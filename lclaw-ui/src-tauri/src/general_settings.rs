//! General UX settings: autostart and prevent-sleep.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

static PREVENT_SLEEP_ENABLED: AtomicBool = AtomicBool::new(false);

// ── Autostart ────────────────────────────────────────────────────────────────

pub fn get_autostart(app: &AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

pub fn set_autostart(app: &AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

// ── Prevent Sleep ─────────────────────────────────────────────────────────────

pub fn get_prevent_sleep() -> bool {
    PREVENT_SLEEP_ENABLED.load(Ordering::Relaxed)
}

pub fn set_prevent_sleep(enabled: bool) -> Result<(), String> {
    apply_prevent_sleep(enabled)?;
    PREVENT_SLEEP_ENABLED.store(enabled, Ordering::Relaxed);
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply_prevent_sleep(enabled: bool) -> Result<(), String> {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;

    #[link(name = "kernel32")]
    extern "system" {
        fn SetThreadExecutionState(esFlags: u32) -> u32;
    }

    let flags = if enabled {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    } else {
        ES_CONTINUOUS // reset to allow sleep
    };

    let result = unsafe { SetThreadExecutionState(flags) };
    if result == 0 {
        return Err("SetThreadExecutionState failed".to_string());
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn apply_prevent_sleep(_enabled: bool) -> Result<(), String> {
    Ok(())
}
