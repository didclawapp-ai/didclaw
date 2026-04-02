use serde_json::{json, Map, Value};
use std::collections::BTreeSet;
use std::fs;

fn read_env_vars_from_openclaw_config() -> Map<String, Value> {
    let path = match crate::openclaw_common::openclaw_config_path() {
        Ok(p) => p,
        Err(_) => return Map::new(),
    };
    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return Map::new(),
    };
    let root: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => return Map::new(),
    };
    let Some(env) = root.get("env").and_then(|v| v.as_object()) else {
        return Map::new();
    };
    env.get("vars")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default()
}

fn as_object_clone(value: Option<&Value>) -> Map<String, Value> {
    value
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default()
}

fn model_refs_from_providers(providers: &Map<String, Value>) -> Vec<String> {
    let mut refs = BTreeSet::new();
    for (provider_id, provider_val) in providers {
        let Some(provider_obj) = provider_val.as_object() else {
            continue;
        };
        let Some(models_val) = provider_obj.get("models") else {
            continue;
        };
        if let Some(models_obj) = models_val.as_object() {
            for model_id in models_obj.keys() {
                let id = model_id.trim();
                if !id.is_empty() {
                    refs.insert(format!("{provider_id}/{id}"));
                }
            }
            continue;
        }
        if let Some(models_arr) = models_val.as_array() {
            for item in models_arr {
                let id = item
                    .as_object()
                    .and_then(|o| o.get("id"))
                    .and_then(|v| v.as_str())
                    .map(str::trim)
                    .filter(|s| !s.is_empty());
                if let Some(id) = id {
                    refs.insert(format!("{provider_id}/{id}"));
                }
            }
        }
    }
    refs.into_iter().collect()
}

pub fn read_open_claw_ai_snapshot() -> Value {
    let providers_raw = crate::openclaw_providers::read_open_claw_providers();
    if providers_raw.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return providers_raw;
    }

    let model_raw = crate::openclaw_model_config::read_open_claw_model_config();
    if model_raw.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return model_raw;
    }

    let providers = as_object_clone(providers_raw.get("providers"));
    let model = as_object_clone(model_raw.get("model"));
    let models = as_object_clone(model_raw.get("models"));

    let primary_model = model
        .get("primary")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();

    let fallbacks = model
        .get("fallbacks")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let mut model_refs = BTreeSet::new();
    for key in models.keys() {
        let key = key.trim();
        if !key.is_empty() {
            model_refs.insert(key.to_string());
        }
    }
    for item in model_refs_from_providers(&providers) {
        model_refs.insert(item);
    }
    if !primary_model.is_empty() {
        model_refs.insert(primary_model.clone());
    }
    for item in &fallbacks {
        model_refs.insert(item.clone());
    }

    let env_vars = read_env_vars_from_openclaw_config();

    json!({
        "ok": true,
        "defaultAgentId": providers_raw
            .get("defaultAgentId")
            .and_then(|v| v.as_str())
            .unwrap_or("main"),
        "providers": Value::Object(providers),
        "model": Value::Object(model),
        "models": Value::Object(models),
        "primaryModel": primary_model,
        "fallbacks": fallbacks,
        "modelRefs": model_refs.into_iter().collect::<Vec<_>>(),
        "envVars": Value::Object(env_vars),
    })
}
