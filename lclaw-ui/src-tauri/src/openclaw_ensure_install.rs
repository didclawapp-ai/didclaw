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
    use tokio::io::{AsyncBufReadExt, BufReader};

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let script = resolve_ensure_script_path(&app)?;
    let script_str = script.to_str().ok_or_else(|| "脚本路径含非 UTF-8 字符".to_string())?;

    let mut cmd = tokio::process::Command::new("powershell.exe");
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
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.creation_flags(CREATE_NO_WINDOW);

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

    let out_fut = async move {
        let mut reader = BufReader::new(stdout).lines();
        loop {
            match reader.next_line().await {
                Ok(None) => break,
                Ok(Some(line)) => {
                    col_o
                        .lock()
                        .unwrap()
                        .push(format!("[stdout] {line}"));
                    let _ = app_o.emit(
                        ENSURE_INSTALL_LOG_EVENT,
                        json!({ "stream": "stdout", "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
    };

    let err_fut = async move {
        let mut reader = BufReader::new(stderr).lines();
        loop {
            match reader.next_line().await {
                Ok(None) => break,
                Ok(Some(line)) => {
                    col_e
                        .lock()
                        .unwrap()
                        .push(format!("[stderr] {line}"));
                    let _ = app_e.emit(
                        ENSURE_INSTALL_LOG_EVENT,
                        json!({ "stream": "stderr", "line": line }),
                    );
                }
                Err(_) => break,
            }
        }
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
