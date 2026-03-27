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

/// 检查渠道插件是否已安装。
/// 判断 `~/.openclaw/extensions/<plugin-id>/package.json` 是否存在（非空目录误判）。
pub fn check_channel_plugin_installed(channel: &str) -> Value {
    let plugin_id = match channel {
        "wechat" => "openclaw-weixin",
        _ => {
            return json!({
                "ok": false,
                "error": format!("不支持检查安装状态的渠道: {channel}")
            });
        }
    };

    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    // 检查 package.json 是否存在，避免空目录被误判为已安装
    let pkg_json = dir.join("extensions").join(plugin_id).join("package.json");
    let installed = pkg_json.is_file();
    json!({
        "ok": true,
        "channel": channel,
        "pluginId": plugin_id,
        "installed": installed
    })
}

// ── start_channel_qr_flow ────────────────────────────────────────────────────

/// 剥离 ANSI/VT100 转义序列（`\x1b[…m` 及常见控制码），返回纯文本。
/// 不引入额外依赖，仅处理 ESC `[` CSI 序列（CLI 工具最常见的色彩码格式）。
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\x1b' {
            // 跳过 ESC + `[` 引导的 CSI 序列，直到遇到字母结束符
            if chars.peek() == Some(&'[') {
                chars.next(); // 消耗 '['
                for c in chars.by_ref() {
                    // CSI 序列以 0x40–0x7E 范围的字节结束（字母）
                    if c.is_ascii_alphabetic() { break; }
                }
            }
            // 其他 ESC 序列（如 ESC M 等）：跳过紧跟的一个字符
            else if let Some(&next) = chars.peek() {
                if next != '\x1b' { chars.next(); }
            }
        } else {
            out.push(ch);
        }
    }
    out
}

fn first_url_token(s: &str) -> Option<&str> {
    s.split_whitespace()
        .find(|token| {
            token.starts_with("https://")
                || token.starts_with("http://")
                || token.starts_with("data:image/")
        })
        .map(|token| token.trim_matches(|c| matches!(c, '"' | '\'' | '(' | ')' | '[' | ']')))
}

/// 查找 npx 可执行文件（Windows 优先 npx.cmd，fallback 到 PATH 中的 npx）。
fn resolve_npx_executable() -> Option<String> {
    #[cfg(windows)]
    {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let p = std::path::PathBuf::from(&appdata).join("npm").join("npx.cmd");
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
        for base in &[r"C:\Program Files\nodejs", r"C:\Program Files (x86)\nodejs"] {
            let p = std::path::PathBuf::from(base).join("npx.cmd");
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
        if let Ok(out) = std::process::Command::new("where").arg("npx").output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = s.lines().next() {
                    let t = line.trim();
                    if !t.is_empty() { return Some(t.to_owned()); }
                }
            }
        }
    }
    #[cfg(not(windows))]
    {
        for c in &["/usr/local/bin/npx", "/usr/bin/npx"] {
            if std::path::Path::new(c).is_file() { return Some(c.to_string()); }
        }
        if let Ok(out) = std::process::Command::new("which").arg("npx").output() {
            if out.status.success() {
                let s = String::from_utf8_lossy(&out.stdout);
                let t = s.trim();
                if !t.is_empty() { return Some(t.to_owned()); }
            }
        }
    }
    None
}

/// 流式运行渠道 QR 登录命令，逐行向前端推送事件：
/// - `channel:line`  → `{flowId, stream: "stdout"|"stderr", line: string}`
/// - `channel:qr`    → `{flowId, url: string}`（检测到 https:// 行时）
/// - `channel:done`  → `{flowId, ok: bool, exitCode: number}`（进程退出）
///
/// `flow_id` 由前端生成并传入，所有事件带回同一 ID，前端据此过滤多个并发流的事件串台。
pub async fn start_channel_qr_flow(
    app: tauri::AppHandle,
    channel: String,
    gateway_url: String,
    flow_id: String,
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

    // 飞书使用独立的 npx 安装命令；微信/WhatsApp 走 openclaw CLI 登录。
    let (exe_resolved, args_resolved): (String, Vec<String>) = match channel.as_str() {
        "whatsapp" => (
            exe,
            vec!["channels".into(), "login".into(), "--channel".into(), "whatsapp".into()],
        ),
        "feishu" => {
            // 查找 npx（Windows 上通常是 npx.cmd）
            let npx = resolve_npx_executable().unwrap_or_else(|| "npx".into());
            (npx, vec!["-y".into(), "@larksuite/openclaw-lark".into(), "install".into()])
        }
        "wechat" => (
            exe,
            vec![
                "channels".into(),
                "login".into(),
                "--channel".into(),
                "openclaw-weixin".into(),
            ],
        ),
        _ => return json!({"ok": false, "error": format!("不支持的 QR 渠道: {channel}")}),
    };
    let args: Vec<&str> = args_resolved.iter().map(String::as_str).collect();

    let mut cmd = Command::new(&exe_resolved);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
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
    let fid_out = flow_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit("channel:line", json!({"flowId": &fid_out, "stream": "stdout", "line": &line}));
            // 剥离 ANSI 转义序列后再做 URL 检测，避免色彩码或前缀文案导致匹配失败。
            let clean = strip_ansi(line.trim());
            if let Some(url) = first_url_token(clean.trim()) {
                let _ = app_out.emit("channel:qr", json!({"flowId": &fid_out, "url": url}));
            }
        }
    });

    let app_err = app.clone();
    let fid_err = flow_id.clone();
    let stderr_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit("channel:line", json!({"flowId": &fid_err, "stream": "stderr", "line": &line}));
            // stderr 也做 URL 检测（部分 CLI 版本将二维码 URL 输出到 stderr）
            let clean = strip_ansi(line.trim());
            if let Some(url) = first_url_token(clean.trim()) {
                let _ = app_err.emit("channel:qr", json!({"flowId": &fid_err, "url": url}));
            }
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);

    match child.wait().await {
        Ok(status) => {
            let code = status.code().unwrap_or(-1);
            let ok = status.success();
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": ok, "exitCode": code}));
            json!({"ok": ok, "exitCode": code})
        }
        Err(e) => {
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": e.to_string()}));
            json!({"ok": false, "error": e.to_string()})
        }
    }
}
