//! Windows：子进程执行仓库 `ensure-openclaw-windows.ps1`（官方 install.ps1 + 可选非交互 onboard）。

use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
#[cfg(windows)]
use std::process::{Command, Stdio};
use tauri::path::BaseDirectory;
use tauri::AppHandle;
use tauri::Manager;

const LOG_CAP: usize = 120_000;

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
        let dev = fs::canonicalize(&dev).map_err(|_| {
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
pub fn run_ensure_openclaw_windows_install_impl(
    app: &AppHandle,
    skip_onboard: bool,
) -> Result<Value, String> {
    #[cfg(not(windows))]
    {
        let _ = (app, skip_onboard);
        return Ok(json!({
            "ok": false,
            "exitCode": -1,
            "log": "",
            "error": "当前平台不支持：ensure-openclaw 仅提供 Windows 版 PowerShell 脚本。"
        }));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;

        let script = resolve_ensure_script_path(app)?;
        let script_str = script.to_str().ok_or("脚本路径含非 UTF-8 字符")?;

        let mut cmd = Command::new("powershell.exe");
        cmd.args([
            "-NoProfile",
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

        let out = cmd
            .output()
            .map_err(|e| format!("无法启动 PowerShell：{e}"))?;

        let code = out.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
        let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
        let mut log = format!("--- stdout ---\n{stdout}\n--- stderr ---\n{stderr}");
        if log.len() > LOG_CAP {
            log.truncate(LOG_CAP);
            log.push_str("\n... [输出已截断]");
        }

        let ok = out.status.success();
        Ok(json!({
            "ok": ok,
            "exitCode": code,
            "log": log,
            "error": if ok { Value::Null } else { json!(format!("进程退出码 {code}")) }
        }))
    }
}
