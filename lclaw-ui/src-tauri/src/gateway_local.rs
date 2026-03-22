//! `gateway-local.json`：与 `electron/main.ts` 中 `readGatewayLocalMerged` / `writeLocalConfig` 行为对齐。

use serde_json::{json, Map, Value};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

pub fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("gateway-local.json"))
}

pub fn read_merged_map(app: &tauri::AppHandle) -> Result<Map<String, Value>, String> {
    let p = config_path(app)?;
    if !p.is_file() {
        return Ok(Map::new());
    }
    let raw = fs::read_to_string(&p).map_err(|e| e.to_string())?;
    let j: Value = serde_json::from_str(&raw).unwrap_or(json!({}));
    match j {
        Value::Object(m) => Ok(m),
        _ => Ok(Map::new()),
    }
}

/// 供前端读取的字段子集（与 Electron `LocalGatewayFile` 一致）。
pub fn merged_to_frontend_value(m: &Map<String, Value>) -> Value {
    let mut out = Map::new();
    if let Some(Value::String(s)) = m.get("url") {
        let t = s.trim();
        if !t.is_empty() {
            out.insert("url".into(), json!(t));
        }
    }
    if let Some(Value::String(s)) = m.get("token") {
        let t = s.trim();
        if !t.is_empty() {
            out.insert("token".into(), json!(t));
        }
    }
    if let Some(Value::String(s)) = m.get("password") {
        let t = s.trim();
        if !t.is_empty() {
            out.insert("password".into(), json!(t));
        }
    }
    if let Some(v) = m.get("autoStartOpenClaw") {
        if v.is_boolean() {
            out.insert("autoStartOpenClaw".into(), v.clone());
        }
    }
    if let Some(v) = m.get("stopManagedGatewayOnQuit") {
        if v.is_boolean() {
            out.insert("stopManagedGatewayOnQuit".into(), v.clone());
        }
    }
    if let Some(Value::String(s)) = m.get("openclawExecutable") {
        let t = s.trim();
        if !t.is_empty() {
            out.insert("openclawExecutable".into(), json!(t));
        }
    }
    Value::Object(out)
}

pub fn write_merged_from_payload(
    app: &tauri::AppHandle,
    data: &Value,
) -> Result<(), String> {
    if !data.is_object() {
        return Err("参数无效".into());
    }
    let o = data
        .as_object()
        .ok_or_else(|| "参数无效".to_string())?;
    let mut merged = read_merged_map(app)?;

    if let Some(Value::String(s)) = o.get("url") {
        let t = s.trim();
        if t.is_empty() {
            merged.remove("url");
        } else {
            merged.insert("url".into(), json!(t));
        }
    }
    if let Some(Value::String(s)) = o.get("token") {
        let t = s.trim();
        if t.is_empty() {
            merged.remove("token");
        } else {
            merged.insert("token".into(), json!(t));
        }
    }
    if let Some(Value::String(s)) = o.get("password") {
        let t = s.trim();
        if t.is_empty() {
            merged.remove("password");
        } else {
            merged.insert("password".into(), json!(t));
        }
    }
    if o.contains_key("autoStartOpenClaw") {
        let v = matches!(o.get("autoStartOpenClaw"), Some(Value::Bool(true)));
        merged.insert("autoStartOpenClaw".into(), Value::Bool(v));
    }
    if o.contains_key("stopManagedGatewayOnQuit") {
        let v = matches!(o.get("stopManagedGatewayOnQuit"), Some(Value::Bool(true)));
        merged.insert("stopManagedGatewayOnQuit".into(), Value::Bool(v));
    }
    if o.contains_key("openclawExecutable") {
        let t = o
            .get("openclawExecutable")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if t.is_empty() {
            merged.remove("openclawExecutable");
        } else {
            merged.insert("openclawExecutable".into(), json!(t));
        }
    }

    let p = config_path(app)?;
    let dir = p.parent().ok_or_else(|| "无效配置路径".to_string())?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;

    if merged.is_empty() {
        let _ = fs::remove_file(&p);
        return Ok(());
    }
    let out = merged;
    let body = format!("{}\n", serde_json::to_string_pretty(&Value::Object(out)).map_err(|e| e.to_string())?);
    fs::write(&p, body).map_err(|e| e.to_string())?;
    Ok(())
}
