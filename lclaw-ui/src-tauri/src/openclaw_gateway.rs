//! 与 `electron/openclaw-gateway-process.ts` 对齐：本机环回 WS、探测端口、拉起 `openclaw gateway`、退出时可选结束子进程。

use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io;
use std::io::{Read, Seek};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

fn build_clawhub_env(
    token: Option<&str>,
    registry: Option<&str>,
) -> Vec<(String, String)> {
    let mut v = Vec::new();
    if let Some(t) = token.map(str::trim).filter(|s| !s.is_empty()) {
        v.push(("OPENCLAW_CLAWHUB_TOKEN".into(), t.to_string()));
        v.push(("CLAWHUB_TOKEN".into(), t.to_string()));
    }
    if let Some(r) = registry.map(str::trim).filter(|s| !s.is_empty()) {
        let base = r.trim_end_matches('/').to_string();
        v.push(("OPENCLAW_CLAWHUB_URL".into(), base.clone()));
        v.push(("CLAWHUB_URL".into(), base));
    }
    v
}

fn apply_extra_env(cmd: &mut Command, extra: &[(String, String)]) {
    for (k, val) in extra {
        cmd.env(k, val);
    }
}

fn output_text_looks_like_clawhub_rate_limit(text: &str) -> bool {
    let l = text.to_ascii_lowercase();
    if l.contains("rate limit exceeded")
        || l.contains("too many requests")
        || (l.contains("429") && l.contains("rate limit"))
    {
        return true;
    }
    l.contains("(429)") && l.contains("clawhub")
}

fn rate_limit_backoff_seconds(text: &str, attempt: usize) -> u64 {
    let lower = text.to_ascii_lowercase();
    for needle in ["retry-after:", "retry-after "] {
        if let Some(idx) = lower.find(needle) {
            let rest = text[idx + needle.len()..]
                .trim_start()
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect::<String>();
            if let Ok(n) = rest.parse::<u64>() {
                if (1..=300).contains(&n) {
                    return n;
                }
            }
        }
    }
    (12u64 + attempt as u64 * 14).min(78)
}
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
    let path_env = windows_enhanced_path();
    for name in args {
        let Ok(out) = Command::new("where.exe")
            .arg(name)
            .env("PATH", &path_env)
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

/// 与 `System32\WindowsPowerShell\v1.0\powershell.exe` 一致；不依赖 PATH（从桌面快捷方式启动时 PATH 常缺 System32）。
#[cfg(windows)]
pub(crate) fn windows_powershell_exe() -> PathBuf {
    let root = std::env::var("SystemRoot")
        .or_else(|_| std::env::var("WINDIR"))
        .unwrap_or_else(|_| "C:\\Windows".to_string());
    Path::new(&root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe")
}

/// 从资源管理器启动的 GUI 进程往往拿不到完整 PATH：先补 **System32 / PowerShell / Wbem**，再保留原 PATH，并补常见 Node/npm 目录后再 `where` / 起子进程。
#[cfg(windows)]
pub(crate) fn windows_enhanced_path() -> String {
    fn push_unique(seen: &mut BTreeSet<String>, out: &mut Vec<String>, s: String) {
        let k = s.to_lowercase();
        if seen.insert(k) {
            out.push(s);
        }
    }
    let mut seen = BTreeSet::new();
    let mut out: Vec<String> = Vec::new();

    let system_root = std::env::var("SystemRoot")
        .or_else(|_| std::env::var("WINDIR"))
        .unwrap_or_else(|_| "C:\\Windows".to_string());
    let sys32 = Path::new(&system_root).join("System32");
    let ps_v1 = sys32.join("WindowsPowerShell").join("v1.0");
    let wbem = sys32.join("Wbem");
    for d in [
        sys32.clone(),
        ps_v1,
        wbem,
        Path::new(&system_root).to_path_buf(),
    ] {
        if d.is_dir() {
            push_unique(&mut seen, &mut out, d.to_string_lossy().to_string());
        }
    }

    if let Ok(base) = std::env::var("PATH") {
        for p in base.split(';') {
            let t = p.trim();
            if !t.is_empty() {
                push_unique(&mut seen, &mut out, t.to_string());
            }
        }
    }
    let extra_dirs: Vec<Option<PathBuf>> = vec![
        std::env::var("ProgramFiles")
            .ok()
            .map(|p| Path::new(&p).join("nodejs")),
        std::env::var("ProgramFiles(x86)")
            .ok()
            .map(|p| Path::new(&p).join("nodejs")),
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|p| Path::new(&p).join("Programs").join("nodejs")),
        std::env::var("APPDATA")
            .ok()
            .map(|p| Path::new(&p).join("npm")),
    ];
    for d in extra_dirs.into_iter().flatten() {
        if d.is_dir() {
            push_unique(&mut seen, &mut out, d.to_string_lossy().to_string());
        }
    }
    out.join(";")
}

/// npm 全局 `openclaw.cmd` 同目录下一般为 `node_modules/openclaw/openclaw.mjs`（与官方包 `bin` 一致）。
#[cfg(windows)]
fn openclaw_entry_mjs_next_to_npm_shim(shim_path: &str) -> Option<PathBuf> {
    let p = Path::new(shim_path.trim());
    let ext = p.extension()?.to_str()?.to_ascii_lowercase();
    if !matches!(ext.as_str(), "cmd" | "bat" | "ps1") {
        return None;
    }
    let parent = p.parent()?;
    let mjs = parent
        .join("node_modules")
        .join("openclaw")
        .join("openclaw.mjs");
    if mjs.is_file() {
        Some(mjs)
    } else {
        None
    }
}

#[cfg(windows)]
fn resolve_node_exe_windows() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let fixed_candidates: [Option<PathBuf>; 3] = [
        std::env::var("ProgramFiles")
            .ok()
            .map(|p| Path::new(&p).join("nodejs").join("node.exe")),
        std::env::var("ProgramFiles(x86)")
            .ok()
            .map(|p| Path::new(&p).join("nodejs").join("node.exe")),
        std::env::var("LOCALAPPDATA")
            .ok()
            .map(|p| Path::new(&p).join("Programs").join("nodejs").join("node.exe")),
    ];
    for c in fixed_candidates.into_iter().flatten() {
        if c.is_file() {
            return Some(c);
        }
    }
    let path_env = windows_enhanced_path();
    let out = Command::new("where.exe")
        .arg("node.exe")
        .env("PATH", &path_env)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let line = stdout
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())?;
    let pb = PathBuf::from(line);
    if pb.is_file() {
        Some(pb)
    } else {
        None
    }
}

/// 解析 openclaw 可执行路径（网关自启与安装预检共用）。
pub fn resolve_open_claw_executable(custom: Option<&str>) -> Option<String> {
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
        let path_env = windows_enhanced_path();
        if Command::new("openclaw")
            .arg("--version")
            .env("PATH", &path_env)
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

/// Windows：将 stdout/stderr 重定向到 `~/.openclaw/logs/` 下文件，减少子进程分配可见控制台的概率；文件名使用 `didclaw-` 前缀以免与其它程序写入同一日志混淆。
#[cfg(windows)]
fn open_didclaw_gateway_stdio_log_files() -> Result<(std::fs::File, std::fs::File), std::io::Error> {
    use std::fs::OpenOptions;
    let dir = crate::openclaw_common::openclaw_dir()
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?
        .join("logs");
    std::fs::create_dir_all(&dir)?;
    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("didclaw-gateway.log"))?;
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("didclaw-gateway.err.log"))?;
    Ok((stdout_log, stderr_log))
}

#[cfg(windows)]
fn read_didclaw_gateway_err_log_tail(max_bytes: usize) -> String {
    let Ok(dir) = crate::openclaw_common::openclaw_dir() else {
        return String::new();
    };
    let path = dir.join("logs").join("didclaw-gateway.err.log");
    let Ok(mut f) = std::fs::File::open(&path) else {
        return String::new();
    };
    let Ok(meta) = f.metadata() else {
        return String::new();
    };
    let len = meta.len();
    if len == 0 {
        return String::new();
    }
    let max = max_bytes as u64;
    let start = len.saturating_sub(max);
    if f.seek(std::io::SeekFrom::Start(start)).is_err() {
        return String::new();
    }
    let to_read = (len - start) as usize;
    let mut buf = vec![0u8; to_read];
    let Ok(n) = f.read(&mut buf) else {
        return String::new();
    };
    String::from_utf8_lossy(&buf[..n]).trim().to_string()
}

fn kill_managed_gateway_process() -> bool {
    let mut g = MANAGED_CHILD.lock().expect("MANAGED_CHILD mutex poisoned");
    if let Some(mut c) = g.take() {
        let _ = c.kill();
        let _ = c.wait();
        return true;
    }
    false
}

fn gateway_stop_output_looks_safe(text: &str) -> bool {
    let l = text.to_ascii_lowercase();
    l.contains("not running")
        || l.contains("already stopped")
        || l.contains("not installed")
        || l.contains("no installed gateway")
        || l.contains("no service")
        || l.contains("service is not installed")
}

fn resolve_configured_openclaw_executable(
    app: &tauri::AppHandle,
) -> Result<Option<String>, String> {
    let merged = crate::gateway_local::read_merged_map(app)?;
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    Ok(resolve_open_claw_executable(exe_opt))
}

/// 退出应用时关闭仍带标题的网关控制台窗口（例如此前由其它方式拉起、或旧版本遗留）。
#[cfg(windows)]
pub fn cleanup_windows_gateway_console_titles() {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    for title in ["openclaw-gateway", "OpenClaw Gateway"] {
        let _ = Command::new("cmd")
            .args([
                "/c",
                "taskkill",
                "/f",
                "/t",
                "/fi",
                &format!("WINDOWTITLE eq {title}"),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
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

/// 升级前先停止 Gateway，避免 Windows 上 npm 覆盖全局 openclaw 包时被运行中的进程锁文件。
pub fn stop_open_claw_gateway_service(app: &tauri::AppHandle) -> Value {
    let managed_stopped = kill_managed_gateway_process();

    let exe = match resolve_configured_openclaw_executable(app) {
        Ok(Some(exe)) => exe,
        Ok(None) => {
            return json!({
                "ok": managed_stopped,
                "error": if managed_stopped {
                    Value::Null
                } else {
                    json!("未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。")
                }
            });
        }
        Err(e) => {
            return json!({
                "ok": managed_stopped,
                "error": if managed_stopped { Value::Null } else { json!(e) }
            });
        }
    };

    let output = Command::new(exe.trim())
        .arg("gateway")
        .arg("stop")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    let output = match output {
        Ok(o) => o,
        Err(e) => {
            if managed_stopped {
                return json!({ "ok": true });
            }
            return json!({
                "ok": false,
                "error": format!("执行 openclaw gateway stop 失败：{e}")
            });
        }
    };

    if output.status.success() {
        return json!({ "ok": true });
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = [stderr.as_str(), stdout.as_str()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");

    if managed_stopped || gateway_stop_output_looks_safe(&detail) {
        return json!({ "ok": true });
    }

    let detail = if detail.is_empty() {
        output
            .status
            .code()
            .map(|c| format!("退出码 {c}"))
            .unwrap_or_else(|| "进程异常退出".into())
    } else {
        detail
    };
    json!({
        "ok": false,
        "error": format!("停止 Gateway 失败：{detail}")
    })
}

// NOTE: run_openclaw_gateway_restart_captured 已删除——Windows 下 openclaw gateway restart
// 内部发送 SIGUSR1（Unix 专有信号）会导致 ERR_UNKNOWN_SIGNAL；改为 kill+spawn 直接重启。
// 保留此注释说明删除原因，避免误以为忘记实现。
#[cfg(any())] // 永不编译的占位块，使下方代码不可达
fn run_openclaw_gateway_restart_captured_deleted(exe: &str) -> io::Result<std::process::Output> {
    use base64::{engine::general_purpose, Engine as _};
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let exe = exe.trim();
    let lower = exe.to_ascii_lowercase();
    if lower.ends_with(".exe") && std::path::Path::new(exe).is_file() {
        return Command::new(exe)
            .args(["gateway", "restart"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .creation_flags(CREATE_NO_WINDOW)
            .output();
    }

    let b64 = general_purpose::STANDARD.encode(exe.as_bytes());
    let script = format!(
        concat!(
            "$ErrorActionPreference='Stop';",
            "$exe=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{b64}'));",
            "$q=[string][char]34;",
            "$safe=$exe.Replace($q,$q+$q);",
            "$argsLine='/c '+$q+$safe+$q+' gateway restart';",
            "$psi=New-Object System.Diagnostics.ProcessStartInfo;",
            "$psi.FileName='cmd.exe';$psi.Arguments=$argsLine;",
            "$psi.UseShellExecute=$false;",
            "$psi.RedirectStandardOutput=$true;",
            "$psi.RedirectStandardError=$true;",
            "$psi.CreateNoWindow=$true;",
            "$p=[System.Diagnostics.Process]::Start($psi);",
            "$out=$p.StandardOutput.ReadToEnd();$err=$p.StandardError.ReadToEnd();",
            "$p.WaitForExit()|Out-Null;",
            "[Console]::Out.Write($out);[Console]::Error.Write($err);",
            "exit $p.ExitCode",
        ),
        b64 = b64
    );

    let path_env = windows_enhanced_path();
    let ps = windows_powershell_exe();
    let ps_prog = if ps.is_file() {
        ps
    } else {
        PathBuf::from("powershell.exe")
    };
    Command::new(&ps_prog)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .env("PATH", &path_env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW)
        .output()
}

#[cfg(windows)]
fn windows_cmd_inner_line_for_openclaw(exe: &str, forward_args: &[&str]) -> String {
    fn quote_if_needed(s: &str) -> String {
        let needs = s.chars().any(|c| {
            c.is_whitespace() || matches!(c, '&' | '(' | ')' | '^' | '%')
        });
        if needs {
            format!("\"{}\"", s.replace('\"', "\\\""))
        } else {
            s.to_string()
        }
    }
    let mut line = quote_if_needed(exe.trim());
    for a in forward_args {
        line.push(' ');
        line.push_str(&quote_if_needed(a));
    }
    line
}

/// 运行已解析的 `openclaw` 可执行文件并捕获输出（与 `plugins install` 相同的 Windows 启动策略）。
pub fn run_open_claw_cli_captured(
    exe: &str,
    forward_args: &[&str],
    extra_env: &[(String, String)],
) -> io::Result<std::process::Output> {
    #[cfg(windows)]
    {
        use base64::{engine::general_purpose, Engine as _};
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let exe = exe.trim();
        let lower = exe.to_ascii_lowercase();
        let path_env = windows_enhanced_path();

        if lower.ends_with(".exe") && Path::new(exe).is_file() {
            let mut c = Command::new(exe);
            c.args(forward_args)
                .env("PATH", &path_env)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .creation_flags(CREATE_NO_WINDOW);
            apply_extra_env(&mut c, extra_env);
            return c.output();
        }

        if let Some(mjs) = openclaw_entry_mjs_next_to_npm_shim(exe) {
            if let Some(node) = resolve_node_exe_windows() {
                let pkg_root = mjs
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| mjs.clone());
                let mut c = Command::new(node);
                c.arg(&mjs)
                    .args(forward_args)
                    .env("PATH", &path_env)
                    .current_dir(pkg_root)
                    .stdin(Stdio::null())
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .creation_flags(CREATE_NO_WINDOW);
                apply_extra_env(&mut c, extra_env);
                return c.output();
            }
        }

        let inner = windows_cmd_inner_line_for_openclaw(exe, forward_args);
        let inner_b64 = general_purpose::STANDARD.encode(inner.as_bytes());
        let script = format!(
            concat!(
                "$ErrorActionPreference='Stop';",
                "$inner=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('{inner_b64}'));",
                "$argsLine='/c '+$inner;",
                "$psi=New-Object System.Diagnostics.ProcessStartInfo;",
                "$psi.FileName='cmd.exe';$psi.Arguments=$argsLine;",
                "$psi.UseShellExecute=$false;",
                "$psi.RedirectStandardOutput=$true;",
                "$psi.RedirectStandardError=$true;",
                "$psi.CreateNoWindow=$true;",
                "$p=[System.Diagnostics.Process]::Start($psi);",
                "$out=$p.StandardOutput.ReadToEnd();$err=$p.StandardError.ReadToEnd();",
                "$p.WaitForExit()|Out-Null;",
                "[Console]::Out.Write($out);[Console]::Error.Write($err);",
                "exit $p.ExitCode",
            ),
            inner_b64 = inner_b64
        );

        let ps = windows_powershell_exe();
        let ps_prog = if ps.is_file() {
            ps
        } else {
            PathBuf::from("powershell.exe")
        };
        let mut c = Command::new(&ps_prog);
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            &script,
        ])
        .env("PATH", &path_env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .creation_flags(CREATE_NO_WINDOW);
        apply_extra_env(&mut c, extra_env);
        c.output()
    }
    #[cfg(not(windows))]
    {
        let mut c = Command::new(exe.trim());
        c.args(forward_args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        apply_extra_env(&mut c, extra_env);
        c.output()
    }
}

fn truncate_error_text(s: &str, max_chars: usize) -> String {
    let trimmed = s.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    trimmed.chars().take(max_chars).collect::<String>() + "…"
}

fn parse_json_value_from_cli_output(label: &str, stdout: &str, stderr: &str) -> Result<Value, String> {
    let candidates = [
        stdout.trim().to_string(),
        stderr.trim().to_string(),
        format!("{}\n{}", stdout.trim(), stderr.trim()).trim().to_string(),
    ];

    for text in &candidates {
        if text.is_empty() {
            continue;
        }
        if let Ok(v) = serde_json::from_str::<Value>(text) {
            return Ok(v);
        }
        let trimmed = text.trim();
        let open = trimmed
            .char_indices()
            .find(|(_, ch)| *ch == '{' || *ch == '[')
            .map(|(idx, ch)| (idx, ch));
        let Some((start_idx, open_ch)) = open else {
            continue;
        };
        let close_ch = if open_ch == '{' { '}' } else { ']' };
        let mut end_indices: Vec<usize> = trimmed
            .char_indices()
            .filter_map(|(idx, ch)| if ch == close_ch { Some(idx) } else { None })
            .collect();
        end_indices.reverse();
        for end_idx in end_indices.into_iter().take(64) {
            if end_idx < start_idx {
                continue;
            }
            let slice = &trimmed[start_idx..=end_idx];
            if let Ok(v) = serde_json::from_str::<Value>(slice) {
                return Ok(v);
            }
        }
    }

    let detail = [stderr.trim(), stdout.trim()]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if detail.is_empty() {
        return Err(format!("{label} 未返回 JSON 输出"));
    }
    Err(format!(
        "{label} JSON 解析失败：{}",
        truncate_error_text(&detail, 400)
    ))
}

fn run_openclaw_plugins_install_captured(
    exe: &str,
    spec: &str,
    extra_env: &[(String, String)],
) -> io::Result<std::process::Output> {
    run_open_claw_cli_captured(exe, &["plugins", "install", spec.trim()], extra_env)
}

pub fn pick_plugin_package_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Plugin package", &["tgz", "tar", "gz", "zip"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

fn spawn_openclaw_gateway(exe: &str) -> Result<Child, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let exe = exe.trim();
        let lower = exe.to_ascii_lowercase();
        let path_env = windows_enhanced_path();

        // 日志文件不可写时勿用 stderr 管道：个别环境下 node 仍会为管道分配可见控制台；双 null 则牺牲首包错误摘要。
        let (stdout, stderr) = match open_didclaw_gateway_stdio_log_files() {
            Ok((out, err)) => (Stdio::from(out), Stdio::from(err)),
            Err(_) => (Stdio::null(), Stdio::null()),
        };

        // 真实 .exe：直接子进程 + CREATE_NO_WINDOW，无 cmd 中转。
        if lower.ends_with(".exe") && Path::new(exe).is_file() {
            return Command::new(exe)
                .arg("gateway")
                .env("PATH", &path_env)
                .stdin(Stdio::null())
                .stdout(stdout)
                .stderr(stderr)
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| e.to_string());
        }

        // npm 垫片：`cmd /c *.cmd` 时 CREATE_NO_WINDOW 盖不住内层 node 的新控制台；改为 node openclaw.mjs gateway。
        if let Some(mjs) = openclaw_entry_mjs_next_to_npm_shim(exe) {
            if let Some(node) = resolve_node_exe_windows() {
                let pkg_root = mjs
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(|| mjs.clone());
                return Command::new(node)
                    .arg(&mjs)
                    .arg("gateway")
                    .env("PATH", &path_env)
                    .stdin(Stdio::null())
                    .stdout(stdout)
                    .stderr(stderr)
                    .current_dir(pkg_root)
                    .creation_flags(CREATE_NO_WINDOW)
                    .spawn()
                    .map_err(|e| e.to_string());
            }
        }

        // 兜底：仍走 cmd（pnpm 等非标准布局时可能只有垫片可用）。
        Command::new("cmd")
            .arg("/C")
            .arg(exe)
            .arg("gateway")
            .env("PATH", &path_env)
            .stdin(Stdio::null())
            .stdout(stdout)
            .stderr(stderr)
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

/// 重启 Gateway。
/// - Windows：`openclaw gateway restart` 内部发送 SIGUSR1（Unix 专有信号），Windows 不支持。
///   改为直接 kill 当前托管进程 + 再 spawn 一个新进程，等同于"停 + 启"。
/// - 非 Windows：调用 `openclaw gateway restart`（systemd / launchd 服务重启）。
pub fn restart_open_claw_gateway_service(app: &tauri::AppHandle) -> Value {
    kill_managed_gateway_process();

    let exe = match resolve_configured_openclaw_executable(app) {
        Ok(Some(exe)) => exe,
        Ok(None) => {
            return json!({
                "ok": false,
                "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
            });
        }
        Err(e) => {
            return json!({ "ok": false, "error": e });
        }
    };

    // Windows：直接 kill + spawn，避免触发 SIGUSR1 导致 ERR_UNKNOWN_SIGNAL
    #[cfg(windows)]
    {
        match spawn_openclaw_gateway(&exe) {
            Ok(child) => {
                {
                    let mut g = MANAGED_CHILD.lock().expect("MANAGED_CHILD mutex poisoned");
                    if let Some(mut old) = g.take() {
                        let _ = old.kill();
                        let _ = old.wait();
                    }
                    *g = Some(child);
                }
                // 给进程 2 秒启动时间，再由前端重连
                std::thread::sleep(std::time::Duration::from_millis(2000));
                return json!({ "ok": true });
            }
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("重启 Gateway 失败（spawn）：{e}")
                });
            }
        }
    }

    // 非 Windows：走 `openclaw gateway restart`（systemd / launchd）
    #[cfg(not(windows))]
    {
        let output = Command::new(exe.trim())
            .arg("gateway")
            .arg("restart")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output();

        let output = match output {
            Ok(o) => o,
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("执行 openclaw gateway restart 失败：{e}")
                });
            }
        };

        if output.status.success() {
            return json!({ "ok": true });
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let mut detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if detail.is_empty() {
            detail = output
                .status
                .code()
                .map(|c| format!("退出码 {c}"))
                .unwrap_or_else(|| "进程异常退出".into());
        }
        json!({
            "ok": false,
            "error": format!("网关服务重启失败：{detail}")
        })
    }
}

/// 调用 `openclaw plugins install <package_spec>`（如 `clawhub:@scope/name`），与官方 CLI 一致。
pub fn run_open_claw_plugins_install_service(
    app: &tauri::AppHandle,
    package_spec: String,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Value {
    let spec = package_spec.trim();
    if spec.is_empty() {
        return json!({
            "ok": false,
            "error": "package_spec 为空"
        });
    }

    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => {
            return json!({ "ok": false, "error": e });
        }
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };

    let extra_env = build_clawhub_env(
        clawhub_token.as_deref(),
        clawhub_registry.as_deref(),
    );

    const MAX_ATTEMPTS: usize = 4;

    for attempt in 0..MAX_ATTEMPTS {
        let output = match run_openclaw_plugins_install_captured(&exe, spec, &extra_env) {
            Ok(o) => o,
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("执行 openclaw plugins install 失败：{e}")
                });
            }
        };

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if output.status.success() {
            return json!({
                "ok": true,
                "stdout": stdout,
                "stderr": stderr
            });
        }

        let combined = format!("{stdout}\n{stderr}");
        let retryable = output_text_looks_like_clawhub_rate_limit(&combined);

        if retryable && attempt + 1 < MAX_ATTEMPTS {
            let wait = rate_limit_backoff_seconds(&combined, attempt);
            std::thread::sleep(Duration::from_secs(wait));
            continue;
        }

        let mut detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if detail.is_empty() {
            detail = output
                .status
                .code()
                .map(|c| format!("退出码 {c}"))
                .unwrap_or_else(|| "进程异常退出".into());
        }
        let mut err_msg = format!("openclaw plugins install 失败：{detail}");
        if output_text_looks_like_clawhub_rate_limit(&combined) {
            err_msg.push_str(
                " 提示：ClawHub 对匿名请求限流较严，可先在终端执行 clawhub login，或稍后重试。",
            );
        }
        return json!({
            "ok": false,
            "error": err_msg,
            "stdout": stdout,
            "stderr": stderr
        });
    }

    unreachable!("openclaw plugins install: 每次循环均 return")
}

pub fn search_open_claw_skills_service(
    app: &tauri::AppHandle,
    query: &str,
    limit: Option<u32>,
    clawhub_token: Option<&str>,
    clawhub_registry: Option<&str>,
) -> Value {
    let q = query.trim();
    if q.is_empty() {
        return json!({ "results": [] });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };

    let mut args = vec![
        "--no-color".to_string(),
        "skills".to_string(),
        "search".to_string(),
        q.to_string(),
        "--json".to_string(),
    ];
    if let Some(limit) = limit.filter(|n| *n > 0) {
        args.push("--limit".to_string());
        args.push(limit.min(100).to_string());
    }
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let extra_env = build_clawhub_env(clawhub_token, clawhub_registry);
    let out = match run_open_claw_cli_captured(&exe, &arg_refs, &extra_env) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw skills search 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw skills search 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw skills search 失败：{detail}")
            }
        });
    }
    match parse_json_value_from_cli_output("skills search", &stdout, &stderr) {
        Ok(v) => v,
        Err(e) => json!({
            "ok": false,
            "error": e
        }),
    }
}

pub fn install_open_claw_skill_service(
    app: &tauri::AppHandle,
    skill_slug: &str,
    version: Option<&str>,
    clawhub_token: Option<&str>,
    clawhub_registry: Option<&str>,
) -> Value {
    let slug = skill_slug.trim();
    if slug.is_empty() {
        return json!({ "ok": false, "error": "skill slug 不能为空" });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };

    let mut args = vec![
        "--no-color".to_string(),
        "skills".to_string(),
        "install".to_string(),
        slug.to_string(),
    ];
    if let Some(version) = version.map(str::trim).filter(|s| !s.is_empty()) {
        args.push("--version".to_string());
        args.push(version.to_string());
    }
    let arg_refs = args.iter().map(String::as_str).collect::<Vec<_>>();
    let extra_env = build_clawhub_env(clawhub_token, clawhub_registry);
    let out = match run_open_claw_cli_captured(&exe, &arg_refs, &extra_env) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw skills install 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw skills install 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw skills install 失败：{detail}")
            },
            "stdout": stdout,
            "stderr": stderr,
        });
    }
    json!({
        "ok": true,
        "stdout": stdout,
        "stderr": stderr,
    })
}

pub fn update_open_claw_skill_service(
    app: &tauri::AppHandle,
    skill_name: &str,
    clawhub_token: Option<&str>,
    clawhub_registry: Option<&str>,
) -> Value {
    let name = skill_name.trim();
    if name.is_empty() {
        return json!({ "ok": false, "error": "skill name 不能为空" });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };
    let extra_env = build_clawhub_env(clawhub_token, clawhub_registry);
    let out = match run_open_claw_cli_captured(
        &exe,
        &["--no-color", "skills", "update", name],
        &extra_env,
    ) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw skills update 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw skills update 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw skills update 失败：{detail}")
            },
            "stdout": stdout,
            "stderr": stderr,
        });
    }
    json!({
        "ok": true,
        "stdout": stdout,
        "stderr": stderr,
    })
}

pub fn list_open_claw_plugins_service(
    app: &tauri::AppHandle,
    enabled_only: bool,
) -> Value {
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };

    let mut args: Vec<&str> = vec!["--no-color", "plugins", "list", "--json"];
    if enabled_only {
        args.push("--enabled");
    }
    let out = match run_open_claw_cli_captured(&exe, &args, &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw plugins list 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw plugins list 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw plugins list 失败：{detail}")
            }
        });
    }
    match parse_json_value_from_cli_output("plugins list", &stdout, &stderr) {
        Ok(v) => v,
        Err(e) => json!({
            "ok": false,
            "error": e
        }),
    }
}

pub fn inspect_open_claw_plugin_service(app: &tauri::AppHandle, plugin_id: &str) -> Value {
    let id = plugin_id.trim();
    if id.is_empty() {
        return json!({ "ok": false, "error": "plugin id 不能为空" });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };
    let out = match run_open_claw_cli_captured(&exe, &["--no-color", "plugins", "inspect", id, "--json"], &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw plugins inspect 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw plugins inspect 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw plugins inspect 失败：{detail}")
            }
        });
    }
    match parse_json_value_from_cli_output("plugins inspect", &stdout, &stderr) {
        Ok(v) => v,
        Err(e) => json!({ "ok": false, "error": e }),
    }
}

pub fn set_open_claw_plugin_enabled_service(
    app: &tauri::AppHandle,
    plugin_id: &str,
    enabled: bool,
) -> Value {
    let id = plugin_id.trim();
    if id.is_empty() {
        return json!({ "ok": false, "error": "plugin id 不能为空" });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };
    let action = if enabled { "enable" } else { "disable" };
    let out = match run_open_claw_cli_captured(&exe, &["--no-color", "plugins", action, id], &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw plugins {action} 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw plugins {action} 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw plugins {action} 失败：{detail}")
            },
            "stdout": stdout,
            "stderr": stderr,
        });
    }
    json!({
        "ok": true,
        "stdout": stdout,
        "stderr": stderr,
    })
}

pub fn update_open_claw_plugin_service(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Value {
    let id = plugin_id.trim();
    if id.is_empty() {
        return json!({ "ok": false, "error": "plugin id 不能为空" });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };
    let out = match run_open_claw_cli_captured(&exe, &["--no-color", "plugins", "update", id], &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw plugins update 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw plugins update 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw plugins update 失败：{detail}")
            },
            "stdout": stdout,
            "stderr": stderr,
        });
    }
    json!({
        "ok": true,
        "stdout": stdout,
        "stderr": stderr,
    })
}

pub fn uninstall_open_claw_plugin_service(
    app: &tauri::AppHandle,
    plugin_id: &str,
) -> Value {
    let id = plugin_id.trim();
    if id.is_empty() {
        return json!({ "ok": false, "error": "plugin id 不能为空" });
    }
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };
    let out = match run_open_claw_cli_captured(
        &exe,
        &["--no-color", "plugins", "uninstall", id, "--force"],
        &[],
    ) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw plugins uninstall 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw plugins uninstall 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw plugins uninstall 失败：{detail}")
            },
            "stdout": stdout,
            "stderr": stderr,
        });
    }
    json!({
        "ok": true,
        "stdout": stdout,
        "stderr": stderr,
    })
}

pub fn list_open_claw_skills_service(
    app: &tauri::AppHandle,
    eligible_only: bool,
    verbose: bool,
) -> Value {
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };

    let mut args: Vec<&str> = vec!["--no-color", "skills", "list", "--json"];
    if eligible_only {
        args.push("--eligible");
    }
    if verbose {
        args.push("--verbose");
    }
    let out = match run_open_claw_cli_captured(&exe, &args, &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw skills list 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw skills list 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw skills list 失败：{detail}")
            }
        });
    }
    match parse_json_value_from_cli_output("skills list", &stdout, &stderr) {
        Ok(v) => v,
        Err(e) => json!({
            "ok": false,
            "error": e
        }),
    }
}

pub fn check_open_claw_skills_service(app: &tauri::AppHandle) -> Value {
    let merged = match crate::gateway_local::read_merged_map(app) {
        Ok(m) => m,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let exe_opt = merged
        .get("openclawExecutable")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let Some(exe) = resolve_open_claw_executable(exe_opt) else {
        return json!({
            "ok": false,
            "error": "未找到 openclaw。请先安装或在「本机设置 → 连助手」填写 openclaw.cmd 完整路径。"
        });
    };

    let out = match run_open_claw_cli_captured(&exe, &["--no-color", "skills", "check", "--json"], &[]) {
        Ok(o) => o,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("执行 openclaw skills check 失败：{e}")
            });
        }
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !out.status.success() {
        let detail = [stderr.as_str(), stdout.as_str()]
            .into_iter()
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        return json!({
            "ok": false,
            "error": if detail.is_empty() {
                format!("openclaw skills check 失败（退出码 {}）", out.status.code().unwrap_or(-1))
            } else {
                format!("openclaw skills check 失败：{detail}")
            }
        });
    }
    match parse_json_value_from_cli_output("skills check", &stdout, &stderr) {
        Ok(v) => v,
        Err(e) => json!({
            "ok": false,
            "error": e
        }),
    }
}

pub async fn ensure_open_claw_gateway_running(
    app: tauri::AppHandle,
    ws_url: String,
) -> Result<Value, String> {
    let _guard = ensure_mutex().lock().await;

    let _ = crate::openclaw_gateway_origins::ensure_didclaw_desktop_allowed_origins();

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
        let mut g = MANAGED_CHILD.lock().expect("MANAGED_CHILD mutex poisoned");
        if let Some(mut old) = g.take() {
            let _ = old.kill();
            let _ = old.wait();
        }
        *g = Some(child);
    }

    tokio::time::sleep(Duration::from_millis(1200)).await;
    {
        let mut g = MANAGED_CHILD.lock().expect("MANAGED_CHILD mutex poisoned");
        if let Some(ref mut c) = *g {
            match c.try_wait() {
                Ok(Some(status)) => {
                    let mut stderr_tail = read_child_stderr_abbrev(c, 8192);
                    #[cfg(windows)]
                    if stderr_tail.is_empty() {
                        stderr_tail = read_didclaw_gateway_err_log_tail(8192);
                    }
                    drop(g);
                    kill_managed_gateway_process();
                    let code = status
                        .code()
                        .map(|c| c.to_string())
                        .unwrap_or_else(|| "非零/信号".into());
                    let detail = if stderr_tail.is_empty() {
                        #[cfg(windows)]
                        {
                            "启动失败且暂无错误摘要；可打开用户文件夹\\.openclaw\\logs\\didclaw-gateway.err.log 查看，或在终端执行「openclaw gateway」。".to_string()
                        }
                        #[cfg(not(windows))]
                        {
                            "未捕获到子进程错误输出；请在终端手动执行「openclaw gateway」查看完整日志。".to_string()
                        }
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

    // 端口刚 listen 时，进程内 WS 升级与 connect.challenge 仍可能滞后（冷启加载扩展更明显）；650ms 常不够，表现为首连很久或失败、断开后重连却秒好。
    tokio::time::sleep(Duration::from_millis(2000)).await;

    Ok(json!({"ok": true, "started": true}))
}

/// 执行 `openclaw doctor [--repair] --non-interactive`，返回原始输出供前端解析。
pub fn run_openclaw_doctor_impl(repair: bool, custom_executable: Option<&str>) -> Result<Value, String> {
    let exe = resolve_open_claw_executable(custom_executable)
        .ok_or_else(|| "找不到 openclaw 可执行文件，请先完成安装向导。".to_string())?;

    let mut args: Vec<&str> = vec!["doctor", "--non-interactive"];
    if repair {
        args.push("--repair");
    }

    let out = run_open_claw_cli_captured(&exe, &args, &[])
        .map_err(|e| format!("启动 openclaw doctor 失败：{e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let code = out.status.code().unwrap_or(-1);
    let ok = out.status.success();

    Ok(json!({
        "ok": ok,
        "exitCode": code,
        "stdout": stdout,
        "stderr": stderr,
    }))
}
