//! Watch remote: Bima for Wear OS, over Bluetooth LE.
//!
//! The watch is the BLE peripheral (it advertises the Bima service); this side is the
//! central. One GATT service, two characteristics:
//!   EVENT  watch → Bima (notify): hello, battery, commands, pairing answers
//!   STATE  Bima → watch (write):  live state, acks, haptic alerts, pairing request
//! Messages are small JSON objects in 19-byte frames (1 header byte, 0x80 = last frame) so
//! they fit any MTU. Keep in sync with watch/app/src/main/java/com/bima/watch/Protocol.kt.
//!
//! The UI decides what a command does (same paths as the keyboard and clicker) and what to
//! send back; this module only finds the watch, keeps the link, and moves messages.

use btleplug::api::{Central, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::{Adapter, Manager, Peripheral};
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

const SERVICE: Uuid = Uuid::from_u128(0x9adc6dd9_e03e_4f67_9373_995d98b8dfad);
const EVENT: Uuid = Uuid::from_u128(0x703689a9_6b8d_4233_8928_0259e508909c);
const STATE: Uuid = Uuid::from_u128(0x867ca9fb_463e_4778_86d2_1b158a057588);
const MAKER: u16 = 0xFFFF;
const PAYLOAD: usize = 18;
const LAST: u8 = 0x80;

// ------------------------------------------------------------------ framing

pub fn frames(message: &str) -> Vec<Vec<u8>> {
    let bytes = message.as_bytes();
    let n = bytes.chunks(PAYLOAD).count();
    bytes
        .chunks(PAYLOAD)
        .enumerate()
        .map(|(i, chunk)| {
            let mut f = Vec::with_capacity(chunk.len() + 1);
            f.push(if i + 1 == n { LAST } else { 0 });
            f.extend_from_slice(chunk);
            f
        })
        .collect()
}

#[derive(Default)]
pub struct Reassembler(Vec<u8>);

impl Reassembler {
    pub fn feed(&mut self, frame: &[u8]) -> Option<String> {
        let (&head, body) = frame.split_first()?;
        self.0.extend_from_slice(body);
        if head & LAST == 0 {
            if self.0.len() > 4096 {
                self.0.clear(); // garbage guard
            }
            return None;
        }
        let msg = String::from_utf8_lossy(&self.0).into_owned();
        self.0.clear();
        Some(msg)
    }
}

// ------------------------------------------------------------------ shared state

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    /// key for the UI: the watch id if its scan response arrived, else "p:<peripheral>"
    id: String,
    name: String,
    /// the watch's own id, once known (scan response, or its hello after connecting)
    #[serde(skip)]
    watch: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Status {
    /// off · searching · connected · no-bluetooth
    state: &'static str,
    name: Option<String>,
    battery: Option<i64>,
    /// watches nearby that aren't paired yet
    found: Vec<Found>,
}

struct Ctrl {
    enabled: bool,
    paired: Option<String>,
    /// messages for the connected watch
    tx: Option<mpsc::UnboundedSender<String>>,
    /// a pairing in progress: (found key, code, answer = the watch's id when accepted)
    pairing: Option<(String, String, Option<oneshot::Sender<Option<String>>>)>,
    name: Option<String>,
    battery: Option<i64>,
    found: Vec<Found>,
    state: &'static str,
}

static CTRL: Mutex<Ctrl> = Mutex::new(Ctrl {
    enabled: false,
    paired: None,
    tx: None,
    pairing: None,
    name: None,
    battery: None,
    found: Vec::new(),
    state: "off",
});

fn emit_status(app: &AppHandle) {
    let s = {
        let c = CTRL.lock().unwrap();
        Status { state: c.state, name: c.name.clone(), battery: c.battery, found: c.found.clone() }
    };
    let _ = app.emit("remote-status", s);
}

fn set_state(app: &AppHandle, state: &'static str) {
    let changed = {
        let mut c = CTRL.lock().unwrap();
        let changed = c.state != state;
        c.state = state;
        changed
    };
    if changed {
        emit_status(app);
    }
}

// ------------------------------------------------------------------ commands

/// Turn the watch link on/off, and say which watch is ours (None = not paired yet).
#[tauri::command]
pub fn remote_config(app: AppHandle, enabled: bool, paired: Option<String>) {
    {
        let mut c = CTRL.lock().unwrap();
        let changed_watch = c.paired != paired;
        c.enabled = enabled;
        c.paired = paired;
        if !enabled || changed_watch {
            c.tx = None; // drops the session → it disconnects
        }
        if !enabled {
            c.found.clear();
            c.name = None;
            c.battery = None;
            c.state = "off";
        }
    }
    emit_status(&app);
}

/// Something for the connected watch (state, ack, buzz). Dropped if none is connected.
#[tauri::command]
pub fn remote_send(json: String) {
    if let Some(tx) = CTRL.lock().unwrap().tx.as_ref() {
        let _ = tx.send(json);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paired {
    id: String,
    name: String,
}

/// Pair with a watch found nearby: it shows `code` and asks the presenter to confirm.
#[tauri::command]
pub async fn remote_pair(app: AppHandle, id: String) -> Result<Paired, String> {
    let code = format!("{:04}", rand::random::<u16>() % 10000);
    let (tx, rx) = oneshot::channel();
    {
        let mut c = CTRL.lock().unwrap();
        c.pairing = Some((id.clone(), code.clone(), Some(tx)));
    }
    let _ = app.emit("remote-pair-code", &code);
    let answer = tokio::time::timeout(Duration::from_secs(60), rx).await;
    let name = {
        let mut c = CTRL.lock().unwrap();
        c.pairing = None;
        c.found.iter().find(|f| f.id == id).map(|f| f.name.clone())
    };
    match answer {
        Ok(Ok(Some(watch))) => {
            let name = name.unwrap_or_else(|| "Galaxy Watch".into());
            {
                let mut c = CTRL.lock().unwrap();
                c.paired = Some(watch.clone());
                c.found.retain(|f| f.id != id);
            }
            Ok(Paired { id: watch, name })
        }
        Ok(Ok(None)) => Err("החיבור בוטל בשעון".into()),
        _ => Err("לא התקבל אישור מהשעון".into()),
    }
}

// ------------------------------------------------------------------ the link

/// Runs for the app's lifetime: find our watch, keep it connected, reconnect when lost.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            if !CTRL.lock().unwrap().enabled {
                tokio::time::sleep(Duration::from_millis(800)).await;
                continue;
            }
            let adapter = match adapter().await {
                Some(a) => a,
                None => {
                    set_state(&app, "no-bluetooth");
                    tokio::time::sleep(Duration::from_secs(3)).await;
                    continue;
                }
            };
            set_state(&app, "searching");
            if let Err(e) = round(&app, &adapter).await {
                eprintln!("remote: {e}");
            }
            tokio::time::sleep(Duration::from_millis(600)).await;
        }
    });
}

async fn adapter() -> Option<Adapter> {
    let manager = Manager::new().await.ok()?;
    manager.adapters().await.ok()?.into_iter().next()
}

/// One scan; connect to our watch if it's there (or to the one being paired).
async fn round(app: &AppHandle, adapter: &Adapter) -> Result<(), String> {
    adapter.start_scan(ScanFilter { services: vec![SERVICE] }).await.map_err(|e| e.to_string())?;
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let peripherals = adapter.peripherals().await.map_err(|e| e.to_string())?;
    let mut nearby: Vec<(Found, Peripheral)> = Vec::new();
    for p in peripherals {
        let Ok(Some(props)) = p.properties().await else { continue };
        if !props.services.contains(&SERVICE) {
            continue;
        }
        // scan response "id|name" - Windows doesn't always merge it into what it reports, so
        // a watch without it is still a candidate; its hello tells us who it is
        let tag = props.manufacturer_data.get(&MAKER).map(|d| String::from_utf8_lossy(d).into_owned());
        let fallback = props.local_name.clone().map(|n| n.split(" (").next().unwrap_or(&n).to_string());
        let found = match tag.as_deref().and_then(|t| t.split_once('|')) {
            Some((id, name)) => Found {
                id: id.to_string(),
                name: if name.is_empty() { fallback.unwrap_or_else(|| "Galaxy Watch".into()) } else { name.to_string() },
                watch: Some(id.to_string()),
            },
            None => Found {
                id: format!("p:{}", p.id()),
                name: fallback.unwrap_or_else(|| "Galaxy Watch".into()),
                watch: tag.filter(|t| !t.is_empty()),
            },
        };
        if not_ours(&found.id) {
            continue;
        }
        nearby.push((found, p));
    }
    let _ = adapter.stop_scan().await;

    let (paired, pairing) = {
        let c = CTRL.lock().unwrap();
        (c.paired.clone(), c.pairing.as_ref().map(|(id, _, _)| id.clone()))
    };
    {
        let mut c = CTRL.lock().unwrap();
        let found: Vec<Found> = nearby.iter().map(|(f, _)| f.clone()).filter(|f| Some(&f.id) != paired.as_ref()).collect();
        if found.iter().map(|f| &f.id).ne(c.found.iter().map(|f| &f.id)) {
            c.found = found;
            drop(c);
            emit_status(app);
        }
    }

    // pairing: the one the presenter picked
    if let Some(key) = pairing {
        if let Some((found, p)) = nearby.into_iter().find(|(f, _)| f.id == key) {
            return session(app, p, found, None).await;
        }
        return Ok(());
    }
    let Some(paired) = paired else { return Ok(()) };
    // ours by its scan response, or an unknown Bima watch we check by its hello
    let pick = nearby
        .iter()
        .position(|(f, _)| f.watch.as_deref() == Some(paired.as_str()))
        .or_else(|| nearby.iter().position(|(f, _)| f.watch.is_none()));
    let Some(i) = pick else { return Ok(()) };
    let (found, p) = nearby.swap_remove(i);
    session(app, p, found, Some(paired)).await
}

/// Watches that turned out to be someone else's: skipped for a minute.
static NOT_OURS: Mutex<Vec<(String, std::time::Instant)>> = Mutex::new(Vec::new());

fn not_ours(key: &str) -> bool {
    let mut v = NOT_OURS.lock().unwrap();
    v.retain(|(_, t)| t.elapsed() < Duration::from_secs(60));
    v.iter().any(|(k, _)| k == key)
}

/// Connected: pump messages both ways until the link drops or is turned off.
async fn session(app: &AppHandle, p: Peripheral, mut found: Found, expect: Option<String>) -> Result<(), String> {
    let e = |e: btleplug::Error| e.to_string();
    p.connect().await.map_err(e)?;
    p.discover_services().await.map_err(e)?;
    let chars = p.characteristics();
    let find = |u: Uuid| chars.iter().find(|c| c.uuid == u).cloned();
    let (Some(event), Some(state)) = (find(EVENT), find(STATE)) else {
        let _ = p.disconnect().await;
        return Err("watch has no Bima service".into());
    };
    let mut notes = p.notifications().await.map_err(e)?;
    p.subscribe(&event).await.map_err(e)?;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    let pairing_code = {
        let mut c = CTRL.lock().unwrap();
        c.tx = Some(tx.clone());
        c.name = Some(found.name.clone());
        c.pairing.as_ref().filter(|(id, _, _)| *id == found.id).map(|(_, code, _)| code.clone())
    };
    if let Some(code) = pairing_code {
        let pc = hostname();
        let _ = tx.send(serde_json::json!({ "t": "pair", "code": code, "pc": pc }).to_string());
    } else if found.watch.is_some() && found.watch == expect {
        set_state(app, "connected");
        let _ = app.emit("remote-connected", ());
    }
    // not sure who this is yet: give it a moment to say hello
    let deadline = std::time::Instant::now() + Duration::from_secs(4);

    let mut inbox = Reassembler::default();
    let mut alive = tokio::time::interval(Duration::from_secs(2));
    let outcome = loop {
        tokio::select! {
            note = notes.next() => {
                let Some(note) = note else { break "stream ended" };
                if note.uuid != EVENT { continue }
                if let Some(msg) = inbox.feed(&note.value) {
                    match learn(&msg, &mut found, expect.as_deref()) {
                        Some(true) => {
                            set_state(app, "connected");
                            let _ = app.emit("remote-connected", ());
                        }
                        Some(false) => {
                            NOT_OURS.lock().unwrap().push((found.id.clone(), std::time::Instant::now()));
                            break "not ours";
                        }
                        None => {}
                    }
                    handle(app, &msg, &found);
                }
            }
            out = rx.recv() => {
                let Some(msg) = out else { break "turned off" };
                if write(&p, &state, &msg).await.is_err() { break "write failed" }
            }
            _ = alive.tick() => {
                if !p.is_connected().await.unwrap_or(false) { break "disconnected" }
                if expect.is_some() && found.watch.is_none() && std::time::Instant::now() > deadline { break "no hello" }
                // config changed (turned off / other watch) → our sender was replaced
                if CTRL.lock().unwrap().tx.as_ref().map(|t| !t.same_channel(&tx)).unwrap_or(true) { break "replaced" }
            }
        }
    };
    let _ = p.disconnect().await;
    {
        let mut c = CTRL.lock().unwrap();
        if c.tx.as_ref().map(|t| t.same_channel(&tx)).unwrap_or(false) {
            c.tx = None;
        }
        c.battery = None;
    }
    set_state(app, if CTRL.lock().unwrap().enabled { "searching" } else { "off" });
    let _ = app.emit("remote-lost", outcome);
    Ok(())
}

/// From the watch's hello: who it is. Some(true) = it's the paired watch (just learned),
/// Some(false) = someone else's, None = nothing new.
fn learn(msg: &str, found: &mut Found, expect: Option<&str>) -> Option<bool> {
    let v: Value = serde_json::from_str(msg).ok()?;
    if v["t"] != "hi" {
        return None;
    }
    let id = v["id"].as_str()?.to_string();
    let was_known = found.watch.is_some();
    found.watch = Some(id.clone());
    match expect {
        Some(e) if e != id => Some(false),
        Some(_) if !was_known => Some(true),
        _ => None,
    }
}

async fn write(p: &Peripheral, ch: &Characteristic, msg: &str) -> Result<(), btleplug::Error> {
    for f in frames(msg) {
        p.write(ch, &f, WriteType::WithoutResponse).await?;
    }
    Ok(())
}

fn handle(app: &AppHandle, msg: &str, found: &Found) {
    let Ok(v) = serde_json::from_str::<Value>(msg) else { return };
    match v["t"].as_str().unwrap_or("") {
        "hi" => {
            {
                let mut c = CTRL.lock().unwrap();
                if let Some(n) = v["n"].as_str() {
                    c.name = Some(n.to_string());
                }
                c.battery = v["bat"].as_i64();
            }
            emit_status(app);
        }
        "bat" => {
            CTRL.lock().unwrap().battery = v["v"].as_i64();
            emit_status(app);
        }
        "c" => {
            // only the paired watch drives the show
            if found.watch.is_some() && CTRL.lock().unwrap().paired == found.watch {
                let _ = app.emit("remote-command", v);
            }
        }
        kind @ ("pair_ok" | "pair_no") => {
            let mut c = CTRL.lock().unwrap();
            if let Some((id, code, answer)) = c.pairing.as_mut() {
                if *id == found.id && v["code"].as_str() == Some(code.as_str()) {
                    if let Some(a) = answer.take() {
                        let _ = a.send(if kind == "pair_ok" { found.watch.clone() } else { None });
                    }
                }
            }
            drop(c);
            if kind == "pair_ok" {
                set_state(app, "connected");
                let _ = app.emit("remote-connected", ());
            }
        }
        _ => {}
    }
}

fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "בימה".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frames_round_trip() {
        let msg = r#"{"t":"st","i":3,"n":38,"nx":"סדר היום","bk":"none"}"#;
        let fs = frames(msg);
        assert!(fs.iter().all(|f| f.len() <= 19));
        assert_eq!(fs.iter().filter(|f| f[0] & LAST != 0).count(), 1);
        let mut r = Reassembler::default();
        let out: Vec<String> = fs.iter().filter_map(|f| r.feed(f)).collect();
        assert_eq!(out, vec![msg.to_string()]);
    }

    #[test]
    fn two_messages_in_a_row() {
        let mut r = Reassembler::default();
        let mut got = Vec::new();
        for m in ["{\"t\":\"ack\",\"s\":1}", "{\"t\":\"buzz\",\"p\":\"time5\"}"] {
            for f in frames(m) {
                if let Some(x) = r.feed(&f) {
                    got.push(x);
                }
            }
        }
        assert_eq!(got.len(), 2);
    }
}
