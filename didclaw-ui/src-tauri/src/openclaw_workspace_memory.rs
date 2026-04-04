//! Lists OpenClaw workspace memory files (`~/.openclaw/workspace/memory/*.md`).
//! These are separate from live Gateway session keys (sessions.list).

use crate::openclaw_common::openclaw_dir;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs;
use std::time::UNIX_EPOCH;

#[derive(Serialize)]
struct MemoryFileRow {
    name: String,
    path: String,
    #[serde(rename = "modifiedMs")]
    modified_ms: i64,
    size: u64,
}

#[tauri::command]
pub fn list_openclaw_workspace_memory() -> Result<Value, String> {
    let dir = openclaw_dir()?.join("workspace").join("memory");
    if !dir.is_dir() {
        let empty: Vec<MemoryFileRow> = Vec::new();
        return Ok(json!({ "ok": true, "files": empty }));
    }
    let rd = fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut files: Vec<MemoryFileRow> = Vec::new();
    for ent in rd.flatten() {
        let path = ent.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) if n.ends_with(".md") => n.to_string(),
            _ => continue,
        };
        let meta = match ent.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified_ms = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| {
                let m = d.as_millis();
                if m > i64::MAX as u128 {
                    i64::MAX
                } else {
                    m as i64
                }
            })
            .unwrap_or(0);
        files.push(MemoryFileRow {
            name,
            path: path.to_string_lossy().to_string(),
            modified_ms,
            size: meta.len(),
        });
    }
    files.sort_by(|a, b| b.modified_ms.cmp(&a.modified_ms));
    Ok(json!({ "ok": true, "files": files }))
}
