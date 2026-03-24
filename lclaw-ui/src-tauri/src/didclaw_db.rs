//! DidClaw 应用本地数据 SQLite（`app_data_dir/didclaw.db`）。
//! OpenClaw 的 `~/.openclaw` 仍由既有模块管理，不写入本库。

use rusqlite::{Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// 网关合并配置在 KV 表中的内部键（禁止对用户 KV 白名单开放）。
pub const GATEWAY_LOCAL_DB_KEY: &str = "__didclaw_gateway_local_merged__";

/// 前端可调用的 KV 键白名单（与 `lclaw-ui/src/lib/didclaw-kv.ts` 保持一致）。
const ALLOWED_USER_KV_KEYS: &[&str] = &[
    "didclaw-device-identity-v1",
    "didclaw_first_run_model_complete",
    "didclaw_model_config_deferred",
    "didclaw_model_wizard_snooze_until",
    "didclaw_setup_wizard_snooze_until",
    "didclaw.skillsInstallRoot",
    "didclaw.openclawUpdate.dismissedLatest",
];

const MAX_USER_KV_KEY_LEN: usize = 128;
const MAX_USER_KV_VALUE_BYTES: usize = 512 * 1024;

pub fn db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("didclaw.db"))
}

pub fn open_connection(app: &tauri::AppHandle) -> Result<Connection, String> {
    let path = db_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(&path).map_err(|e| e.to_string())?;
    conn
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| e.to_string())?;
    init_schema(&conn)?;
    Ok(conn)
}

fn init_schema(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS didclaw_kv (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;
    let ver: i32 = conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if ver < 1 {
        conn.pragma_update(None, "user_version", 1)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn read_gateway_merged_inner(conn: &Connection) -> Result<Map<String, Value>, String> {
    let row: Option<String> = conn
        .query_row(
            "SELECT value FROM didclaw_kv WHERE key = ?1",
            [GATEWAY_LOCAL_DB_KEY],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let Some(s) = row else {
        return Ok(Map::new());
    };
    let j: Value = serde_json::from_str(&s).unwrap_or(json!({}));
    match j {
        Value::Object(m) => Ok(m),
        _ => Ok(Map::new()),
    }
}

pub fn read_gateway_merged_map(app: &tauri::AppHandle) -> Result<Map<String, Value>, String> {
    let conn = open_connection(app)?;
    read_gateway_merged_inner(&conn)
}

pub fn write_gateway_merged_map(app: &tauri::AppHandle, merged: &Map<String, Value>) -> Result<(), String> {
    let conn = open_connection(app)?;
    if merged.is_empty() {
        conn.execute(
            "DELETE FROM didclaw_kv WHERE key = ?1",
            [GATEWAY_LOCAL_DB_KEY],
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    let body =
        serde_json::to_string(&Value::Object(merged.clone())).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO didclaw_kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![GATEWAY_LOCAL_DB_KEY, body],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn validate_user_kv_key(key: &str) -> Result<(), String> {
    if key.len() > MAX_USER_KV_KEY_LEN {
        return Err("key 过长".into());
    }
    if ALLOWED_USER_KV_KEYS.contains(&key) {
        return Ok(());
    }
    Err("不允许的 key".into())
}

pub fn user_kv_get(app: &tauri::AppHandle, key: &str) -> Result<Option<String>, String> {
    validate_user_kv_key(key)?;
    let conn = open_connection(app)?;
    let row: Option<String> = conn
        .query_row(
            "SELECT value FROM didclaw_kv WHERE key = ?1",
            [key],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(row)
}

pub fn user_kv_set(app: &tauri::AppHandle, key: &str, value: &str) -> Result<(), String> {
    validate_user_kv_key(key)?;
    if value.as_bytes().len() > MAX_USER_KV_VALUE_BYTES {
        return Err("value 过大".into());
    }
    let conn = open_connection(app)?;
    conn.execute(
        "INSERT INTO didclaw_kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn user_kv_remove(app: &tauri::AppHandle, key: &str) -> Result<(), String> {
    validate_user_kv_key(key)?;
    let conn = open_connection(app)?;
    conn.execute("DELETE FROM didclaw_kv WHERE key = ?1", [key])
        .map_err(|e| e.to_string())?;
    Ok(())
}
