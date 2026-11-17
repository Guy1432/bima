//! Bima Cloud - Supabase (accounts + projects) and Cloudflare R2 (media, via the
//! `bima-media` Worker).
//!
//! * Sign-in: 6-digit code sent by email (Supabase Auth OTP). The refresh token lives in
//!   the Windows Credential Manager (keyring), never in a file.
//! * Projects: one row per session in `public.projects` (RLS: a user only ever sees their
//!   own rows). The server stamps `updated_at`, which is how we tell what changed where.
//! * Media: uploaded once to R2 under `<user id>/<file>`; every computer keeps a local
//!   copy, so projection never depends on the internet.
//! * Model: the local library stays the working copy (fast, works offline). A background
//!   engine mirrors it both ways, with conflict copies when both sides changed.

use crate::e2s;
use crate::library::{mtime_ms, sessions_dir};
use crate::media::{data_dir, media_dir, safe_name};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

pub const SUPABASE_URL: &str = "https://iavnqpirnihirkvpnvpg.supabase.co";
pub const SUPABASE_KEY: &str = "sb_publishable_JRIwBhmYICh6LSpdvqd-Lw_vjfiN8oI";
const MEDIA_URL: &str = "https://bima-media.bima-media.workers.dev";
const KEYRING_SERVICE: &str = "bima-cloud";
/// Worker request bodies are capped at 100 MB → bigger files go up in parts.
const SINGLE_PUT_MAX: u64 = 90 * 1024 * 1024;
const PART: u64 = 50 * 1024 * 1024;

fn http() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(concat!("Bima/", env!("CARGO_PKG_VERSION")))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("http client")
    })
}

fn offline(e: reqwest::Error) -> String {
    format!("offline: {e}")
}

// ------------------------------------------------------------------ account + tokens

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Account {
    id: String,
    email: String,
}

fn account_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("cloud-account.json"))
}
fn read_account(app: &AppHandle) -> Option<Account> {
    serde_json::from_str(&fs::read_to_string(account_file(app).ok()?).ok()?).ok()
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, "refresh_token").map_err(e2s)
}
fn refresh_token() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}
pub fn signed_in() -> bool {
    refresh_token().is_some()
}

struct Access {
    token: String,
    expires: Instant,
}
static ACCESS: Mutex<Option<Access>> = Mutex::new(None);
/// Supabase rotates refresh tokens: only one refresh may be in flight.
static REFRESHING: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn store_session(v: &Value) -> Result<(String, Account), String> {
    let token = v["access_token"].as_str().ok_or("no access_token")?.to_string();
    let refresh = v["refresh_token"].as_str().ok_or("no refresh_token")?;
    let ttl = v["expires_in"].as_u64().unwrap_or(3600);
    keyring_entry()?.set_password(refresh).map_err(e2s)?;
    *ACCESS.lock().unwrap() = Some(Access { token: token.clone(), expires: Instant::now() + Duration::from_secs(ttl) });
    let acc = Account {
        id: v["user"]["id"].as_str().unwrap_or_default().to_string(),
        email: v["user"]["email"].as_str().unwrap_or_default().to_string(),
    };
    Ok((token, acc))
}

fn cached_token() -> Option<String> {
    let g = ACCESS.lock().unwrap();
    let a = g.as_ref()?;
    (a.expires > Instant::now() + Duration::from_secs(120)).then(|| a.token.clone())
}

async fn access_token(app: &AppHandle) -> Result<String, String> {
    if let Some(t) = cached_token() {
        return Ok(t);
    }
    let _guard = REFRESHING.lock().await;
    if let Some(t) = cached_token() {
        return Ok(t); // refreshed while we waited
    }
    let rt = refresh_token().ok_or("לא מחובר לענן")?;
    let res = http()
        .post(format!("{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"))
        .header("apikey", SUPABASE_KEY)
        .json(&json!({ "refresh_token": rt }))
        .send()
        .await
        .map_err(offline)?;
    let status = res.status();
    let v: Value = res.json().await.map_err(e2s)?;
    if !status.is_success() {
        if status.as_u16() == 400 || status.as_u16() == 401 {
            // revoked / expired / reused → force a fresh sign-in
            let _ = keyring_entry().and_then(|e| e.delete_credential().map_err(e2s));
            let _ = app.emit("cloud-signed-out", ());
            return Err("ההתחברות לענן פגה - יש להתחבר מחדש".into());
        }
        return Err(format!("שגיאת התחברות ({status})"));
    }
    let (token, acc) = store_session(&v)?;
    if !acc.email.is_empty() {
        let _ = fs::write(account_file(app)?, serde_json::to_string(&acc).unwrap_or_default());
    }
    Ok(token)
}

fn auth_error(v: &Value) -> String {
    let code = v["error_code"].as_str().or(v["code"].as_str()).unwrap_or("");
    let msg = v["msg"].as_str().or(v["error_description"].as_str()).or(v["message"].as_str()).unwrap_or("");
    match code {
        "otp_expired" => "הקוד שגוי או שפג תוקפו - בקש קוד חדש".into(),
        "over_email_send_rate_limit" | "over_request_rate_limit" => "יותר מדי ניסיונות - נסה שוב בעוד כמה דקות".into(),
        "email_address_invalid" | "validation_failed" => "כתובת המייל לא תקינה".into(),
        _ if msg.is_empty() => "שגיאה לא צפויה".into(),
        _ => msg.to_string(),
    }
}

// ------------------------------------------------------------------ commands: sign-in

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudStatus {
    signed_in: bool,
    account: Option<Account>,
}

#[tauri::command]
pub fn cloud_status(app: AppHandle) -> CloudStatus {
    CloudStatus { signed_in: signed_in(), account: read_account(&app) }
}

#[tauri::command]
pub async fn cloud_send_code(email: String) -> Result<(), String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        return Err("כתובת המייל לא תקינה".into());
    }
    let res = http()
        .post(format!("{SUPABASE_URL}/auth/v1/otp"))
        .header("apikey", SUPABASE_KEY)
        .json(&json!({ "email": email, "create_user": true }))
        .send()
        .await
        .map_err(|_| "אין חיבור לאינטרנט".to_string())?;
    if res.status().is_success() {
        return Ok(());
    }
    let v: Value = res.json().await.unwrap_or_default();
    Err(auth_error(&v))
}

#[tauri::command]
pub async fn cloud_verify_code(app: AppHandle, email: String, code: String) -> Result<Account, String> {
    let email = email.trim().to_lowercase();
    let code: String = code.chars().filter(|c| c.is_ascii_digit()).collect();
    let res = http()
        .post(format!("{SUPABASE_URL}/auth/v1/verify"))
        .header("apikey", SUPABASE_KEY)
        .json(&json!({ "type": "email", "email": email, "token": code }))
        .send()
        .await
        .map_err(|_| "אין חיבור לאינטרנט".to_string())?;
    let ok = res.status().is_success();
    let v: Value = res.json().await.map_err(e2s)?;
    if !ok {
        return Err(auth_error(&v));
    }
    let (_, acc) = store_session(&v)?;
    fs::write(account_file(&app)?, serde_json::to_string(&acc).map_err(e2s)?).map_err(e2s)?;
    crate::library::leave_cloud_folder(&app);
    start_sync_loop(app.clone());
    kick(app);
    Ok(acc)
}

#[tauri::command]
pub async fn cloud_logout(app: AppHandle) -> Result<(), String> {
    if let Some(t) = cached_token() {
        let _ = http()
            .post(format!("{SUPABASE_URL}/auth/v1/logout"))
            .header("apikey", SUPABASE_KEY)
            .bearer_auth(t)
            .send()
            .await;
    }
    let _ = keyring_entry().and_then(|e| e.delete_credential().map_err(e2s));
    *ACCESS.lock().unwrap() = None;
    let _ = fs::remove_file(account_file(&app)?);
    let _ = fs::remove_file(state_file(&app)?);
    emit_status(&app, "off", "", None);
    Ok(())
}

// ------------------------------------------------------------------ sign-in by email link
//
// Supabase's default email contains a link. We ask it to redirect that link to a tiny
// server Bima runs on 127.0.0.1 while waiting; the page hands the session (in the URL
// fragment) to Bima, which signs in. No email-template or SMTP setup needed.

const LINK_PORT: u16 = 53987;
static LISTENING: AtomicBool = AtomicBool::new(false);
/// One-time secret in the link's path (/auth/<nonce>). The local listener only accepts a
/// session that comes back with it — another page on this computer can't inject a foreign
/// session (login-CSRF / session fixation), because it can't know the nonce.
static LINK_NONCE: Mutex<String> = Mutex::new(String::new());

fn new_nonce() -> String {
    (0..24).map(|_| format!("{:x}", rand::random::<u8>() % 16)).collect()
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        match b[i] {
            b'%' if i + 2 < b.len() => {
                if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
                out.push(b'%');
            }
            b'+' => out.push(b' '),
            c => out.push(c),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn query_map(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| kv.split_once('=').map(|(k, v)| (pct_decode(k), pct_decode(v))))
        .collect()
}

const LINK_PAGE: &str = r#"<!doctype html><html dir="rtl" lang="he"><meta charset="utf-8"><title>בימה</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#09090b;color:#fafafa;font-family:Segoe UI,Arial,sans-serif}
.c{text-align:center}.l{width:56px;height:56px;border-radius:16px;background:#6366f1;display:grid;place-items:center;font-size:28px;font-weight:900;margin:0 auto 18px}
h1{font-size:22px;margin:0 0 6px}p{color:#a1a1aa;margin:0}</style>
<div class="c"><div class="l">ב</div><h1 id="t">מתחבר לבימה…</h1><p id="d">רגע אחד</p></div>
<script>
const h=new URLSearchParams(location.hash.slice(1)),q=new URLSearchParams(location.search);
const err=h.get('error_description')||q.get('error_description');
const t=document.getElementById('t'),d=document.getElementById('d');
const n=location.pathname.split('/').pop();
if(err){t.textContent='הקישור לא תקין';d.textContent='ייתכן שפג תוקפו - בקש קישור חדש בבימה.';fetch('/done/'+n+'?error='+encodeURIComponent(err));}
else fetch('/done/'+n+'?'+location.hash.slice(1)).then(r=>r.text()).then(x=>{
 if(x==='ok'){t.textContent='מחובר! ✓';d.textContent='אפשר לסגור את הלשונית ולחזור לבימה.';}
 else{t.textContent='ההתחברות נכשלה';d.textContent=x;}
});
</script></html>"#;

fn respond(stream: &mut std::net::TcpStream, ctype: &str, body: &str) {
    use std::io::Write;
    let _ = write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: {ctype}; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
}

async fn finish_link_sign_in(app: &AppHandle, q: &HashMap<String, String>) -> Result<Account, String> {
    if let Some(e) = q.get("error") {
        return Err(e.clone());
    }
    let token = q.get("access_token").ok_or("חסר אסימון")?;
    let res = http()
        .get(format!("{SUPABASE_URL}/auth/v1/user"))
        .header("apikey", SUPABASE_KEY)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|_| "אין חיבור לאינטרנט".to_string())?;
    if !res.status().is_success() {
        return Err("הקישור לא תקין".into());
    }
    let user: Value = res.json().await.map_err(e2s)?;
    let v = json!({
        "access_token": token,
        "refresh_token": q.get("refresh_token").cloned().unwrap_or_default(),
        "expires_in": q.get("expires_in").and_then(|x| x.parse::<u64>().ok()).unwrap_or(3600),
        "user": user,
    });
    let (_, acc) = store_session(&v)?;
    fs::write(account_file(app)?, serde_json::to_string(&acc).map_err(e2s)?).map_err(e2s)?;
    crate::library::leave_cloud_folder(&app);
    start_sync_loop(app.clone());
    kick(app.clone());
    Ok(acc)
}

/// Serve the link-landing page until the user clicks the email link (or 30 minutes pass).
fn start_link_listener(app: AppHandle) -> Result<(), String> {
    if LISTENING.swap(true, Ordering::SeqCst) {
        return Ok(()); // already waiting
    }
    let listener = match std::net::TcpListener::bind(("127.0.0.1", LINK_PORT)) {
        Ok(l) => l,
        Err(_) => {
            LISTENING.store(false, Ordering::SeqCst);
            return Err("תוכנה אחרת תופסת את פורט ההתחברות - סגור אותה ונסה שוב".into());
        }
    };
    let _ = listener.set_nonblocking(true);
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(30 * 60);
        while Instant::now() < deadline {
            let (mut stream, _) = match listener.accept() {
                Ok(c) => c,
                Err(_) => {
                    std::thread::sleep(Duration::from_millis(150));
                    continue;
                }
            };
            let _ = stream.set_nonblocking(false);
            let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
            let mut buf = [0u8; 8192];
            let n = stream.read(&mut buf).unwrap_or(0);
            let req = String::from_utf8_lossy(&buf[..n]).into_owned();
            let target = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/").to_string();
            let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
            match path {
                p if p.starts_with("/auth/") => respond(&mut stream, "text/html", LINK_PAGE),
                p if p.starts_with("/done/") => {
                    let nonce = LINK_NONCE.lock().unwrap().clone();
                    if nonce.is_empty() || p.trim_start_matches("/done/") != nonce {
                        respond(&mut stream, "text/plain", "הקישור לא תקף. בקש קישור חדש בבימה.");
                        continue;
                    }
                    let q = query_map(query);
                    match tauri::async_runtime::block_on(finish_link_sign_in(&app, &q)) {
                        Ok(acc) => {
                            respond(&mut stream, "text/plain", "ok");
                            LINK_NONCE.lock().unwrap().clear(); // one-time
                            let _ = app.emit("cloud-signed-in", &acc);
                            break;
                        }
                        Err(e) => {
                            respond(&mut stream, "text/plain", &e);
                            let _ = app.emit("cloud-signin-error", &e);
                        }
                    }
                }
                _ => respond(&mut stream, "text/plain", ""),
            }
        }
        LISTENING.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
pub async fn cloud_send_link(app: AppHandle, email: String) -> Result<(), String> {
    let email = email.trim().to_lowercase();
    if !email.contains('@') {
        return Err("כתובת המייל לא תקינה".into());
    }
    start_link_listener(app)?;
    let nonce = new_nonce();
    *LINK_NONCE.lock().unwrap() = nonce.clone();
    let redirect = urlenc(&format!("http://127.0.0.1:{LINK_PORT}/auth/{nonce}"));
    let res = http()
        .post(format!("{SUPABASE_URL}/auth/v1/otp?redirect_to={redirect}"))
        .header("apikey", SUPABASE_KEY)
        .json(&json!({ "email": email, "create_user": true }))
        .send()
        .await
        .map_err(|_| "אין חיבור לאינטרנט".to_string())?;
    if res.status().is_success() {
        return Ok(());
    }
    let v: Value = res.json().await.unwrap_or_default();
    Err(auth_error(&v))
}

/// For the UI's realtime subscription (live updates from other computers).
#[tauri::command]
pub async fn cloud_access_token(app: AppHandle) -> Result<String, String> {
    access_token(&app).await
}

#[tauri::command]
pub fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("bad url".into());
    }
    open::that(url).map_err(e2s)
}

// ------------------------------------------------------------------ REST helpers

fn rest(method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
    http()
        .request(method, format!("{SUPABASE_URL}/rest/v1/{path}"))
        .header("apikey", SUPABASE_KEY)
        .bearer_auth(token)
}

async fn check(res: reqwest::Response) -> Result<reqwest::Response, String> {
    if res.status().is_success() {
        return Ok(res);
    }
    let status = res.status();
    let body = res.text().await.unwrap_or_default();
    let detail: String = body.chars().take(200).collect();
    match status.as_u16() {
        401 => {
            *ACCESS.lock().unwrap() = None; // the next attempt refreshes the token
            Err(format!("unauthorized: {detail}"))
        }
        429 | 500..=599 => Err(format!("transient: {status} {detail}")),
        _ => Err(format!("שגיאת ענן {status}: {detail}")),
    }
}

/// Project row metadata (cheap listing: no document bodies).
#[derive(Deserialize, Clone)]
struct RemoteRow {
    id: String,
    rev: i64,
    updated_at: String,
    deleted: bool,
}

/// Full row, fetched only for projects the plan actually needs.
#[derive(Deserialize, Clone)]
struct FullRow {
    id: String,
    rev: i64,
    updated_at: String,
    data: Value,
}

/// Result of a compare-and-swap write.
enum Write {
    /// written; the server's new revision
    Done(i64),
    /// the server copy moved on since our base revision — nothing was written
    Conflict,
}

async fn list_projects(token: &str) -> Result<Vec<RemoteRow>, String> {
    let res = rest(reqwest::Method::GET, "projects?select=id,rev,updated_at,deleted", token).send().await.map_err(offline)?;
    check(res).await?.json().await.map_err(e2s)
}

/// Batch fetch (one request per 40 projects instead of one per project).
async fn fetch_projects(token: &str, ids: &[String]) -> Result<HashMap<String, FullRow>, String> {
    let mut out = HashMap::new();
    for chunk in ids.chunks(40) {
        // ids are validated by `safe_name` (letters, digits, - _ .) → safe inside in.(…)
        let list = chunk.join(",");
        let res = rest(reqwest::Method::GET, &format!("projects?select=id,rev,updated_at,data&id=in.({list})"), token)
            .send()
            .await
            .map_err(offline)?;
        let rows: Vec<FullRow> = check(res).await?.json().await.map_err(e2s)?;
        out.extend(rows.into_iter().map(|r| (r.id.clone(), r)));
    }
    Ok(out)
}

fn project_body(doc: &Value, device: &str) -> Value {
    json!({ "name": doc["name"].as_str().unwrap_or(""), "data": doc, "deleted": false, "device": device })
}

/// Insert a project that must not exist yet. A 409 (it does exist) is a conflict, not an error.
async fn insert_project(token: &str, owner: &str, device: &str, id: &str, doc: &Value) -> Result<Write, String> {
    let mut body = project_body(doc, device);
    body["owner"] = json!(owner);
    body["id"] = json!(id);
    let res = rest(reqwest::Method::POST, "projects", token)
        .header("Prefer", "return=representation")
        .json(&json!([body]))
        .send()
        .await
        .map_err(offline)?;
    if res.status().as_u16() == 409 {
        return Ok(Write::Conflict);
    }
    let rows: Vec<Value> = check(res).await?.json().await.map_err(e2s)?;
    Ok(rows.first().and_then(|r| r["rev"].as_i64()).map(Write::Done).unwrap_or(Write::Conflict))
}

/// Compare-and-swap update: only applies if the server is still at `base` (also revives a
/// tombstone). Zero rows back ⇒ someone else wrote first ⇒ Conflict.
async fn update_project(token: &str, device: &str, id: &str, base: i64, doc: &Value) -> Result<Write, String> {
    let res = rest(reqwest::Method::PATCH, &format!("projects?id=eq.{id}&rev=eq.{base}"), token)
        .header("Prefer", "return=representation")
        .json(&project_body(doc, device))
        .send()
        .await
        .map_err(offline)?;
    let rows: Vec<Value> = check(res).await?.json().await.map_err(e2s)?;
    Ok(rows.first().and_then(|r| r["rev"].as_i64()).map(Write::Done).unwrap_or(Write::Conflict))
}

/// Compare-and-swap tombstone (soft delete — recoverable on the server).
async fn tombstone_project(token: &str, device: &str, id: &str, base: i64) -> Result<Write, String> {
    let res = rest(reqwest::Method::PATCH, &format!("projects?id=eq.{id}&rev=eq.{base}"), token)
        .header("Prefer", "return=representation")
        .json(&json!({ "deleted": true, "device": device }))
        .send()
        .await
        .map_err(offline)?;
    let rows: Vec<Value> = check(res).await?.json().await.map_err(e2s)?;
    Ok(rows.first().and_then(|r| r["rev"].as_i64()).map(Write::Done).unwrap_or(Write::Conflict))
}

/// Retry transient failures (network blip, 5xx, 429, expired token) with exponential
/// backoff + jitter. Each attempt gets a fresh token, so a mid-pass expiry just refreshes.
async fn retry<T, Fut>(app: &AppHandle, f: impl Fn(String) -> Fut) -> Result<T, String>
where
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let mut delay = 400u64;
    for attempt in 0..3 {
        let token = access_token(app).await?;
        match f(token).await {
            Ok(v) => return Ok(v),
            Err(e) if attempt < 2 && is_transient(&e) => {
                let jitter = rand::random::<u64>() % 250;
                tokio::time::sleep(Duration::from_millis(delay + jitter)).await;
                delay *= 3;
            }
            Err(e) => return Err(e),
        }
    }
    unreachable!()
}

fn is_transient(e: &str) -> bool {
    e.starts_with("offline") || e.starts_with("transient") || e.starts_with("unauthorized")
}

async fn list_media(token: &str) -> Result<HashSet<String>, String> {
    #[derive(Deserialize)]
    struct Row {
        file: String,
    }
    let res = rest(reqwest::Method::GET, "media?select=file", token).send().await.map_err(offline)?;
    let rows: Vec<Row> = check(res).await?.json().await.map_err(e2s)?;
    Ok(rows.into_iter().map(|r| r.file).collect())
}

async fn record_media(token: &str, owner: &str, file: &str, size: u64) -> Result<(), String> {
    let res = rest(reqwest::Method::POST, "media?on_conflict=owner,file", token)
        .header("Prefer", "resolution=merge-duplicates")
        .json(&json!([{ "owner": owner, "file": file, "size": size }]))
        .send()
        .await
        .map_err(offline)?;
    check(res).await.map(|_| ())
}

// ------------------------------------------------------------------ media (R2 via Worker)

fn media_req(method: reqwest::Method, path: &str, token: &str) -> reqwest::RequestBuilder {
    http().request(method, format!("{MEDIA_URL}{path}")).bearer_auth(token)
}

fn read_range(path: &Path, start: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut f = fs::File::open(path).map_err(e2s)?;
    f.seek(SeekFrom::Start(start)).map_err(e2s)?;
    let mut buf = Vec::with_capacity(len as usize);
    f.take(len).read_to_end(&mut buf).map_err(e2s)?;
    Ok(buf)
}

async fn upload_media(token: &str, file: &str, path: &Path, mut progress: impl FnMut(u64, u64)) -> Result<u64, String> {
    let size = fs::metadata(path).map_err(e2s)?.len();
    if size <= SINGLE_PUT_MAX {
        let bytes = tokio::fs::read(path).await.map_err(e2s)?;
        let res = media_req(reqwest::Method::PUT, &format!("/m/{file}"), token)
            .body(bytes)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(offline)?;
        check(res).await?;
        progress(size, size);
        return Ok(size);
    }
    // multipart: 50 MB parts
    let res = media_req(reqwest::Method::POST, &format!("/mp/{file}?op=create"), token).send().await.map_err(offline)?;
    let upload_id = check(res).await?.json::<Value>().await.map_err(e2s)?["uploadId"].as_str().ok_or("no uploadId")?.to_string();
    let mut parts = Vec::new();
    let mut sent = 0u64;
    let mut n = 1u32;
    while sent < size {
        let len = PART.min(size - sent);
        let chunk = read_range(path, sent, len)?;
        let res = media_req(reqwest::Method::PUT, &format!("/mp/{file}?uploadId={}&part={n}", urlenc(&upload_id)), token)
            .body(chunk)
            .timeout(Duration::from_secs(600))
            .send()
            .await
            .map_err(offline)?;
        let v: Value = check(res).await?.json().await.map_err(e2s)?;
        parts.push(json!({ "partNumber": v["partNumber"], "etag": v["etag"] }));
        sent += len;
        n += 1;
        progress(sent, size);
    }
    let res = media_req(reqwest::Method::POST, &format!("/mp/{file}?op=complete&uploadId={}", urlenc(&upload_id)), token)
        .json(&json!({ "parts": parts }))
        .send()
        .await
        .map_err(offline)?;
    check(res).await?;
    Ok(size)
}

async fn download_media(token: &str, file: &str, dest: &Path) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;
    let res = media_req(reqwest::Method::GET, &format!("/m/{file}"), token).send().await.map_err(offline)?;
    let res = check(res).await?;
    let expected = res.content_length();
    let tmp = dest.with_extension("part");
    let mut out = tokio::fs::File::create(&tmp).await.map_err(e2s)?;
    let mut stream = res.bytes_stream();
    while let Some(chunk) = stream.next().await {
        out.write_all(&chunk.map_err(offline)?).await.map_err(e2s)?;
    }
    out.flush().await.map_err(e2s)?;
    drop(out);
    if let Some(len) = expected {
        let got = fs::metadata(&tmp).map(|m| m.len()).unwrap_or(0);
        if got != len {
            let _ = fs::remove_file(&tmp);
            return Err(format!("transient: truncated download ({got} of {len} bytes)"));
        }
    }
    fs::rename(&tmp, dest).map_err(e2s)
}

fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

// ------------------------------------------------------------------ content helpers

/// Canonical JSON (object keys sorted) - Postgres jsonb reorders keys, the app doesn't,
/// so hashing the raw text would see differences that aren't there.
fn canon(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String((*k).clone()).to_string());
                out.push(':');
                canon(&m[*k], out);
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                canon(x, out);
            }
            out.push(']');
        }
        // numbers: normalise 1 vs 1.0
        Value::Number(n) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e15 => out.push_str(&format!("{}", f as i64)),
            _ => out.push_str(&n.to_string()),
        },
        other => out.push_str(&other.to_string()),
    }
}

fn hash_value(v: &Value) -> String {
    use sha2::{Digest, Sha256};
    let mut s = String::new();
    canon(v, &mut s);
    let d = Sha256::digest(s.as_bytes());
    d.iter().map(|b| format!("{b:02x}")).collect()
}

fn read_json(p: &Path) -> Option<Value> {
    serde_json::from_str(&fs::read_to_string(p).ok()?).ok()
}

fn write_json(p: &Path, v: &Value) -> Result<(), String> {
    let tmp = p.with_extension("json.cloud");
    fs::write(&tmp, serde_json::to_vec(v).map_err(e2s)?).map_err(e2s)?;
    fs::rename(&tmp, p).map_err(e2s)
}

fn is_empty_project(v: &Value) -> bool {
    v["items"].as_array().map(|a| a.is_empty()).unwrap_or(true)
}

/// Conflicts resolve like Google Docs: the newer version simply wins — no duplicate
/// projects appear. The version that lost is kept in a hidden local history
/// (sessions/.versions, never listed, never synced) so nothing is ever really lost.
fn keep_version(sdir: &Path, id: &str, doc: &Value) {
    let dir = sdir.join(".versions");
    if fs::create_dir_all(&dir).is_err() {
        return;
    }
    let _ = write_json(&dir.join(format!("{id}-{}.json", now_ms())), doc);
    // keep the 20 most recent per project
    if let Ok(rd) = fs::read_dir(&dir) {
        let mut mine: Vec<PathBuf> = rd
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.file_name().map(|n| n.to_string_lossy().starts_with(&format!("{id}-"))).unwrap_or(false))
            .collect();
        mine.sort();
        let excess = mine.len().saturating_sub(20);
        for p in mine.into_iter().take(excess) {
            let _ = fs::remove_file(p);
        }
    }
}

/// "2026-11-16T15:25:04.943217+00:00" → unix ms (UTC offsets honoured).
fn parse_ts_ms(s: &str) -> u64 {
    let b = s.as_bytes();
    let num = |a: usize, n: usize| -> i64 { s.get(a..a + n).and_then(|x| x.parse().ok()).unwrap_or(0) };
    if b.len() < 19 {
        return 0;
    }
    let (y, mo, d) = (num(0, 4), num(5, 2), num(8, 2));
    let (h, mi, se) = (num(11, 2), num(14, 2), num(17, 2));
    // days from civil (Howard Hinnant)
    let y2 = if mo <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (mo + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    let mut ms = (days * 86400 + h * 3600 + mi * 60 + se) * 1000;
    // fraction + offset
    let rest = &s[19..];
    let mut i = 0;
    let rb = rest.as_bytes();
    if rb.first() == Some(&b'.') {
        i = 1;
        let mut frac = String::new();
        while i < rb.len() && rb[i].is_ascii_digit() {
            frac.push(rb[i] as char);
            i += 1;
        }
        let f3: String = format!("{frac:0<3}").chars().take(3).collect();
        ms += f3.parse::<i64>().unwrap_or(0);
    }
    if let Some(&sign) = rb.get(i) {
        if sign == b'+' || sign == b'-' {
            let oh: i64 = rest.get(i + 1..i + 3).and_then(|x| x.parse().ok()).unwrap_or(0);
            let om: i64 = rest.get(i + 4..i + 6).and_then(|x| x.parse().ok()).unwrap_or(0);
            let off = (oh * 60 + om) * 60_000;
            ms = if sign == b'+' { ms - off } else { ms + off };
        }
    }
    ms.max(0) as u64
}

// ------------------------------------------------------------------ sync state

/// The common base for one project: what both sides agreed on at the last sync.
#[derive(Serialize, Deserialize, Default, Clone)]
struct SessEntry {
    /// server revision we last saw (0 = unknown, e.g. state from an older version)
    #[serde(default)]
    rev: i64,
    /// canonical content hash at that point
    #[serde(default)]
    hash: String,
}

/// Content-hash cache: re-read + re-hash a project file only when its size or mtime changed.
#[derive(Serialize, Deserialize, Default, Clone)]
struct HashCache {
    mtime: u64,
    len: u64,
    hash: String,
    empty: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct SyncState {
    account: String,
    /// stable id of this installation (lets us ignore our own realtime echoes)
    #[serde(default)]
    device: String,
    sessions: HashMap<String, SessEntry>,
    #[serde(default)]
    hashes: HashMap<String, HashCache>,
}

fn state_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("cloud-state.json"))
}
fn load_state(app: &AppHandle) -> SyncState {
    let mut st: SyncState = state_file(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if st.device.is_empty() {
        st.device = crate::media::short_id();
    }
    st
}
/// Atomic: write a temp file, then rename over the old one. A crash mid-write can never
/// leave a half-written (and therefore "everything is new") state behind.
fn save_state(app: &AppHandle, s: &SyncState) {
    if let Ok(p) = state_file(app) {
        let tmp = p.with_extension("json.tmp");
        if fs::write(&tmp, serde_json::to_string(s).unwrap_or_default()).is_ok() {
            let _ = fs::rename(&tmp, &p);
        }
    }
}

/// This installation's id (the UI ignores realtime events it caused itself).
#[tauri::command]
pub fn cloud_device_id(app: AppHandle) -> String {
    let st = load_state(&app);
    if !state_file(&app).map(|p| p.exists()).unwrap_or(false) {
        save_state(&app, &st);
    }
    st.device
}

// ------------------------------------------------------------------ status events

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusEvent {
    state: String, // off | syncing | idle | offline | error
    message: String,
    progress: Option<(u64, u64)>,
    last_sync: u64,
}

static LAST_SYNC: Mutex<u64> = Mutex::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn emit_status(app: &AppHandle, state: &str, message: &str, progress: Option<(u64, u64)>) {
    let _ = app.emit(
        "cloud-status",
        StatusEvent { state: state.into(), message: message.into(), progress, last_sync: *LAST_SYNC.lock().unwrap() },
    );
}

// ------------------------------------------------------------------ the sync engine

/// Every media-like file name a session JSON references.
fn collect_media(v: &Value, out: &mut HashSet<String>) {
    match v {
        Value::Object(m) => {
            for (k, val) in m {
                if matches!(k.as_str(), "file" | "thumb" | "bgImage") {
                    if let Some(s) = val.as_str() {
                        if safe_name(s).is_some() {
                            out.insert(s.to_string());
                        }
                    }
                }
                collect_media(val, out);
            }
        }
        Value::Array(a) => a.iter().for_each(|x| collect_media(x, out)),
        _ => {}
    }
}

fn local_trash(app: &AppHandle, id: &str) {
    if let Ok(dir) = sessions_dir(app) {
        let trash = dir.join(".trash");
        let _ = fs::create_dir_all(&trash);
        let _ = fs::rename(dir.join(format!("{id}.json")), trash.join(format!("{id}.cloud-removed.json")));
    }
}

// ------------------------------------------------------------------ media phases (parallel)

/// How many media files move at once. Parallel transfers hide per-request latency (most
/// slides are small images), while 4 keeps a big video from starving the rest.
const MEDIA_PARALLEL: usize = 4;

/// Every media file the local projects reference.
fn referenced_media(app: &AppHandle) -> Result<HashSet<String>, String> {
    let mut referenced = HashSet::new();
    for e in fs::read_dir(sessions_dir(app)?).map_err(e2s)?.flatten() {
        let p = e.path();
        if p.extension().map(|x| x == "json").unwrap_or(false) {
            if let Some(v) = read_json(&p) {
                collect_media(&v, &mut referenced);
            }
        }
    }
    Ok(referenced)
}

/// Upload referenced media the cloud doesn't have (parallel, each file isolated, size
/// verified). Returns per-file errors; the rest of the sync carries on regardless.
async fn upload_missing_media(app: &AppHandle, acc: &Account, remote: &HashSet<String>) -> Vec<String> {
    use futures_util::stream::{self, StreamExt};
    use std::sync::atomic::AtomicU64;
    let Ok(mdir) = media_dir(app) else { return vec!["media folder unavailable".into()] };
    let mut up: Vec<String> = match referenced_media(app) {
        Ok(r) => r.into_iter().filter(|n| mdir.join(n).is_file() && !remote.contains(n)).collect(),
        Err(e) => return vec![e],
    };
    if up.is_empty() {
        return vec![];
    }
    // small first: slide images make the other computer usable quickly
    up.sort_by_key(|n| fs::metadata(mdir.join(n)).map(|m| m.len()).unwrap_or(u64::MAX));
    let total = up.len() as u64;
    let done = AtomicU64::new(0);
    emit_status(app, "syncing", &format!("מעלה לענן (0/{total})"), Some((0, total)));

    stream::iter(up)
        .map(|n| {
            let path = mdir.join(&n);
            let done = &done;
            async move {
                let local_len = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
                let r: Result<(), String> = async {
                    let token = access_token(app).await?;
                    let sz = upload_media(&token, &n, &path, |s, t| {
                        if t > 50 * 1024 * 1024 {
                            let d = done.load(Ordering::SeqCst);
                            emit_status(app, "syncing", &format!("מעלה לענן ({}/{total}) · {}%", d + 1, s * 100 / t.max(1)), Some((d, total)));
                        }
                    })
                    .await?;
                    if sz != local_len {
                        return Err(format!("size mismatch after upload ({sz} ≠ {local_len})"));
                    }
                    let (owner, file) = (acc.id.clone(), n.clone());
                    retry(app, |t| {
                        let (owner, file) = (owner.clone(), file.clone());
                        async move { record_media(&t, &owner, &file, sz).await }
                    })
                    .await
                }
                .await;
                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                emit_status(app, "syncing", &format!("מעלה לענן ({d}/{total})"), Some((d, total)));
                r.err().map(|e| format!("{n}: {e}"))
            }
        })
        .buffer_unordered(MEDIA_PARALLEL)
        .filter_map(|e| async move { e })
        .collect()
        .await
}

/// Download referenced media this computer doesn't have (parallel, isolated per file).
async fn download_missing_media(app: &AppHandle, remote: &HashSet<String>) -> Vec<String> {
    use futures_util::stream::{self, StreamExt};
    use std::sync::atomic::AtomicU64;
    let Ok(mdir) = media_dir(app) else { return vec!["media folder unavailable".into()] };
    let mut down: Vec<String> = match referenced_media(app) {
        Ok(r) => r.into_iter().filter(|n| !mdir.join(n).is_file() && remote.contains(n)).collect(),
        Err(e) => return vec![e],
    };
    if down.is_empty() {
        return vec![];
    }
    down.sort_by_key(|n| if n.ends_with(".jpg") || n.contains("_t.") { 0 } else { 1 });
    let total = down.len() as u64;
    let done = AtomicU64::new(0);
    emit_status(app, "syncing", &format!("מוריד מהענן (0/{total})"), Some((0, total)));

    stream::iter(down)
        .map(|n| {
            let path = mdir.join(&n);
            let done = &done;
            async move {
                let r = async {
                    let token = access_token(app).await?;
                    download_media(&token, &n, &path).await
                }
                .await;
                let d = done.fetch_add(1, Ordering::SeqCst) + 1;
                if r.is_ok() {
                    let _ = app.emit("cloud-media-ready", &n);
                }
                emit_status(app, "syncing", &format!("מוריד מהענן ({d}/{total})"), Some((d, total)));
                r.err().map(|e| format!("{n}: {e}"))
            }
        })
        .buffer_unordered(MEDIA_PARALLEL)
        .filter_map(|e| async move { e })
        .collect()
        .await
}

/// A project file on this computer, as the planner sees it.
struct LocalFile {
    path: PathBuf,
    doc: crate::sync_plan::LocalDoc,
}

/// Snapshot of local projects. Files that can't be read/parsed right now (being written,
/// corrupt) are reported in `unreadable` and left OUT of planning entirely — an unreadable
/// file must never be mistaken for a deleted one (that would delete it in the cloud).
fn local_snapshot(app: &AppHandle, cache: &mut HashMap<String, HashCache>) -> Result<(HashMap<String, LocalFile>, HashSet<String>), String> {
    let dir = sessions_dir(app)?;
    let mut out = HashMap::new();
    let mut unreadable = HashSet::new();
    for e in fs::read_dir(&dir).map_err(e2s)?.flatten() {
        let p = e.path();
        if !p.is_file() || p.extension().map(|x| x != "json").unwrap_or(true) {
            continue;
        }
        let id = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
        if safe_name(&id).is_none() {
            continue;
        }
        let Ok(meta) = fs::metadata(&p) else {
            unreadable.insert(id);
            continue;
        };
        let (mtime, len) = (mtime_ms(&p), meta.len());
        let hit = cache.get(&id).filter(|c| c.mtime == mtime && c.len == len).cloned();
        let entry = match hit {
            Some(c) => c,
            None => match read_json(&p) {
                Some(v) => {
                    let c = HashCache { mtime, len, hash: hash_value(&v), empty: is_empty_project(&v) };
                    cache.insert(id.clone(), c.clone());
                    c
                }
                None => {
                    unreadable.insert(id);
                    continue;
                }
            },
        };
        out.insert(id, LocalFile { path: p, doc: crate::sync_plan::LocalDoc { hash: entry.hash, mtime, empty: entry.empty } });
    }
    cache.retain(|id, _| out.contains_key(id));
    Ok((out, unreadable))
}

/// Write a pulled document and record the new common base (and its hash-cache entry, so the
/// next pass doesn't re-read the file we just wrote).
fn apply_pull(st: &mut SyncState, path: &Path, id: &str, row: &FullRow) -> Result<(), String> {
    write_json(path, &row.data)?;
    let hash = hash_value(&row.data);
    let len = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    st.hashes.insert(id.to_string(), HashCache { mtime: mtime_ms(path), len, hash: hash.clone(), empty: is_empty_project(&row.data) });
    st.sessions.insert(id.to_string(), SessEntry { rev: row.rev, hash });
    Ok(())
}

/// Plan + execute project sync. Returns (projects changed locally, per-item errors).
/// Every action is isolated: one bad project never blocks the others. Compare-and-swap
/// conflicts are re-planned once against a fresh listing.
async fn sync_projects(app: &AppHandle, acc: &Account, st: &mut SyncState) -> (Vec<String>, Vec<String>) {
    use crate::sync_plan::{plan, remote_wins, Action, Known, RemoteMeta};
    let mut pulled = Vec::new();
    let mut errors = Vec::new();
    let mut only: Option<HashSet<String>> = None; // second round: just the conflicted ids

    for _round in 0..2 {
        let rows = match retry(app, |t| async move { list_projects(&t).await }).await {
            Ok(r) => r,
            Err(e) => {
                errors.push(e);
                break;
            }
        };
        let (local, unreadable) = match local_snapshot(app, &mut st.hashes) {
            Ok(x) => x,
            Err(e) => {
                errors.push(e);
                break;
            }
        };
        let keep = |id: &String| !unreadable.contains(id) && only.as_ref().map(|o| o.contains(id)).unwrap_or(true);
        let remote: HashMap<String, RemoteMeta> = rows
            .iter()
            .filter(|r| keep(&r.id) && safe_name(&r.id).is_some())
            .map(|r| (r.id.clone(), RemoteMeta { rev: r.rev, deleted: r.deleted, updated_ms: parse_ts_ms(&r.updated_at) }))
            .collect();
        let local_docs = local.iter().filter(|(id, _)| keep(id)).map(|(id, f)| (id.clone(), f.doc.clone())).collect();
        let known = st
            .sessions
            .iter()
            .filter(|(id, _)| keep(id))
            .map(|(id, k)| (id.clone(), Known { rev: k.rev, hash: k.hash.clone() }))
            .collect();
        let actions = plan(&local_docs, &remote, &known);
        if actions.is_empty() {
            break;
        }

        // one batched fetch for everything we need to read
        let need: Vec<String> = actions
            .iter()
            .filter_map(|a| match a {
                Action::Pull { id } | Action::Resolve { id } => Some(id.clone()),
                _ => None,
            })
            .collect();
        let fetched = if need.is_empty() {
            HashMap::new()
        } else {
            match retry(app, |t| {
                let need = need.clone();
                async move { fetch_projects(&t, &need).await }
            })
            .await
            {
                Ok(f) => f,
                Err(e) => {
                    errors.push(e);
                    break;
                }
            }
        };

        let sdir = match sessions_dir(app) {
            Ok(d) => d,
            Err(e) => {
                errors.push(e);
                break;
            }
        };
        let mut conflicts = HashSet::new();
        let total = actions.len() as u64;
        for (i, action) in actions.into_iter().enumerate() {
            if i % 5 == 0 {
                emit_status(app, "syncing", "מסנכרן פרויקטים…", Some((i as u64, total)));
            }
            let id = match &action {
                Action::Push { id, .. }
                | Action::Pull { id }
                | Action::Resolve { id }
                | Action::DeleteLocal { id }
                | Action::DeleteRemote { id, .. }
                | Action::Forget { id } => id.clone(),
            };
            let path = sdir.join(format!("{id}.json"));
            let result: Result<(), String> = async {
                match &action {
                    Action::Pull { .. } => {
                        // vanished between listing and fetching → next pass
                        let Some(row) = fetched.get(&id) else { return Ok(()) };
                        apply_pull(st, &path, &id, row)?;
                        pulled.push(id.clone());
                    }
                    Action::Resolve { .. } => {
                        let Some(row) = fetched.get(&id) else { return Ok(()) };
                        let lf = local.get(&id).ok_or("local file vanished")?;
                        if hash_value(&row.data) == lf.doc.hash {
                            // same content (e.g. first sign-in on a computer that already had it)
                            st.sessions.insert(id.clone(), SessEntry { rev: row.rev, hash: lf.doc.hash.clone() });
                        } else if remote_wins(lf.doc.mtime, parse_ts_ms(&row.updated_at)) {
                            if let Some(mine) = read_json(&lf.path) {
                                keep_version(&sdir, &id, &mine);
                            }
                            apply_pull(st, &path, &id, row)?;
                            pulled.push(id.clone());
                        } else {
                            keep_version(&sdir, &id, &row.data);
                            let doc = read_json(&lf.path).ok_or("local file unreadable")?;
                            let base = row.rev;
                            let (dev, iid) = (st.device.clone(), id.clone());
                            match retry(app, |t| {
                                let (dev, iid, doc) = (dev.clone(), iid.clone(), doc.clone());
                                async move { update_project(&t, &dev, &iid, base, &doc).await }
                            })
                            .await?
                            {
                                Write::Done(rev) => {
                                    st.sessions.insert(id.clone(), SessEntry { rev, hash: lf.doc.hash.clone() });
                                }
                                Write::Conflict => {
                                    conflicts.insert(id.clone());
                                }
                            }
                        }
                    }
                    Action::Push { base, .. } => {
                        let lf = local.get(&id).ok_or("local file vanished")?;
                        let doc = read_json(&lf.path).ok_or("local file unreadable")?;
                        let (dev, iid, owner, base) = (st.device.clone(), id.clone(), acc.id.clone(), *base);
                        let w = retry(app, |t| {
                            let (dev, iid, owner, doc) = (dev.clone(), iid.clone(), owner.clone(), doc.clone());
                            async move {
                                match base {
                                    Some(b) => update_project(&t, &dev, &iid, b, &doc).await,
                                    None => insert_project(&t, &owner, &dev, &iid, &doc).await,
                                }
                            }
                        })
                        .await?;
                        match w {
                            Write::Done(rev) => {
                                st.sessions.insert(id.clone(), SessEntry { rev, hash: lf.doc.hash.clone() });
                            }
                            Write::Conflict => {
                                conflicts.insert(id.clone());
                            }
                        }
                    }
                    Action::DeleteRemote { rev, .. } => {
                        let (dev, iid, rev) = (st.device.clone(), id.clone(), *rev);
                        match retry(app, |t| {
                            let (dev, iid) = (dev.clone(), iid.clone());
                            async move { tombstone_project(&t, &dev, &iid, rev).await }
                        })
                        .await?
                        {
                            Write::Done(_) => {
                                st.sessions.remove(&id);
                            }
                            // edited elsewhere after we deleted → re-plan (it will come back)
                            Write::Conflict => {
                                conflicts.insert(id.clone());
                            }
                        }
                    }
                    Action::DeleteLocal { .. } => {
                        local_trash(app, &id);
                        st.sessions.remove(&id);
                        st.hashes.remove(&id);
                        pulled.push(id.clone());
                    }
                    Action::Forget { .. } => {
                        st.sessions.remove(&id);
                    }
                }
                Ok(())
            }
            .await;
            match result {
                Ok(()) => save_state(app, st),
                Err(e) if e.starts_with("offline") => {
                    errors.push(e);
                    return (pulled, errors); // no network: stop, the scheduler backs off
                }
                Err(e) => errors.push(format!("{id}: {e}")),
            }
        }
        if conflicts.is_empty() {
            break;
        }
        only = Some(conflicts);
    }
    (pulled, errors)
}

/// One sync pass. Order matters:
///   1. media up   — a project must never reach another computer before its images
///   2. projects   — three-way plan, compare-and-swap writes, conflicts re-planned
///   3. media down — whatever the projects we now have reference
/// Every item is isolated: failures are collected and reported, the rest still syncs.
async fn sync_once(app: &AppHandle) -> Result<(), String> {
    access_token(app).await?;
    let acc = read_account(app).ok_or("לא מחובר לענן")?;
    let mut st = load_state(app);
    if st.account != acc.id {
        // different account → start fresh (never delete anything on either side)
        st = SyncState { account: acc.id.clone(), device: st.device, ..Default::default() };
    }
    emit_status(app, "syncing", "מסנכרן…", None);
    let mut errors: Vec<String> = Vec::new();

    // 1. media up
    match retry(app, |t| async move { list_media(&t).await }).await {
        Ok(remote_media) => errors.extend(upload_missing_media(app, &acc, &remote_media).await),
        Err(e) => errors.push(e),
    }
    if errors.iter().any(|e| e.starts_with("offline")) {
        save_state(app, &st);
        return Err("offline".into());
    }

    // 2. projects
    let (pulled, perrors) = sync_projects(app, &acc, &mut st).await;
    errors.extend(perrors);
    save_state(app, &st);
    if !pulled.is_empty() {
        let _ = app.emit("cloud-pulled", &pulled);
    }

    // 3. media down (fresh list: another computer may have uploaded meanwhile)
    match retry(app, |t| async move { list_media(&t).await }).await {
        Ok(remote_media) => errors.extend(download_missing_media(app, &remote_media).await),
        Err(e) => errors.push(e),
    }

    if errors.is_empty() {
        *LAST_SYNC.lock().unwrap() = now_ms();
        emit_status(app, "idle", "מסונכרן", None);
        return Ok(());
    }
    if errors.iter().any(|e| e.starts_with("offline")) {
        return Err("offline".into());
    }
    for e in &errors {
        eprintln!("[sync] {e}");
    }
    Err(format!("{} פריטים לא סונכרנו. ניסיון חוזר אוטומטי.", errors.len()))
}

static RUNNING: AtomicBool = AtomicBool::new(false);
static AGAIN: AtomicBool = AtomicBool::new(false);
static LOOP: AtomicBool = AtomicBool::new(false);
/// consecutive failed passes → exponential backoff for the automatic retry
static FAILURES: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
/// bumped on every scheduled retry; a retry only fires if it's still the latest one
static RETRY_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Run a sync now. Single-flight: if a pass is running, exactly one more follows it
/// (coalescing any number of requests that arrive meanwhile).
fn kick(app: AppHandle) {
    if !signed_in() {
        return;
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        AGAIN.store(true, Ordering::SeqCst);
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            AGAIN.store(false, Ordering::SeqCst);
            match sync_once(&app).await {
                Ok(()) => {
                    FAILURES.store(0, Ordering::SeqCst);
                }
                Err(e) => {
                    let offline = e.starts_with("offline");
                    emit_status(
                        &app,
                        if offline { "offline" } else { "error" },
                        if offline { "אין חיבור לאינטרנט. השינויים יסונכרנו כשהחיבור יחזור." } else { &e },
                        None,
                    );
                    schedule_retry(app.clone());
                }
            }
            if !AGAIN.load(Ordering::SeqCst) {
                break;
            }
        }
        RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Retry after a failed pass with exponential backoff + jitter: 5s, 10s, 20s … capped at
/// 5 minutes. A successful pass (or the network coming back) resets it.
fn schedule_retry(app: AppHandle) {
    let n = FAILURES.fetch_add(1, Ordering::SeqCst).min(6);
    let secs = (5u64 << n).min(300);
    let jitter = rand::random::<u64>() % 1000;
    let gen = RETRY_GEN.fetch_add(1, Ordering::SeqCst) + 1;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(secs * 1000 + jitter)).await;
        if RETRY_GEN.load(Ordering::SeqCst) == gen {
            kick(app);
        }
    });
}

/// UI → "sync now" (after a save, a realtime event, the network coming back, …).
#[tauri::command]
pub fn cloud_sync_now(app: AppHandle) {
    kick(app);
}

/// The network came back: forget the backoff and sync right away.
#[tauri::command]
pub fn cloud_network_online(app: AppHandle) {
    FAILURES.store(0, Ordering::SeqCst);
    RETRY_GEN.fetch_add(1, Ordering::SeqCst);
    kick(app);
}

/// One-time cleanup of the old Google Drive connection (replaced by Bima Cloud): forget its
/// stored login and settings. Nothing in the user's Drive is touched.
pub fn retire_drive(app: &AppHandle) {
    if let Ok(e) = keyring::Entry::new("bima-google-drive", "refresh_token") {
        let _ = e.delete_credential();
    }
    if let Ok(d) = data_dir(app) {
        for f in ["google-client.json", "google-account.json", "cloud-sync.json"] {
            let _ = fs::remove_file(d.join(f));
        }
    }
}

/// Background heartbeat (the UI also kicks a sync on realtime changes and after saves).
pub fn start_sync_loop(app: AppHandle) {
    if !signed_in() || LOOP.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            if !signed_in() {
                LOOP.store(false, Ordering::SeqCst);
                break;
            }
            kick(app.clone());
            tokio::time::sleep(Duration::from_secs(45)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_ignores_key_order_and_number_form() {
        let a: Value = serde_json::from_str(r#"{"name":"x","items":[{"a":1,"b":[1,2]}],"z":2.0}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"z":2,"items":[{"b":[1,2],"a":1.0}],"name":"x"}"#).unwrap();
        assert_eq!(hash_value(&a), hash_value(&b));
        let c: Value = serde_json::from_str(r#"{"z":2,"items":[{"b":[2,1],"a":1}],"name":"x"}"#).unwrap();
        assert_ne!(hash_value(&a), hash_value(&c));
    }

    #[test]
    fn parses_postgres_timestamps() {
        assert_eq!(parse_ts_ms("1970-01-01T00:00:00+00:00"), 0);
        assert_eq!(parse_ts_ms("2026-11-16T15:25:04.943217+00:00"), 1794842704943);
        assert_eq!(parse_ts_ms("2026-11-16T17:25:04.943+02:00"), 1794842704943);
        assert_eq!(parse_ts_ms("2026-11-16 15:25:04.9+00"), 1794842704900);
    }

    #[test]
    fn empty_projects() {
        assert!(is_empty_project(&json!({"name":"a","items":[]})));
        assert!(!is_empty_project(&json!({"name":"a","items":[{}]})));
    }
}
