//! 在 DidClaw 写入 `tools.profile` 时同步 `exec-approvals.json` 的 `defaults`，与通用设置里四档权限对齐。
//! 最终生效仍受 OpenClaw `tools.exec.*` 与「更严一方」规则约束，见 <https://docs.openclaw.ai/zh-CN/tools/exec-approvals>。

use crate::openclaw_common::{backup_timestamp, is_enoent, openclaw_dir};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const BACKUP_PREFIX: &str = "exec-approvals.json.didclaw-backup-";
const BACKUP_SUFFIX: &str = ".json";

fn new_backup_basename() -> String {
    format!("{BACKUP_PREFIX}{}{BACKUP_SUFFIX}", backup_timestamp())
}

fn backup_if_exists(path: &Path) -> Result<String, String> {
    match fs::metadata(path) {
        Err(e) if is_enoent(&e) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
        Ok(m) if !m.is_file() => Ok(String::new()),
        Ok(_) => {
            let dir = path.parent().ok_or_else(|| "无效配置路径".to_string())?;
            let bp = dir.join(new_backup_basename());
            fs::copy(path, &bp).map_err(|e| e.to_string())?;
            Ok(bp.to_string_lossy().to_string())
        }
    }
}

/// DidClaw `tools.profile` → OpenClaw `exec-approvals.json` 的 `defaults`。
pub fn defaults_for_tools_profile(profile: &str) -> Value {
    match profile {
        "full" => json!({
            "security": "full",
            "ask": "off",
            "askFallback": "full",
            "autoAllowSkills": true,
        }),
        "coding" => json!({
            "security": "allowlist",
            "ask": "on-miss",
            "askFallback": "deny",
            "autoAllowSkills": true,
        }),
        "messaging" | "minimal" => json!({
            "security": "deny",
            "ask": "off",
            "askFallback": "deny",
            "autoAllowSkills": false,
        }),
        _ => json!({}),
    }
}

/// 写入/合并 `defaults`，保留 `socket`、`agents` 等其余字段。无文件时创建带 `version` 的新文件。
pub fn sync_exec_approvals_defaults_for_tools_profile(profile: &str) -> Value {
    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let path = dir.join("exec-approvals.json");
    let defaults = defaults_for_tools_profile(profile);
    if !defaults.is_object() || defaults.as_object().is_some_and(|o| o.is_empty()) {
        return json!({"ok": false, "error": "未知的 tools.profile"});
    }

    let mut root: Value = match fs::read_to_string(&path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(v) if v.is_object() => v,
            Ok(_) => {
                return json!({"ok": false, "error": "exec-approvals.json 顶层不是 JSON 对象，已跳过写入以避免破坏"});
            }
            Err(e) => {
                return json!({"ok": false, "error": format!("exec-approvals.json 无法解析: {e}")});
            }
        },
        Err(e) if is_enoent(&e) => json!({ "version": 1 }),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    {
        let obj = root.as_object_mut().unwrap();
        obj.insert("defaults".to_string(), defaults);
        if !obj.contains_key("version") {
            obj.insert("version".to_string(), json!(1));
        }
    }

    let backup = match backup_if_exists(&path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": e.to_string()});
    }
    let out = match serde_json::to_string_pretty(&root) {
        Ok(s) => format!("{s}\n"),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    if let Err(e) = fs::write(&path, out) {
        return json!({"ok": false, "error": e.to_string()});
    }

    if backup.is_empty() {
        json!({"ok": true})
    } else {
        json!({"ok": true, "backupPath": backup})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_allows_exec_without_ask() {
        let d = defaults_for_tools_profile("full");
        assert_eq!(d["security"], "full");
        assert_eq!(d["ask"], "off");
    }

    #[test]
    fn minimal_denies_exec() {
        let d = defaults_for_tools_profile("minimal");
        assert_eq!(d["security"], "deny");
    }
}
