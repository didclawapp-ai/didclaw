//! 第五步：公司 roster 技能写入 OpenClaw 托管共享目录 `~/.openclaw/skills/didclaw-company-roster/SKILL.md`。
//! 与 ZIP 技能安装根 `~/.openclaw/workspace/skills`（`skills.rs`）分离；与 `openclaw skills list --json` 的 `managedSkillsDir` 对齐。

use crate::openclaw_common::{backup_timestamp, is_enoent, openclaw_dir};
use serde_json::{json, Value};
use std::fs;
use std::path::Path;

pub const COMPANY_ROSTER_SKILL_SLUG: &str = "didclaw-company-roster";

const SKILL_FILE: &str = "SKILL.md";
const BACKUP_PREFIX: &str = "SKILL.md.didclaw-backup-";
const MAX_SKILL_MD_BYTES: usize = 512 * 1024;

fn backup_existing_skill_md(skill_path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(skill_path) {
        Err(e) if is_enoent(&e) => Ok(None),
        Err(e) => Err(e.to_string()),
        Ok(m) if !m.is_file() => Ok(None),
        Ok(_) => {
            let dir = skill_path
                .parent()
                .ok_or_else(|| "无效技能路径".to_string())?;
            let name = format!("{BACKUP_PREFIX}{}.md", backup_timestamp());
            let backup = dir.join(name);
            fs::copy(skill_path, &backup).map_err(|e| e.to_string())?;
            Ok(Some(backup.to_string_lossy().into_owned()))
        }
    }
}

pub fn write_openclaw_company_roster_skill(skill_md: &str) -> Value {
    let content = skill_md.trim();
    if content.is_empty() {
        return json!({"ok": false, "error": "SKILL.md 内容不能为空"});
    }
    let bytes = content.as_bytes();
    if bytes.len() > MAX_SKILL_MD_BYTES {
        return json!({
            "ok": false,
            "error": format!("SKILL.md 过长（上限 {MAX_SKILL_MD_BYTES} 字节）")
        });
    }

    let base = match openclaw_dir() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let dir = base.join("skills").join(COMPANY_ROSTER_SKILL_SLUG);
    let skill_path = dir.join(SKILL_FILE);

    if let Err(e) = fs::create_dir_all(&dir) {
        return json!({"ok": false, "error": e.to_string()});
    }

    let backup_path = match backup_existing_skill_md(&skill_path) {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("备份既有 SKILL.md 失败：{e}")
            });
        }
    };

    let tmp = dir.join(".SKILL.md.didclaw.tmp");
    if let Err(e) = fs::write(&tmp, format!("{content}\n")) {
        let _ = fs::remove_file(&tmp);
        return json!({"ok": false, "error": e.to_string()});
    }
    if let Err(e) = fs::rename(&tmp, &skill_path) {
        let _ = fs::remove_file(&tmp);
        return json!({"ok": false, "error": e.to_string()});
    }

    let mut out = json!({
        "ok": true,
        "path": skill_path.to_string_lossy(),
        "slug": COMPANY_ROSTER_SKILL_SLUG,
    });
    if let Some(bp) = backup_path {
        out.as_object_mut()
            .unwrap()
            .insert("backupPath".into(), json!(bp));
    }
    out
}
