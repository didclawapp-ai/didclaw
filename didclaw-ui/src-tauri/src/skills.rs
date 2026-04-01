//! OpenClaw 本机技能目录：列表、zip 解压安装、目录复制、删除。
//! 默认安装目录为 `~/.openclaw/workspace/skills`；若该路径不存在但 `~/.openclaw/skills`
//! 已存在，则兼容回退到后者，避免旧用户升级后看不到既有技能。

use base64::Engine;
use serde_json::{json, Value};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};

const SKILL_MD: &str = "skill.md";

fn home_openclaw_shared_skills() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
    Ok(home
        .join(".openclaw")
        .join("skills"))
}

fn home_openclaw_workspace_skills_legacy() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "无法解析用户主目录".to_string())?;
    Ok(home
        .join(".openclaw")
        .join("workspace")
        .join("skills"))
}

/// 默认安装根：优先 `~/.openclaw/workspace/skills`；若该路径不存在但
/// `~/.openclaw/skills` 已存在，则兼容回退，避免旧用户升级后丢失技能。
pub fn default_install_root() -> Result<String, String> {
    let workspace = home_openclaw_workspace_skills_legacy()?;
    let shared = home_openclaw_shared_skills()?;
    let p = if workspace.is_dir() || !shared.is_dir() {
        workspace
    } else {
        shared
    };
    Ok(p.to_string_lossy().to_string())
}

fn normalize_install_root(raw: &str) -> Result<PathBuf, String> {
    let t = raw.trim();
    let p = if t.is_empty() {
        PathBuf::from(default_install_root()?)
    } else {
        PathBuf::from(t)
    };
    fs::create_dir_all(&p).map_err(|e| format!("无法创建或使用安装目录: {e}"))?;
    fs::canonicalize(&p).map_err(|e| format!("安装根目录无效: {e}"))
}

fn normalize_slug(slug: &str) -> Result<String, String> {
    let s = slug.trim();
    if s.is_empty() {
        return Err("slug 不能为空".to_string());
    }
    if s.contains('/') || s.contains('\\') || s.contains("..") {
        return Err("slug 不能包含路径分隔符或 ..".to_string());
    }
    Ok(s.to_string())
}

fn safe_zip_rel_path(name: &str) -> Option<PathBuf> {
    let path = Path::new(name);
    if path.is_absolute() {
        return None;
    }
    for c in path.components() {
        match c {
            Component::Prefix(_) | Component::RootDir => return None,
            Component::ParentDir => return None,
            Component::Normal(_) | Component::CurDir => {}
        }
    }
    Some(path.to_path_buf())
}

/// 当前目录树下是否存在 SKILL.md（大小写不敏感，最多 `max_depth` 层目录）
fn tree_has_skill_md(dir: &Path, max_depth: u8) -> bool {
    if max_depth == 0 {
        return false;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut subdirs: Vec<PathBuf> = Vec::new();
    for e in entries.flatten() {
        let p = e.path();
        if p.is_file() {
            let name = e.file_name().to_string_lossy().to_ascii_lowercase();
            if name == SKILL_MD {
                return true;
            }
        } else if p.is_dir() {
            subdirs.push(p);
        }
    }
    for d in subdirs {
        if tree_has_skill_md(&d, max_depth - 1) {
            return true;
        }
    }
    false
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;
        let s = entry.path();
        let d = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_recursive(&s, &d)?;
        } else {
            fs::copy(&s, &d).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn write_origin_json(skill_dir: &Path, origin: &Value) -> Result<(), String> {
    let dot = skill_dir.join(".clawhub");
    fs::create_dir_all(&dot).map_err(|e| e.to_string())?;
    let path = dot.join("origin.json");
    fs::write(
        &path,
        format!("{}\n", serde_json::to_string_pretty(origin).map_err(|e| e.to_string())?),
    )
    .map_err(|e| e.to_string())
}

pub fn list_installed(install_root: String) -> Result<Value, String> {
    let root = normalize_install_root(&install_root)?;
    if !root.is_dir() {
        return Ok(json!([]));
    }
    let mut items = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        let dir = entry.path();
        if !tree_has_skill_md(&dir, 3) {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        let origin_path = dir.join(".clawhub").join("origin.json");
        let mut source = "local";
        let mut registry: Option<String> = None;
        let mut installed_version: Option<String> = None;
        if origin_path.is_file() {
            if let Ok(text) = fs::read_to_string(&origin_path) {
                if let Ok(v) = serde_json::from_str::<Value>(&text) {
                    if v.get("registry").and_then(|x| x.as_str()).is_some() {
                        source = "clawhub";
                    }
                    registry = v.get("registry").and_then(|x| x.as_str()).map(String::from);
                    installed_version = v
                        .get("installedVersion")
                        .and_then(|x| x.as_str())
                        .map(String::from);
                }
            }
        }
        items.push(json!({
            "slug": slug,
            "path": dir.to_string_lossy(),
            "source": source,
            "registry": registry,
            "installedVersion": installed_version,
        }));
    }
    items.sort_by(|a, b| {
        let sa = a.get("slug").and_then(|x| x.as_str()).unwrap_or("");
        let sb = b.get("slug").and_then(|x| x.as_str()).unwrap_or("");
        sa.cmp(sb)
    });
    Ok(Value::Array(items))
}

/// 将已读取的 zip 字节解压到目标技能目录（内部公用）。
fn extract_zip_bytes_to_dest(bytes: Vec<u8>, dest: &PathBuf, origin: Option<Value>) -> Result<Value, String> {
    if bytes.len() > 80 * 1024 * 1024 {
        return Err("zip 超过 80MB，请改用本机 zip 文件安装".to_string());
    }
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|e| format!("覆盖已有技能失败: {e}"))?;
    }
    fs::create_dir_all(dest).map_err(|e| e.to_string())?;

    let cursor = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("zip 解析失败: {e}"))?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        let Some(rel) = safe_zip_rel_path(&name) else {
            return Err(format!("zip 内包含不安全路径: {name}"));
        };
        let out = dest.join(&rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&out, buf).map_err(|e| e.to_string())?;
    }

    if !tree_has_skill_md(dest, 3) {
        let _ = fs::remove_dir_all(dest);
        return Err("zip 解压后未找到 SKILL.md（已在子目录中递归检测）".to_string());
    }

    if let Some(o) = origin {
        write_origin_json(dest, &o)?;
    }

    Ok(json!({"ok": true, "path": dest.to_string_lossy()}))
}

pub fn install_zip_base64(
    install_root: String,
    slug: String,
    zip_base64: String,
    origin: Option<Value>,
) -> Result<Value, String> {
    let root = normalize_install_root(&install_root)?;
    let slug = normalize_slug(&slug)?;
    // 80MB zip 对应约 110MB base64；提前检查避免在解码前就分配超量内存
    const MAX_ZIP_BASE64_INPUT: usize = 110 * 1024 * 1024;
    if zip_base64.len() > MAX_ZIP_BASE64_INPUT {
        return Err("zip 超过 80MB，请改用本机 zip 文件安装".to_string());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(zip_base64.trim())
        .map_err(|e| format!("zip Base64 解码失败: {e}"))?;
    extract_zip_bytes_to_dest(bytes, &root.join(&slug), origin)
}

pub fn install_from_folder(install_root: String, slug: String, source_path: String) -> Result<Value, String> {
    let root = normalize_install_root(&install_root)?;
    let slug = normalize_slug(&slug)?;
    let src = PathBuf::from(source_path.trim());
    let src = fs::canonicalize(&src).map_err(|e| format!("源目录无效: {e}"))?;
    if !src.is_dir() {
        return Err("源路径不是目录".to_string());
    }
    if !tree_has_skill_md(&src, 3) {
        return Err("源目录中未找到 SKILL.md".to_string());
    }
    let dest = root.join(&slug);
    if dest.exists() {
        fs::remove_dir_all(&dest).map_err(|e| format!("覆盖已有技能失败: {e}"))?;
    }
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    copy_dir_recursive(&src, &dest)?;
    Ok(json!({"ok": true, "path": dest.to_string_lossy()}))
}

pub fn install_zip_path(install_root: String, slug: String, zip_path: String) -> Result<Value, String> {
    let root = normalize_install_root(&install_root)?;
    let slug = normalize_slug(&slug)?;
    let zp = PathBuf::from(zip_path.trim());
    let zp = fs::canonicalize(&zp).map_err(|e| format!("zip 文件无效: {e}"))?;
    if !zp.is_file() {
        return Err("zip 路径不是文件".to_string());
    }
    let bytes = fs::read(&zp).map_err(|e| e.to_string())?;
    extract_zip_bytes_to_dest(bytes, &root.join(&slug), None)
}

pub fn delete_skill(install_root: String, slug: String) -> Result<(), String> {
    let root = normalize_install_root(&install_root)?;
    let slug = normalize_slug(&slug)?;
    let dest = root.join(&slug);
    let canon_root = fs::canonicalize(&root).map_err(|e| e.to_string())?;
    if !dest.exists() {
        return Err("技能目录不存在".to_string());
    }
    let canon_dest = fs::canonicalize(&dest).map_err(|e| e.to_string())?;
    if !canon_dest.starts_with(&canon_root) {
        return Err("拒绝删除：路径越界".to_string());
    }
    fs::remove_dir_all(&canon_dest).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn pick_zip_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("ZIP", &["zip"])
        .pick_file()
        .map(|p| p.to_string_lossy().to_string())
}

pub fn pick_folder() -> Option<String> {
    rfd::FileDialog::new().pick_folder().map(|p| p.to_string_lossy().to_string())
}
