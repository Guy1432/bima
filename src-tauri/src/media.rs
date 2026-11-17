use crate::e2s;
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tauri::{ipc::InvokeBody, AppHandle, Manager};

pub fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(e2s)?;
    fs::create_dir_all(&d).map_err(e2s)?;
    Ok(d)
}

pub fn media_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = crate::library::library_dir(app)?.join("media");
    fs::create_dir_all(&d).map_err(e2s)?;
    Ok(d)
}

pub fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()[..12].to_string()
}

pub fn clean_ext(ext: &str) -> String {
    let e: String = ext
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect::<String>()
        .to_lowercase();
    if e.is_empty() {
        "bin".into()
    } else {
        e
    }
}

/// Only plain file names are valid media / project references: no separators or traversal,
/// no control or wildcard characters, and none of Windows' reserved device names
/// (`CON`, `NUL`, `COM1`… — with any extension — open a device, not a file).
pub fn safe_name(name: &str) -> Option<&str> {
    const RESERVED: &[&str] = &[
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
        "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    let stem = name.split('.').next().unwrap_or("").trim_end().to_ascii_uppercase();
    let ok = !name.is_empty()
        && name.len() <= 200
        && !name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|'])
        && !name.chars().any(|c| c.is_control())
        && name != "."
        && name != ".."
        && !name.starts_with("..")
        && !name.ends_with(['.', ' '])
        && !RESERVED.contains(&stem.as_str());
    ok.then_some(name)
}

/// File types the UI may ask us to read or import from an arbitrary path (the user picked
/// them in a file dialog or dropped them on the window). Anything else is refused, so the
/// webview can never be used to read arbitrary files off the disk.
const IMPORTABLE: &[&str] = &[
    "pptx", "ppt", "pps", "ppsx", "pptm", "potx", "odp", "key", "pdf", "mp4", "m4v", "mov", "webm", "ogv", "mkv", "avi", "wmv", "mpg", "mpeg",
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "zip", "bima",
];

fn check_importable(path: &Path) -> Result<(), String> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if !IMPORTABLE.contains(&ext.as_str()) {
        return Err(format!("סוג קובץ לא נתמך: .{ext}"));
    }
    let meta = fs::metadata(path).map_err(|e| format!("הקובץ לא נמצא: {e}"))?;
    if !meta.is_file() {
        return Err("זה לא קובץ".into());
    }
    Ok(())
}

#[tauri::command]
pub fn get_media_dir(app: AppHandle) -> Result<String, String> {
    Ok(media_dir(&app)?.to_string_lossy().to_string())
}

/// Copies an external file into the media library. Returns the stored file name.
#[tauri::command]
pub async fn import_file(app: AppHandle, path: String) -> Result<String, String> {
    let dir = media_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let src = PathBuf::from(&path);
        check_importable(&src)?;
        let ext = src
            .extension()
            .map(|e| clean_ext(&e.to_string_lossy()))
            .unwrap_or_else(|| "bin".into());
        let name = format!("{}.{}", short_id(), ext);
        fs::copy(&src, dir.join(&name)).map_err(|e| format!("העתקת הקובץ נכשלה: {e}"))?;
        Ok(name)
    })
    .await
    .map_err(e2s)?
}

/// Raw-body command: saves bytes (e.g. a rendered PDF page) into the media library.
#[tauri::command]
pub fn save_media_bytes(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let ext = request
        .headers()
        .get("x-ext")
        .and_then(|v| v.to_str().ok())
        .map(clean_ext)
        .unwrap_or_else(|| "bin".into());
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".into());
    };
    let name = format!("{}.{}", short_id(), ext);
    fs::write(media_dir(&app)?.join(&name), data).map_err(e2s)?;
    Ok(name)
}

/// "%D7%90" → bytes → UTF-8 (paths travel in a header, which must be ASCII).
fn percent_decode(s: &str) -> Option<String> {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// Only what the export feature produces, written where the user chose in the save dialog.
fn export_target(encoded: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(percent_decode(encoded).ok_or("נתיב לא תקין")?);
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if !matches!(ext.as_str(), "pdf" | "pptx") || !path.is_absolute() {
        return Err("אפשר לשמור רק קובצי PDF או PowerPoint".into());
    }
    Ok(path)
}

/// Saves an exported PDF / PowerPoint (raw body; target path percent-encoded in `x-path`).
#[tauri::command]
pub fn write_export(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let encoded = request.headers().get("x-path").and_then(|v| v.to_str().ok()).ok_or("חסר נתיב")?;
    let path = export_target(encoded)?;
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected raw body".into());
    };
    // write next to it, then swap in: a failed export never leaves a half-written file
    let tmp = path.with_extension("bima-tmp");
    fs::write(&tmp, data).map_err(|e| format!("השמירה נכשלה: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("השמירה נכשלה: {e}")
    })
}

#[cfg(test)]
mod export_tests {
    use super::*;

    #[test]
    fn decodes_hebrew_paths() {
        assert_eq!(percent_decode("C%3A%5C%D7%A9%D7%9C%D7%95%D7%9D.pdf").as_deref(), Some(r"C:\שלום.pdf"));
        assert!(percent_decode("bad%zz").is_none());
    }

    #[test]
    fn only_pdf_or_pptx() {
        assert!(export_target("C%3A%5Cx.pdf").is_ok());
        assert!(export_target("C%3A%5Cx.PPTX").is_ok());
        assert!(export_target("C%3A%5Cx.exe").is_err());
        assert!(export_target("x.pdf").is_err()); // relative
    }
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    check_importable(&p)?;
    // read into memory is for documents/images (PDF pages, pictures) — not multi-GB videos
    if fs::metadata(&p).map(|m| m.len()).unwrap_or(0) > 1024 * 1024 * 1024 {
        return Err("הקובץ גדול מדי".into());
    }
    let bytes = tauri::async_runtime::spawn_blocking(move || fs::read(&p))
        .await
        .map_err(e2s)?
        .map_err(|e| format!("קריאת הקובץ נכשלה: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Packs session.json + every referenced media file into a single portable zip.
#[tauri::command]
pub async fn export_bundle(
    app: AppHandle,
    session_json: String,
    files: Vec<String>,
    dest: String,
) -> Result<(), String> {
    let dir = media_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        use zip::write::SimpleFileOptions;
        use zip::CompressionMethod;
        let out = fs::File::create(&dest).map_err(e2s)?;
        let mut zw = zip::ZipWriter::new(std::io::BufWriter::new(out));
        let json_opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        zw.start_file("session.json", json_opts).map_err(e2s)?;
        zw.write_all(session_json.as_bytes()).map_err(e2s)?;
        zw.start_file(
            "README.txt",
            json_opts,
        )
        .map_err(e2s)?;
        zw.write_all("Bima session bundle. Open it from the app: ייבוא חבילת מפגש.\r\n".as_bytes())
            .map_err(e2s)?;

        let mut seen = HashSet::new();
        for f in files {
            let Some(name) = safe_name(&f) else { continue };
            if !seen.insert(name.to_string()) {
                continue;
            }
            let p = dir.join(name);
            let Ok(meta) = fs::metadata(&p) else { continue };
            let opts = SimpleFileOptions::default()
                .compression_method(CompressionMethod::Stored)
                .large_file(meta.len() >= 0xFFFF_FFFF);
            zw.start_file(format!("media/{name}"), opts).map_err(e2s)?;
            let mut src = fs::File::open(&p).map_err(e2s)?;
            std::io::copy(&mut src, &mut zw).map_err(e2s)?;
        }
        zw.finish().map_err(e2s)?;
        Ok(())
    })
    .await
    .map_err(e2s)?
}

/// Extracts a bundle's media into the library and returns its session JSON.
#[tauri::command]
pub async fn import_bundle(app: AppHandle, src: String) -> Result<String, String> {
    let dir = media_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let f = fs::File::open(&src).map_err(e2s)?;
        let mut za = zip::ZipArchive::new(std::io::BufReader::new(f))
            .map_err(|e| format!("הקובץ אינו חבילת מפגש תקינה: {e}"))?;
        let mut session: Option<String> = None;
        let mut total: u64 = 0;
        for i in 0..za.len() {
            let mut entry = za.by_index(i).map_err(e2s)?;
            let name = entry.name().to_string();
            if name == "session.json" {
                let mut s = String::new();
                (&mut entry).take(64 * 1024 * 1024).read_to_string(&mut s).map_err(e2s)?;
                session = Some(s);
            } else if let Some(file) = name.strip_prefix("media/") {
                let Some(file) = safe_name(file) else { continue };
                let dst = dir.join(file);
                if dst.exists() {
                    continue;
                }
                // never trust the archive's own size claims: cap what we actually write
                const MAX_ENTRY: u64 = 16 * 1024 * 1024 * 1024;
                total += entry.size();
                if entry.size() > MAX_ENTRY || total > 4 * MAX_ENTRY {
                    return Err("החבילה גדולה מדי או פגומה".into());
                }
                let tmp = dir.join(format!("{file}.part"));
                let mut out = fs::File::create(&tmp).map_err(e2s)?;
                let n = std::io::copy(&mut (&mut entry).take(MAX_ENTRY + 1), &mut out).map_err(e2s)?;
                drop(out);
                if n > MAX_ENTRY {
                    let _ = fs::remove_file(&tmp);
                    return Err("החבילה פגומה".into());
                }
                fs::rename(&tmp, &dst).map_err(e2s)?;
            }
        }
        session.ok_or_else(|| "בחבילה חסר הקובץ session.json".to_string())
    })
    .await
    .map_err(e2s)?
}

/// Deletes media files that are not referenced by the current session.
#[tauri::command]
pub fn cleanup_media(app: AppHandle, keep: Vec<String>) -> Result<(u32, u64), String> {
    let dir = media_dir(&app)?;
    let keep: HashSet<String> = keep.into_iter().collect();
    let mut count = 0u32;
    let mut bytes = 0u64;
    for entry in fs::read_dir(&dir).map_err(e2s)?.flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if keep.contains(&name) {
            continue;
        }
        let len = entry.metadata().map(|m| m.len()).unwrap_or(0);
        if fs::remove_file(&p).is_ok() {
            count += 1;
            bytes += len;
        }
    }
    Ok((count, bytes))
}

#[tauri::command]
pub fn reveal_media_dir(app: AppHandle) -> Result<(), String> {
    let dir = media_dir(&app)?;
    open_in_explorer(&dir)
}

fn open_in_explorer(p: &Path) -> Result<(), String> {
    std::process::Command::new("explorer")
        .arg(p)
        .spawn()
        .map(|_| ())
        .map_err(e2s)
}

#[cfg(test)]
mod tests {
    use super::safe_name;

    #[test]
    fn accepts_normal_names() {
        for n in ["a1b2c3.png", "53d7a648a17b", "deck_3_t.jpg", "תמונה.jpg"] {
            assert!(safe_name(n).is_some(), "{n}");
        }
    }

    #[test]
    fn rejects_traversal_separators_and_wildcards() {
        for n in ["", ".", "..", "../x", r"..\x", "a/b", r"a\b", "c:x", "a*b", "a?b", "a|b", "a<b", "a\"b", "x.", "x ", "a\u{0}b"] {
            assert!(safe_name(n).is_none(), "{n:?}");
        }
    }

    #[test]
    fn rejects_windows_device_names_with_any_extension() {
        for n in ["CON", "con.json", "NUL.png", "com1.mp4", "Lpt9.txt", "aux"] {
            assert!(safe_name(n).is_none(), "{n}");
        }
        assert!(safe_name("console.png").is_some());
        assert!(safe_name("com10.png").is_some());
    }
}
