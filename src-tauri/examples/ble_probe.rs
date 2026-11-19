//! Bench test for the watch link without the app: `cargo run --example ble_probe`
//! Scans for Bima for Wear OS, connects, prints what the watch sends, and sends it a state
//! message (the watch should switch to its control screen and show "3/38").

use btleplug::api::{Central, Manager as _, Peripheral as _, ScanFilter, WriteType};
use btleplug::platform::Manager;
use futures_util::StreamExt;
use std::time::{Duration, Instant};
use uuid::Uuid;

const SERVICE: Uuid = Uuid::from_u128(0x9adc6dd9_e03e_4f67_9373_995d98b8dfad);
const EVENT: Uuid = Uuid::from_u128(0x703689a9_6b8d_4233_8928_0259e508909c);
const STATE: Uuid = Uuid::from_u128(0x867ca9fb_463e_4778_86d2_1b158a057588);

fn frames(msg: &str) -> Vec<Vec<u8>> {
    let b = msg.as_bytes();
    let n = b.chunks(18).count();
    b.chunks(18)
        .enumerate()
        .map(|(i, c)| [&[if i + 1 == n { 0x80u8 } else { 0 }][..], c].concat())
        .collect()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manager = Manager::new().await?;
    let adapter = manager.adapters().await?.into_iter().next().ok_or("no Bluetooth adapter")?;
    adapter.start_scan(ScanFilter { services: vec![SERVICE] }).await?;
    println!("scanning…");
    let t0 = Instant::now();
    let watch = loop {
        tokio::time::sleep(Duration::from_millis(500)).await;
        let mut hit = None;
        for p in adapter.peripherals().await? {
            if let Some(props) = p.properties().await? {
                if props.services.contains(&SERVICE) {
                    let tag = props.manufacturer_data.get(&0xFFFF).map(|d| String::from_utf8_lossy(d).into_owned());
                    println!("found {:?} tag={:?} rssi={:?} after {:?}", props.address, tag, props.rssi, t0.elapsed());
                    hit = Some(p);
                }
            }
        }
        if let Some(p) = hit {
            break p;
        }
        if t0.elapsed() > Duration::from_secs(20) {
            return Err("watch not found in 20 s".into());
        }
    };
    adapter.stop_scan().await?;

    let t1 = Instant::now();
    watch.connect().await?;
    watch.discover_services().await?;
    println!("connected in {:?}", t1.elapsed());
    let chars = watch.characteristics();
    let event = chars.iter().find(|c| c.uuid == EVENT).ok_or("no EVENT")?.clone();
    let state = chars.iter().find(|c| c.uuid == STATE).ok_or("no STATE")?.clone();
    let mut notes = watch.notifications().await?;
    watch.subscribe(&event).await?;

    let msg = r#"{"t":"st","i":3,"n":38,"it":"בדיקה","nx":"סדר היום","bk":"none","md":0,"pl":0,"el":75,"tl":0,"pj":1}"#;
    let t2 = Instant::now();
    for f in frames(msg) {
        watch.write(&state, &f, WriteType::WithoutResponse).await?;
    }
    println!("state sent ({} bytes) in {:?}", msg.len(), t2.elapsed());

    // listen for 25 s: hello, battery, and any taps on the watch
    let mut buf = Vec::new();
    let end = Instant::now() + Duration::from_secs(25);
    while let Ok(Some(n)) = tokio::time::timeout(end.saturating_duration_since(Instant::now()), notes.next()).await {
        buf.extend_from_slice(&n.value[1..]);
        if n.value[0] & 0x80 != 0 {
            let text = String::from_utf8_lossy(&buf).into_owned();
            println!("watch → {text}");
            // ack taps so the wrist buzzes
            if let Some(s) = text.split("\"s\":").nth(1).and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next()) {
                let ack = format!(r#"{{"t":"ack","s":{s},"ok":1,"bk":"none"}}"#);
                for f in frames(&ack) {
                    watch.write(&state, &f, WriteType::WithoutResponse).await?;
                }
            }
            buf.clear();
        }
    }
    watch.disconnect().await?;
    println!("done");
    Ok(())
}
