//! PowerPoint import.
//!
//! 1. Slides are rendered to PNG through PowerPoint COM automation (full fidelity:
//!    fonts, RTL Hebrew, layout). If PowerPoint is not installed, LibreOffice headless
//!    converts the deck to PDF and the frontend rasterises it.
//! 2. Embedded / linked videos are extracted straight from the .pptx zip together with
//!    their on-slide geometry, so the app can overlay a real, playable <video> element
//!    exactly where it sits in the slide.

use crate::e2s;
use crate::media::{clean_ext, media_dir, short_id};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::AppHandle;

const PPT_SCRIPT: &str = include_str!("../scripts/export-pptx.ps1");

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VideoOverlay {
    file: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    /// PowerPoint "Trim Video": seconds cut from the start / from the end
    #[serde(skip_serializing_if = "Option::is_none")]
    trim_start: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trim_end: Option<f64>,
}

#[derive(Serialize)]
pub struct PresSlide {
    file: String,
    thumb: String,
    hidden: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresResult {
    engine: String,
    aspect: f64,
    slides: Vec<PresSlide>,
    pdf: Option<String>,
    slide_videos: Vec<Vec<VideoOverlay>>,
    warnings: Vec<String>,
}

#[cfg(windows)]
fn hidden_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    let mut c = Command::new(program);
    c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    c
}
#[cfg(not(windows))]
fn hidden_command(program: &str) -> Command {
    Command::new(program)
}


/// Run an external converter with a hard time limit. PowerPoint/LibreOffice can block forever
/// on an invisible dialog (password, Protected View, file recovery…); we kill it instead of
/// hanging the import. stderr is captured for the error message.
fn run_with_timeout(mut cmd: Command, limit: std::time::Duration) -> Result<std::process::Output, String> {
    use std::io::Read as _;
    use std::process::Stdio;
    let mut child = cmd.stdout(Stdio::null()).stderr(Stdio::piped()).spawn().map_err(e2s)?;
    // drain stderr on a thread so a chatty process can't block on a full pipe
    let mut err_pipe = child.stderr.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = p.read_to_end(&mut buf);
        }
        buf
    });
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(e2s)? {
            let stderr = reader.join().unwrap_or_default();
            return Ok(std::process::Output { status, stdout: Vec::new(), stderr });
        }
        if started.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err("ההמרה לא הסתיימה בזמן (ייתכן שהמצגת מוגנת בסיסמה או ש-PowerPoint הציג חלון). נסה לפתוח אותה ב-PowerPoint ולשמור מחדש.".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
    }
}

#[tauri::command]
pub async fn convert_presentation(app: AppHandle, path: String) -> Result<PresResult, String> {
    let media = media_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || convert_blocking(&media, Path::new(&path)))
        .await
        .map_err(e2s)?
}

fn convert_blocking(media: &Path, src: &Path) -> Result<PresResult, String> {
    let id = short_id();
    let work = media.join(format!(".work-{id}"));
    fs::create_dir_all(&work).map_err(e2s)?;
    let result = convert_in(media, &work, &id, src);
    let _ = fs::remove_dir_all(&work);
    result
}

fn convert_in(media: &Path, work: &Path, id: &str, src: &Path) -> Result<PresResult, String> {
    let mut warnings = Vec::new();
    let ext = src
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    // ---- embedded videos (OOXML only) ----
    let (slide_videos, zip_aspect) = if matches!(ext.as_str(), "pptx" | "ppsx" | "pptm" | "potx") {
        match extract_videos(src, media, id) {
            Ok(v) => v,
            Err(e) => {
                warnings.push(format!("לא ניתן היה לחלץ סרטונים מוטמעים: {e}"));
                (Vec::new(), None)
            }
        }
    } else {
        (Vec::new(), None)
    };

    // ---- 1. PowerPoint COM ----
    match powerpoint_export(work, src) {
        Ok(info) => {
            let mut slides = Vec::new();
            for i in 1..=info.count {
                let file = format!("{id}_{i}.png");
                let thumb = format!("{id}_{i}_t.png");
                fs::rename(work.join(format!("slide_{i}.png")), media.join(&file)).map_err(e2s)?;
                fs::rename(work.join(format!("thumb_{i}.png")), media.join(&thumb)).map_err(e2s)?;
                slides.push(PresSlide {
                    file,
                    thumb,
                    hidden: info.hidden.get(i - 1).copied().unwrap_or(false),
                });
            }
            return Ok(PresResult {
                engine: "powerpoint".into(),
                aspect: info.width / info.height,
                slides,
                pdf: None,
                slide_videos,
                warnings,
            });
        }
        Err(e) => warnings.push(format!("PowerPoint: {e}")),
    }

    // ---- 2. LibreOffice headless → PDF ----
    if let Some(soffice) = find_soffice() {
        let mut cmd = hidden_command(&soffice.to_string_lossy());
        cmd.args(["--headless", "--norestore", "--convert-to", "pdf", "--outdir"]).arg(work).arg(src);
        let status = run_with_timeout(cmd, std::time::Duration::from_secs(240))?.status;
        if status.success() {
            if let Some(pdf) = fs::read_dir(work)
                .map_err(e2s)?
                .flatten()
                .map(|e| e.path())
                .find(|p| p.extension().map(|x| x == "pdf").unwrap_or(false))
            {
                let name = format!("{id}.pdf");
                fs::rename(&pdf, media.join(&name)).map_err(e2s)?;
                return Ok(PresResult {
                    engine: "libreoffice".into(),
                    aspect: zip_aspect.unwrap_or(16.0 / 9.0),
                    slides: Vec::new(),
                    pdf: Some(name),
                    slide_videos,
                    warnings,
                });
            }
        }
        warnings.push("LibreOffice: ההמרה נכשלה".into());
    }

    Err(format!(
        "לא ניתן לפתוח את המצגת. יש להתקין Microsoft PowerPoint או LibreOffice.\n{}",
        warnings.join("\n")
    ))
}

struct PptInfo {
    count: usize,
    width: f64,
    height: f64,
    hidden: Vec<bool>,
}

fn powerpoint_export(work: &Path, src: &Path) -> Result<PptInfo, String> {
    if !cfg!(windows) {
        return Err("זמין רק ב-Windows".into());
    }
    let script = work.join("export.ps1");
    // UTF-8 BOM so Windows PowerShell 5.1 reads the script correctly.
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(PPT_SCRIPT.as_bytes());
    fs::write(&script, bytes).map_err(e2s)?;

    let abs = fs::canonicalize(src).unwrap_or_else(|_| src.to_path_buf());
    let abs = strip_verbatim(&abs);
    let mut cmd = hidden_command("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"])
        .arg(&script)
        .arg("-InFile")
        .arg(&abs)
        .arg("-OutDir")
        .arg(work);
    // ~1s per slide is typical; 4 minutes covers very large decks
    let out = run_with_timeout(cmd, std::time::Duration::from_secs(240))?;
    let info_path = work.join("info.json");
    if !out.status.success() || !info_path.exists() {
        let err = String::from_utf8_lossy(&out.stderr);
        let first = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("PowerPoint לא זמין");
        return Err(first.trim().to_string());
    }
    let v: serde_json::Value =
        serde_json::from_str(fs::read_to_string(info_path).map_err(e2s)?.trim_start_matches('\u{feff}'))
            .map_err(e2s)?;
    let hidden = match &v["hidden"] {
        serde_json::Value::Array(a) => a.iter().map(|x| x.as_bool().unwrap_or(false)).collect(),
        serde_json::Value::Bool(b) => vec![*b],
        _ => Vec::new(),
    };
    Ok(PptInfo {
        count: v["count"].as_u64().unwrap_or(0) as usize,
        width: v["width"].as_f64().unwrap_or(960.0),
        height: v["height"].as_f64().unwrap_or(540.0),
        hidden,
    })
}

fn strip_verbatim(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

fn find_soffice() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from(r"C:\Program Files\LibreOffice\program\soffice.exe"),
        PathBuf::from(r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"),
        PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
    ];
    // macOS: also a per-user install (~/Applications)
    if let Some(home) = std::env::var_os("HOME") {
        candidates.push(PathBuf::from(home).join("Applications/LibreOffice.app/Contents/MacOS/soffice"));
    }
    candidates.into_iter().find(|p| p.exists())
}

// ---------------------------------------------------------------- OOXML parsing

fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let needle = format!(" {name}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    Some(&tag[start..end])
}

fn read_entry(za: &mut zip::ZipArchive<fs::File>, name: &str) -> Option<String> {
    let mut e = za.by_name(name).ok()?;
    let mut s = String::new();
    e.read_to_string(&mut s).ok()?;
    Some(s)
}

/// Relationship id → (target, external?)
fn parse_rels(xml: &str) -> HashMap<String, (String, bool)> {
    let re = Regex::new(r"<Relationship\b[^>]*>").unwrap();
    re.find_iter(xml)
        .filter_map(|m| {
            let t = m.as_str();
            Some((
                attr(t, "Id")?.to_string(),
                (
                    attr(t, "Target")?.to_string(),
                    attr(t, "TargetMode") == Some("External"),
                ),
            ))
        })
        .collect()
}

fn resolve_zip_path(base_dir: &str, target: &str) -> String {
    if let Some(abs) = target.strip_prefix('/') {
        return abs.to_string();
    }
    let mut parts: Vec<&str> = base_dir.split('/').filter(|s| !s.is_empty()).collect();
    for seg in target.split('/') {
        match seg {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            s => parts.push(s),
        }
    }
    parts.join("/")
}

const VIDEO_EXT: &[&str] = &["mp4", "m4v", "mov", "webm", "wmv", "avi", "mkv", "mpg", "mpeg"];

type Extracted = (Vec<Vec<VideoOverlay>>, Option<f64>);

fn extract_videos(src: &Path, media: &Path, id: &str) -> Result<Extracted, String> {
    let f = fs::File::open(src).map_err(e2s)?;
    let mut za = zip::ZipArchive::new(f).map_err(e2s)?;

    let pres = read_entry(&mut za, "ppt/presentation.xml").ok_or("presentation.xml חסר")?;
    let pres_rels = parse_rels(&read_entry(&mut za, "ppt/_rels/presentation.xml.rels").unwrap_or_default());

    let sz_re = Regex::new(r"<p:sldSz\b[^>]*>").unwrap();
    let (cx, cy) = sz_re
        .find(&pres)
        .and_then(|m| {
            let t = m.as_str();
            Some((attr(t, "cx")?.parse::<f64>().ok()?, attr(t, "cy")?.parse::<f64>().ok()?))
        })
        .unwrap_or((12_192_000.0, 6_858_000.0));

    let id_re = Regex::new(r"<p:sldId\b[^>]*>").unwrap();
    let slide_paths: Vec<String> = id_re
        .find_iter(&pres)
        .filter_map(|m| attr(m.as_str(), "r:id").map(|s| s.to_string()))
        .filter_map(|rid| pres_rels.get(&rid).map(|(t, _)| resolve_zip_path("ppt", t)))
        .collect();

    let pic_re = Regex::new(r"(?s)<p:pic\b.*?</p:pic>").unwrap();
    let off_re = Regex::new(r"<a:off\b[^>]*>").unwrap();
    let ext_re = Regex::new(r"<a:ext\b[^>]*\bcx=[^>]*>").unwrap();
    let embed_re = Regex::new(r#"<p14:media\b[^>]*r:embed="([^"]+)""#).unwrap();
    let link_re = Regex::new(r#"<a:videoFile\b[^>]*r:link="([^"]+)""#).unwrap();
    let trim_re = Regex::new(r"<p14:trim\b[^>]*>").unwrap();

    let mut extracted: HashMap<String, String> = HashMap::new();
    let mut counter = 0usize;
    let mut out = Vec::new();

    for slide_path in &slide_paths {
        let mut overlays = Vec::new();
        let Some(xml) = read_entry(&mut za, slide_path) else {
            out.push(overlays);
            continue;
        };
        let (dir, file) = slide_path.rsplit_once('/').unwrap_or(("", slide_path));
        let rels = parse_rels(&read_entry(&mut za, &format!("{dir}/_rels/{file}.rels")).unwrap_or_default());

        for pic in pic_re.find_iter(&xml).map(|m| m.as_str()) {
            let rid = embed_re
                .captures(pic)
                .or_else(|| link_re.captures(pic))
                .map(|c| c[1].to_string());
            let Some(rid) = rid else { continue };
            let Some((target, external)) = rels.get(&rid) else { continue };

            let ext = target.rsplit('.').next().unwrap_or("").to_lowercase();
            if !VIDEO_EXT.contains(&ext.as_str()) {
                continue;
            }

            let key = format!("{external}:{target}");
            let stored = if let Some(s) = extracted.get(&key) {
                s.clone()
            } else {
                counter += 1;
                let name = format!("{id}_v{counter}.{}", clean_ext(&ext));
                let ok = if *external {
                    let p = target.strip_prefix("file:///").unwrap_or(target).replace("%20", " ");
                    fs::copy(&p, media.join(&name)).is_ok()
                } else {
                    let zp = resolve_zip_path(dir, target);
                    match za.by_name(&zp) {
                        Ok(mut entry) => fs::File::create(media.join(&name))
                            .and_then(|mut o| std::io::copy(&mut entry, &mut o))
                            .is_ok(),
                        Err(_) => false,
                    }
                };
                if !ok {
                    continue;
                }
                extracted.insert(key, name.clone());
                name
            };

            let (x, y) = off_re
                .find(pic)
                .and_then(|m| {
                    let t = m.as_str();
                    Some((attr(t, "x")?.parse::<f64>().ok()?, attr(t, "y")?.parse::<f64>().ok()?))
                })
                .unwrap_or((0.0, 0.0));
            let (w, h) = ext_re
                .find(pic)
                .and_then(|m| {
                    let t = m.as_str();
                    Some((attr(t, "cx")?.parse::<f64>().ok()?, attr(t, "cy")?.parse::<f64>().ok()?))
                })
                .unwrap_or((cx, cy));

            // <p14:trim st="1234.5" end="678.9"/> - milliseconds trimmed from start / end
            let trim = trim_re.find(pic).map(|m| m.as_str());
            let ms = |k: &str| {
                trim.and_then(|t| attr(t, k))
                    .and_then(|v| v.parse::<f64>().ok())
                    .filter(|v| *v > 0.0)
                    .map(|v| v / 1000.0)
            };

            overlays.push(VideoOverlay {
                file: stored,
                x: x / cx,
                y: y / cy,
                w: w / cx,
                h: h / cy,
                trim_start: ms("st"),
                trim_end: ms("end"),
            });
        }
        out.push(overlays);
    }
    Ok((out, Some(cx / cy)))
}
