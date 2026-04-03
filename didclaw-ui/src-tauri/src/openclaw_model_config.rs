//! `openclaw.json` 中 `agents.defaults.model` / `models`：与 `electron/openclaw-config.ts` 中 6a 范围对齐。

use crate::openclaw_common::{is_enoent, openclaw_config_path, openclaw_dir};
use serde_json::{json, Map, Value};
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::time::UNIX_EPOCH;

const BACKUP_PREFIX: &str = "openclaw.json.didclaw-backup-";
const BACKUP_SUFFIX: &str = ".json";

fn new_backup_basename() -> String {
    format!(
        "{BACKUP_PREFIX}{}{BACKUP_SUFFIX}",
        crate::openclaw_common::backup_timestamp()
    )
}

fn extract_agents_defaults(root: &Value) -> (Map<String, Value>, Map<String, Value>) {
    let empty = || (Map::new(), Map::new());
    let Some(root_obj) = root.as_object() else {
        return empty();
    };
    let Some(agents) = root_obj.get("agents").and_then(|v| v.as_object()) else {
        return empty();
    };
    let Some(defaults) = agents.get("defaults").and_then(|v| v.as_object()) else {
        return empty();
    };
    let model = defaults
        .get("model")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let models = defaults
        .get("models")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    (model, models)
}

/// 无现网文件时返回空字符串；否则为备份文件完整路径。
fn backup_current_file_if_exists(config_path: &Path) -> Result<String, String> {
    match fs::metadata(config_path) {
        Err(e) if is_enoent(&e) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
        Ok(m) if !m.is_file() => Ok(String::new()),
        Ok(_) => {
            let dir = config_path
                .parent()
                .ok_or_else(|| "无效配置路径".to_string())?;
            let backup_path = dir.join(new_backup_basename());
            fs::copy(config_path, &backup_path).map_err(|e| e.to_string())?;
            Ok(backup_path.to_string_lossy().to_string())
        }
    }
}

pub fn read_open_claw_model_config() -> Value {
    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let raw = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if is_enoent(&e) => {
            return json!({"ok": true, "model": {}, "models": {}});
        }
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            return json!({"ok": false, "error": "openclaw.json 不是合法 JSON，请用 CLI 或编辑器修正后再试"});
        }
    };
    let (model, models) = extract_agents_defaults(&root);
    json!({
        "ok": true,
        "model": Value::Object(model),
        "models": Value::Object(models),
    })
}

pub fn write_open_claw_model_config(payload: Value) -> Value {
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
                return json!({"ok": false, "error": "当前 openclaw.json 无法解析为 JSON，已中止写入"});
            }
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    let backup_path_str = match backup_current_file_if_exists(&config_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": format!("备份失败，已中止写入：{e}")}),
    };

    let backup_path_json = if backup_path_str.is_empty() {
        Value::Null
    } else {
        json!(&backup_path_str)
    };

    let Some(payload_obj) = payload.as_object() else {
        return json!({
            "ok": false,
            "error": "参数无效",
            "backupPath": backup_path_json,
        });
    };

    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    if !root_map
        .get("agents")
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        root_map.insert("agents".into(), json!({}));
    }
    let agents = root_map.get_mut("agents").unwrap().as_object_mut().unwrap();

    if !agents
        .get("defaults")
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        agents.insert("defaults".into(), json!({}));
    }
    let defaults = agents.get_mut("defaults").unwrap().as_object_mut().unwrap();

    if let Some(mv) = payload_obj.get("model") {
        if let Some(mo) = mv.as_object() {
            let dm = defaults
                .entry("model".to_string())
                .or_insert_with(|| json!({}));
            if !dm.is_object() {
                *dm = json!({});
            }
            let dm = dm.as_object_mut().unwrap();
            for (k, v) in mo {
                dm.insert(k.clone(), v.clone());
            }
        }
    }

    if let Some(mv) = payload_obj.get("models") {
        let next = if mv.is_null() {
            Map::new()
        } else if let Some(mo) = mv.as_object() {
            mo.clone()
        } else {
            return json!({
                "ok": false,
                "error": "models 参数无效",
                "backupPath": backup_path_json,
            });
        };
        defaults.insert("models".into(), Value::Object(next));
    }

    // Write agents.defaults.imageGenerationModel as a top-level sibling of `model`
    if let Some(igv) = payload_obj.get("imageGenerationModel") {
        if igv.is_null() {
            defaults.remove("imageGenerationModel");
        } else {
            defaults.insert("imageGenerationModel".into(), igv.clone());
        }
    }

    let out = match serde_json::to_string_pretty(&root) {
        Ok(s) => format!("{s}\n"),
        Err(e) => {
            return json!({
                "ok": false,
                "error": e.to_string(),
                "backupPath": backup_path_json,
            });
        }
    };

    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({
            "ok": false,
            "error": e.to_string(),
            "backupPath": backup_path_json,
        });
    }
    if let Err(e) = fs::write(&config_path, out) {
        return json!({
            "ok": false,
            "error": e.to_string(),
            "backupPath": backup_path_json,
        });
    }

    if backup_path_str.is_empty() {
        json!({"ok": true})
    } else {
        json!({"ok": true, "backupPath": backup_path_str})
    }
}

/// Move legacy flat string keys from `env` into `env.vars` (OpenClaw injects process env from `env.vars`).
fn migrate_legacy_env_strings_into_vars(env: &mut Map<String, Value>) {
    let mut moves: Vec<(String, Value)> = Vec::new();
    for (k, v) in env.iter() {
        if k == "vars" {
            continue;
        }
        if v.is_string() {
            moves.push((k.clone(), v.clone()));
        }
    }
    for (k, _) in &moves {
        env.remove(k);
    }
    if moves.is_empty() {
        return;
    }
    let vars = env
        .entry("vars".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap();
    for (k, v) in moves {
        vars.insert(k, v);
    }
}

/// Patch `env.vars` in `openclaw.json` (process environment for the gateway).
/// `patch` keys with `null` values are removed; string values are set under `env.vars`.
pub fn write_open_claw_env(payload: Value) -> Value {
    let patch_obj = match payload.get("patch").and_then(|v| v.as_object()) {
        Some(o) => o,
        None => return json!({"ok": false, "error": "patch 无效"}),
    };

    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let dir = match crate::openclaw_common::openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let mut root: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => return json!({"ok": false, "error": "当前 openclaw.json 无法解析为 JSON"}),
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    let backup_path_str = match backup_current_file_if_exists(&config_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": format!("备份失败：{e}")}),
    };

    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    if !root_map.get("env").map(|v| v.is_object()).unwrap_or(false) {
        root_map.insert("env".into(), json!({}));
    }
    let env = root_map.get_mut("env").unwrap().as_object_mut().unwrap();
    migrate_legacy_env_strings_into_vars(env);

    if !env.get("vars").map(|v| v.is_object()).unwrap_or(false) {
        env.insert("vars".into(), json!({}));
    }
    let vars = env.get_mut("vars").unwrap().as_object_mut().unwrap();

    for (k, v) in patch_obj {
        if v.is_null() {
            vars.remove(k);
        } else if let Some(s) = v.as_str() {
            if s.is_empty() {
                vars.remove(k);
            } else {
                vars.insert(k.clone(), json!(s));
            }
        }
    }

    if vars.is_empty() {
        env.remove("vars");
    }
    if env.is_empty() {
        root_map.remove("env");
    }

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

    if backup_path_str.is_empty() {
        json!({"ok": true})
    } else {
        json!({"ok": true, "backupPath": backup_path_str})
    }
}

fn file_mtime_ms(path: &Path) -> u128 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn find_latest_backup_file(dir: &Path) -> Result<Option<PathBuf>, io::Error> {
    let rd = match fs::read_dir(dir) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e),
        Ok(x) => x,
    };
    let mut best: Option<(PathBuf, u128)> = None;
    for ent in rd.flatten() {
        let name = ent.file_name().to_string_lossy().to_string();
        if !name.starts_with(BACKUP_PREFIX) || !name.ends_with(BACKUP_SUFFIX) {
            continue;
        }
        let path = ent.path();
        let ms = file_mtime_ms(&path);
        best = match best {
            None => Some((path, ms)),
            Some((_, t)) if ms > t => Some((path, ms)),
            Some(x) => Some(x),
        };
    }
    Ok(best.map(|(p, _)| p))
}

pub fn restore_open_claw_config_to_latest_backup() -> Value {
    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let latest = match find_latest_backup_file(&dir) {
        Ok(o) => o,
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let Some(latest) = latest else {
        return json!({"ok": false, "error": "未找到本应用生成的备份文件（openclaw.json.didclaw-backup-*.json）"});
    };

    let pre_backup = match backup_current_file_if_exists(&config_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": format!("恢复前备份失败：{e}")}),
    };

    let content = match fs::read_to_string(&latest) {
        Ok(s) => s,
        Err(e) => {
            let mut v = json!({"ok": false, "error": e.to_string()});
            if !pre_backup.is_empty() {
                v["backupPath"] = json!(pre_backup);
            }
            return v;
        }
    };
    if serde_json::from_str::<Value>(&content).is_err() {
        let mut v = json!({"ok": false, "error": "备份文件不是合法 JSON，已中止恢复"});
        if !pre_backup.is_empty() {
            v["backupPath"] = json!(pre_backup);
        }
        return v;
    }

    let content_out = if content.ends_with('\n') {
        content
    } else {
        format!("{content}\n")
    };

    if let Err(e) = fs::create_dir_all(&dir) {
        let mut v = json!({"ok": false, "error": e.to_string()});
        if !pre_backup.is_empty() {
            v["backupPath"] = json!(pre_backup);
        }
        return v;
    }
    if let Err(e) = fs::write(&config_path, content_out) {
        let mut v = json!({"ok": false, "error": e.to_string()});
        if !pre_backup.is_empty() {
            v["backupPath"] = json!(pre_backup);
        }
        return v;
    }

    json!({
        "ok": true,
        "backupUsed": latest.to_string_lossy(),
    })
}

const VALID_TOOL_PROFILES: &[&str] = &["full", "coding", "messaging", "minimal"];

/// Read `tools.profile` from `openclaw.json`. Returns `null` profile when not set.
pub fn read_open_claw_tools_profile() -> Value {
    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let root: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => return json!({"ok": false, "error": "openclaw.json 无法解析为 JSON"}),
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let profile = root
        .get("tools")
        .and_then(|t| t.get("profile"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    json!({"ok": true, "profile": if profile.is_empty() { Value::Null } else { json!(profile) }})
}

/// Write `tools.profile` into `openclaw.json`, preserving all other fields.
pub fn write_open_claw_tools_profile(profile: &str) -> Value {
    let profile = profile.trim();
    if !VALID_TOOL_PROFILES.contains(&profile) {
        return json!({"ok": false, "error": format!("无效的 profile 值 \"{profile}\"，允许: full / coding / messaging / minimal")});
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
            Err(_) => return json!({"ok": false, "error": "当前 openclaw.json 无法解析为 JSON，已中止写入"}),
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    // Ensure tools block exists; update only tools.profile, leave other keys alone
    if !root_map.get("tools").map(|v| v.is_object()).unwrap_or(false) {
        root_map.insert("tools".into(), json!({}));
    }
    root_map
        .get_mut("tools")
        .unwrap()
        .as_object_mut()
        .unwrap()
        .insert("profile".into(), json!(profile));

    let backup_path_str = match backup_current_file_if_exists(&config_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": format!("备份失败：{e}")}),
    };

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

    let mut ok_ret = if backup_path_str.is_empty() {
        json!({"ok": true})
    } else {
        json!({"ok": true, "backupPath": backup_path_str})
    };
    if let Some(m) = ok_ret.as_object_mut() {
        m.insert(
            "execApprovalsSync".into(),
            crate::openclaw_exec_approvals_defaults::sync_exec_approvals_defaults_for_tools_profile(
                profile,
            ),
        );
    }
    ok_ret
}
