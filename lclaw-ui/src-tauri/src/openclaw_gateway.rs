//! 与 `electron/openclaw-gateway-process.ts` 对齐：本机环回 WS、探测端口、拉起 `openclaw gateway`、退出时可选结束子进程。

use serde_json::{json, Value};
use std::io;
use std::io::Read;
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

pub(crate) fn parse_gateway_ws_tcp_target(ws_url: &str) -> Option<(String, u16)> {
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

/// 与 OpenClaw `resolveGatewayPort` 对齐：读 `~/.openclaw/openclaw.json` 的 `gateway.port`（数字或字符串）。
fn read_gateway_port_from_openclaw_json() -> Option<u16> {
    let path = crate::openclaw_common::openclaw_config_path().ok()?;
    let raw = std::fs::read_to_string(&path).ok()?;
    let v: Value = serde_json::from_str(&raw).ok()?;
    let port_val = v.get("gateway")?.get("port")?;
    match port_val {
        Value::Number(n) => n.as_u64().and_then(|u| u16::try_from(u).ok()),
        Value::String(s) => s.trim().parse::<u16>().ok(),
        _ => None,
    }
}

fn format_port_mismatch_hint(ws_port: u16, host: &str) -> String {
    let Some(cfg_port) = read_gateway_port_from_openclaw_json() else {
        return String::new();
    };
    if cfg_port == ws_port {
        return String::new();
    }
    let mut s = format!(
        " 检测到 openclaw.json 中 gateway.port={cfg_port}，与当前连接地址端口 {ws_port} 不一致；请在「本机设置 → 连助手」将 WebSocket 改为 ws://{host}:{cfg_port}（或改配置使端口一致）。"
    );
    if probe_port_once(host, cfg_port, Duration::from_millis(800)) {
        s.push_str(&format!(" 当前端口 {cfg_port} 已可连接，优先改连接地址。"));
    }
    s
}

/// npm 全局目录常见：`where openclaw` 得到无扩展名垫片路径，`cmd /C` 无法直接执行，需改用同名的 `openclaw.cmd`。
#[cfg(windows)]
fn best_windows_openclaw_path(from_where: &str) -> Option<String> {
    use std::path::Path;
    let from_where = from_where.trim();
    let p = Path::new(from_where);
    if !p.exists() {
        return None;
    }
    if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
        let ext_l = ext.to_ascii_lowercase();
        if matches!(ext_l.as_str(), "cmd" | "bat" | "exe") {
            return Some(from_where.to_string());
        }
        if ext_l == "ps1" {
            let cmd = p.with_extension("cmd");
            if cmd.exists() {
                return Some(cmd.to_string_lossy().into_owned());
            }
        }
    }
    let cmd = p.with_extension("cmd");
    if cmd.exists() {
        return Some(cmd.to_string_lossy().into_owned());
    }
    let bat = p.with_extension("bat");
    if bat.exists() {
        return Some(bat.to_string_lossy().into_owned());
    }
    None
}

#[cfg(windows)]
fn first_resolved_openclaw_from_where(args: &[&str]) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    for name in args {
        let Ok(out) = Command::new("where.exe")
            .arg(name)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
            if let Some(best) = best_windows_openclaw_path(line) {
                return Some(best);
            }
        }
    }
    None
}

fn resolve_open_claw_executable(custom: Option<&str>) -> Option<String> {
    if let Some(t) = custom.map(str::trim).filter(|s| !s.is_empty()) {
        #[cfg(windows)]
        {
            if let Some(best) = best_windows_openclaw_path(t) {
                return Some(best);
            }
        }
        #[cfg(not(windows))]
        {
            if std::path::Path::new(t).exists() {
                return Some(t.to_string());
            }
        }
        return None;
    }

    #[cfg(windows)]
    {
        if let Some(p) = first_resolved_openclaw_from_where(&["openclaw.cmd", "openclaw"]) {
            return Some(p);
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

/// 在子进程已退出或即将被回收前读取 stderr，便于把 OpenClaw 的校验/端口等报错展示给用户。
fn read_child_stderr_abbrev(child: &mut Child, max_bytes: usize) -> String {
    let Some(mut err) = child.stderr.take() else {
        return String::new();
    };
    let mut buf = vec![0u8; max_bytes];
    let mut total = 0usize;
    loop {
        match err.read(&mut buf[total..]) {
            Ok(0) => break,
            Ok(n) => {
                total += n;
                if total >= max_bytes {
                    break;
                }
            }
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&buf[..total]).trim().to_string()
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
        // 勿把「"路径" gateway」拼成 /C 的单个参数，否则 cmd 会把整段当命令名而报「不是内部或外部命令」。
        // 分开发传参，由 Rust/Windows 按规则为含空格的路径加引号。
        Command::new("cmd")
            .arg("/C")
            .arg(exe.trim())
            .arg("gateway")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
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
            .stderr(Stdio::piped())
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

    tokio::time::sleep(Duration::from_millis(1200)).await;
    {
        let mut g = MANAGED_CHILD.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(ref mut c) = *g {
            match c.try_wait() {
                Ok(Some(status)) => {
                    let stderr_tail = read_child_stderr_abbrev(c, 8192);
                    drop(g);
                    kill_managed_gateway_process();
                    let code = status
                        .code()
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "非零/信号".into());
                    let detail = if stderr_tail.is_empty() {
                        "未捕获到子进程错误输出；请在 CMD/PowerShell 手动执行「openclaw gateway」查看完整日志。".to_string()
                    } else {
                        format!("进程错误输出：\n{stderr_tail}")
                    };
                    return Ok(json!({
                        "ok": false,
                        "error": format!(
                            "openclaw gateway 启动后很快退出（退出码 {code}）。{detail} 常见原因：配置校验失败、端口被占用、依赖未就绪。若仅本应用拉不起进程，请在「本机设置」填写 openclaw 的完整路径（如 npm 全局目录下的 openclaw.cmd）。"
                        )
                    }));
                }
                Ok(None) => {}
                Err(_) => {}
            }
        }
    }

    let up = wait_for_tcp_port_open(
        &host,
        port,
        Duration::from_secs(90),
        Duration::from_millis(350),
    )
    .await;

    if !up {
        kill_managed_gateway_process();
        let hint = format_port_mismatch_hint(port, &host);
        return Ok(json!({
            "ok": false,
            "error": format!(
                "已在后台执行 openclaw gateway，但端口 {port} 在约 90 秒内仍未监听。请检查：1) 防火墙是否拦截本机环回；2) 该端口是否被其它程序占用；3) openclaw.json 里 gateway.port 是否与「连接地址」一致。{hint} 仍失败时请在终端运行「openclaw gateway」查看实时日志。"
            )
        }));
    }

    // 端口刚 accept 时，进程内 WebSocket 与首帧 connect.challenge 可能仍滞后；立刻建连易首连失败，关开开关后反而秒连。
    tokio::time::sleep(Duration::from_millis(650)).await;

    Ok(json!({"ok": true, "started": true}))
}
