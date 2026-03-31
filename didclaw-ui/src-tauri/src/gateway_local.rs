//! 网关本机合并配置：存于 `didclaw.db`。
//! 行为与历史 Electron `readGatewayLocalMerged` / `writeLocalConfig` 对齐。

use crate::didclaw_db;
use serde_json::{json, Map, Value};

/// 对用户提供的可执行文件路径做基础安全校验（深度防御；Command::new 不走 shell，
/// 但拒绝明显的注入字符可防止路径混淆及日志污染）。
fn validate_executable_path(p: &str) -> Result<(), String> {
    if p.len() > 4096 {
        return Err("可执行文件路径过长".into());
    }
    for ch in ['|', ';', '`', '$', '>', '<', '\n', '\r'] {
        if p.contains(ch) {
            return Err(format!("可执行文件路径包含非法字符 '{ch}'"));
        }
    }
    Ok(())
}

pub fn read_merged_map(app: &tauri::AppHandle) -> Result<Map<String, Value>, String> {
    didclaw_db::read_gateway_merged_map(app)
}

/// 供前端读取的字段子集（与历史 `LocalGatewayFile` 一致）。
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

pub fn write_merged_from_payload(app: &tauri::AppHandle, data: &Value) -> Result<(), String> {
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
            validate_executable_path(t)?;
            merged.insert("openclawExecutable".into(), json!(t));
        }
    }

    didclaw_db::write_gateway_merged_map(app, &merged)
}
