//! The "library": where sessions + media live. Defaults to the app-data folder, but can be
//! moved into a cloud-synced folder (Google Drive / OneDrive / Dropbox for desktop) so every
//! computer signed into the same account sees the same sessions - no files to carry around.

use crate::e2s;
use crate::media::{data_dir, safe_name, short_id};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Default)]
struct Config {
    library_root: Option<String>,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("config.json"))
}

fn read_config(app: &AppHandle) -> Config {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(app: &AppHandle, c: &Config) -> Result<(), String> {
    fs::write(config_path(app)?, serde_json::to_string_pretty(c).map_err(e2s)?).map_err(e2s)
}

pub fn library_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = match read_config(app).library_root {
        Some(r) if Path::new(&r).exists() || fs::create_dir_all(&r).is_ok() => PathBuf::from(r),
        _ => data_dir(app)?,
    };
    fs::create_dir_all(&d).map_err(e2s)?;
    Ok(d)
}

pub fn sessions_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = library_dir(app)?.join("sessions");
    fs::create_dir_all(&d).map_err(e2s)?;
    Ok(d)
}

/// Lets <img>/<video> load from the media folder wherever it lives.
pub fn allow_media_scope(app: &AppHandle) {
    if let Ok(m) = crate::media::media_dir(app) {
        let _ = app.asset_protocol_scope().allow_directory(&m, true);
    }
}

/// One-time migration of the single session.json used by early versions.
pub fn migrate_legacy(app: &AppHandle) {
    let Ok(dd) = data_dir(app) else { return };
    let legacy = dd.join("session.json");
    let Ok(sd) = sessions_dir(app) else { return };
    if legacy.exists() {
        let empty = fs::read_dir(&sd).map(|mut r| r.next().is_none()).unwrap_or(true);
        if empty {
            let _ = fs::copy(&legacy, sd.join(format!("{}.json", short_id())));
        }
        let _ = fs::rename(&legacy, dd.join("session.legacy.json"));
    }
}

pub fn mtime_ms(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    root: String,
    media_dir: String,
    is_default: bool,
}

#[tauri::command]
pub fn get_library(app: AppHandle) -> Result<LibraryInfo, String> {
    let root = library_dir(&app)?;
    Ok(LibraryInfo {
        root: root.to_string_lossy().into(),
        media_dir: crate::media::media_dir(&app)?.to_string_lossy().into(),
        is_default: read_config(&app).library_root.is_none(),
    })
}

#[derive(Serialize)]
pub struct CloudFolder {
    label: String,
    path: String,
}

/// Finds folders synced by cloud desktop clients on this machine.
#[tauri::command]
pub fn detect_cloud_folders() -> Vec<CloudFolder> {
    let mut out = Vec::new();
    // Google Drive for desktop mounts a virtual drive (G:, H: …) with "My Drive" (localised).
    for letter in b'D'..=b'Z' {
        for name in ["My Drive", "\u{05D4}\u{05D0}\u{05D7}\u{05E1}\u{05D5}\u{05DF} \u{05E9}\u{05DC}\u{05D9}", "Mi unidad", "Mon Drive", "Meine Ablage"] {
            let p = PathBuf::from(format!("{}:\\{}", letter as char, name));
            if p.is_dir() {
                out.push(CloudFolder { label: "Google Drive".into(), path: p.to_string_lossy().into() });
            }
        }
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        for (label, sub) in [("Google Drive", "Google Drive"), ("Dropbox", "Dropbox")] {
            let p = Path::new(&home).join(sub);
            if p.is_dir() {
                out.push(CloudFolder { label: label.into(), path: p.to_string_lossy().into() });
            }
        }
    }
    for var in ["OneDrive", "OneDriveConsumer"] {
        if let Ok(p) = std::env::var(var) {
            if Path::new(&p).is_dir() && !out.iter().any(|c| c.path == p) {
                out.push(CloudFolder { label: "OneDrive".into(), path: p });
            }
        }
    }
    out
}

fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<u32> {
    let mut n = 0;
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)?.flatten() {
        let p = e.path();
        let name = e.file_name();
        if name.to_string_lossy().starts_with(".work-") {
            continue;
        }
        let target = dst.join(&name);
        if p.is_dir() {
            n += copy_tree(&p, &target)?;
        } else if !target.exists() || mtime_ms(&p) > mtime_ms(&target) {
            // newer wins - never replace a fresher copy with an older one
            fs::copy(&p, &target)?;
            n += 1;
        }
    }
    Ok(n)
}

/// Moves the library into `folder` (a "Bima" sub-folder is created). `None` = back to default.
/// Existing sessions + media are copied over (never overwriting what is already there),
/// so pointing a second computer at the same Drive folder simply merges.
#[tauri::command]
pub async fn set_library(app: AppHandle, folder: Option<String>) -> Result<LibraryInfo, String> {
    let old = library_dir(&app)?;
    let new_root = match &folder {
        Some(f) => {
            let p = PathBuf::from(f);
            if p.file_name().map(|n| n == "Bima").unwrap_or(false) {
                p
            } else {
                p.join("Bima")
            }
        }
        None => data_dir(&app)?,
    };
    let (o, n) = (old.clone(), new_root.clone());
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        fs::create_dir_all(&n).map_err(e2s)?;
        if o != n {
            for sub in ["sessions", "media"] {
                if o.join(sub).is_dir() {
                    copy_tree(&o.join(sub), &n.join(sub)).map_err(|e| format!("העתקה נכשלה: {e}"))?;
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(e2s)??;
    write_config(&app, &Config { library_root: folder.map(|_| new_root.to_string_lossy().into()) })?;
    allow_media_scope(&app);
    get_library(app)
}

/// Is this path inside a folder that a desktop cloud client (Drive / OneDrive / Dropbox) syncs?
pub fn is_cloud_synced(path: &str) -> bool {
    let l = path.to_lowercase();
    ["my drive", "google drive", "האחסון שלי", "onedrive", "dropbox", "mi unidad", "mon drive", "meine ablage"]
        .iter()
        .any(|m| l.contains(m))
}

/// Bima Cloud replaces folder-syncing: a library still sitting in a Drive/OneDrive folder
/// would be synced twice (by the desktop client AND by Bima) and the two fight. Move it back
/// to this computer once, newest file wins. Nothing in the cloud folder is deleted.
pub fn leave_cloud_folder(app: &AppHandle) {
    let Some(root) = read_config(app).library_root else { return };
    if !is_cloud_synced(&root) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        match set_library(app.clone(), None).await {
            Ok(_) => {
                let _ = app.emit("library-moved-local", root);
            }
            Err(e) => eprintln!("leave_cloud_folder: {e}"),
        }
    });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    id: String,
    name: String,
    items: usize,
    updated: u64,
    /// first visible slide of the first item - rendered as the project's cover
    cover: Option<serde_json::Value>,
}

#[tauri::command]
pub fn list_sessions(app: AppHandle) -> Result<Vec<SessionMeta>, String> {
    let dir = sessions_dir(&app)?;
    let mut out = Vec::new();
    for e in fs::read_dir(dir).map_err(e2s)?.flatten() {
        let p = e.path();
        if !p.is_file() || p.extension().map(|x| x != "json").unwrap_or(true) {
            continue;
        }
        let id = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let v: serde_json::Value = fs::read_to_string(&p)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        out.push(SessionMeta {
            id,
            name: v["name"].as_str().unwrap_or("מפגש").to_string(),
            items: v["items"].as_array().map(|a| a.len()).unwrap_or(0),
            updated: mtime_ms(&p),
            cover: v["items"]
                .as_array()
                .and_then(|items| items.iter().find_map(|it| it["slides"].as_array().and_then(|sl| sl.first().cloned()))),
        });
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    Ok(out)
}

fn session_file(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let id = safe_name(id).ok_or("מזהה מפגש לא תקין")?;
    Ok(sessions_dir(app)?.join(format!("{id}.json")))
}

#[derive(Serialize)]
pub struct Loaded {
    json: Option<String>,
    mtime: u64,
}

#[tauri::command]
pub fn load_session(app: AppHandle, id: String) -> Result<Loaded, String> {
    let p = session_file(&app, &id)?;
    if !p.exists() {
        return Ok(Loaded { json: None, mtime: 0 });
    }
    Ok(Loaded { json: Some(fs::read_to_string(&p).map_err(e2s)?), mtime: mtime_ms(&p) })
}

/// Atomic write; returns the new modification time (used to detect edits from another computer).
#[tauri::command]
pub fn save_session(app: AppHandle, id: String, json: String, base_mtime: Option<u64>) -> Result<u64, String> {
    let p = session_file(&app, &id)?;
    // Optimistic check against the version the editor loaded: if the file changed underneath
    // (sync wrote a newer copy from another computer while you were editing), your edit still
    // wins — but the copy it replaces goes to the local version history instead of vanishing.
    if let Some(base) = base_mtime.filter(|b| *b > 0) {
        let disk = mtime_ms(&p);
        if p.exists() && disk != base {
            let dir = sessions_dir(&app)?.join(".versions");
            if fs::create_dir_all(&dir).is_ok() {
                let stamp = std::time::SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
                let _ = fs::copy(&p, dir.join(format!("{id}-{stamp}.json")));
            }
        }
    }
    let tmp = p.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(e2s)?;
    fs::rename(&tmp, &p).map_err(e2s)?;
    Ok(mtime_ms(&p))
}

#[tauri::command]
pub fn session_mtime(app: AppHandle, id: String) -> Result<u64, String> {
    Ok(mtime_ms(&session_file(&app, &id)?))
}

/// Soft delete → sessions/.trash
#[tauri::command]
pub fn delete_session(app: AppHandle, id: String) -> Result<(), String> {
    let p = session_file(&app, &id)?;
    let trash = sessions_dir(&app)?.join(".trash");
    fs::create_dir_all(&trash).map_err(e2s)?;
    if p.exists() {
        fs::rename(&p, trash.join(format!("{id}.json"))).map_err(e2s)?;
    }
    Ok(())
}

#[tauri::command]
pub fn new_session_id() -> String {
    short_id()
}
