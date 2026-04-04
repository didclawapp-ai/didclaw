//! 读取 / 合并写入 `openclaw.json` 的 `tools.agentToAgent`（官方 multi-agent，与 Phase 2 拓扑对齐）。

use crate::openclaw_common::{is_enoent, openclaw_config_path};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

fn agent_id_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-zA-Z][a-zA-Z0-9._-]*$").expect("agent id regex"))
}

fn backup_openclaw_json_if_exists(config_path: &Path) -> Result<String, String> {
    let parent = config_path
        .parent()
        .ok_or_else(|| "无法解析 openclaw.json 父目录".to_string())?;
    let name = format!(
        "openclaw.json.didclaw-backup-{}.json",
        crate::openclaw_common::backup_timestamp()
    );
    let backup_path = parent.join(name);
    fs::copy(config_path, &backup_path).map_err(|e| e.to_string())?;
    Ok(backup_path.to_string_lossy().to_string())
}

fn empty_to_null(s: &str) -> Value {
    if s.is_empty() {
        Value::Null
    } else {
        json!(s)
    }
}

fn normalize_allow_list(arr: &[Value]) -> Result<Vec<String>, String> {
    let mut out: Vec<String> = Vec::new();
    for v in arr {
        let s = v
            .as_str()
            .map(str::trim)
            .ok_or_else(|| "allow 中每一项须为非空字符串".to_string())?;
        if s.is_empty() {
            return Err("allow 中 agent id 不能为空".to_string());
        }
        if !agent_id_regex().is_match(s) {
            return Err(format!(
                "allow 中 id「{s}」不合法：须以字母开头，仅含字母、数字、._-"
            ));
        }
        out.push(s.to_string());
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// 返回 `{ ok, enabled, allow }`；缺省为 `enabled: false`, `allow: []`。
pub fn read_open_claw_tools_agent_to_agent() -> Value {
    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let raw = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if is_enoent(&e) => {
            return json!({"ok": true, "enabled": false, "allow": Value::Array(vec![])});
        }
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            return json!({"ok": false, "error": "openclaw.json 不是合法 JSON，请用编辑器修正后再试"});
        }
    };
    let ata = root
        .get("tools")
        .and_then(|t| t.get("agentToAgent"));
    let Some(obj) = ata.and_then(|v| v.as_object()) else {
        return json!({"ok": true, "enabled": false, "allow": Value::Array(vec![])});
    };
    let enabled = obj
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let allow_json = match obj.get("allow").and_then(|v| v.as_array()) {
        Some(a) => {
            let mut ids: Vec<String> = Vec::new();
            for v in a {
                if let Some(s) = v.as_str() {
                    let t = s.trim();
                    if !t.is_empty() {
                        ids.push(t.to_string());
                    }
                }
            }
            ids.sort();
            ids.dedup();
            Value::Array(ids.into_iter().map(|s| json!(s)).collect())
        }
        None => Value::Array(vec![]),
    };
    json!({
        "ok": true,
        "enabled": enabled,
        "allow": allow_json,
    })
}

/// `payload`: `{ enabled: boolean, allow: string[] }`。合并进 `tools.agentToAgent`，保留同对象内其它键（如 `maxPingPongTurns`）。
pub fn write_open_claw_tools_agent_to_agent_merge(payload: Value) -> Value {
    let enabled = payload
        .get("enabled")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let allow_arr = match payload.get("allow").and_then(|v| v.as_array()) {
        Some(a) => a.as_slice(),
        None => {
            return json!({"ok": false, "error": "缺少 allow 数组"});
        }
    };
    let allow_norm = match normalize_allow_list(allow_arr) {
        Ok(v) => v,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let openclaw_existed = fs::metadata(&config_path).map(|m| m.is_file()).unwrap_or(false);

    let mut root_val: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => {
                return json!({"ok": false, "error": "当前 openclaw.json 无法解析为 JSON，已中止写入"});
            }
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    if !root_val.is_object() {
        root_val = json!({});
    }

    let mut backup_path_str = String::new();
    if openclaw_existed {
        match backup_openclaw_json_if_exists(&config_path) {
            Ok(s) => backup_path_str = s,
            Err(e) => {
                return json!({"ok": false, "error": format!("备份 openclaw.json 失败：{e}")});
            }
        }
    }

    let root_map = root_val.as_object_mut().unwrap();

    let mut tools_obj: Map<String, Value> = root_map
        .get("tools")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let old_ata = tools_obj
        .get("agentToAgent")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let preserved_ping_pong = old_ata.get("maxPingPongTurns").cloned();

    let mut ata_obj = Map::new();
    ata_obj.insert("enabled".into(), json!(enabled));
    ata_obj.insert(
        "allow".into(),
        Value::Array(allow_norm.iter().map(|s| json!(s)).collect()),
    );
    if let Some(pp) = preserved_ping_pong {
        ata_obj.insert("maxPingPongTurns".into(), pp);
    }

    tools_obj.insert("agentToAgent".into(), Value::Object(ata_obj));
    root_map.insert("tools".into(), Value::Object(tools_obj));

    let out = format!(
        "{}\n",
        serde_json::to_string_pretty(&Value::Object(root_map.clone())).unwrap()
    );

    if let Some(parent) = config_path.parent() {
        if let Err(e) = fs::create_dir_all(parent) {
            return json!({
                "ok": false,
                "error": e.to_string(),
                "backupPath": empty_to_null(&backup_path_str),
            });
        }
    }
    if let Err(e) = fs::write(&config_path, out) {
        return json!({
            "ok": false,
            "error": format!("写入 openclaw.json 失败：{e}"),
            "backupPath": empty_to_null(&backup_path_str),
        });
    }

    let mut ok = json!({ "ok": true });
    if !backup_path_str.is_empty() {
        ok["backupPath"] = json!(&backup_path_str);
    }
    ok
}
