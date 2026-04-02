//! Copy DidClaw-shipped skills from the app bundle into `~/.openclaw/workspace/skills`.
//! Only creates missing skill folders so local edits are preserved.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use tauri::Manager;

fn copy_dir_all(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        let s = entry.path();
        let d = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&s, &d)?;
        } else {
            fs::copy(&s, &d)?;
        }
    }
    Ok(())
}

fn resolve_bundled_skills_root(app: &AppHandle) -> Option<PathBuf> {
    if let Ok(rd) = app.path().resource_dir() {
        let p = rd.join("skills");
        if p.is_dir() {
            return Some(p);
        }
    }
    #[cfg(debug_assertions)]
    {
        let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../skills");
        if dev.is_dir() {
            return Some(dev);
        }
    }
    None
}

/// One skill = one subdirectory containing `SKILL.md` (case-insensitive).
fn looks_like_skill_dir(dir: &Path) -> bool {
    if !dir.is_dir() {
        return false;
    }
    let Ok(rd) = fs::read_dir(dir) else {
        return false;
    };
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_ascii_lowercase();
        if name == "skill.md" {
            return true;
        }
    }
    false
}

pub fn sync_bundled_workspace_skills(app: &AppHandle) {
    let Some(src_root) = resolve_bundled_skills_root(app) else {
        crate::launch_log::line("bundled skills: no packaged skills/ directory, skip");
        return;
    };

    let workspace_skills = match crate::openclaw_common::openclaw_dir() {
        Ok(d) => d.join("workspace").join("skills"),
        Err(e) => {
            crate::launch_log::line(&format!("bundled skills: openclaw dir: {e}"));
            return;
        }
    };

    if let Err(e) = fs::create_dir_all(&workspace_skills) {
        crate::launch_log::line(&format!("bundled skills: mkdir workspace/skills: {e}"));
        return;
    }

    let entries = match fs::read_dir(&src_root) {
        Ok(e) => e,
        Err(e) => {
            crate::launch_log::line(&format!("bundled skills: read bundle: {e}"));
            return;
        }
    };

    let mut installed = 0usize;
    for ent in entries.flatten() {
        let path = ent.path();
        if !looks_like_skill_dir(&path) {
            continue;
        }
        let name = ent.file_name();
        let dest = workspace_skills.join(&name);
        if dest.exists() {
            continue;
        }
        match copy_dir_all(&path, &dest) {
            Ok(()) => {
                installed += 1;
                crate::launch_log::line(&format!(
                    "bundled skills: installed {}",
                    name.to_string_lossy()
                ));
            }
            Err(e) => {
                crate::launch_log::line(&format!(
                    "bundled skills: copy {} failed: {e}",
                    name.to_string_lossy()
                ));
            }
        }
    }

    if installed > 0 {
        crate::launch_log::line(&format!(
            "bundled skills: {} new skill folder(s) under workspace/skills",
            installed
        ));
    }
}
