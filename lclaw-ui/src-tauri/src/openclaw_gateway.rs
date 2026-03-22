//! 与 `electron/openclaw-gateway-process.ts` 对齐：本机环回 WS、探测端口、拉起 `openclaw gateway`、退出时可选结束子进程。

use serde_json::{json, Value};
use std::io;
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::sync::Mutex as AsyncMutex;
use url::Url;

static MANAGED_CHILD: Mutex<Option<Child>> = Mutex::new(None);

fn ensure_mutex() -> &'static AsyncMutex<()> {
    use std::sync::OnceLock;
    static M: OnceLock<AsyncMutex<()>> = OnceLock::new();
    M.get_or_init(|| AsyncMutex::new(()))
}

fn is_loopback_host(host: &str) -> bool {
    matches!(
        host.to_lowercase().as_str(),
        "127.0.0.1" | "localhost" | "::1"
    )
}

fn parse_gateway_ws_tcp_target(ws_url: &str) -> Option<(String, u16)> {
    let u = Url::parse(ws_url.trim()).ok()?;
    let scheme = u.scheme();
    if scheme != "ws" && scheme != "wss" {
        return None;
    }
    let host = u.host_str()?.to_string();
    if !is_loopback_host(&host) {
        return None;
    }
    let mut port = u.port().unwrap_or(0);
    if port == 0 {
        port = if scheme == "wss" { 443 } else { 18789 };
    }
    Some((host, port))
}

fn probe_addr(host: &str, port: u16) -> io::Result<SocketAddr> {
    let host_l = host.to_lowercase();
    match host_l.as_str() {
        "127.0.0.1" | "localhost" => Ok(SocketAddr::from(([127, 0, 0, 1], port))),
        "::1" => Ok(SocketAddr::from(([0u16, 0, 0, 0, 0, 0, 0, 1], port))),
        _ => {
            let spec = if host.contains(':') && !host.starts_with('[') {
                format!("[{host}]:{port}")
            } else {
                format!("{host}:{port}")
            };
            spec.to_socket_addrs()?
                .next()
                .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "无法解析地址"))
        }
    }
}

fn probe_port_once(host: &str, port: u16, timeout: Duration) -> bool {
    let Ok(addr) = probe_addr(host, port) else {
        return false;
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

async fn wait_for_tcp_port_open(host: &str, port: u16, total: Duration, interval: Duration) -> bool {
    let deadline = Instant::now() + total;
    while Instant::now() < deadline {
        let slice = Duration::from_millis(2000).min(deadline.saturating_duration_since(Instant::now()));
        if slice.is_zero() {
            break;
        }
        if probe_port_once(host, port, slice) {
            return true;
        }
        tokio::time::sleep(interval).await;
    }
    false
}

fn resolve_open_claw_executable(custom: Option<&str>) -> Option<String> {
    if let Some(t) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        if std::path::Path::new(t).exists() {
            return Some(t.to_string());
        }
        return None;
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if let Ok(out) = Command::new("where.exe")
            .arg("openclaw")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            if out.status.success() {
                let stdout = String::from_utf8_lossy(&out.stdout);
                if let Some(line) = stdout.lines().map(str::trim).find(|l| !l.is_empty()) {
                    if std::path::Path::new(line).exists() {
                        return Some(line.to_string());
                    }
                }
            }
        }
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        if Command::new("openclaw")
            .arg("--version")
            .creation_flags(CREATE_NO_WINDOW)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some("openclaw".to_string());
        }
    }

    #[cfg(not(windows))]
    {
        if Command::new("openclaw")
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
        {
            return Some("openclaw".to_string());
        }
    }

    None
}

fn kill_managed_gateway_process() {
    let mut g = MANAGED_CHILD.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut c) = g.take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

pub fn dispose_managed_open_claw_gateway(app: &tauri::AppHandle) {
    let kill_on_quit = crate::gateway_local::read_merged_map(app)
        .ok()
        .and_then(|m| {
            m.get("stopManagedGatewayOnQuit")
                .and_then(|v| v.as_bool())
        })
        .unwrap_or(false);
    if kill_on_quit {
        kill_managed_gateway_process();
    }
}

fn spawn_openclaw_gateway(exe: &str) -> Result<Child, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let inner = format!("\"{}\" gateway", exe.replace('"', ""));
        Command::new("cmd")
            .arg("/C")
            .arg(&inner)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        Command::new(exe)
            .arg("gateway")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())
    }
}

pub async fn ensure_open_claw_gateway_running(
    app: tauri::AppHandle,
    ws_url: String,
) -> Result<Value, String> {
    let _guard = ensure_mutex().lock().await;

    let Some((host, port)) = parse_gateway_ws_tcp_target(&ws_url) else {
        return Ok(json!({"ok": true, "started": false}));
    };

    let merged = crate::gateway_local::read_merged_map(&app).unwrap_or_default();
    let auto_start = merged
        .get("autoStartOpenClaw")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);
    if !auto_start {
        return Ok(json!({"ok": true, "started": false}));
    }

    if wait_for_tcp_port_open(&host, port, Duration::from_millis(500), Duration::from_millis(350)).await
    {
        return Ok(json!({"ok": true, "started": false}));
    }

    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let exe = resolve_open_claw_executable(exe_opt).ok_or_else(|| {
        "未找到 openclaw。请先安装 OpenClaw 并确保终端能执行 openclaw，或在「本机设置 → 连助手」填写 openclaw 的完整路径（如 npm 全局目录下的 openclaw.cmd）。".to_string()
    })?;

    let child = spawn_openclaw_gateway(&exe).map_err(|e| {
        if e.is_empty() {
            "无法启动 openclaw gateway（进程创建失败）。".to_string()
        } else {
            format!("无法启动 openclaw gateway（进程创建失败）：{e}")
        }
    })?;

    {
        let mut g = MANAGED_CHILD.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(mut old) = g.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        *g = Some(child);
    }

    let up = wait_for_tcp_port_open(
        &host,
        port,
        Duration::from_secs(45),
        Duration::from_millis(350),
    )
    .await;

    if !up {
        kill_managed_gateway_process();
        return Ok(json!({
            "ok": false,
            "error": format!(
                "已在后台执行 openclaw gateway，但端口 {port} 在超时内仍未就绪。请检查本机防火墙、openclaw.json 里的 gateway.port 是否与连接地址一致。"
            )
        }));
    }

    Ok(json!({"ok": true, "started": true}))
}
