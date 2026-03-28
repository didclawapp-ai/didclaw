//! 渠道配置写入与 QR 流式接入（P1-3）。

use crate::openclaw_common::{backup_timestamp, is_enoent, openclaw_config_path, openclaw_dir};
use serde_json::{json, Map, Value};
use std::fs;
use std::path::Path;

fn upsert_string_array(obj: &mut Map<String, Value>, key: &str, value: &str) {
    if !obj.get(key).map(|v| v.is_array()).unwrap_or(false) {
        obj.insert(key.to_string(), json!([]));
    }
    let arr = obj.get_mut(key).unwrap().as_array_mut().unwrap();
    if !arr.iter().any(|v| v.as_str() == Some(value)) {
        arr.push(json!(value));
    }
}

fn ensure_feishu_plugin_config(
    app_id: &str,
    app_secret: &str,
    domain: &str,
    open_id: Option<&str>,
) -> Result<Value, String> {
    let config_path = openclaw_config_path()?;
    let dir = openclaw_dir()?;

    let mut root: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str(&raw)
            .map_err(|_| "openclaw.json 无法解析为 JSON，已中止写入".to_string())?,
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return Err(e.to_string()),
    };

    let backup = backup_if_exists(&config_path).map_err(|e| format!("备份失败，已中止：{e}"))?;

    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    if !root_map.get("channels").map(|v| v.is_object()).unwrap_or(false) {
        root_map.insert("channels".into(), json!({}));
    }
    let channels = root_map.get_mut("channels").unwrap().as_object_mut().unwrap();
    if !channels.get("feishu").map(|v| v.is_object()).unwrap_or(false) {
        channels.insert("feishu".into(), json!({}));
    }
    let feishu = channels.get_mut("feishu").unwrap().as_object_mut().unwrap();
    feishu.insert("enabled".into(), json!(true));
    feishu.insert("appId".into(), json!(app_id));
    feishu.insert("appSecret".into(), json!(app_secret));
    feishu.insert("domain".into(), json!(domain));
    if !feishu.contains_key("connectionMode") {
        feishu.insert("connectionMode".into(), json!("websocket"));
    }
    if !feishu.contains_key("requireMention") {
        feishu.insert("requireMention".into(), json!(true));
    }

    if let Some(id) = open_id {
        feishu.insert("dmPolicy".into(), json!("allowlist"));
        upsert_string_array(feishu, "allowFrom", id);
        if !feishu.contains_key("groupPolicy") {
            feishu.insert("groupPolicy".into(), json!("allowlist"));
        }
        upsert_string_array(feishu, "groupAllowFrom", id);
        if !feishu.get("groups").map(|v| v.is_object()).unwrap_or(false) {
            feishu.insert("groups".into(), json!({"*": {"enabled": true}}));
        }
    } else {
        if !feishu.contains_key("dmPolicy") {
            feishu.insert("dmPolicy".into(), json!("pairing"));
        }
        if !feishu.contains_key("groupPolicy") {
            feishu.insert("groupPolicy".into(), json!("open"));
        }
    }

    if !root_map.get("plugins").map(|v| v.is_object()).unwrap_or(false) {
        root_map.insert("plugins".into(), json!({}));
    }
    let plugins = root_map.get_mut("plugins").unwrap().as_object_mut().unwrap();

    if !plugins.get("allow").map(|v| v.is_array()).unwrap_or(false) {
        plugins.insert("allow".into(), json!([]));
    }
    let allow = plugins.get_mut("allow").unwrap().as_array_mut().unwrap();
    allow.retain(|v| v.as_str() != Some("feishu"));
    if !allow.iter().any(|v| v.as_str() == Some("openclaw-lark")) {
        allow.push(json!("openclaw-lark"));
    }

    if !plugins.get("entries").map(|v| v.is_object()).unwrap_or(false) {
        plugins.insert("entries".into(), json!({}));
    }
    let entries = plugins.get_mut("entries").unwrap().as_object_mut().unwrap();
    entries.insert("feishu".into(), json!({"enabled": false}));
    entries.insert("openclaw-lark".into(), json!({"enabled": true}));

    let out = serde_json::to_string_pretty(&root)
        .map(|s| format!("{s}\n"))
        .map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(&config_path, out).map_err(|e| e.to_string())?;

    let backup_json = if backup.is_empty() { Value::Null } else { json!(backup) };
    Ok(json!({"ok": true, "backupPath": backup_json}))
}

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
        "wecom" => "wecom-openclaw-plugin",
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

/// 清理已知渠道的残留配置与扩展目录（当前主要用于飞书安装失败后的恢复）。
pub fn cleanup_channel_residue(channel: &str) -> Value {
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
            Err(_) => return json!({"ok": false, "error": "openclaw.json 无法解析为 JSON，已中止清理"}),
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

    let mut removed: Vec<String> = Vec::new();
    let root_map = root.as_object_mut().unwrap();

    match channel {
        "feishu" => {
            if let Some(channels) = root_map.get_mut("channels").and_then(|v| v.as_object_mut()) {
                if channels.remove("feishu").is_some() {
                    removed.push("channels.feishu".into());
                }
            }

            if let Some(plugins) = root_map.get_mut("plugins").and_then(|v| v.as_object_mut()) {
                if let Some(entries) = plugins.get_mut("entries").and_then(|v| v.as_object_mut()) {
                    for key in ["feishu", "openclaw-lark"] {
                        if entries.remove(key).is_some() {
                            removed.push(format!("plugins.entries.{key}"));
                        }
                    }
                }
                if let Some(installs) = plugins.get_mut("installs").and_then(|v| v.as_object_mut()) {
                    for key in ["feishu", "openclaw-lark"] {
                        if installs.remove(key).is_some() {
                            removed.push(format!("plugins.installs.{key}"));
                        }
                    }
                }
                if let Some(paths) = plugins
                    .get_mut("load")
                    .and_then(|v| v.as_object_mut())
                    .and_then(|load| load.get_mut("paths"))
                    .and_then(|v| v.as_array_mut())
                {
                    let before = paths.len();
                    paths.retain(|item| {
                        item.as_str()
                            .map(|s| !s.to_ascii_lowercase().contains("openclaw-lark"))
                            .unwrap_or(true)
                    });
                    if before != paths.len() {
                        removed.push("plugins.load.paths[*openclaw-lark*]".into());
                    }
                }
            }
        }
        _ => {
            return json!({
                "ok": false,
                "error": format!("不支持清理残留的渠道: {channel}")
            })
        }
    }

    let mut removed_dirs: Vec<String> = Vec::new();
    for name in ["openclaw-lark", "feishu"] {
        let p = dir.join("extensions").join(name);
        if p.is_dir() {
            if let Err(e) = fs::remove_dir_all(&p) {
                return json!({"ok": false, "error": format!("删除目录失败（{}）：{}", p.display(), e)});
            }
            removed_dirs.push(p.to_string_lossy().to_string());
        }
    }

    if !removed.is_empty() {
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
    }

    let backup_json = if backup.is_empty() { Value::Null } else { json!(backup) };
    json!({
        "ok": true,
        "channel": channel,
        "removed": removed,
        "removedDirs": removed_dirs,
        "backupPath": backup_json
    })
}

pub fn configure_feishu_plugin(
    app_id: &str,
    app_secret: &str,
    domain: &str,
) -> Value {
    match ensure_feishu_plugin_config(app_id, app_secret, domain, None) {
        Ok(v) => v,
        Err(e) => json!({"ok": false, "error": e}),
    }
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

fn installed_feishu_plugin_version() -> Option<String> {
    let dir = openclaw_dir().ok()?;
    let root = dir.join("extensions").join("openclaw-lark");
    let pkg = root.join("package.json");
    let node_modules = root.join("node_modules");
    if !pkg.is_file() || !node_modules.is_dir() {
        return None;
    }
    let raw = fs::read_to_string(pkg).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    value.get("version")?.as_str().map(ToOwned::to_owned)
}

fn feishu_plugin_root() -> Option<std::path::PathBuf> {
    openclaw_dir().ok().map(|dir| dir.join("extensions").join("openclaw-lark"))
}

fn cleanup_incomplete_feishu_plugin_dir() -> Result<bool, String> {
    let Some(root) = feishu_plugin_root() else {
        return Ok(false);
    };
    if !root.exists() {
        return Ok(false);
    }
    if installed_feishu_plugin_version().is_some() {
        return Ok(false);
    }
    fs::remove_dir_all(&root)
        .map_err(|e| format!("删除不完整飞书插件目录失败（{}）：{}", root.display(), e))?;
    Ok(true)
}

fn feishu_accounts_base(domain: &str) -> &'static str {
    match domain {
        "lark" => "https://accounts.larksuite.com",
        _ => "https://accounts.feishu.cn",
    }
}

fn feishu_registration_post(base: &str, params: &[(&str, &str)]) -> Result<Value, String> {
    let body = url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(params.iter().copied())
        .finish();
    let url = format!("{base}/oauth/v1/app/registration");
    let resp = ureq::post(&url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body);

    match resp {
        Ok(r) => r.into_json::<Value>().map_err(|e| e.to_string()),
        Err(ureq::Error::Status(_, r)) => r.into_json::<Value>().map_err(|e| e.to_string()),
        Err(e) => Err(e.to_string()),
    }
}

fn run_feishu_existing_plugin_flow(
    app: tauri::AppHandle,
    flow_id: String,
    installed_version: String,
) -> Value {
    use std::time::{Duration, Instant};
    use tauri::Emitter;

    let _ = app.emit(
        "channel:line",
        json!({
            "flowId": &flow_id,
            "stream": "stdout",
            "line": format!("已检测到本地飞书插件 v{installed_version}，跳过重复安装，直接开始扫码配置…"),
        }),
    );

    let init = match feishu_registration_post(feishu_accounts_base("feishu"), &[("action", "init")]) {
        Ok(v) => v,
        Err(e) => {
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": e}));
            return json!({"ok": false, "error": e});
        }
    };
    let supported = init
        .get("supported_auth_methods")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().any(|v| v.as_str() == Some("client_secret")))
        .unwrap_or(false);
    if !supported {
        let msg = "当前飞书环境不支持 client_secret 授权流程";
        let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
        return json!({"ok": false, "error": msg});
    }

    let begin = match feishu_registration_post(
        feishu_accounts_base("feishu"),
        &[
            ("action", "begin"),
            ("archetype", "PersonalAgent"),
            ("auth_method", "client_secret"),
            ("request_user_info", "open_id"),
        ],
    ) {
        Ok(v) => v,
        Err(e) => {
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": e}));
            return json!({"ok": false, "error": e});
        }
    };

    let mut qr_url = match begin.get("verification_uri_complete").and_then(|v| v.as_str()) {
        Some(v) => v.to_string(),
        None => {
            let msg = "飞书返回结果缺少 verification_uri_complete";
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
            return json!({"ok": false, "error": msg});
        }
    };
    if let Ok(mut parsed) = url::Url::parse(&qr_url) {
        parsed.query_pairs_mut().append_pair("from", "onboard");
        qr_url = parsed.to_string();
    }
    let _ = app.emit(
        "channel:line",
        json!({"flowId": &flow_id, "stream": "stdout", "line": "请使用飞书扫码完成机器人配置…"}),
    );
    let _ = app.emit("channel:qr", json!({"flowId": &flow_id, "url": &qr_url}));

    let device_code = match begin.get("device_code").and_then(|v| v.as_str()) {
        Some(v) => v.to_string(),
        None => {
            let msg = "飞书返回结果缺少 device_code";
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
            return json!({"ok": false, "error": msg});
        }
    };

    let mut interval = begin.get("interval").and_then(|v| v.as_u64()).unwrap_or(5);
    let expire_in = begin.get("expire_in").and_then(|v| v.as_u64()).unwrap_or(600);
    let started = Instant::now();
    let mut domain = "feishu".to_string();

    while started.elapsed() < Duration::from_secs(expire_in) {
        let poll = match feishu_registration_post(
            feishu_accounts_base(&domain),
            &[("action", "poll"), ("device_code", &device_code)],
        ) {
            Ok(v) => v,
            Err(e) => {
                let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": e}));
                return json!({"ok": false, "error": e});
            }
        };

        if poll
            .get("user_info")
            .and_then(|v| v.get("tenant_brand"))
            .and_then(|v| v.as_str())
            == Some("lark")
            && domain != "lark"
        {
            domain = "lark".into();
            let _ = app.emit(
                "channel:line",
                json!({"flowId": &flow_id, "stream": "stdout", "line": "检测到 Lark 国际版租户，已切换到 Lark 域名继续获取配置…"}),
            );
            continue;
        }

        let app_id = poll.get("client_id").and_then(|v| v.as_str());
        let app_secret = poll.get("client_secret").and_then(|v| v.as_str());
        if let (Some(app_id), Some(app_secret)) = (app_id, app_secret) {
            let open_id = poll
                .get("user_info")
                .and_then(|v| v.get("open_id"))
                .and_then(|v| v.as_str());
            match ensure_feishu_plugin_config(app_id, app_secret, &domain, open_id) {
                Ok(_) => {
                    let _ = app.emit(
                        "channel:line",
                        json!({"flowId": &flow_id, "stream": "stdout", "line": "已获取并写入飞书机器人配置，请重启 Gateway 使其生效。"}),
                    );
                    let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": true, "skippedInstall": true}));
                    return json!({"ok": true, "skippedInstall": true, "installedVersion": installed_version});
                }
                Err(e) => {
                    let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": e}));
                    return json!({"ok": false, "error": e});
                }
            }
        }

        if let Some(err) = poll.get("error").and_then(|v| v.as_str()) {
            match err {
                "authorization_pending" => {}
                "slow_down" => interval += 5,
                "access_denied" => {
                    let msg = "用户取消了飞书扫码授权";
                    let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
                    return json!({"ok": false, "error": msg});
                }
                "expired_token" => {
                    let msg = "飞书扫码会话已过期，请重试";
                    let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
                    return json!({"ok": false, "error": msg});
                }
                other => {
                    let msg = format!(
                        "飞书配置失败：{}{}",
                        other,
                        poll.get("error_description")
                            .and_then(|v| v.as_str())
                            .map(|s| format!(" ({s})"))
                            .unwrap_or_default()
                    );
                    let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
                    return json!({"ok": false, "error": msg});
                }
            }
        }

        std::thread::sleep(Duration::from_secs(interval));
    }

    let msg = "飞书扫码超时，请重试";
    let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
    json!({"ok": false, "error": msg})
}

async fn run_feishu_install_and_config_flow(
    app: tauri::AppHandle,
    flow_id: String,
    openclaw_exe: String,
) -> Value {
    use std::process::Stdio;
    use tauri::Emitter;
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    if let Some(version) = installed_feishu_plugin_version() {
        return match tokio::task::spawn_blocking(move || {
            run_feishu_existing_plugin_flow(app, flow_id, version)
        })
        .await
        {
            Ok(v) => v,
            Err(e) => json!({"ok": false, "error": e.to_string()}),
        };
    }

    match cleanup_incomplete_feishu_plugin_dir() {
        Ok(true) => {
            let _ = app.emit(
                "channel:line",
                json!({"flowId": &flow_id, "stream": "stdout", "line": "检测到未完成的飞书插件目录，已自动清理后重新安装…"}),
            );
        }
        Ok(false) => {}
        Err(e) => {
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": e}));
            return json!({"ok": false, "error": e});
        }
    }

    let mut cmd = Command::new(&openclaw_exe);
    cmd.args(["plugins", "install", "@larksuite/openclaw-lark"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("启动飞书插件安装失败：{e}");
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
            return json!({"ok": false, "error": msg});
        }
    };

    let stdout = match child.stdout.take() {
        Some(v) => v,
        None => {
            let msg = "飞书插件安装未提供 stdout".to_string();
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
            return json!({"ok": false, "error": msg});
        }
    };
    let stderr = match child.stderr.take() {
        Some(v) => v,
        None => {
            let msg = "飞书插件安装未提供 stderr".to_string();
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
            return json!({"ok": false, "error": msg});
        }
    };

    let app_out = app.clone();
    let fid_out = flow_id.clone();
    let stdout_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit("channel:line", json!({"flowId": &fid_out, "stream": "stdout", "line": &line}));
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
            let clean = strip_ansi(line.trim());
            if let Some(url) = first_url_token(clean.trim()) {
                let _ = app_err.emit("channel:qr", json!({"flowId": &fid_err, "url": url}));
            }
        }
    });

    let _ = tokio::join!(stdout_task, stderr_task);

    let status = match child.wait().await {
        Ok(v) => v,
        Err(e) => {
            let msg = e.to_string();
            let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
            return json!({"ok": false, "error": msg});
        }
    };

    if !status.success() {
        let msg = format!("飞书插件安装失败（退出码 {}）", status.code().unwrap_or(-1));
        let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "exitCode": status.code().unwrap_or(-1), "error": msg}));
        return json!({"ok": false, "error": msg, "exitCode": status.code().unwrap_or(-1)});
    }

    let Some(version) = installed_feishu_plugin_version() else {
        let msg = "飞书插件安装完成，但未检测到完整的 openclaw-lark 目录".to_string();
        let _ = app.emit("channel:done", json!({"flowId": &flow_id, "ok": false, "error": msg}));
        return json!({"ok": false, "error": msg});
    };

    match tokio::task::spawn_blocking(move || run_feishu_existing_plugin_flow(app, flow_id, version)).await {
        Ok(v) => v,
        Err(e) => json!({"ok": false, "error": e.to_string()}),
    }
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

    if channel == "feishu" {
        return run_feishu_install_and_config_flow(app, flow_id, exe).await;
    }

    // 飞书使用独立的 npx 安装命令；微信/WhatsApp 走 openclaw CLI 登录。
    let (exe_resolved, args_resolved): (String, Vec<String>) = match channel.as_str() {
        "whatsapp" => (
            exe,
            vec!["channels".into(), "login".into(), "--channel".into(), "whatsapp".into()],
        ),
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
