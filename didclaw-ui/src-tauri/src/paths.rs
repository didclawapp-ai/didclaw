//! `file:` URL 与本地路径解析，供预览、系统打开等命令共用。

use std::fs;
use std::path::PathBuf;

pub fn file_url_to_path(file_url: &str) -> Result<PathBuf, String> {
    let u = url::Url::parse(file_url.trim()).map_err(|_| "无效的 URL".to_string())?;
    if u.scheme() != "file" {
        return Err("非 file URL".into());
    }
    u.to_file_path()
        .map_err(|_| "无法解析为本地路径".into())
}

/// 与 Electron `resolveExistingFilePath` 一致：存在且为普通文件。
pub fn resolve_existing_local_file(file_url: &str) -> Result<PathBuf, String> {
    let p = file_url_to_path(file_url)?;
    let meta = fs::metadata(&p).map_err(|_| "路径不存在或不是文件".to_string())?;
    if !meta.is_file() {
        return Err("路径不存在或不是文件".into());
    }
    Ok(p)
}
