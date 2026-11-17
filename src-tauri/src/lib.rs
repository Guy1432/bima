mod cloud;
mod library;
mod media;
mod presentation;
mod system;
mod sync_plan;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
    WindowEvent,
};

pub(crate) fn e2s<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

const BROWSER_ARGS: &str = "--autoplay-policy=no-user-gesture-required --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection";
const PROJECTOR: &str = "projector";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MonitorInfo {
    index: usize,
    name: String,
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    scale: f64,
    primary: bool,
}

#[tauri::command]
fn list_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app.available_monitors().map_err(e2s)?;
    let primary = app.primary_monitor().ok().flatten();
    Ok(monitors
        .iter()
        .enumerate()
        .map(|(index, m)| {
            let p = m.position();
            let s = m.size();
            let is_primary = primary
                .as_ref()
                .map(|pm| pm.position() == p && pm.size() == s)
                .unwrap_or(index == 0);
            MonitorInfo {
                index,
                name: m.name().cloned().unwrap_or_else(|| format!("מסך {}", index + 1)),
                x: p.x,
                y: p.y,
                width: s.width,
                height: s.height,
                scale: m.scale_factor(),
                primary: is_primary,
            }
        })
        .collect())
}

/// Opens (or moves) the borderless fullscreen audience window.
/// `monitor`: explicit monitor index, or None for auto (first non-primary).
/// `windowed`: open as a regular window - used for rehearsal on a single screen.
/// macOS "simple" fullscreen: covers the screen without creating a separate Space (native
/// fullscreen animates, and hides the window when the operator switches Spaces).
fn set_fullscreen(win: &tauri::WebviewWindow, on: bool) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    return win.set_simple_fullscreen(on);
    #[cfg(not(target_os = "macos"))]
    return win.set_fullscreen(on);
}

#[tauri::command]
async fn open_projector(
    app: AppHandle,
    monitor: Option<usize>,
    windowed: bool,
) -> Result<String, String> {
    let monitors = app.available_monitors().map_err(e2s)?;
    let primary = app.primary_monitor().ok().flatten();
    let is_primary = |m: &tauri::Monitor| {
        primary
            .as_ref()
            .map(|p| p.position() == m.position() && p.size() == m.size())
            .unwrap_or(false)
    };

    let target = match monitor {
        Some(i) if i < monitors.len() => Some(monitors[i].clone()),
        _ => monitors
            .iter()
            .find(|m| !is_primary(m))
            .cloned()
            .or_else(|| monitors.first().cloned()),
    }
    .ok_or("לא נמצא מסך")?;

    // Single screen + auto → rehearsal window instead of covering the operator.
    let windowed = windowed || (monitor.is_none() && monitors.len() < 2);

    if let Some(existing) = app.get_webview_window(PROJECTOR) {
        let _ = existing.hide();
        let _ = existing.destroy();
        // wait (max ~1.5s) until the old window is really gone before re-using the label
        for _ in 0..30 {
            if app.get_webview_window(PROJECTOR).is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }

    let mut builder = WebviewWindowBuilder::new(&app, PROJECTOR, WebviewUrl::App("index.html".into()))
        .title("בימה - מסך קהל")
        .background_color(tauri::window::Color(0, 0, 0, 255))
        .additional_browser_args(BROWSER_ARGS)
        .focused(false)
        .visible(false);

    if windowed {
        builder = builder.decorations(true).resizable(true).inner_size(960.0, 540.0);
    } else {
        builder = builder
            .decorations(false)
            .resizable(false)
            .skip_taskbar(true)
            .always_on_top(true)
            .shadow(false);
    }

    let win = builder.build().map_err(e2s)?;

    if !windowed {
        let pos = *target.position();
        let size = *target.size();
        win.set_position(PhysicalPosition::new(pos.x, pos.y)).map_err(e2s)?;
        win.set_size(PhysicalSize::new(size.width, size.height)).map_err(e2s)?;
        set_fullscreen(&win, true).map_err(e2s)?;
    }
    win.show().map_err(e2s)?;

    let handle = app.clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Destroyed = e {
            let _ = handle.emit("projector-closed", ());
        }
    });

    if !windowed {
        watch_projector_display(app.clone(), ScreenId::of(&target));
    }

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }

    Ok(if windowed {
        "windowed".into()
    } else {
        target.name().cloned().unwrap_or_else(|| "מסך חיצוני".into())
    })
}

/// Identity of the screen the projector was opened on.
#[derive(Clone, Debug, PartialEq)]
struct ScreenId {
    name: Option<String>,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
}

impl ScreenId {
    fn of(m: &tauri::Monitor) -> Self {
        let (p, s) = (m.position(), m.size());
        ScreenId { name: m.name().cloned(), x: p.x, y: p.y, w: s.width, h: s.height }
    }
}

/// Is the target screen still connected? Matched by its Windows device name, or by the
/// exact same geometry (names can change when Windows re-enumerates displays).
/// Deliberately NOT "is the window on the primary screen": the audience screen may well be
/// the primary one — that's a normal setup, not a disconnect.
fn target_present(target: &ScreenId, now: &[ScreenId]) -> bool {
    now.iter().any(|m| {
        (target.name.is_some() && m.name == target.name) || (m.x == target.x && m.y == target.y && m.w == target.w && m.h == target.h)
    })
}

/// How many consecutive misses mean "gone": projectors drop off the bus for a second or two
/// when they re-handshake HDMI (input switch, resolution change) — that is not a disconnect.
const LOST_AFTER: u32 = 3; // × 1.2 s ≈ 3.6 s

/// While the projector is fullscreen: if ITS screen disappears (cable pulled, projector
/// switched off), Windows moves the window onto another screen — typically the operator's —
/// fullscreen and always-on-top, i.e. covering everything mid-show. Detect that and demote
/// it to a small, normal window instead, and tell the UI.
fn watch_projector_display(app: AppHandle, target: ScreenId) {
    std::thread::spawn(move || {
        let mut misses = 0;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            let Some(win) = app.get_webview_window(PROJECTOR) else { return };
            let now: Vec<ScreenId> = match app.available_monitors() {
                Ok(m) => m.iter().map(ScreenId::of).collect(),
                Err(_) => continue, // can't tell → don't act
            };
            misses = if target_present(&target, &now) { 0 } else { misses + 1 };
            if misses >= LOST_AFTER {
                let _ = set_fullscreen(&win, false);
                let _ = win.set_always_on_top(false);
                let _ = win.set_decorations(true);
                let _ = win.set_size(PhysicalSize::new(960, 540));
                let _ = win.center();
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.set_focus();
                }
                let _ = app.emit("projector-display-lost", ());
                return;
            }
        }
    });
}

#[cfg(test)]
mod watch_tests {
    use super::*;

    fn scr(name: &str, x: i32, w: u32) -> ScreenId {
        ScreenId { name: Some(name.into()), x, y: 0, w, h: 1080 }
    }

    #[test]
    fn present_when_projecting_on_the_primary_screen() {
        // the false alarm we had: audience screen IS the primary one
        let target = scr("DISPLAY1", 0, 1920);
        assert!(target_present(&target, &[scr("DISPLAY1", 0, 1920), scr("DISPLAY2", 1920, 2880)]));
    }

    #[test]
    fn present_after_windows_renames_the_display() {
        let target = scr("DISPLAY2", 1920, 1920);
        assert!(target_present(&target, &[scr("DISPLAY1", 0, 2880), scr("DISPLAY5", 1920, 1920)]));
    }

    #[test]
    fn present_after_re_layout_with_same_name() {
        let target = scr("DISPLAY2", 1920, 1920);
        assert!(target_present(&target, &[scr("DISPLAY2", -1920, 1920), scr("DISPLAY1", 0, 2880)]));
    }

    #[test]
    fn missing_when_the_projector_is_unplugged() {
        let target = scr("DISPLAY2", 1920, 1920);
        assert!(!target_present(&target, &[scr("DISPLAY1", 0, 2880)]));
    }

    #[test]
    fn missing_on_a_three_screen_setup_when_the_projector_goes() {
        let target = scr("DISPLAY3", 4800, 1920);
        assert!(!target_present(&target, &[scr("DISPLAY1", 0, 2880), scr("DISPLAY2", 2880, 1920)]));
    }
}

#[tauri::command]
async fn close_projector(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window(PROJECTOR) {
        let _ = set_fullscreen(&w, false);
        let _ = w.hide();
        w.destroy().map_err(e2s)?;
    }
    // belt and braces: tell every window the projector is gone
    let _ = app.emit("projector-closed", ());
    Ok(())
}

#[tauri::command]
fn is_projector_open(app: AppHandle) -> bool {
    app.get_webview_window(PROJECTOR).is_some()
}

/// The UI finished its shutdown work (last save flushed, projector closed) → quit.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
fn focus_main(app: AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // a second launch focuses the running Bima instead of starting a rival instance
        // (two sync engines on the same files would race each other)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(main) = app.get_webview_window("main") {
                let _ = main.unminimize();
                let _ = main.show();
                let _ = main.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let h = app.handle().clone();
            library::migrate_legacy(&h);
            library::allow_media_scope(&h);
            cloud::retire_drive(&h);
            system::refresh_icons_after_update(&h);
            if cloud::signed_in() {
                library::leave_cloud_folder(&h);
            }
            cloud::start_sync_loop(h.clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let app = window.app_handle().clone();
                    let _ = app.emit("app-close-requested", ());
                    // safety net: if the UI doesn't answer (crashed, frozen), quit anyway
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_secs(4));
                        app.exit(0);
                    });
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_monitors,
            open_projector,
            close_projector,
            is_projector_open,
            focus_main,
            quit_app,
            media::get_media_dir,
            library::get_library,
            library::detect_cloud_folders,
            library::set_library,
            library::list_sessions,
            library::load_session,
            library::save_session,
            library::session_mtime,
            library::delete_session,
            library::new_session_id,
            cloud::cloud_status,
            cloud::cloud_send_code,
            cloud::cloud_send_link,
            cloud::cloud_verify_code,
            cloud::cloud_logout,
            cloud::cloud_access_token,
            cloud::cloud_sync_now,
            cloud::cloud_network_online,
            cloud::cloud_device_id,
            system::set_keep_awake,
            system::extend_displays,
            system::restore_duplicate,
            system::screen_count,
            system::list_system_fonts,
            cloud::open_url,
            media::import_file,
            media::save_media_bytes,
            media::write_export,
            media::read_file_bytes,
            media::export_bundle,
            media::import_bundle,
            media::cleanup_media,
            media::reveal_media_dir,
            presentation::convert_presentation,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
