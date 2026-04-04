//! 读取 / 合并写入 `openclaw.json` 的 `agents.list`（多 Agent 公司制向导，对齐官方 schema）。

use crate::openclaw_common::{is_enoent, openclaw_config_path, openclaw_dir};
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

pub fn read_open_claw_agents_list() -> Value {
    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let raw = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if is_enoent(&e) => {
            return json!({"ok": true, "list": []});
        }
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            return json!({"ok": false, "error": "openclaw.json 不是合法 JSON，请用编辑器修正后再试"});
        }
    };
    let list = root
        .get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|l| l.as_array())
        .cloned()
        .unwrap_or_default();
    json!({ "ok": true, "list": Value::Array(list) })
}

/// `payload.agents` 为对象数组，每项须含 `id`；按 `id` 覆盖已有项或追加。
pub fn write_open_claw_agents_list_merge(payload: Value) -> Value {
    let incoming = match payload.get("agents").and_then(|v| v.as_array()) {
        Some(a) if !a.is_empty() => a.clone(),
        Some(_) => {
            return json!({"ok": false, "error": "agents 数组不能为空"});
        }
        None => {
            return json!({"ok": false, "error": "缺少 agents 数组"});
        }
    };

    for item in &incoming {
        let Some(o) = item.as_object() else {
            return json!({"ok": false, "error": "agents 中每一项须为 JSON 对象"});
        };
        let id = o
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if id.is_empty() {
            return json!({"ok": false, "error": "每个 agent 须包含非空 id"});
        }
        if !agent_id_regex().is_match(id) {
            return json!({
                "ok": false,
                "error": format!(
                    "agent id「{id}」不合法：须以字母开头，仅含字母、数字、._-"
                ),
            });
        }
    }

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

    let mut agents_obj: Map<String, Value> = root_map
        .get("agents")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    let mut list: Vec<Value> = agents_obj
        .get("list")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for patch in incoming {
        let id = patch
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if let Some(idx) = list.iter().position(|x| {
            x.get("id")
                .and_then(|v| v.as_str())
                .map(str::trim)
                == Some(id)
        }) {
            list[idx] = patch;
        } else {
            list.push(patch);
        }
    }

    agents_obj.insert("list".into(), Value::Array(list));
    root_map.insert("agents".into(), Value::Object(agents_obj));

    let out = format!(
        "{}\n",
        serde_json::to_string_pretty(&Value::Object(root_map.clone())).unwrap()
    );

    let odir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => {
            return json!({
                "ok": false,
                "error": e,
                "backupPath": empty_to_null(&backup_path_str),
            });
        }
    };
    if let Err(e) = fs::create_dir_all(&odir) {
        return json!({
            "ok": false,
            "error": e.to_string(),
            "backupPath": empty_to_null(&backup_path_str),
        });
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
