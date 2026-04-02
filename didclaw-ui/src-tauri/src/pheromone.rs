//! Pheromone memory graph — stores and retrieves didclaw-pheromone.json
//! from ~/.openclaw/. Also handles injecting the memory section into AGENTS.md.

use crate::openclaw_common::{extract_default_agent_id, openclaw_dir};
use serde_json::Value;
use std::fs;
use std::path::PathBuf;

fn pheromone_path() -> Result<PathBuf, String> {
    Ok(openclaw_dir()?.join("didclaw-pheromone.json"))
}

fn agents_md_path(agent_id: &str) -> Result<PathBuf, String> {
    // Try agent-specific workspace first, fall back to root workspace.
    let agent_specific = openclaw_dir()?
        .join("agents")
        .join(agent_id)
        .join("workspace")
        .join("AGENTS.md");
    if agent_specific.exists() {
        return Ok(agent_specific);
    }
    Ok(openclaw_dir()?.join("workspace").join("AGENTS.md"))
}

#[tauri::command]
pub fn read_pheromone_graph() -> Result<Value, String> {
    let path = pheromone_path()?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_pheromone_graph(graph: Value) -> Result<(), String> {
    let path = pheromone_path()?;
    let pretty = serde_json::to_string_pretty(&graph).map_err(|e| e.to_string())?;
    fs::write(&path, pretty).map_err(|e| e.to_string())
}

/// Inject a pheromone memory section into AGENTS.md, replacing any existing section.
/// Uses HTML comment markers so the section is stable across rewrites.
#[tauri::command]
pub fn inject_pheromone_agents_md(content: String, agent_id: Option<String>) -> Result<(), String> {
    // Resolve agent id
    let aid = agent_id.unwrap_or_else(|| {
        openclaw_dir()
            .ok()
            .and_then(|d| {
                let p = d.join("openclaw.json");
                fs::read_to_string(p).ok()
            })
            .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            .map(|v| extract_default_agent_id(&v))
            .unwrap_or_else(|| "main".to_string())
    });

    let path = agents_md_path(&aid)?;

    // Ensure parent directory exists.
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    const START: &str = "<!-- didclaw-pheromone-start -->";
    const END: &str = "<!-- didclaw-pheromone-end -->";

    let section = format!("{START}\n{content}\n{END}");

    let existing = if path.exists() {
        fs::read_to_string(&path).map_err(|e| e.to_string())?
    } else {
        String::new()
    };

    let updated = if let (Some(si), Some(ei)) = (existing.find(START), existing.find(END)) {
        // Replace between markers (inclusive).
        let after_end = ei + END.len();
        format!("{}{}{}", &existing[..si], section, &existing[after_end..])
    } else {
        // Append section at end.
        if existing.is_empty() {
            section
        } else {
            format!("{}\n\n{}", existing.trim_end(), section)
        }
    };

    fs::write(&path, updated).map_err(|e| e.to_string())
}
