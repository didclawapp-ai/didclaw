//! 渠道配置写入与 QR 流式接入（P1-3）。

use crate::openclaw_common::{backup_timestamp, is_enoent, openclaw_config_path, openclaw_dir};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

// ── 备份辅助 ──────────────────────────────────────────────────────────────────

fn backup_if_exists(config_path: &Path) -> Result<String, String> {
    let prefix = "openclaw.json.didclaw-ch-backup-";
    match fs::metadata(config_path) {
        Err(e) if is_enoent(&e) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
        Ok(m) if !m.is_file() => Ok(String::new()),
        Ok(_) => {
            let dir = config_path
                .parent()
                .ok_or_else(|| "无效配置路径".to_string())?;
            let name = format!("{prefix}{}.json", backup_timestamp());
            let backup = dir.join(name);
            fs::copy(config_path, &backup).map_err(|e| e.to_string())?;
            Ok(backup.to_string_lossy().to_string())
        }
    }
}

// ── 深合并 ────────────────────────────────────────────────────────────────────

fn deep_merge(dst: &mut Map<String, Value>, src: &Map<String, Value>) {
    for (k, v) in src {
        if let (Some(dst_obj), Some(src_obj)) = (
            dst.get_mut(k).and_then(|x| x.as_object_mut()),
            v.as_object(),
        ) {
            deep_merge(dst_obj, src_obj);
        } else {
            dst.insert(k.clone(), v.clone());
        }
    }
}

// ── write_channel_config ─────────────────────────────────────────────────────

/// 将 `payload` 深合并到 `openclaw.json` 的 `channels.<channel_key>` 中，写入前备份。
pub fn write_channel_config(channel_key: &str, payload: Value) -> Value {
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
            Err(_) => return json!({"ok": false, "error": "openclaw.json 无法解析为 JSON，已中止写入"}),
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };

    let backup = match backup_if_exists(&config_path) {
        Ok(s) => s,
        Err(e) => return json!({"ok": false, "error": format!("备份失败，已中止：{e}")}),
    };

    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    if !root_map.get("channels").map(|v| v.is_object()).unwrap_or(false) {
        root_map.insert("channels".into(), json!({}));
    }
    let channels = root_map.get_mut("channels").unwrap().as_object_mut().unwrap();

    if !channels.get(channel_key).map(|v| v.is_object()).unwrap_or(false) {
        channels.insert(channel_key.to_string(), json!({}));
    }
    if let Some(payload_obj) = payload.as_object() {
        let chan = channels.get_mut(channel_key).unwrap().as_object_mut().unwrap();
        deep_merge(chan, payload_obj);
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

    let backup_json = if backup.is_empty() { Value::Null } else { json!(backup) };
    json!({"ok": true, "backupPath": backup_json})
}

// ── start_channel_qr_flow ────────────────────────────────────────────────────

/// 流式运行渠道 QR 登录命令，逐行向前端推送事件：
/// - `channel:line`  → `{stream: "stdout"|"stderr", line: string}`
/// - `channel:qr`    → `{url: string}`（检测到 https:// 行时）
/// - `channel:done`  → `{ok: bool, exitCode: number}`（进程退出）
pub async fn start_channel_qr_flow(
    app: tauri::AppHandle,
    channel: String,
    gateway_url: String,
) -> Value {
    use crate::openclaw_gateway::resolve_open_claw_executable;
    use std::process::Stdio;
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let exe = match resolve_open_claw_executable(None) {
        Some(e) => e,
        None => return json!({"ok": false, "error": "找不到 openclaw，请先完成安装向导"}),
    };

    // force=true 时加 --force，强制清除旧 session 重新生成 QR
    let force = channel.ends_with(":force");
    let channel_name = channel.trim_end_matches(":force");
    let args: Vec<&str> = match channel_name {
        "whatsapp" if force => vec!["channels", "login", "--channel", "whatsapp", "--force"],
        "whatsapp"          => vec!["channels", "login", "--channel", "whatsapp"],
        _ => return json!({"ok": false, "error": format!("不支持的 QR 渠道: {channel_name}")}),
    };

    let mut cmd = Command::new(&exe);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // 接管 stdin，以便向交互式提示发送回车键自动接受默认选项
        .stdin(Stdio::piped());

    if !gateway_url.is_empty() {
        cmd.env("OPENCLAW_GATEWAY_URL", &gateway_url);
    }

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return json!({"ok": false, "error": format!("启动 {channel} 登录失败：{e}")}),
    };

    // 向 stdin 写入回车，自动接受 clack / inquirer 插件选择提示的默认选项。
    // 只发 3 次（间隔 1.5s），足以通过插件选择弹窗；不多发，避免跳过 QR 步骤。
    if let Some(mut stdin) = child.stdin.take() {
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            for _ in 0..3u8 {
                if stdin.write_all(b"\n").await.is_err() { break; }
                tokio::time::sleep(tokio::time::Duration::from_millis(1500)).await;
            }
        });
    }

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app_out = app.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit("channel:line", json!({"stream": "stdout", "line": &line}));
            let t = line.trim();
            if t.starts_with("https://") || t.starts_with("http://") {
                let _ = app_out.emit("channel:qr", json!({"url": t}));
            }
        }
    });

    let app_err = app.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit("channel:line", json!({"stream": "stderr", "line": &line}));
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);

    match child.wait().await {
        Ok(status) => {
            let code = status.code().unwrap_or(-1);
            let ok = status.success();
            let _ = app.emit("channel:done", json!({"ok": ok, "exitCode": code}));
            json!({"ok": ok, "exitCode": code})
        }
        Err(e) => {
            let _ = app.emit("channel:done", json!({"ok": false, "error": e.to_string()}));
            json!({"ok": false, "error": e.to_string()})
        }
    }
}
