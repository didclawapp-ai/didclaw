//! 备份与恢复 `~/.openclaw/` 目录：打包为 zip、解压还原。
//! 排除大型不必要目录（logs/completions/agents/*/sessions）减小备份体积。

use crate::openclaw_common::{backup_timestamp, openclaw_dir};
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

/// 判断相对于 `.openclaw/` 根的路径是否应排除出备份。
fn should_exclude(rel: &Path) -> bool {
    let parts: Vec<String> = rel
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    let Some(first) = parts.first() else {
        return false;
    };
    // 顶层：日志、补全缓存（体积大、无需迁移）
    if matches!(first.as_str(), "logs" | "completions") {
        return true;
    }
    // agents/<id>/sessions/ 可能数百 MB 至数 GB
    if first == "agents" {
        if let Some(third) = parts.get(2) {
            if third == "sessions" {
                return true;
            }
        }
    }
    // workspace 下的 node_modules / .git
    if first == "workspace" {
        if let Some(second) = parts.get(1) {
            if matches!(second.as_str(), "node_modules" | ".git") {
                return true;
            }
        }
    }
    // 已有 didclaw 备份 zip（避免重复打包）
    let filename = rel
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    if filename.contains("didclaw-backup-") {
        return true;
    }
    false
}

/// 把相对路径转为 zip 内条目名（统一用 `/` 分隔）。
fn rel_to_zip_entry(rel: &Path) -> String {
    rel.components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

/// 递归收集需要备份的文件：`(绝对路径, zip 条目名)`。
fn collect_files(base: &Path) -> Result<Vec<(PathBuf, String)>, String> {
    let mut result = Vec::new();
    collect_files_rec(base, base, &mut result)?;
    Ok(result)
}

fn collect_files_rec(
    base: &Path,
    current: &Path,
    out: &mut Vec<(PathBuf, String)>,
) -> Result<(), String> {
    let entries = match fs::read_dir(current) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let rel = path.strip_prefix(base).map_err(|e| e.to_string())?;
        if should_exclude(rel) {
            continue;
        }
        if path.is_dir() {
            collect_files_rec(base, &path, out)?;
        } else if path.is_file() {
            let entry_name = rel_to_zip_entry(rel);
            out.push((path, entry_name));
        }
    }
    Ok(())
}

// ─── 公开命令实现 ────────────────────────────────────────────────────────────

/// 估算备份体积，不弹窗、不写文件。
pub fn estimate_backup_size() -> Value {
    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    if !dir.exists() {
        return json!({"ok": true, "bytes": 0, "fileCount": 0});
    }
    let files = match collect_files(&dir) {
        Ok(f) => f,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let total_bytes: u64 = files
        .iter()
        .filter_map(|(p, _)| fs::metadata(p).ok().map(|m| m.len()))
        .sum();
    json!({
        "ok": true,
        "bytes": total_bytes,
        "fileCount": files.len(),
    })
}

/// 弹出「另存为」对话框，将 `~/.openclaw/` 打包为 zip。
pub fn backup_openclaw_config() -> Value {
    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    if !dir.exists() {
        return json!({"ok": false, "error": ".openclaw 目录不存在，尚无配置可备份"});
    }
    let default_name = format!("didclaw-backup-{}.zip", backup_timestamp());
    let save_path = rfd::FileDialog::new()
        .add_filter("DidClaw 备份", &["zip"])
        .set_file_name(&default_name)
        .save_file();
    let save_path = match save_path {
        Some(p) => p,
        None => return json!({"ok": false, "cancelled": true}),
    };
    let files = match collect_files(&dir) {
        Ok(f) => f,
        Err(e) => return json!({"ok": false, "error": format!("扫描目录失败：{e}")}),
    };
    let zip_file = match File::create(&save_path) {
        Ok(f) => f,
        Err(e) => return json!({"ok": false, "error": format!("创建备份文件失败：{e}")}),
    };
    let mut zip = ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (abs_path, entry_name) in &files {
        if let Err(e) = zip.start_file(entry_name, options) {
            return json!({"ok": false, "error": format!("压缩条目失败（{entry_name}）：{e}")});
        }
        let mut f = match File::open(abs_path) {
            Ok(f) => f,
            Err(e) => {
                return json!({"ok": false, "error": format!("读取文件失败（{}）：{e}", abs_path.display())})
            }
        };
        let mut buf = Vec::new();
        if let Err(e) = f.read_to_end(&mut buf) {
            return json!({"ok": false, "error": format!("读取文件内容失败：{e}")});
        }
        if let Err(e) = zip.write_all(&buf) {
            return json!({"ok": false, "error": format!("写入压缩数据失败：{e}")});
        }
    }
    if let Err(e) = zip.finish() {
        return json!({"ok": false, "error": format!("完成压缩失败：{e}")});
    }
    json!({
        "ok": true,
        "savedPath": save_path.to_string_lossy(),
        "fileCount": files.len(),
    })
}

/// 弹出「打开文件」对话框，从 zip 解压还原到 `~/.openclaw/`。
pub fn restore_openclaw_config() -> Value {
    let pick = rfd::FileDialog::new()
        .add_filter("DidClaw 备份", &["zip"])
        .pick_file();
    let zip_path = match pick {
        Some(p) => p,
        None => return json!({"ok": false, "cancelled": true}),
    };
    let dir = match openclaw_dir() {
        Ok(d) => d,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": format!("创建目标目录失败：{e}")});
    }
    let zip_file = match File::open(&zip_path) {
        Ok(f) => f,
        Err(e) => return json!({"ok": false, "error": format!("打开备份文件失败：{e}")}),
    };
    let mut archive = match zip::ZipArchive::new(zip_file) {
        Ok(a) => a,
        Err(e) => return json!({"ok": false, "error": format!("读取压缩文件失败：{e}")}),
    };
    let total = archive.len();
    for i in 0..total {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(e) => return json!({"ok": false, "error": format!("读取条目 {i} 失败：{e}")}),
        };
        let entry_name = entry.name().to_string();
        // 拒绝路径穿越
        if entry_name.starts_with('/') || entry_name.contains("..") {
            continue;
        }
        let out_path = dir.join(&entry_name);
        if entry_name.ends_with('/') {
            if let Err(e) = fs::create_dir_all(&out_path) {
                return json!({"ok": false, "error": format!("创建目录失败（{entry_name}）：{e}")});
            }
        } else {
            if let Some(parent) = out_path.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    return json!({"ok": false, "error": format!("创建父目录失败：{e}")});
                }
            }
            let mut out_file = match File::create(&out_path) {
                Ok(f) => f,
                Err(e) => {
                    return json!({"ok": false, "error": format!("创建文件失败（{entry_name}）：{e}")})
                }
            };
            let mut buf = Vec::new();
            if let Err(e) = entry.read_to_end(&mut buf) {
                return json!({"ok": false, "error": format!("读取条目内容失败：{e}")});
            }
            if let Err(e) = out_file.write_all(&buf) {
                return json!({"ok": false, "error": format!("写入文件失败：{e}")});
            }
        }
    }
    json!({
        "ok": true,
        "restoredFrom": zip_path.to_string_lossy(),
        "fileCount": total,
    })
}
