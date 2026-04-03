//! Apply unified diffs under a workspace root with path traversal checks.

use diffy::Patch;
use serde_json::{json, Value};
use std::fs;
use std::path::{Component, Path, PathBuf};

const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;
const MAX_FILES_PER_APPLY: usize = 64;

fn normalize_diff_text(diff: &str) -> String {
    diff.replace("\r\n", "\n")
}

/// Reject absolute paths and `..` segments.
fn safe_relative_path_from_header(path: &str) -> Result<PathBuf, String> {
    let s = path.trim();
    let s = s
        .strip_prefix("a/")
        .or_else(|| s.strip_prefix("b/"))
        .unwrap_or(s);
    let s = s.strip_prefix("./").unwrap_or(s);
    if s.is_empty() {
        return Err("补丁中文件路径为空".into());
    }
    if s == "/dev/null" {
        return Err("跳过 /dev/null".into());
    }
    let p = Path::new(s);
    if p.is_absolute() {
        return Err("不允许绝对路径".into());
    }
    for c in p.components() {
        match c {
            Component::ParentDir => return Err("路径中不允许 `..`".into()),
            Component::RootDir | Component::Prefix(_) => {
                return Err("无效路径".into());
            }
            _ => {}
        }
    }
    Ok(p.to_path_buf())
}

fn is_subpath_of(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok()
}

fn resolve_target_path(root: &Path, rel: &Path) -> Result<PathBuf, String> {
    let full = root.join(rel);
    let parent = full.parent().ok_or("无效目标路径")?.to_path_buf();
    fs::create_dir_all(&parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let root_can = fs::canonicalize(root).map_err(|e| format!("工作区路径无效: {e}"))?;
    let parent_can = fs::canonicalize(&parent).map_err(|e| format!("无法解析父目录: {e}"))?;
    if !is_subpath_of(&root_can, &parent_can) && parent_can != root_can {
        return Err("路径越出工作区".into());
    }
    Ok(full)
}

/// Strip optional `diff --git` / `index` / `similarity` lines before `---` for diffy.
fn file_patch_body_for_diffy(lines: &[&str]) -> String {
    let mut start = 0usize;
    for (i, line) in lines.iter().enumerate() {
        if line.starts_with("--- ") {
            start = i;
            break;
        }
    }
    lines[start..].join("\n") + "\n"
}

/// Split unified diff into per-file hunks (each starts with `--- `).
fn split_unified_files(normalized: &str) -> Vec<Vec<String>> {
    let lines: Vec<&str> = normalized.lines().collect();
    let mut files: Vec<Vec<String>> = Vec::new();
    let mut i = 0usize;
    while i < lines.len() {
        if !lines[i].starts_with("--- ") {
            i += 1;
            continue;
        }
        let mut block: Vec<String> = Vec::new();
        while i < lines.len() {
            let line = lines[i];
            if !block.is_empty() && line.starts_with("--- ") {
                break;
            }
            block.push(line.to_string());
            i += 1;
        }
        if !block.is_empty() {
            files.push(block);
        }
    }
    files
}

fn old_path_from_minus_line(minus_line: &str) -> Option<String> {
    let rest = minus_line.strip_prefix("--- ")?;
    let rest = rest.trim();
    if rest == "/dev/null" || rest == "dev/null" {
        return None;
    }
    let rest = rest
        .strip_prefix("a/")
        .or_else(|| rest.strip_prefix("b/"))
        .unwrap_or(rest);
    Some(rest.to_string())
}

fn new_path_from_plus_line(plus_line: &str) -> Result<String, String> {
    let rest = plus_line
        .strip_prefix("+++ ")
        .ok_or("缺少 +++ 行")?
        .trim();
    if rest == "/dev/null" {
        return Err("目标为 /dev/null（删除文件）暂不支持通过 UI 应用".into());
    }
    let rest = rest
        .strip_prefix("b/")
        .or_else(|| rest.strip_prefix("a/"))
        .unwrap_or(rest);
    Ok(rest.to_string())
}

/// Apply a multi-file unified diff under `root`. Returns JSON `{ ok, results: [{ path, ok, error? }] }`.
pub fn apply_unified_diff_under_root(root: &str, diff: &str) -> Result<Value, String> {
    let root = Path::new(root.trim());
    if root.as_os_str().is_empty() {
        return Err("工作区路径为空".into());
    }
    if !root.is_dir() {
        return Err("工作区不是有效目录".into());
    }
    let normalized = normalize_diff_text(diff);
    if normalized.len() > MAX_DIFF_BYTES {
        return Err(format!(
            "补丁过大（超过 {} MB）",
            MAX_DIFF_BYTES / (1024 * 1024)
        ));
    }
    let file_blocks = split_unified_files(&normalized);
    if file_blocks.is_empty() {
        return Err("未识别到有效的 unified diff（需要以 --- 开头的文件头）".into());
    }
    if file_blocks.len() > MAX_FILES_PER_APPLY {
        return Err(format!("单次最多应用 {MAX_FILES_PER_APPLY} 个文件"));
    }

    let root_can = fs::canonicalize(root).map_err(|e| format!("工作区路径无效: {e}"))?;

    let mut results: Vec<Value> = Vec::new();

    for block in file_blocks {
        let ref_lines: Vec<&str> = block.iter().map(|s| s.as_str()).collect();
        let minus: &str = ref_lines.first().ok_or("空补丁块")?;
        if !minus.starts_with("--- ") {
            continue;
        }
        let plus: &str = ref_lines.get(1).ok_or("补丁块缺少 +++ 行")?;
        if !plus.starts_with("+++ ") {
            return Err("补丁格式错误：+++ 应在 --- 下一行".into());
        }

        let new_rel = safe_relative_path_from_header(&new_path_from_plus_line(plus)?)?;
        let old_exists = old_path_from_minus_line(minus).is_some();
        let body = file_patch_body_for_diffy(&ref_lines);
        let patch = Patch::from_str(&body).map_err(|e| format!("解析补丁失败 ({new_rel:?}): {e}"))?;

        let target = resolve_target_path(&root_can, &new_rel)?;
        let old_text = if target.is_file() {
            fs::read_to_string(&target).map_err(|e| format!("读取 {} 失败: {e}", target.display()))?
        } else if old_exists {
            return Err(format!("补丁引用已存在文件但磁盘上不存在: {}", target.display()));
        } else {
            String::new()
        };

        let new_text = diffy::apply(&old_text, &patch).map_err(|e| {
            format!(
                "应用 hunks 失败 ({}): {e}",
                new_rel.display()
            )
        })?;

        if let Err(e) = fs::write(&target, new_text) {
            results.push(json!({
                "path": new_rel.to_string_lossy(),
                "ok": false,
                "error": format!("写入失败: {e}"),
            }));
        } else {
            results.push(json!({
                "path": new_rel.to_string_lossy(),
                "ok": true,
            }));
        }
    }

    let all_ok = results.iter().all(|r| r.get("ok") == Some(&json!(true)));
    Ok(json!({ "ok": all_ok, "results": results }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let diff = "\
--- a/../secret
+++ b/../secret
@@ -0,0 +1 @@
+x
";
        let r = apply_unified_diff_under_root(tmp.path().to_str().unwrap(), diff);
        assert!(r.is_err());
    }

    #[test]
    fn applies_add_file() {
        let tmp = tempfile::tempdir().unwrap();
        let diff = "\
--- /dev/null
+++ b/hello.txt
@@ -0,0 +1,2 @@
+line1
+line2
";
        let v = apply_unified_diff_under_root(tmp.path().to_str().unwrap(), diff).unwrap();
        assert_eq!(v["ok"], true);
        let p = tmp.path().join("hello.txt");
        let s = fs::read_to_string(p).unwrap();
        assert!(s.contains("line1"));
    }

    #[test]
    fn applies_modify() {
        let tmp = tempfile::tempdir().unwrap();
        let f = tmp.path().join("a.txt");
        let mut file = std::fs::File::create(&f).unwrap();
        writeln!(file, "old").unwrap();
        drop(file);
        let diff = format!(
            "\
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-old
+new
"
        );
        let v = apply_unified_diff_under_root(tmp.path().to_str().unwrap(), &diff).unwrap();
        assert_eq!(v["ok"], true);
        let s = fs::read_to_string(f).unwrap();
        assert_eq!(s.trim(), "new");
    }
}
