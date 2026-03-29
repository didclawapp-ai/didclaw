//! DidClaw self-update: check for app updates from a JSON manifest endpoint
//! and download + launch the installer.

use serde_json::{json, Value};
use std::io::Read;
use std::time::Duration;
use tauri::AppHandle;

/// Parses a semver string into (major, minor, patch), stripping any leading 'v'.
fn parse_semver(s: &str) -> (u32, u32, u32) {
    let s = s.trim().trim_start_matches('v');
    let parts: Vec<u32> = s
        .splitn(4, '.')
        .map(|p| p.split(['-', '+']).next().unwrap_or("0").parse().unwrap_or(0))
        .collect();
    (
        parts.first().copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

fn semver_gt(a: &str, b: &str) -> bool {
    parse_semver(a) > parse_semver(b)
}

/// Detects current platform key used in the manifest "platforms" object.
fn platform_key() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Checks for a DidClaw app update from the given manifest endpoint URL.
/// Expected manifest JSON:
/// ```json
/// {
///   "version": "0.6.0",
///   "notes": "...",
///   "date": "2026-03-30",
///   "platforms": { "windows": "https://...", "macos": "https://...", "linux": "https://..." }
/// }
/// ```
pub fn check_didclaw_update_impl(app: &AppHandle, endpoint: &str) -> Value {
    let current = app.package_info().version.to_string();

    if endpoint.trim().is_empty() {
        return json!({
            "ok": true,
            "currentVersion": current,
            "latestVersion": Value::Null,
            "updateAvailable": false,
            "noEndpoint": true,
        });
    }

    let resp = match ureq::get(endpoint)
        .set("User-Agent", "DidClaw-Updater/1.0")
        .timeout(Duration::from_secs(12))
        .call()
    {
        Ok(r) => r,
        Err(e) => {
            return json!({
                "ok": false,
                "currentVersion": current,
                "error": format!("无法连接更新服务：{e}"),
            });
        }
    };

    let body: Value = match resp.into_json() {
        Ok(v) => v,
        Err(e) => {
            return json!({
                "ok": false,
                "currentVersion": current,
                "error": format!("解析更新清单失败：{e}"),
            });
        }
    };

    let latest = match body.get("version").and_then(|v| v.as_str()) {
        Some(v) => v.trim().trim_start_matches('v').to_string(),
        None => {
            return json!({
                "ok": false,
                "currentVersion": current,
                "error": "更新清单缺少 version 字段",
            });
        }
    };

    let update_available = semver_gt(&latest, &current);
    let platform = platform_key();
    let download_url = body
        .get("platforms")
        .and_then(|p| p.get(platform))
        .and_then(|u| u.as_str())
        .map(str::to_string);
    let notes = body.get("notes").and_then(|n| n.as_str()).map(str::to_string);
    let date = body.get("date").and_then(|d| d.as_str()).map(str::to_string);

    json!({
        "ok": true,
        "currentVersion": current,
        "latestVersion": latest,
        "updateAvailable": update_available,
        "downloadUrl": download_url,
        "notes": notes,
        "date": date,
        "platform": platform,
    })
}

/// Downloads the installer from `download_url` to a temp file and launches it.
/// On success returns the temp path; the caller should tell the user to close the app.
pub fn install_didclaw_update_impl(download_url: &str) -> Result<String, String> {
    // Determine file extension from URL
    let url_path = download_url.split('?').next().unwrap_or(download_url);
    let ext = if url_path.ends_with(".msi") {
        ".msi"
    } else {
        ".exe"
    };

    // Download to a fixed-name temp file so we can always find it
    let tmp_dir = std::env::temp_dir();
    let file_name = format!("DidClaw-update{ext}");
    let tmp_path = tmp_dir.join(&file_name);

    let resp = ureq::get(download_url)
        .set("User-Agent", "DidClaw-Updater/1.0")
        .timeout(Duration::from_secs(300))
        .call()
        .map_err(|e| format!("下载失败：{e}"))?;

    let mut reader = resp.into_reader();
    let mut file =
        std::fs::File::create(&tmp_path).map_err(|e| format!("创建临时文件失败：{e}"))?;
    // Limit to 1 GB to guard against runaway responses
    std::io::copy(&mut (&mut reader).take(1024 * 1024 * 1024), &mut file)
        .map_err(|e| format!("写入安装包失败：{e}"))?;
    drop(file);

    // Launch the installer
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", tmp_path.to_str().unwrap_or("")])
            .spawn()
            .map_err(|e| format!("启动安装程序失败：{e}"))?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        open::that(&tmp_path).map_err(|e| format!("打开安装包失败：{e}"))?;
    }

    Ok(tmp_path.to_string_lossy().into_owned())
}
