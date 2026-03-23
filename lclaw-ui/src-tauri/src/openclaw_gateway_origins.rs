//! 合并 `openclaw.json` 中 `gateway.controlUi.allowedOrigins`，使内置 `tauri.localhost` 等无需用户手工改网关。
//! 启动时执行一次；若当时尚无配置文件（例如尚未 onboard），须在 `openclaw.json` 出现之后再次调用（见 `get_open_claw_setup_status`）。

use crate::launch_log;
use crate::openclaw_common::{is_enoent, openclaw_config_path};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;

/// 是否实际写入了 `openclaw.json`（若为 true，正在运行的网关需 restart 才能生效）。
#[derive(Debug, Clone, Serialize)]
pub struct AllowedOriginsMergeOutcome {
    pub merged: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub added: Vec<String>,
}

const BACKUP_PREFIX: &str = "openclaw.json.lclaw-backup-";
const BACKUP_SUFFIX: &str = ".json";

/// 与内置前端、可选 loopback 静态页、本地 Vite 开发一致；已存在则跳过（按规范化字符串比较）。
const ORIGINS_TO_ENSURE: &[&str] = &[
    "https://tauri.localhost",
    "http://tauri.localhost",
    "http://127.0.0.1:34127",
    "http://localhost:5173",
];

fn norm_origin(s: &str) -> String {
    s.trim().to_lowercase()
}

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
            let backup_path = dir.join(name);
            fs::copy(config_path, &backup_path).map_err(|e| e.to_string())?;
            Ok(backup_path.to_string_lossy().to_string())
        }
    }
}

fn ensure_object_in_map<'a>(
    map: &'a mut Map<String, Value>,
    key: &str,
) -> &'a mut Map<String, Value> {
    let entry = map.entry(key.to_string()).or_insert_with(|| json!({}));
    if !entry.is_object() {
        *entry = json!({});
    }
    entry.as_object_mut().expect("object")
}

/// 若 `openclaw.json` 不存在则跳过；若 JSON 非法则返回 Err。有变更则先备份再写回。
pub fn ensure_lclaw_desktop_allowed_origins() -> Result<AllowedOriginsMergeOutcome, String> {
    let config_path = openclaw_config_path()?;
    let raw = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if is_enoent(&e) => {
            launch_log::line("openclaw: 未找到 openclaw.json，跳过 controlUi.allowedOrigins 合并");
            return Ok(AllowedOriginsMergeOutcome {
                merged: false,
                added: vec![],
            });
        }
        Err(e) => return Err(e.to_string()),
    };

    let mut root: Value = serde_json::from_str(&raw)
        .map_err(|_| "openclaw.json 不是合法 JSON，跳过 allowedOrigins 合并".to_string())?;

    let Some(root_obj) = root.as_object_mut() else {
        return Err("openclaw.json 根节点不是对象".to_string());
    };

    let gateway = ensure_object_in_map(root_obj, "gateway");
    let control_ui = ensure_object_in_map(gateway, "controlUi");

    let origins_val = control_ui
        .entry("allowedOrigins".to_string())
        .or_insert_with(|| json!([]));

    if !origins_val.is_array() {
        *origins_val = json!([]);
    }
    let origins = origins_val.as_array_mut().expect("array");

    let mut seen: HashSet<String> = origins
        .iter()
        .filter_map(Value::as_str)
        .map(norm_origin)
        .collect();

    let mut added: Vec<String> = Vec::new();
    for o in ORIGINS_TO_ENSURE {
        let n = norm_origin(o);
        if seen.contains(&n) {
            continue;
        }
        seen.insert(n);
        origins.push(json!(o));
        added.push((*o).to_string());
    }

    if added.is_empty() {
        launch_log::line("openclaw: controlUi.allowedOrigins 已包含桌面所需 Origin，无需写入");
        return Ok(AllowedOriginsMergeOutcome {
            merged: false,
            added: vec![],
        });
    }

    let backup_path_str = backup_current_file_if_exists(&config_path)?;
    if !backup_path_str.is_empty() {
        launch_log::line(&format!(
            "openclaw: 已备份至 {backup_path_str}，写入 allowedOrigins 增补"
        ));
    }

    let pretty =
        serde_json::to_string_pretty(&root).map_err(|e| format!("序列化配置失败: {e}"))?;
    fs::write(&config_path, pretty).map_err(|e| e.to_string())?;

    launch_log::line(&format!(
        "openclaw: 已合并 controlUi.allowedOrigins: {}",
        added.join(", ")
    ));
    Ok(AllowedOriginsMergeOutcome { merged: true, added })
}
