//! Windows：子进程执行仓库 `ensure-openclaw-windows.ps1`（官方 install.ps1 + 可选非交互 onboard）。

use serde_json::{json, Value};
use std::path::PathBuf;
#[cfg(windows)]
use std::process::Stdio;
use tauri::path::BaseDirectory;
use tauri::AppHandle;
use tauri::Manager;

const LOG_CAP: usize = 120_000;

/// 前端 `listen` 此事件以流式追加安装日志（payload: `{ stream, line }`）。
#[cfg(windows)]
pub const ENSURE_INSTALL_LOG_EVENT: &str = "didclaw-ensure-install-log";

/// 安装流程阶段（payload: `{ key: string, detail?: string }`），在首行脚本输出前即可提示「环境已就绪」。
#[cfg(windows)]
pub const ENSURE_INSTALL_PHASE_EVENT: &str = "didclaw-ensure-install-phase";

#[cfg(windows)]
fn resolve_ensure_script_path(app: &AppHandle) -> Result<PathBuf, String> {
    let res = app
        .path()
        .resolve("scripts/ensure-openclaw-windows.ps1", BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if res.is_file() {
        return Ok(res);
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../scripts/ensure-openclaw-windows.ps1");
        let dev = std::fs::canonicalize(&dev).map_err(|_| {
            format!(
                "开发模式下未找到脚本（期望 {}）",
                dev.display()
            )
        })?;
        if dev.is_file() {
            return Ok(dev);
        }
    }
    Err(format!(
        "未找到 ensure-openclaw-windows.ps1（打包资源 scripts/ 下缺失）。已检查: {}",
        res.display()
    ))
}

/// `skip_onboard`: true 等价于 `-SkipOnboard`（只装 CLI）；false 时追加 `-OnboardAuthChoice skip -SkipHealth`，与 LCLaw 默认「先骨架、模型后进应用」一致。
#[cfg(not(windows))]
pub async fn run_ensure_openclaw_windows_install_impl(
    _app: AppHandle,
    skip_onboard: bool,
) -> Result<Value, String> {
    let _ = skip_onboard;
    Ok(json!({
        "ok": false,
        "exitCode": -1,
        "log": "",
        "error": "当前平台不支持：ensure-openclaw 仅提供 Windows 版 PowerShell 脚本。"
    }))
}

#[cfg(windows)]
pub async fn run_ensure_openclaw_windows_install_impl(
    app: AppHandle,
    skip_onboard: bool,
) -> Result<Value, String> {
    use std::sync::{Arc, Mutex};
    use tauri::Emitter;
    use tokio::io::BufReader;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let script = resolve_ensure_script_path(&app)?;
    let script_str = script.to_str().ok_or_else(|| "脚本路径含非 UTF-8 字符".to_string())?;

    // 桌面快捷方式启动的 GUI 常继承残缺 PATH，`powershell.exe` 无法解析；用 SystemRoot 下绝对路径并补全 PATH。
    let path_env = crate::openclaw_gateway::windows_enhanced_path();
    let ps = crate::openclaw_gateway::windows_powershell_exe();
    let program = if ps.is_file() {
        ps
    } else {
        PathBuf::from("powershell.exe")
    };

    let mut cmd = tokio::process::Command::new(&program);
    cmd.args([
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script_str,
    ]);
    if skip_onboard {
        cmd.arg("-SkipOnboard");
    } else {
        cmd.args(["-OnboardAuthChoice", "skip", "-SkipHealth"]);
    }
    cmd.env("PATH", &path_env);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.creation_flags(CREATE_NO_WINDOW);

    let _ = app.emit(
        ENSURE_INSTALL_PHASE_EVENT,
        json!({
            "key": "precheck_ok",
            "detail": "PowerShell 与安装脚本已就绪，正在启动…"
        }),
    );

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("无法启动 PowerShell：{e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "无法捕获 stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "无法捕获 stderr".to_string())?;

    let collector = Arc::new(Mutex::new(Vec::<String>::new()));

    let app_o = app.clone();
    let app_e = app.clone();
    let col_o = Arc::clone(&collector);
    let col_e = Arc::clone(&collector);

    /// 按行读取 AsyncRead 并通过回调处理每一行（容错 UTF-8：非法字节做 lossy 替换而非 break）。
    async fn read_lines_lossy<R: tokio::io::AsyncRead + Unpin>(
        reader: R,
        mut on_line: impl FnMut(String),
    ) {
        use tokio::io::AsyncReadExt;
        let mut buf_reader = BufReader::new(reader);
        let mut raw = Vec::new();
        let mut tmp = [0u8; 4096];
        loop {
            match buf_reader.read(&mut tmp).await {
                Ok(0) | Err(_) => {
                    // 冲刷剩余未换行内容
                    if !raw.is_empty() {
                        on_line(String::from_utf8_lossy(&raw).into_owned());
                    }
                    break;
                }
                Ok(n) => {
                    raw.extend_from_slice(&tmp[..n]);
                    while let Some(pos) = raw.iter().position(|&b| b == b'\n') {
                        let line_bytes = raw.drain(..=pos).collect::<Vec<u8>>();
                        let line = String::from_utf8_lossy(&line_bytes)
                            .trim_end_matches(['\r', '\n'])
                            .to_owned();
                        if !line.is_empty() {
                            on_line(line);
                        }
                    }
                }
            }
        }
    }

    let out_fut = async move {
        read_lines_lossy(stdout, |line| {
            col_o.lock().unwrap().push(format!("[stdout] {line}"));
            let _ = app_o.emit(
                ENSURE_INSTALL_LOG_EVENT,
                json!({ "stream": "stdout", "line": line }),
            );
        })
        .await;
    };

    let err_fut = async move {
        read_lines_lossy(stderr, |line| {
            col_e.lock().unwrap().push(format!("[stderr] {line}"));
            let _ = app_e.emit(
                ENSURE_INSTALL_LOG_EVENT,
                json!({ "stream": "stderr", "line": line }),
            );
        })
        .await;
    };

    let wait_fut = async move {
        child
            .wait()
            .await
            .map_err(|e| format!("等待子进程结束失败：{e}"))
    };

    let (_, _, status) = tokio::join!(out_fut, err_fut, wait_fut);

    let status = status?;
    let code = status.code().unwrap_or(-1);
    let lines = collector.lock().unwrap().join("\n");
    let mut log = format!("--- streamed ---\n{lines}");
    if log.len() > LOG_CAP {
        log.truncate(LOG_CAP);
        log.push_str("\n... [输出已截断]");
    }
    let ok = status.success();
    Ok(json!({
        "ok": ok,
        "exitCode": code,
        "log": log,
        "error": if ok { Value::Null } else { json!(format!("进程退出码 {code}")) }
    }))
}
