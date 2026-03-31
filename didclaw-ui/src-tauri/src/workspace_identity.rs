//! 读取 ~/.openclaw/workspace/IDENTITY.md 和 USER.md，解析 AI 与用户的显示名称。

use crate::openclaw_common::openclaw_dir;
use serde_json::{json, Value};
use std::fs;

/// 从 markdown 中提取 `- **Field:** Value` 格式的值。
/// 例：`- **Name:** 小小 (Xiaoxiao)` → `"小小"`
fn extract_field(text: &str, field: &str) -> Option<String> {
    let needle = format!("**{}:**", field);
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(pos) = trimmed.find(&needle) {
            let rest = trimmed[pos + needle.len()..].trim();
            // 去掉括号注释，如 "(Xiaoxiao)"
            let name = rest.split('(').next().unwrap_or("").trim().to_string();
            if !name.is_empty() && name != "_（待定）_" && name != "_(待定)_" {
                return Some(name);
            }
        }
    }
    None
}

pub fn read_workspace_identity() -> Value {
    let workspace = match openclaw_dir() {
        Ok(d) => d.join("workspace"),
        Err(e) => return json!({ "ok": false, "error": e }),
    };

    let ai_name = fs::read_to_string(workspace.join("IDENTITY.md"))
        .ok()
        .and_then(|t| extract_field(&t, "Name"));

    let user_name = fs::read_to_string(workspace.join("USER.md"))
        .ok()
        .and_then(|t| {
            extract_field(&t, "What to call them")
                .or_else(|| extract_field(&t, "Name"))
        });

    json!({
        "ok": true,
        "aiName": ai_name,
        "userName": user_name,
    })
}
