//! OS integration that makes a live show dependable:
//! * keep-awake - no sleep / screen-off while Bima is open (laptops on battery, Modern
//!   Standby machines otherwise nap mid-presentation). Windows: SetThreadExecutionState;
//!   macOS: a `caffeinate` assertion tied to our process;
//! * display mode (Windows) - like PowerPoint: if a projector is connected but mirrored
//!   ("Duplicate"), switch to "Extend" for the show and put it back afterwards. On macOS the
//!   arrangement is the user's System Settings choice and we leave it alone.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;
use tauri::AppHandle;

// ------------------------------------------------------------------ keep awake

#[cfg(windows)]
const ES_CONTINUOUS: u32 = 0x8000_0000;
const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;
const ES_AWAYMODE_REQUIRED: u32 = 0x0000_0040;

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn SetThreadExecutionState(es_flags: u32) -> u32;
}

static WANT: AtomicU32 = AtomicU32::new(0);
static STARTED: AtomicBool = AtomicBool::new(false);

/// A dedicated thread owns the execution state (it is per-thread in Windows) and re-asserts
/// it periodically, so nothing else in the app can accidentally clear it.
fn ensure_thread() {
    if STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::Builder::new()
        .name("bima-keep-awake".into())
        .spawn(|| loop {
            let flags = WANT.load(Ordering::SeqCst);
            #[cfg(windows)]
            unsafe {
                SetThreadExecutionState(ES_CONTINUOUS | flags);
            }
            let _ = flags;
            std::thread::sleep(Duration::from_secs(20));
        })
        .ok();
}

/// macOS: `caffeinate -w <our pid>` holds the power assertion and ends with us, so a crash
/// can never leave the Mac unable to sleep.
#[cfg(target_os = "macos")]
fn mac_caffeinate(system: bool, display: bool) {
    use std::sync::Mutex;
    static CHILD: Mutex<Option<std::process::Child>> = Mutex::new(None);
    let mut slot = CHILD.lock().unwrap();
    if let Some(mut old) = slot.take() {
        let _ = old.kill();
        let _ = old.wait();
    }
    if !system && !display {
        return;
    }
    let mut flags = String::from("-");
    if system {
        flags.push('i');
    }
    if display {
        flags.push('d');
    }
    *slot = std::process::Command::new("/usr/bin/caffeinate")
        .arg(flags)
        .arg("-w")
        .arg(std::process::id().to_string())
        .spawn()
        .ok();
}

/// system: never sleep · display: never turn the screens off.
#[tauri::command]
pub fn set_keep_awake(system: bool, display: bool) {
    #[cfg(target_os = "macos")]
    mac_caffeinate(system, display);
    let mut f = 0;
    if system {
        f |= ES_SYSTEM_REQUIRED | ES_AWAYMODE_REQUIRED;
    }
    if display {
        f |= ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED;
    }
    WANT.store(f, Ordering::SeqCst);
    ensure_thread();
}

// ------------------------------------------------------------------ installed fonts

/// Font families installed on this computer (system-wide + per-user).
/// Windows: from the registry - entries look like "Segoe UI Semibold Italic (TrueType)" →
/// family "Segoe UI". macOS: Core Text's own family list.
#[tauri::command]
pub fn list_system_fonts() -> Vec<String> {
    let mut out = std::collections::BTreeSet::new();
    #[cfg(target_os = "macos")]
    {
        for name in core_text::font_collection::get_family_names().iter() {
            let fam = name.to_string();
            // hidden system families start with "." (".SF NS", ".AppleSystemUIFont")
            if fam.len() > 1 && !fam.starts_with('.') {
                out.insert(fam);
            }
        }
    }
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
        use winreg::RegKey;
        const PATH: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts";
        const STYLES: &[&str] = &[
            "Bold", "Italic", "Oblique", "Light", "Semilight", "SemiLight", "Semibold", "SemiBold", "Demibold", "DemiBold",
            "Black", "Heavy", "Thin", "ExtraLight", "Extra Light", "UltraLight", "ExtraBold", "Extra Bold", "UltraBold",
            "Medium", "Regular", "Book", "Condensed", "Narrow", "Variable", "Display", "Text",
        ];
        for root in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
            let Ok(key) = RegKey::predef(root).open_subkey(PATH) else { continue };
            for (name, _) in key.enum_values().flatten() {
                // drop "(TrueType)" etc., then split font collections "A & B"
                let base = name.split(" (").next().unwrap_or(&name).trim().to_string();
                for part in base.split(" & ") {
                    let mut fam = part.trim().to_string();
                    // strip trailing style words, repeatedly ("Segoe UI Semibold Italic" → "Segoe UI")
                    loop {
                        let before = fam.clone();
                        for st in STYLES {
                            if let Some(rest) = fam.strip_suffix(st) {
                                let rest = rest.trim_end();
                                if !rest.is_empty() {
                                    fam = rest.to_string();
                                }
                            }
                        }
                        if fam == before {
                            break;
                        }
                    }
                    if fam.len() > 1 && !fam.starts_with('@') {
                        out.insert(fam);
                    }
                }
            }
        }
    }
    out.into_iter().collect()
}

// ------------------------------------------------------------------ icon refresh after updates

/// Windows caches app icons (taskbar, Start menu, desktop shortcut). After an in-place
/// update the exe carries the new icon but the shell keeps showing the cached old one, so
/// the first run of each new version asks Explorer to rebuild its icon cache.
pub fn refresh_icons_after_update(app: &AppHandle) {
    let version = app.package_info().version.to_string();
    let Ok(dir) = crate::media::data_dir(app) else { return };
    let marker = dir.join("last-run-version");
    if std::fs::read_to_string(&marker).map(|v| v.trim() == version).unwrap_or(false) {
        return;
    }
    let _ = std::fs::write(&marker, &version);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new(r"C:\Windows\System32\ie4uinit.exe")
            .arg("-show")
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .spawn();
    }
}

// ------------------------------------------------------------------ display mode

#[cfg(windows)]
#[repr(C)]
struct DisplayDevice {
    cb: u32,
    device_name: [u16; 32],
    device_string: [u16; 128],
    state_flags: u32,
    device_id: [u16; 128],
    device_key: [u16; 128],
}

#[cfg(windows)]
#[link(name = "user32")]
extern "system" {
    fn EnumDisplayDevicesW(device: *const u16, index: u32, dd: *mut DisplayDevice, flags: u32) -> i32;
}

/// Number of physical screens that are currently showing something - including screens
/// that mirror another one (which Windows reports as a single "monitor").
#[cfg(windows)]
fn active_screens() -> u32 {
    const ATTACHED_TO_DESKTOP: u32 = 0x1;
    const MONITOR_ACTIVE: u32 = 0x1;
    let new_dd = || {
        let mut d: DisplayDevice = unsafe { std::mem::zeroed() };
        d.cb = std::mem::size_of::<DisplayDevice>() as u32;
        d
    };
    let mut count = 0;
    let mut i = 0;
    loop {
        let mut adapter = new_dd();
        if unsafe { EnumDisplayDevicesW(std::ptr::null(), i, &mut adapter, 0) } == 0 {
            break;
        }
        i += 1;
        if adapter.state_flags & ATTACHED_TO_DESKTOP == 0 {
            continue;
        }
        let mut j = 0;
        loop {
            let mut mon = new_dd();
            if unsafe { EnumDisplayDevicesW(adapter.device_name.as_ptr(), j, &mut mon, 0) } == 0 {
                break;
            }
            j += 1;
            if mon.state_flags & MONITOR_ACTIVE != 0 {
                count += 1;
            }
        }
    }
    count
}
#[cfg(not(windows))]
fn active_screens() -> u32 {
    0
}

fn display_switch(arg: &str) -> Result<(), String> {
    if !cfg!(windows) {
        return Err("not available on this system".into());
    }
    let mut cmd = std::process::Command::new(r"C:\Windows\System32\DisplaySwitch.exe");
    cmd.arg(arg);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtendResult {
    /// we changed Windows' display mode (so we should restore it after the show)
    switched: bool,
    monitors: usize,
}

/// If a second screen is connected but mirrored, switch Windows to "Extend" and wait until
/// the new desktop layout is live. No second screen → nothing happens (no flicker).
#[tauri::command]
pub async fn extend_displays(app: AppHandle) -> Result<ExtendResult, String> {
    let monitors = app.available_monitors().map(|m| m.len()).unwrap_or(1);
    if monitors >= 2 || active_screens() < 2 {
        return Ok(ExtendResult { switched: false, monitors });
    }
    display_switch("/extend")?;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(150)).await;
        let n = app.available_monitors().map(|m| m.len()).unwrap_or(1);
        if n >= 2 {
            // give Windows a moment to settle positions / DPI before we place a window there
            tokio::time::sleep(Duration::from_millis(600)).await;
            return Ok(ExtendResult { switched: true, monitors: n });
        }
    }
    Ok(ExtendResult { switched: true, monitors: app.available_monitors().map(|m| m.len()).unwrap_or(1) })
}

/// Back to "Duplicate" (only called if we switched it ourselves).
#[tauri::command]
pub fn restore_duplicate() -> Result<(), String> {
    display_switch("/clone")
}

/// How many physical screens are lit (for the UI: "projector detected").
#[tauri::command]
pub fn screen_count() -> u32 {
    active_screens()
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(windows)]
    fn counts_screens() {
        let n = super::active_screens();
        println!("active screens: {n}");
        assert!(n >= 1);
    }
}

#[cfg(test)]
mod font_tests {
    #[test]
    fn lists_fonts() {
        let f = super::list_system_fonts();
        println!("{} families; sample: {:?}", f.len(), f.iter().filter(|x| x.contains("Segoe") || x.contains("Arial") || x.contains("David") || x.contains("Miriam")).collect::<Vec<_>>());
        assert!(f.len() > 10);
    }
}
