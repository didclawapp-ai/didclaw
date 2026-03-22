//! `~/.openclaw` 路径、备份时间戳、`extractDefaultAgentId`：供 model_config / providers 共用。

use chrono::{Datelike, Local, Timelike};
use serde_json::Value;
use std::io;
use std::path::PathBuf;

pub fn openclaw_dir() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".openclaw"))
        .ok_or_else(|| "无法解析用户主目录".to_string())
}

pub fn openclaw_config_path() -> Result<PathBuf, String> {
    Ok(openclaw_dir()?.join("openclaw.json"))
}

pub fn agent_models_json_path(agent_id: &str) -> Result<PathBuf, String> {
    Ok(openclaw_dir()?
        .join("agents")
        .join(agent_id)
        .join("agent")
        .join("models.json"))
}

pub fn agent_auth_profiles_json_path(agent_id: &str) -> Result<PathBuf, String> {
    Ok(openclaw_dir()?
        .join("agents")
        .join(agent_id)
        .join("agent")
        .join("auth-profiles.json"))
}

pub fn backup_timestamp() -> String {
    let d = Local::now();
    let p = |n: u32| format!("{:02}", n);
    format!(
        "{}{}{}-{}{}{}",
        d.year(),
        p(d.month()),
        p(d.day()),
        p(d.hour()),
        p(d.minute()),
        p(d.second()),
    )
}

pub fn is_enoent(e: &io::Error) -> bool {
    e.kind() == io::ErrorKind::NotFound
}

/// 与 `electron/openclaw-config.ts` 中 `extractDefaultAgentId` 一致。
pub fn extract_default_agent_id(root: &Value) -> String {
    let Some(root_obj) = root.as_object() else {
        return "main".into();
    };
    let Some(agents_val) = root_obj.get("agents") else {
        return "main".into();
    };
    let Some(agents) = agents_val.as_object() else {
        return "main".into();
    };
    let Some(list_val) = agents.get("list") else {
        return "main".into();
    };
    let Some(list) = list_val.as_array() else {
        return "main".into();
    };
    if list.is_empty() {
        return "main".into();
    }
    for item in list {
        let Some(o) = item.as_object() else {
            continue;
        };
        if o.get("default").and_then(|v| v.as_bool()) != Some(true) {
            continue;
        }
        if let Some(id) = o.get("id").and_then(|v| v.as_str()) {
            let t = id.trim();
            if !t.is_empty() {
                return t.to_string();
            }
        }
    }
    if let Some(first) = list.first() {
        if let Some(o) = first.as_object() {
            if let Some(id) = o.get("id").and_then(|v| v.as_str()) {
                let t = id.trim();
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    "main".into()
}
