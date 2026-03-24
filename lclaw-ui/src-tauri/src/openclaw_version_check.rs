//! 对比本机 `openclaw --version` 与 npm `openclaw` 最新版，供桌面端提示升级。

use crate::gateway_local;
use crate::openclaw_gateway::{resolve_open_claw_executable, run_open_claw_cli_captured};
use regex::Regex;
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::sync::OnceLock;
use std::time::Duration;
use tauri::AppHandle;

const NPM_OPENCLAW_LATEST: &str = "https://registry.npmjs.org/openclaw/latest";

fn release_tuple_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| Regex::new(r"^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$").expect("regex"))
}

/// 从 `openclaw --version` 一行输出里取出版本号（如 `2026.3.23-1`）。
fn parse_version_token_from_cli_output(raw: &str) -> Option<String> {
    let line = raw.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    let tokens: Vec<&str> = line.split_whitespace().collect();
    fn strip_v_prefix(s: &str) -> &str {
        s.trim()
            .strip_prefix('v')
            .or_else(|| s.trim().strip_prefix('V'))
            .unwrap_or(s.trim())
    }
    for t in tokens.iter().rev() {
        let u = strip_v_prefix(t);
        if u.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return Some(u.to_string());
        }
    }
    let u = strip_v_prefix(line);
    if u.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return Some(u.to_string());
    }
    None
}

fn parse_release_tuple(v: &str) -> Option<(u32, u32, u32, u32)> {
    let v = v.trim();
    let cap = release_tuple_regex().captures(v)?;
    let a: u32 = cap.get(1)?.as_str().parse().ok()?;
    let b: u32 = cap.get(2)?.as_str().parse().ok()?;
    let c: u32 = cap.get(3)?.as_str().parse().ok()?;
    let d: u32 = cap
        .get(4)
        .map(|m| m.as_str().parse().unwrap_or(0))
        .unwrap_or(0);
    Some((a, b, c, d))
}

fn cmp_openclaw_versions(a: &str, b: &str) -> Ordering {
    match (parse_release_tuple(a), parse_release_tuple(b)) {
        (Some(x), Some(y)) => x.cmp(&y),
        _ => a.cmp(b),
    }
}

fn fetch_npm_latest_openclaw_version() -> Result<String, String> {
    let resp = ureq::get(NPM_OPENCLAW_LATEST)
        .timeout(Duration::from_secs(12))
        .call()
        .map_err(|e| format!("请求 npm registry 失败：{e}"))?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("解析 npm JSON 失败：{e}"))?;
    body.get("version")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| "npm 响应缺少 version 字段".to_string())
}

fn detect_platform_label() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    }
}

/// 同步实现；由 `check_openclaw_update` 在 `spawn_blocking` 中调用。
pub fn check_openclaw_update_impl(app: &AppHandle) -> Value {
    let platform = detect_platform_label();
    let merged = gateway_local::read_merged_map(app).unwrap_or_default();
    let custom = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());

    let Some(exe) = resolve_open_claw_executable(custom) else {
        return json!({
            "ok": true,
            "exeFound": false,
            "exePath": Value::Null,
            "currentVersion": "",
            "latestVersion": Value::Null,
            "registryError": Value::Null,
            "updateAvailable": false,
            "platform": platform,
        });
    };

    let out = match run_open_claw_cli_captured(&exe, &["--version"], &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw --version 失败：{e}"),
                "platform": platform,
            });
        }
    };

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": format!("openclaw --version 退出非零：{detail}"),
            "platform": platform,
        });
    }

    let combined = String::from_utf8_lossy(&out.stdout);
    let current_version = parse_version_token_from_cli_output(&combined).unwrap_or_default();

    let (latest_version, registry_error) = match fetch_npm_latest_openclaw_version() {
        Ok(v) => (Some(v), None),
        Err(e) => (None, Some(e)),
    };

    let update_available = match (current_version.as_str(), latest_version.as_deref()) {
        ("", _) => false,
        (_, None) => false,
        (c, Some(l)) => cmp_openclaw_versions(c, l) == Ordering::Less,
    };

    json!({
        "ok": true,
        "exeFound": true,
        "exePath": exe,
        "currentVersion": current_version,
        "latestVersion": latest_version,
        "registryError": registry_error,
        "updateAvailable": update_available,
        "platform": platform,
    })
}
