//! 读取 / 合并写入 `openclaw.json` 的 `agents.list`（多 Agent 公司制向导，对齐官方 schema）。

use crate::openclaw_common::{
    agent_auth_profiles_json_path, is_enoent, openclaw_config_path, openclaw_dir,
};
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

/// 将向导补丁合并进已有 `agents.list[]` 项，保留 OpenClaw 可能写入的其它键（如 `tools`），
/// 避免整对象替换导致字段丢失；补丁中**未出现**的 `name` / `workspace` / `model` 键表示删除该字段（沿用网关默认）。
fn merge_agent_list_entry(existing: Option<&Value>, patch: &Value) -> Value {
    let Some(patch_obj) = patch.as_object() else {
        return patch.clone();
    };
    let mut merged: Map<String, Value> = existing
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();

    if let Some(id) = patch_obj.get("id") {
        merged.insert("id".into(), id.clone());
    }
    for k in ["name", "workspace", "model"] {
        if let Some(v) = patch_obj.get(k) {
            merged.insert(k.to_string(), v.clone());
        } else {
            merged.remove(k);
        }
    }

    Value::Object(merged)
}

fn backup_agent_auth_profiles_if_exists(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| "无法解析 auth-profiles.json 父目录".to_string())?;
    let name = format!(
        "auth-profiles.json.didclaw-backup-{}.json",
        crate::openclaw_common::backup_timestamp()
    );
    let dest = parent.join(name);
    fs::copy(path, &dest).map_err(|e| e.to_string())?;
    Ok(())
}

/// `auth-profiles.json` 不存在、不可读、或 `profiles` 为空对象时视为缺凭据。
fn auth_profiles_store_empty(path: &Path) -> bool {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(_) => return true,
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return true,
    };
    match v.get("profiles").and_then(|p| p.as_object()) {
        None => true,
        Some(m) => m.is_empty(),
    }
}

/// 将 `agents/main/agent/auth-profiles.json` 复制到 `agents.list` 中非 main、且凭据为空的子代理目录。
/// 主代理 profiles 非空时才复制；子代理已有非空 profiles 时不覆盖。
pub fn sync_subagent_auth_profiles_from_main() -> Value {
    let main_path = match agent_auth_profiles_json_path("main") {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    if !main_path.exists() || auth_profiles_store_empty(&main_path) {
        return json!({
            "ok": true,
            "synced": Value::Array(vec![]),
            "errors": Value::Array(vec![]),
            "note": "main 的 auth-profiles 缺失或 profiles 为空，已跳过子代理同步",
        });
    }
    let main_raw = match fs::read_to_string(&main_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let cfg_raw = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let root: Value = match serde_json::from_str(&cfg_raw) {
        Ok(v) => v,
        Err(e) => return json!({"ok": false, "error": format!("openclaw.json 解析失败：{e}")}),
    };
    let list = root
        .get("agents")
        .and_then(|a| a.get("list"))
        .and_then(|l| l.as_array())
        .cloned()
        .unwrap_or_default();

    let mut synced: Vec<Value> = Vec::new();
    let mut errors: Vec<Value> = Vec::new();

    for item in list {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .unwrap_or("");
        if id.is_empty() || id == "main" {
            continue;
        }
        let sub_path = match agent_auth_profiles_json_path(id) {
            Ok(p) => p,
            Err(e) => {
                errors.push(json!({"agentId": id, "error": e}));
                continue;
            }
        };
        let need = !sub_path.exists() || auth_profiles_store_empty(&sub_path);
        if !need {
            continue;
        }
        if let Some(parent) = sub_path.parent() {
            if let Err(e) = fs::create_dir_all(parent) {
                errors.push(json!({"agentId": id, "error": format!("创建目录失败：{e}")}));
                continue;
            }
        }
        if sub_path.exists() {
            if let Err(e) = backup_agent_auth_profiles_if_exists(&sub_path) {
                errors.push(json!({"agentId": id, "error": format!("备份失败：{e}")}));
                continue;
            }
        }
        if let Err(e) = fs::write(&sub_path, &main_raw) {
            errors.push(json!({"agentId": id, "error": format!("写入失败：{e}")}));
            continue;
        }
        synced.push(json!(id));
    }

    json!({
        "ok": true,
        "synced": Value::Array(synced),
        "errors": Value::Array(errors),
    })
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
            let existing = list.get(idx);
            list[idx] = merge_agent_list_entry(existing, &patch);
        } else {
            list.push(merge_agent_list_entry(None, &patch));
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

    let sync = sync_subagent_auth_profiles_from_main();

    let mut ok = json!({ "ok": true });
    if !backup_path_str.is_empty() {
        ok["backupPath"] = json!(&backup_path_str);
    }
    if let Some(v) = sync.get("synced") {
        ok["authProfilesSynced"] = v.clone();
    }
    if let Some(v) = sync.get("note") {
        ok["authProfilesSyncNote"] = v.clone();
    }
    if let Some(v) = sync.get("errors") {
        ok["authProfilesSyncErrors"] = v.clone();
    }
    ok
}
