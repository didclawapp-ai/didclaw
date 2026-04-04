//! `readOpenClawProviders` / `writeOpenClawProvidersPatch`：与 `electron/openclaw-config.ts` 对齐。

use crate::openclaw_common::{
    agent_auth_profiles_json_path, agent_models_json_path, backup_timestamp, extract_default_agent_id,
    is_enoent, openclaw_config_path, openclaw_dir,
};
use regex::Regex;
use serde_json::{json, Map, Value};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

const MODELS_BACKUP_PREFIX: &str = "models.json.didclaw-backup-";
const AUTH_BACKUP_PREFIX: &str = "auth-profiles.json.didclaw-backup-";
const BACKUP_SUFFIX: &str = ".json";

fn provider_id_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-z0-9]+(-[a-z0-9]+)*$").expect("provider id regex"))
}

fn non_secret_api_key_markers() -> &'static HashSet<String> {
    static S: OnceLock<HashSet<String>> = OnceLock::new();
    S.get_or_init(|| {
        [
            "minimax-oauth",
            "qwen-oauth",
            // 注意：勿把 ollama-local 放这里——网关仍要在 auth-profiles.json 里有一条 api_key 记录，
            // 本机 Ollama 无真实密钥时用字面量 ollama-local 占位（见 effective_auth_storage_key）。
            "custom-local",
            "secretref-managed",
        ]
        .into_iter()
        .map(|s| s.to_lowercase())
        .collect()
    })
}

fn normalize_writable_provider_api_key(raw: Option<&str>) -> Option<String> {
    let t = raw?.trim();
    if t.is_empty() {
        return None;
    }
    if non_secret_api_key_markers().contains(&t.to_lowercase()) {
        return None;
    }
    Some(t.to_string())
}

/// 写入 auth-profiles / openclaw.json 时使用的 API Key：本机 `ollama` 允许空密钥，但网关仍要求有 profile。
fn effective_auth_storage_key(provider_id: &str, api_key: Option<&str>) -> Option<String> {
    if provider_id == "ollama" {
        let empty = api_key.map(str::trim).unwrap_or("").is_empty();
        if empty {
            return Some("ollama-local".to_string());
        }
    }
    normalize_writable_provider_api_key(api_key)
}

fn extract_models_providers(root: &Value) -> Map<String, Value> {
    let Some(root_obj) = root.as_object() else {
        return Map::new();
    };
    let Some(models) = root_obj.get("models").and_then(|v| v.as_object()) else {
        return Map::new();
    };
    let Some(providers) = models.get("providers").and_then(|v| v.as_object()) else {
        return Map::new();
    };
    providers.clone()
}

fn merge_single_provider_for_read(global_p: &Value, agent_p: &Value) -> Value {
    let mut out = global_p.as_object().cloned().unwrap_or_default();
    let a = agent_p.as_object().cloned().unwrap_or_default();
    for (k, v) in a {
        if k == "models" {
            if let Some(v_obj) = v.as_object() {
                let gm = out
                    .get("models")
                    .and_then(|m| m.as_object())
                    .cloned()
                    .unwrap_or_default();
                let mut merged = Map::new();
                for (ik, iv) in gm {
                    merged.insert(ik, iv);
                }
                for (ik, iv) in v_obj {
                    merged.insert(ik.clone(), iv.clone());
                }
                out.insert("models".into(), Value::Object(merged));
            } else {
                out.insert(k, v);
            }
        } else {
            out.insert(k, v);
        }
    }
    Value::Object(out)
}

fn merge_providers_for_read(
    global_providers: &Map<String, Value>,
    agent_providers: &Map<String, Value>,
) -> Map<String, Value> {
    let mut ids: Vec<String> = global_providers
        .keys()
        .chain(agent_providers.keys())
        .cloned()
        .collect();
    ids.sort();
    ids.dedup();
    let mut out = Map::new();
    for id in ids {
        let g = global_providers.get(&id).cloned().unwrap_or(json!({}));
        let a = agent_providers.get(&id).cloned().unwrap_or(json!({}));
        out.insert(id, merge_single_provider_for_read(&g, &a));
    }
    out
}

/// 从 `auth-profiles.json` 为 `merged` 中尚未设置 `apiKey` 的 provider 补充密钥。
/// 用于兼容通过 OpenClaw CLI (`openclaw configure`) 设置的老用户——CLI 只写
/// `auth-profiles.json`，不写 `models.json` 的 `apiKey` 字段。
fn enrich_providers_with_auth_profiles(merged: &mut Map<String, Value>, auth_profiles_path: &Path) {
    let raw = match fs::read_to_string(auth_profiles_path) {
        Ok(s) => s,
        Err(_) => return,
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return,
    };
    let profiles = match root.get("profiles").and_then(|v| v.as_object()) {
        Some(p) => p.clone(),
        None => return,
    };
    for (id, prov) in merged.iter_mut() {
        // 已有 apiKey 则跳过（DidClaw 写入路径已含 apiKey，优先使用）
        let has_key = prov
            .as_object()
            .and_then(|o| o.get("apiKey"))
            .and_then(|v| v.as_str())
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        if has_key {
            continue;
        }
        let profile_key = format!("{id}:default");
        if let Some(profile) = profiles.get(&profile_key) {
            let is_api_key_type = profile.get("type").and_then(|v| v.as_str()) == Some("api_key")
                || profile.get("mode").and_then(|v| v.as_str()) == Some("api_key");
            if is_api_key_type {
                if let Some(key) = profile.get("key").and_then(|v| v.as_str()) {
                    if !key.trim().is_empty() {
                        if let Some(prov_obj) = prov.as_object_mut() {
                            prov_obj.insert("apiKey".to_string(), json!(key));
                        }
                    }
                }
            }
        }
    }
}

fn read_agent_models_providers_map(path: &Path) -> Result<Map<String, Value>, String> {
    let raw = match fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) if is_enoent(&e) => return Ok(Map::new()),
        Err(e) => return Err(e.to_string()),
    };
    let root: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let Some(o) = root.as_object() else {
        return Ok(Map::new());
    };
    let Some(pr) = o.get("providers").and_then(|v| v.as_object()) else {
        return Ok(Map::new());
    };
    Ok(pr.clone())
}

/// Mask `apiKey` fields before returning to frontend: keep first 4 chars + "****".
/// Prevents full keys from leaking into AI conversation context.
fn mask_providers_api_keys(providers: &mut Map<String, Value>) {
    for (_, prov) in providers.iter_mut() {
        let Some(p) = prov.as_object_mut() else { continue };
        if let Some(key_val) = p.get("apiKey") {
            if let Some(k) = key_val.as_str() {
                let masked = if k.len() > 4 {
                    format!("{}****", &k[..4])
                } else {
                    "****".to_string()
                };
                p.insert("apiKey".to_string(), json!(masked));
            }
        }
    }
}

pub fn read_open_claw_providers() -> Value {
    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({ "ok": false, "error": e }),
    };
    let raw = match fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) if is_enoent(&e) => {
            let agent_id = "main".to_string();
            let agent_path = match agent_models_json_path(&agent_id) {
                Ok(p) => p,
                Err(err) => return json!({"ok": false, "error": err}),
            };
            let agent_p = match read_agent_models_providers_map(&agent_path) {
                Ok(m) => m,
                Err(e) => {
                    return json!({"ok": false, "error": format!("读取代理 models.json 失败：{e}")});
                }
            };
            let mut merged = merge_providers_for_read(&Map::new(), &agent_p);
            if let Ok(auth_path) = agent_auth_profiles_json_path(&agent_id) {
                enrich_providers_with_auth_profiles(&mut merged, &auth_path);
            }
            mask_providers_api_keys(&mut merged);
            return json!({
                "ok": true,
                "providers": Value::Object(merged),
                "defaultAgentId": agent_id,
            });
        }
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            return json!({"ok": false, "error": "openclaw.json 不是合法 JSON，请用编辑器修正后再试"});
        }
    };
    let agent_id = extract_default_agent_id(&root);
    let global_p = extract_models_providers(&root);
    let agent_path = match agent_models_json_path(&agent_id) {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let agent_p = match read_agent_models_providers_map(&agent_path) {
        Ok(m) => m,
        Err(e) => {
            return json!({"ok": false, "error": format!("读取代理 models.json 失败：{e}")});
        }
    };
    let mut merged = merge_providers_for_read(&global_p, &agent_p);
    if let Ok(auth_path) = agent_auth_profiles_json_path(&agent_id) {
        enrich_providers_with_auth_profiles(&mut merged, &auth_path);
    }
    mask_providers_api_keys(&mut merged);
    json!({
        "ok": true,
        "providers": Value::Object(merged),
        "defaultAgentId": agent_id,
    })
}

fn merge_provider_entry(existing: &Value, patch: &Map<String, Value>) -> Value {
    let mut base: Map<String, Value> = existing.as_object().cloned().unwrap_or_default();
    for (k, v) in patch {
        if k == "models" {
            if v.is_null() {
                base.remove("models");
                continue;
            }
            if let Some(v_obj) = v.as_object() {
                let prev_models = base
                    .get("models")
                    .and_then(|m| m.as_object())
                    .cloned()
                    .unwrap_or_default();
                let mut next_models = Map::new();
                for (mid, mbody) in v_obj {
                    let merged = match (prev_models.get(mid), mbody) {
                        (Some(pe), m) if pe.is_object() && m.is_object() => {
                            let mut o = pe.as_object().unwrap().clone();
                            for (mk, mv) in m.as_object().unwrap() {
                                o.insert(mk.clone(), mv.clone());
                            }
                            Value::Object(o)
                        }
                        (_, m) => m.clone(),
                    };
                    next_models.insert(mid.clone(), merged);
                }
                base.insert("models".to_string(), Value::Object(next_models));
            }
            continue;
        }
        if k == "baseUrl" {
            base.remove("baseURL");
        } else if k == "baseURL" {
            base.remove("baseUrl");
        }
        if v.is_null() {
            base.remove(k);
            continue;
        }
        base.insert(k.clone(), v.clone());
    }
    Value::Object(base)
}

fn normalize_provider_models_to_array(models: &Value) -> Vec<Value> {
    if let Some(arr) = models.as_array() {
        return arr
            .iter()
            .filter(|m| m.is_object())
            .cloned()
            .collect();
    }
    if let Some(mo) = models.as_object() {
        let mut out = Vec::new();
        for (mid, body) in mo {
            let id = mid.trim();
            if id.is_empty() {
                continue;
            }
            let mut extra = body.as_object().cloned().unwrap_or_default();
            extra.insert("id".to_string(), json!(id));
            out.push(Value::Object(extra));
        }
        return out;
    }
    vec![]
}

fn normalize_agent_providers_models_shape(providers: &mut Map<String, Value>) {
    for (_, prov) in providers.iter_mut() {
        let Some(p) = prov.as_object_mut() else {
            continue;
        };
        if !p.contains_key("models") {
            continue;
        }
        let models = p.get("models").cloned().unwrap_or(Value::Null);
        let arr = normalize_provider_models_to_array(&models);
        p.insert("models".to_string(), json!(arr));
    }
}

fn strip_global_providers_from_open_claw_root(root: &mut Map<String, Value>, patch_ids: &[String]) {
    for id in patch_ids {
        let models_block = root
            .entry("models".to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap();
        let providers = models_block
            .entry("providers".to_string())
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .unwrap();
        providers.remove(id);
    }
}

fn build_next_agent_auth_profiles_root(
    existing_raw: Option<&str>,
    patch: &Map<String, Value>,
    merged_agent_providers: &Map<String, Value>,
) -> Result<(Value, bool), String> {
    let mut auth_root: Map<String, Value> = serde_json::from_value(json!({
        "version": 1,
        "profiles": {},
        "usageStats": {},
    }))
    .unwrap();
    if let Some(raw) = existing_raw {
        if let Ok(v) = serde_json::from_str::<Value>(raw) {
            if let Some(o) = v.as_object() {
                auth_root = o.clone();
            }
        }
    }
    if !auth_root
        .get("profiles")
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        auth_root.insert("profiles".into(), json!({}));
    }
    let profiles = auth_root
        .get_mut("profiles")
        .unwrap()
        .as_object_mut()
        .unwrap();
    let prev_snap = serde_json::to_string(profiles).unwrap_or_default();

    for id in patch.keys() {
        let profile_key = format!("{id}:default");
        if patch.get(id).map(|v| v.is_null()).unwrap_or(false) {
            profiles.remove(&profile_key);
            continue;
        }
        let prov = merged_agent_providers.get(id);
        let api_key = prov
            .and_then(|p| p.as_object())
            .and_then(|o| o.get("apiKey"))
            .and_then(|v| v.as_str());
        let key = effective_auth_storage_key(id, api_key);
        if let Some(k) = key {
            profiles.insert(
                profile_key.clone(),
                json!({
                    "type": "api_key",
                    "provider": id,
                    "key": k,
                }),
            );
        } else if let Some(old) = profiles.get(&profile_key) {
            if old.get("type").and_then(|v| v.as_str()) == Some("api_key") {
                profiles.remove(&profile_key);
            }
        }
    }

    let changed = serde_json::to_string(profiles).unwrap_or_default() != prev_snap;
    Ok((Value::Object(auth_root), changed))
}

fn sync_open_claw_root_auth_profile_refs(
    root: &mut Map<String, Value>,
    patch: &Map<String, Value>,
    merged_agent_providers: &Map<String, Value>,
) -> bool {
    let auth = root
        .entry("auth".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap();
    let profiles = auth
        .entry("profiles".to_string())
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .unwrap();
    let prev_snap = serde_json::to_string(profiles).unwrap_or_default();

    for id in patch.keys() {
        let profile_key = format!("{id}:default");
        if patch.get(id).map(|v| v.is_null()).unwrap_or(false) {
            profiles.remove(&profile_key);
            continue;
        }
        let prov = merged_agent_providers.get(id);
        let api_key = prov
            .and_then(|p| p.as_object())
            .and_then(|o| o.get("apiKey"))
            .and_then(|v| v.as_str());
        let key = effective_auth_storage_key(id, api_key);
        if let Some(_k) = key {
            profiles.insert(
                profile_key.clone(),
                json!({
                    "provider": id,
                    "mode": "api_key",
                }),
            );
        } else if let Some(old) = profiles.get(&profile_key) {
            if old.get("mode").and_then(|v| v.as_str()) == Some("api_key") {
                profiles.remove(&profile_key);
            }
        }
    }

    serde_json::to_string(profiles).unwrap_or_default() != prev_snap
}

fn backup_file_in_parent(config_path: &Path, basename_fn: impl FnOnce() -> String) -> Result<String, String> {
    match fs::metadata(config_path) {
        Err(e) if is_enoent(&e) => Ok(String::new()),
        Err(e) => Err(e.to_string()),
        Ok(m) if !m.is_file() => Ok(String::new()),
        Ok(_) => {
            let dir = config_path
                .parent()
                .ok_or_else(|| "无效配置路径".to_string())?;
            let backup_path = dir.join(basename_fn());
            fs::copy(config_path, &backup_path).map_err(|e| e.to_string())?;
            Ok(backup_path.to_string_lossy().to_string())
        }
    }
}

fn backup_openclaw_if_exists(config_path: &Path) -> Result<String, String> {
    backup_file_in_parent(config_path, || {
        format!(
            "openclaw.json.didclaw-backup-{}{BACKUP_SUFFIX}",
            backup_timestamp()
        )
    })
}

fn backup_agent_models_if_exists(path: &Path) -> Result<String, String> {
    backup_file_in_parent(path, || {
        format!("{MODELS_BACKUP_PREFIX}{}{BACKUP_SUFFIX}", backup_timestamp())
    })
}

fn backup_agent_auth_if_exists(path: &Path) -> Result<String, String> {
    backup_file_in_parent(path, || {
        format!("{AUTH_BACKUP_PREFIX}{}{BACKUP_SUFFIX}", backup_timestamp())
    })
}

pub fn write_open_claw_providers_patch(payload: Value) -> Value {
    let patch_obj = match payload.get("patch").and_then(|v| v.as_object()) {
        Some(o) => o,
        None => return json!({"ok": false, "error": "patch 无效"}),
    };
    let patch: Map<String, Value> = patch_obj.clone();

    for id in patch.keys() {
        if !provider_id_regex().is_match(id) {
            return json!({
                "ok": false,
                "error": format!(
                    "provider 名称「{id}」不合法，请用小写字母、数字与连字符（如 deepseek、xiaomi）"
                ),
            });
        }
    }

    let config_path = match openclaw_config_path() {
        Ok(p) => p,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let openclaw_existed = fs::metadata(&config_path).map(|m| m.is_file()).unwrap_or(false);

    let mut root_val: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => {
                return json!({"ok": false, "error": "当前 openclaw.json 无法解析为 JSON，已中止写入"});
            }
        },
        Err(e) if is_enoent(&e) => json!({}),
        Err(e) => return json!({"ok": false, "error": e.to_string()}),
    };
    if !root_val.is_object() {
        root_val = json!({});
    }

    let mut openclaw_backup_path = String::new();
    if openclaw_existed {
        match backup_openclaw_if_exists(&config_path) {
            Ok(s) => openclaw_backup_path = s,
            Err(e) => return json!({"ok": false, "error": format!("备份 openclaw.json 失败：{e}")}),
        }
    }

    let agent_id = extract_default_agent_id(&root_val);
    let root_map = root_val.as_object_mut().unwrap();

    let agent_models_path = match agent_models_json_path(&agent_id) {
        Ok(p) => p,
        Err(e) => {
            return json!({
                "ok": false,
                "error": e,
                "backupPath": empty_to_null(&openclaw_backup_path),
            });
        }
    };
    let agent_dir = agent_models_path
        .parent()
        .expect("agent models path has parent")
        .to_path_buf();

    let agent_bak = match backup_agent_models_if_exists(&agent_models_path) {
        Ok(s) => s,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("备份代理 models.json 失败：{e}"),
                "backupPath": empty_to_null(&openclaw_backup_path),
            });
        }
    };

    let mut agent_root: Map<String, Value> = match fs::read_to_string(&agent_models_path) {
        Ok(raw) => match serde_json::from_str::<Value>(&raw) {
            Ok(v) => v.as_object().cloned().unwrap_or_default(),
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("代理 models.json 无法解析：{e}"),
                    "backupPath": empty_to_null(&openclaw_backup_path),
                    "agentModelsBackupPath": empty_to_null(&agent_bak),
                });
            }
        },
        Err(e) if is_enoent(&e) => Map::new(),
        Err(e) => {
            return json!({
                "ok": false,
                "error": e.to_string(),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
            });
        }
    };

    if !agent_root
        .get("providers")
        .map(|v| v.is_object())
        .unwrap_or(false)
    {
        agent_root.insert("providers".into(), json!({}));
    }
    let agent_providers = agent_root
        .get_mut("providers")
        .unwrap()
        .as_object_mut()
        .unwrap();

    for (id, body) in &patch {
        if body.is_null() {
            agent_providers.remove(id);
        } else if let Some(bo) = body.as_object() {
            let existing = agent_providers.get(id).cloned().unwrap_or(Value::Null);
            agent_providers.insert(id.clone(), merge_provider_entry(&existing, bo));
        } else {
            return json!({
                "ok": false,
                "error": format!("provider「{id}」的合并内容无效"),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
            });
        }
    }

    normalize_agent_providers_models_shape(agent_providers);

    let global_before = extract_models_providers(&Value::Object(root_map.clone()));
    let patch_ids: Vec<String> = patch.keys().cloned().collect();
    let strip_from_openclaw =
        openclaw_existed && patch_ids.iter().any(|id| global_before.contains_key(id));

    if strip_from_openclaw {
        strip_global_providers_from_open_claw_root(root_map, &patch_ids);
    }

    let root_auth_dirty =
        openclaw_existed && sync_open_claw_root_auth_profile_refs(root_map, &patch, agent_providers);

    let auth_profiles_path = match agent_auth_profiles_json_path(&agent_id) {
        Ok(p) => p,
        Err(e) => {
            return json!({"ok": false, "error": e});
        }
    };

    let auth_existing_raw: Option<String> = match fs::read_to_string(&auth_profiles_path) {
        Ok(s) => Some(s),
        Err(e) if is_enoent(&e) => None,
        Err(e) => {
            return json!({
                "ok": false,
                "error": format!("读取代理 auth-profiles.json 失败：{e}"),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
            });
        }
    };

    if let Some(ref raw) = auth_existing_raw {
        if serde_json::from_str::<Value>(raw).is_err() {
            return json!({
                "ok": false,
                "error": "代理 auth-profiles.json 不是合法 JSON，请用编辑器修正后再试（本次未写入 models / openclaw）",
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
            });
        }
    }

    let (next_auth_root, auth_profiles_changed) = match build_next_agent_auth_profiles_root(
        auth_existing_raw.as_deref(),
        &patch,
        agent_providers,
    ) {
        Ok(x) => x,
        Err(e) => return json!({"ok": false, "error": e}),
    };

    let agent_out = format!(
        "{}\n",
        serde_json::to_string_pretty(&Value::Object(agent_root.clone())).unwrap()
    );
    if let Err(e) = fs::create_dir_all(&agent_dir) {
        return json!({
            "ok": false,
            "error": e.to_string(),
            "backupPath": empty_to_null(&openclaw_backup_path),
            "agentModelsBackupPath": empty_to_null(&agent_bak),
        });
    }
    if let Err(e) = fs::write(&agent_models_path, &agent_out) {
        return json!({
            "ok": false,
            "error": e.to_string(),
            "backupPath": empty_to_null(&openclaw_backup_path),
            "agentModelsBackupPath": empty_to_null(&agent_bak),
        });
    }

    let mut auth_profiles_backup_path = String::new();
    if auth_profiles_changed {
        match backup_agent_auth_if_exists(&auth_profiles_path) {
            Ok(s) => auth_profiles_backup_path = s,
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("models.json 已更新，但备份代理 auth-profiles.json 失败：{e}（请重试保存以写入凭据）"),
                    "backupPath": empty_to_null(&openclaw_backup_path),
                    "agentModelsBackupPath": empty_to_null(&agent_bak),
                });
            }
        }
        if let Err(e) = fs::create_dir_all(auth_profiles_path.parent().unwrap()) {
            return json!({
                "ok": false,
                "error": e.to_string(),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
                "authProfilesBackupPath": empty_to_null(&auth_profiles_backup_path),
            });
        }
        let auth_out = format!(
            "{}\n",
            serde_json::to_string_pretty(&next_auth_root).unwrap()
        );
        if let Err(e) = fs::write(&auth_profiles_path, auth_out) {
            return json!({
                "ok": false,
                "error": format!("models.json 已更新，但写入代理 auth-profiles.json 失败：{e}（网关仍可能报无 API Key，请重试保存）"),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
                "authProfilesBackupPath": empty_to_null(&auth_profiles_backup_path),
            });
        }
    }

    let root_needs_write = openclaw_existed && (strip_from_openclaw || root_auth_dirty);
    if root_needs_write {
        let out = format!(
            "{}\n",
            serde_json::to_string_pretty(&Value::Object(root_map.clone())).unwrap()
        );
        let odir = match openclaw_dir() {
            Ok(d) => d,
            Err(e) => {
                return json!({
                    "ok": false,
                    "error": format!("写入 openclaw.json 失败：{e}"),
                    "backupPath": empty_to_null(&openclaw_backup_path),
                    "agentModelsBackupPath": empty_to_null(&agent_bak),
                    "authProfilesBackupPath": empty_to_null(&auth_profiles_backup_path),
                });
            }
        };
        if let Err(e) = fs::create_dir_all(&odir) {
            return json!({
                "ok": false,
                "error": format!("写入 openclaw.json 失败：{e}"),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
                "authProfilesBackupPath": empty_to_null(&auth_profiles_backup_path),
            });
        }
        if let Err(e) = fs::write(&config_path, out) {
            return json!({
                "ok": false,
                "error": format!("写入 openclaw.json 失败：{e}"),
                "backupPath": empty_to_null(&openclaw_backup_path),
                "agentModelsBackupPath": empty_to_null(&agent_bak),
                "authProfilesBackupPath": empty_to_null(&auth_profiles_backup_path),
            });
        }
    }

    let mut ok = json!({
        "ok": true,
        "defaultAgentId": agent_id,
    });
    if !openclaw_backup_path.is_empty() {
        ok["backupPath"] = json!(&openclaw_backup_path);
    }
    if !agent_bak.is_empty() {
        ok["agentModelsBackupPath"] = json!(&agent_bak);
    }
    if !auth_profiles_backup_path.is_empty() {
        ok["authProfilesBackupPath"] = json!(&auth_profiles_backup_path);
    }
    ok
}

fn empty_to_null(s: &str) -> Value {
    if s.is_empty() {
        Value::Null
    } else {
        json!(s)
    }
}
