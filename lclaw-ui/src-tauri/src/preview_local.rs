//! 与 `electron/main.ts` 中 `preview:openLocal`、`preview:libreOfficeStatus`、`preview:showLibreOfficeInstallDialog` 对齐。

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::{json, Value};
use std::ffi::OsStr;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;
use tempfile::TempDir;

const MAX_TEXT_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;
const LIBREOFFICE_DOWNLOAD: &str = "https://www.libreoffice.org/download/download-libreoffice/";

fn extension_lower(path: &Path) -> String {
    path
        .extension()
        .and_then(OsStr::to_str)
        .unwrap_or("")
        .to_lowercase()
}

fn is_image_ext(ext: &str) -> bool {
    matches!(
        ext,
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "bmp" | "ico"
    )
}

fn is_pdf_ext(ext: &str) -> bool {
    ext == "pdf"
}

fn is_text_preview_ext(ext: &str) -> bool {
    matches!(
        ext,
        "txt" | "text" | "log" | "csv" | "md" | "markdown" | "mdown" | "mkd"
    )
}

fn is_office_ext(ext: &str) -> bool {
    matches!(ext, "doc" | "docx" | "xls" | "xlsx" | "ppt" | "pptx")
}

fn mime_for_image_or_pdf(ext: &str) -> &'static str {
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn text_display_kind(ext: &str) -> &'static str {
    if matches!(ext, "md" | "markdown" | "mdown" | "mkd") {
        "markdown"
    } else {
        "text"
    }
}

fn try_soffice_on_path(cmd: &str) -> bool {
    let mut c = Command::new(cmd);
    c.arg("--version");
    c.stdin(Stdio::null());
    c.stdout(Stdio::null());
    c.stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        c.creation_flags(CREATE_NO_WINDOW);
    }
    c.status().map(|s| s.success()).unwrap_or(false)
}

fn find_soffice_executable() -> Option<String> {
    if let Ok(env_path) = std::env::var("LIBREOFFICE_PATH") {
        let t = env_path.trim();
        if !t.is_empty() && Path::new(t).exists() {
            return Some(t.to_string());
        }
    }

    #[cfg(windows)]
    {
        let candidates = [
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ];
        for c in candidates {
            if Path::new(c).is_file() {
                return Some(c.to_string());
            }
        }
    }

    for name in ["soffice", "libreoffice"] {
        if try_soffice_on_path(name) {
            return Some(name.to_string());
        }
    }
    None
}

pub fn libre_office_available() -> bool {
    find_soffice_executable().is_some()
}

fn run_command_with_timeout(mut cmd: Command, timeout: Duration) -> Result<std::process::ExitStatus, String> {
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Ok(status),
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("LibreOffice 转换超时".into());
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

fn convert_office_to_pdf_bytes(source_path: &Path) -> Result<Vec<u8>, String> {
    let soffice = find_soffice_executable().ok_or_else(|| {
        "未找到 LibreOffice。请安装 LibreOffice，或设置环境变量 LIBREOFFICE_PATH 指向 soffice.exe"
            .to_string()
    })?;

    let dir = TempDir::new().map_err(|e| e.to_string())?;
    let ext = source_path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let temp_input = dir.path().join(format!("source.{ext}"));
    fs::copy(source_path, &temp_input).map_err(|e| e.to_string())?;

    let mut cmd = Command::new(&soffice);
    cmd.args([
        "--headless",
        "--norestore",
        "--nologo",
        "--convert-to",
        "pdf",
        "--outdir",
    ]);
    cmd.arg(dir.path());
    cmd.arg(&temp_input);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::null());
    cmd.stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    let status = run_command_with_timeout(cmd, Duration::from_secs(180))?;
    if !status.success() {
        return Err(format!(
            "LibreOffice 转换失败（退出码 {:?}）",
            status.code()
        ));
    }

    let stem = temp_input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("source");
    let pdf_path = dir.path().join(format!("{stem}.pdf"));
    fs::read(&pdf_path).map_err(|e| e.to_string())
}

pub async fn open_local_preview(file_url: String) -> Value {
    let p = match crate::paths::resolve_existing_local_file(&file_url) {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };

    let ext = extension_lower(&p);

    if is_image_ext(&ext) || is_pdf_ext(&ext) {
        match tokio::fs::read(&p).await {
            Ok(buf) => {
                let mime = mime_for_image_or_pdf(ext.as_str());
                let display_kind = if is_pdf_ext(&ext) { "pdf" } else { "image" };
                return json!({
                    "ok": true,
                    "mimeType": mime,
                    "base64": STANDARD.encode(&buf),
                    "displayKind": display_kind,
                });
            }
            Err(e) => return json!({ "ok": false, "error": e.to_string() }),
        }
    }

    if is_text_preview_ext(&ext) {
        let meta = match tokio::fs::metadata(&p).await {
            Ok(m) => m,
            Err(e) => return json!({ "ok": false, "error": e.to_string() }),
        };
        if meta.len() > MAX_TEXT_PREVIEW_BYTES {
            return json!({
                "ok": false,
                "error": format!(
                    "文本文件过大（>{}MB），请使用外部编辑器打开",
                    MAX_TEXT_PREVIEW_BYTES / 1024 / 1024
                ),
            });
        }
        match tokio::fs::read(&p).await {
            Ok(buf) => {
                let dk = text_display_kind(ext.as_str());
                let mime = if dk == "markdown" {
                    "text/markdown;charset=utf-8"
                } else {
                    "text/plain;charset=utf-8"
                };
                return json!({
                    "ok": true,
                    "mimeType": mime,
                    "base64": STANDARD.encode(&buf),
                    "displayKind": dk,
                });
            }
            Err(e) => return json!({ "ok": false, "error": e.to_string() }),
        }
    }

    if is_office_ext(&ext) {
        let path_clone = p.clone();
        let pdf_result =
            tokio::task::spawn_blocking(move || convert_office_to_pdf_bytes(&path_clone)).await;
        match pdf_result {
            Ok(Ok(pdf)) => {
                return json!({
                    "ok": true,
                    "mimeType": "application/pdf",
                    "base64": STANDARD.encode(&pdf),
                    "displayKind": "pdf",
                });
            }
            Ok(Err(e)) => return json!({ "ok": false, "error": e }),
            Err(e) => return json!({ "ok": false, "error": e.to_string() }),
        }
    }

    json!({"ok": false, "error": "不支持的文件类型（图片、PDF、Office、Markdown、纯文本）"})
}

pub fn show_libre_office_install_dialog() -> Value {
    let res = MessageDialog::new()
        .set_level(MessageLevel::Info)
        .set_title("需要 LibreOffice")
        .set_description(
            "在应用内预览 Word / Excel / PowerPoint 需本机安装 LibreOffice（免费开源）。\n\n\
             点击「打开下载页」将在浏览器中打开官网。安装后若仍无法预览，请重启本应用或设置环境变量 LIBREOFFICE_PATH 指向 soffice.exe。\n\n\
             若已安装 Microsoft Office 或 WPS，可使用「用系统应用打开」，无需 LibreOffice。",
        )
        .set_buttons(MessageButtons::OkCancelCustom(
            "打开下载页".into(),
            "稍后".into(),
        ))
        .show();
    let opened = res == MessageDialogResult::Ok;
    if opened {
        let _ = open::that(LIBREOFFICE_DOWNLOAD);
    }
    json!({ "openedDownload": opened })
}
