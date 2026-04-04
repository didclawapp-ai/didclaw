//! 首次安装向导预检：`~/.openclaw`、`openclaw.json`、CLI 是否在 PATH。
//!
//! **注意**：DidClaw 安装时可能仅向 `~/.openclaw` 复制内置 skills，目录存在 **不等于** 已安装 OpenClaw。
//! 用 `openclaw_setup_indicated`（`openclaw.json` 已存在或已解析到 `openclaw` 可执行文件）判断「环境已就绪」。

use serde_json::{json, Value};
use std::fs;
use tauri::AppHandle;

use crate::gateway_local;
use crate::launch_log;
use crate::openclaw_common::{is_enoent, openclaw_config_path, openclaw_dir};
use crate::openclaw_gateway::resolve_open_claw_executable;

pub fn build_open_claw_setup_status(app: &AppHandle) -> Value {
    let openclaw_dir_exists = match openclaw_dir() {
        Ok(p) => p.is_dir(),
        Err(_) => false,
    };

    let (config_state, config_error): (String, Option<String>) = match openclaw_config_path() {
        Ok(path) => match fs::read_to_string(&path) {
            Ok(raw) => {
                let t = raw.trim();
                if t.is_empty() {
                    ("invalid".into(), Some("openclaw.json 为空".into()))
                } else if serde_json::from_str::<serde_json::Value>(t).is_ok() {
                    ("ok".into(), None)
                } else {
                    (
                        "invalid".into(),
                        Some("openclaw.json 不是合法 JSON".into()),
                    )
                }
            }
            Err(e) if is_enoent(&e) => ("missing".into(), None),
            Err(e) => ("invalid".into(), Some(e.to_string())),
        },
        Err(e) => ("missing".into(), Some(e)),
    };

    let merged = gateway_local::read_merged_map(app).unwrap_or_default();
    let custom = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let openclaw_cli = match resolve_open_claw_executable(custom) {
        Some(path) => json!({ "ok": true, "path": path }),
        None => json!({
            "ok": false,
            "error": "未找到 openclaw。请运行官方 install.ps1，或在本机设置「连助手」中填写可执行文件路径。"
        }),
    };
    let openclaw_cli_ok = openclaw_cli
        .get("ok")
        .and_then(|v| v.as_bool())
        == Some(true);
    let openclaw_setup_indicated =
        config_state != "missing" || openclaw_cli_ok;

    let origins_merged =
        match crate::openclaw_gateway_origins::ensure_didclaw_desktop_allowed_origins() {
            Ok(o) => o.merged,
            Err(e) => {
                launch_log::line(&format!(
                    "openclaw: 预检合并 controlUi.allowedOrigins 失败（可忽略）: {e}"
                ));
                false
            }
        };

    json!({
        "openclawDirExists": openclaw_dir_exists,
        "openclawSetupIndicated": openclaw_setup_indicated,
        "openclawConfigState": config_state,
        "openclawConfigError": config_error,
        "openclawCli": openclaw_cli,
        "modelConfigDeferred": false,
        "controlUiAllowedOriginsMerged": origins_merged,
    })
}
