use crate::openclaw_common::{is_enoent, openclaw_config_path, openclaw_dir};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

const BACKUP_PREFIX: &str = "openclaw.json.didclaw-skill-backup-";
const BACKUP_SUFFIX: &str = ".json";

fn backup_current_file_if_exists(config_path: &Path) -> Result<String, String> {
    match fs::metadata(config_path) {
        Err(e) if is_enoent(&e) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
        Ok(m) if !m.is_file() => Ok(String::new()),
        Ok(_) => {
            let dir = config_path
                .parent()
                .ok_or_else(|| "无效配置路径".to_string())?;
            let name = format!(
                "{BACKUP_PREFIX}{}{BACKUP_SUFFIX}",
                crate::openclaw_common::backup_timestamp()
            );
            let backup = dir.join(name);
            fs::copy(config_path, &backup).map_err(|e| e.to_string())?;
            Ok(backup.to_string_lossy().to_string())
        }
    }
}

pub fn write_open_claw_skill_enabled(skill_key: &str, enabled: bool) -> Value {
    let skill_key = skill_key.trim();
    if skill_key.is_empty() {
        return json!({"ok": false, "error": "skill_key 不能为空"});
    }

    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let mut root: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => {
                return json!({
                    "ok": false,
                    "error": "当前 openclaw.json 无法解析为 JSON，已中止写入"
                });
            }
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    let backup_path = match backup_current_file_if_exists(&config_path) {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("备份失败，已中止写入：{e}")
            });
        }
    };

    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    if !root_map.get("skills").map(|v| v.is_object()).unwrap_or(false) {
        root_map.insert("skills".into(), json!({}));
    }
    let skills = root_map.get_mut("skills").unwrap().as_object_mut().unwrap();

    if !skills.get("entries").map(|v| v.is_object()).unwrap_or(false) {
        skills.insert("entries".into(), json!({}));
    }
    let entries = skills.get_mut("entries").unwrap().as_object_mut().unwrap();

    if !entries
        .get(skill_key)
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        entries.insert(skill_key.to_string(), json!({}));
    }
    let skill_entry = entries.get_mut(skill_key).unwrap().as_object_mut().unwrap();
    skill_entry.insert("enabled".into(), json!(enabled));

    let out = match serde_json::to_string_pretty(&root) {
        Ok(s) => format!("{s}\n"),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": e.to_string()});
    }
    if let Err(e) = fs::write(&config_path, out) {
        return json!({"ok": false, "error": e.to_string()});
    }

    if backup_path.is_empty() {
        json!({"ok": true})
    } else {
        json!({"ok": true, "backupPath": backup_path})
    }
}
