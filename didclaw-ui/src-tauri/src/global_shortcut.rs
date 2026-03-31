//! Global hotkey: summon DidClaw from anywhere.

use rusqlite::OptionalExtension;
use tauri::AppHandle;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

const DB_KEY: &str = "didclaw.globalShortcutKey";
pub const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+D";

fn db_get(app: &AppHandle) -> Option<String> {
    let conn = crate::didclaw_db::open_connection(app).ok()?;
    conn.query_row(
        "SELECT value FROM didclaw_kv WHERE key = ?1",
        [DB_KEY],
        |r| r.get::<_, String>(0),
    )
    .optional()
    .ok()
    .flatten()
}

fn db_set(app: &AppHandle, value: &str) -> Result<(), String> {
    let conn = crate::didclaw_db::open_connection(app)?;
    conn.execute(
        "INSERT INTO didclaw_kv (key, value) VALUES (?1, ?2) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![DB_KEY, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn db_remove(app: &AppHandle) -> Result<(), String> {
    let conn = crate::didclaw_db::open_connection(app)?;
    conn.execute("DELETE FROM didclaw_kv WHERE key = ?1", [DB_KEY])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_shortcut_key(app: &AppHandle) -> String {
    db_get(app).unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

/// Re-register the shortcut. Call after plugin init.
pub fn setup_global_shortcut(app: &AppHandle) {
    let key = get_shortcut_key(app);
    match app.global_shortcut().register(key.as_str()) {
        Ok(_) => crate::launch_log::line(&format!("global_shortcut: registered {key}")),
        Err(e) => crate::launch_log::line(&format!(
            "global_shortcut: register failed ({e})"
        )),
    }
}

pub fn set_shortcut_key(app: &AppHandle, key: String) -> Result<(), String> {
    let _ = app.global_shortcut().unregister_all();
    let trimmed = key.trim();
    if trimmed.is_empty() {
        db_remove(app)?;
        return Ok(());
    }
    app.global_shortcut()
        .register(trimmed)
        .map_err(|e| {
            if crate::app_locale::is_en() {
                format!("Failed to register shortcut \"{trimmed}\": {e}")
            } else {
                format!("无法注册快捷键 \"{trimmed}\": {e}")
            }
        })?;
    db_set(app, trimmed)?;
    Ok(())
}
