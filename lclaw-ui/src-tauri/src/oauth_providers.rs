//! Self-contained OAuth flows for AI providers.
//! Implements flows ourselves (not via `openclaw onboard`) so they work
//! correctly from a headless Tauri subprocess context.

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use uuid::Uuid;

// ── Event key for progress updates ───────────────────────────────────────────

pub const OAUTH_PROGRESS_EVENT: &str = "didclaw-oauth-progress";

// ── PKCE helpers ─────────────────────────────────────────────────────────────

fn pkce_verifier() -> String {
    let id1 = Uuid::new_v4().simple().to_string();
    let id2 = Uuid::new_v4().simple().to_string();
    let raw = format!("{id1}{id2}");
    URL_SAFE_NO_PAD.encode(raw.as_bytes())
}

fn pkce_challenge(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(h.finalize())
}

fn random_state() -> String {
    URL_SAFE_NO_PAD.encode(Uuid::new_v4().simple().to_string().as_bytes())
}

// ── auth-profiles.json I/O ────────────────────────────────────────────────────

/// Discovers all agent IDs from ~/.openclaw/agents/*/agent/auth-profiles.json.
/// Falls back to "main" if none found.
fn discover_agent_ids() -> Vec<String> {
    let agents_dir = match crate::openclaw_common::openclaw_dir() {
        Ok(d) => d.join("agents"),
        Err(_) => return vec!["main".to_string()],
    };
    let mut ids = Vec::new();
    if let Ok(entries) = fs::read_dir(&agents_dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !name.starts_with('.') {
                    ids.push(name);
                }
            }
        }
    }
    if ids.is_empty() {
        ids.push("main".to_string());
    }
    ids
}

/// Writes an OAuth token record into ~/.openclaw/agents/{id}/agent/auth-profiles.json
/// for every discovered agent. Compatible with ClawX's `saveOAuthTokenToOpenClaw`.
pub fn save_oauth_token(
    provider: &str,
    access: &str,
    refresh: &str,
    expires_unix_ms: i64,
    extra: Option<&Map<String, Value>>,
) -> Result<(), String> {
    let agent_ids = discover_agent_ids();
    let profile_id = format!("{provider}:default");

    for agent_id in &agent_ids {
        let path = crate::openclaw_common::agent_auth_profiles_json_path(agent_id)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut store: Map<String, Value> = match fs::read_to_string(&path) {
            Ok(raw) => serde_json::from_str::<Value>(&raw)
                .ok()
                .and_then(|v| v.as_object().cloned())
                .unwrap_or_default(),
            Err(_) => Map::new(),
        };

        // Build profile entry.
        let mut profile = json!({
            "type": "oauth",
            "provider": provider,
            "access": access,
            "refresh": refresh,
            "expires": expires_unix_ms,
        });
        if let (Some(p), Some(e)) = (profile.as_object_mut(), extra) {
            for (k, v) in e {
                p.insert(k.clone(), v.clone());
            }
        }

        let profiles = store
            .entry("profiles")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .cloned()
            .unwrap_or_default();
        let mut profiles_map = profiles;
        profiles_map.insert(profile_id.clone(), profile);
        store.insert("profiles".into(), Value::Object(profiles_map));

        // Update order list.
        {
            let order = store
                .entry("order")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .cloned()
                .unwrap_or_default();
            let mut order_map = order;
            let list = order_map
                .entry(provider.to_string())
                .or_insert_with(|| json!([]))
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut list = list;
            if !list.iter().any(|v| v.as_str() == Some(&profile_id)) {
                list.push(Value::String(profile_id.clone()));
            }
            order_map.insert(provider.to_string(), Value::Array(list));
            store.insert("order".into(), Value::Object(order_map));
        }

        // Update lastGood.
        {
            let last_good = store
                .entry("lastGood")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .cloned()
                .unwrap_or_default();
            let mut lg_map = last_good;
            lg_map.insert(provider.to_string(), Value::String(profile_id.clone()));
            store.insert("lastGood".into(), Value::Object(lg_map));
        }

        let out = serde_json::to_string_pretty(&Value::Object(store))
            .map_err(|e| e.to_string())?;
        fs::write(&path, out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ── MiniMax Device Authorization Flow (RFC 8628) ─────────────────────────────

const MINIMAX_CLIENT_ID: &str = "78257093-7e40-4613-99e0-527b14b39113";
const MINIMAX_SCOPE: &str = "group_id profile model.completion";
const MINIMAX_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:user_code";

fn minimax_base_url(region: &str) -> &'static str {
    if region == "cn" {
        "https://api.minimaxi.com"
    } else {
        "https://api.minimax.io"
    }
}


#[derive(Debug)]
struct MinimaxCodeResponse {
    user_code: String,
    verification_uri: String,
    interval_ms: u64,
}

fn minimax_request_code(base_url: &str, challenge: &str, state: &str) -> Result<MinimaxCodeResponse, String> {
    let body = form_urlencoded_body(&[
        ("response_type", "code"),
        ("client_id", MINIMAX_CLIENT_ID),
        ("scope", MINIMAX_SCOPE),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
    ]);
    let url = format!("{base_url}/oauth/code");
    let resp = ureq::post(&url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Accept", "application/json")
        .set("x-request-id", &Uuid::new_v4().to_string())
        .send_string(&body)
        .map_err(|e| format!("MiniMax OAuth code request failed: {e}"))?;

    let payload: Value = resp
        .into_json()
        .map_err(|e| format!("MiniMax OAuth code response parse failed: {e}"))?;

    let user_code = payload["user_code"]
        .as_str()
        .ok_or("MiniMax OAuth: missing user_code")?
        .to_string();
    let verification_uri = payload["verification_uri"]
        .as_str()
        .ok_or("MiniMax OAuth: missing verification_uri")?
        .to_string();
    let interval_s = payload["interval"].as_u64().unwrap_or(2);
    let resp_state = payload["state"].as_str().unwrap_or("").to_string();

    if resp_state != state {
        return Err("MiniMax OAuth: state mismatch".to_string());
    }

    Ok(MinimaxCodeResponse {
        user_code,
        verification_uri,
        interval_ms: interval_s.max(2) * 1000,
    })
}

fn minimax_poll_token(
    base_url: &str,
    user_code: &str,
    verifier: &str,
) -> Result<Option<Value>, String> {
    let body = form_urlencoded_body(&[
        ("grant_type", MINIMAX_GRANT_TYPE),
        ("client_id", MINIMAX_CLIENT_ID),
        ("user_code", user_code),
        ("code_verifier", verifier),
    ]);
    let url = format!("{base_url}/oauth/token");

    // ureq returns Err for non-2xx. Device Flow servers often return
    // 4xx with a JSON body carrying "status":"pending" or an error code,
    // so we read the body from both 2xx and 4xx paths.
    let payload: Value = match ureq::post(&url)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .set("Accept", "application/json")
        .send_string(&body)
    {
        Ok(resp) => resp
            .into_json()
            .map_err(|e| format!("MiniMax token poll parse failed: {e}"))?,
        Err(ureq::Error::Status(_code, resp)) => resp
            .into_json()
            .map_err(|e| format!("MiniMax token poll error parse failed: {e}"))?,
        Err(e) => return Err(format!("MiniMax token poll network error: {e}")),
    };

    // Handle MiniMax custom status field ("success" / "pending").
    if let Some(status) = payload["status"].as_str() {
        return match status {
            "success" => Ok(Some(payload)),
            "pending" => Ok(None),
            _ => {
                let msg = payload["base_resp"]["status_msg"]
                    .as_str()
                    .unwrap_or(status)
                    .to_string();
                Err(msg)
            }
        };
    }

    // Handle RFC 8628 standard error field (authorization_pending, slow_down, etc.).
    if let Some(err) = payload["error"].as_str() {
        return match err {
            "authorization_pending" | "slow_down" => Ok(None),
            _ => {
                let desc = payload["error_description"]
                    .as_str()
                    .unwrap_or(err)
                    .to_string();
                Err(desc)
            }
        };
    }

    // If neither field is present but we have an access_token, treat as success.
    if payload["access_token"].is_string() {
        return Ok(Some(payload));
    }

    Err("MiniMax token poll returned unrecognised response".to_string())
}

/// Full MiniMax Device Flow. Emits OAUTH_PROGRESS_EVENT for UI updates.
pub async fn run_minimax_oauth(app: tauri::AppHandle, region: String) -> Result<Value, String> {
    let region = if region.trim() == "cn" { "cn" } else { "global" };
    let base_url = minimax_base_url(region);

    let verifier = pkce_verifier();
    let challenge = pkce_challenge(&verifier);
    let state = random_state();

    let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
        "provider": "minimax-portal",
        "step": "requesting_code"
    }));

    let code_resp = tokio::task::spawn_blocking({
        let base_url = base_url.to_string();
        let challenge = challenge.clone();
        let state = state.clone();
        move || minimax_request_code(&base_url, &challenge, &state)
    })
    .await
    .map_err(|e| e.to_string())??;

    // Open browser.
    let _ = open::that(&code_resp.verification_uri);

    let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
        "provider": "minimax-portal",
        "step": "browser_opened",
        "userCode": code_resp.user_code,
        "verificationUri": code_resp.verification_uri,
    }));

    // Poll until approved or expired.
    // Use a fixed 10-minute window — avoids ambiguity over whether
    // expired_in is a Unix timestamp (s or ms) or a duration.
    let expire_at = std::time::Instant::now() + Duration::from_secs(600);

    let interval = Duration::from_millis(code_resp.interval_ms);
    let user_code = code_resp.user_code.clone();
    let verifier_clone = verifier.clone();
    let base_url_s = base_url.to_string();

    loop {
        if std::time::Instant::now() >= expire_at {
            return Err("MiniMax OAuth timed out before user approved access.".to_string());
        }

        tokio::time::sleep(interval).await;

        let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
            "provider": "minimax-portal",
            "step": "polling"
        }));

        let uc = user_code.clone();
        let ver = verifier_clone.clone();
        let bu = base_url_s.clone();
        let poll_result = tokio::task::spawn_blocking(move || minimax_poll_token(&bu, &uc, &ver))
            .await
            .map_err(|e| e.to_string())??;

        if let Some(token) = poll_result {
            let access = token["access_token"].as_str().unwrap_or("").to_string();
            let refresh = token["refresh_token"].as_str().unwrap_or("").to_string();
            let expires = token["expired_in"].as_i64().unwrap_or(0);
            // MiniMax returns a per-account resource_url as the base API endpoint.
            let resource_url = token["resource_url"].as_str().map(|s| s.to_string());

            // 1. Write OAuth token to auth-profiles.json.
            save_oauth_token("minimax-portal", &access, &refresh, expires, None)?;

            // 2. Patch openclaw.json: provider config + plugin + default model.
            //    Mirrors ClawX's setOpenClawDefaultModelWithOverride for MiniMax.
            patch_openclaw_json_for_minimax(region, resource_url.as_deref())?;

            let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
                "provider": "minimax-portal",
                "step": "success"
            }));

            return Ok(json!({
                "ok": true,
                "provider": "minimax-portal",
                "region": region,
            }));
        }
    }
}

/// Writes all MiniMax-specific entries into openclaw.json after a successful OAuth:
///   models.providers["minimax-portal"]  – baseUrl / api / apiKeyEnv / authHeader / modelIds
///   plugins.allow                       – ensure "minimax-portal-auth" is listed
///   plugins.entries["minimax-portal-auth"] – { enabled: true }
///   agents.defaults.model               – set primary model
///
/// Mirrors ClawX's setOpenClawDefaultModelWithOverride + plugin enablement logic.
fn patch_openclaw_json_for_minimax(region: &str, resource_url: Option<&str>) -> Result<(), String> {
    let config_path = crate::openclaw_common::openclaw_config_path()
        .map_err(|e| format!("openclaw.json path: {e}"))?;

    if let Some(parent) = config_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut root: Value = match fs::read_to_string(&config_path) {
        Ok(raw) => serde_json::from_str(&raw).unwrap_or(json!({})),
        Err(e) if crate::openclaw_common::is_enoent(&e) => json!({}),
        Err(e) => return Err(format!("read openclaw.json: {e}")),
    };
    if !root.is_object() {
        root = json!({});
    }
    let root_map = root.as_object_mut().unwrap();

    // ── Resolve base URL ──────────────────────────────────────────────────────
    // Prefer per-account resource_url from the token (MiniMax returns this).
    // Ensure it ends with /anthropic (Anthropic-compatible adapter path).
    let default_base = if region == "cn" {
        "https://api.minimaxi.com/anthropic"
    } else {
        "https://api.minimax.io/anthropic"
    };
    let base_url = resource_url
        .filter(|s| !s.is_empty())
        .map(|u| {
            let u = if !u.starts_with("http://") && !u.starts_with("https://") {
                format!("https://{u}")
            } else {
                u.to_string()
            };
            // Strip trailing /v1 or /anthropic, then re-append /anthropic.
            let trimmed = u
                .trim_end_matches('/')
                .trim_end_matches("/anthropic")
                .trim_end_matches("/v1");
            format!("{trimmed}/anthropic")
        })
        .unwrap_or_else(|| default_base.to_string());

    // ── models.providers["minimax-portal"] ───────────────────────────────────
    {
        let models = root_map
            .entry("models")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("models is not an object")?;
        let providers = models
            .entry("providers")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("models.providers is not an object")?;

        providers.insert(
            "minimax-portal".to_string(),
            json!({
                "baseUrl": base_url,
                "api": "anthropic-messages",
                // Tells Gateway to resolve credentials from auth-profiles.json.
                "apiKeyEnv": "minimax-oauth",
                // Use Authorization: Bearer instead of x-api-key.
                "authHeader": true,
                "modelIds": ["MiniMax-M2.5", "MiniMax-Text-01"]
            }),
        );
    }

    // ── plugins: allow + entries ──────────────────────────────────────────────
    {
        let plugins = root_map
            .entry("plugins")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("plugins is not an object")?;

        // plugins.allow
        let allow = plugins
            .entry("allow")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or("plugins.allow is not an array")?;
        let plugin_id = "minimax-portal-auth";
        if !allow.iter().any(|v| v.as_str() == Some(plugin_id)) {
            allow.push(Value::String(plugin_id.to_string()));
        }

        // plugins.entries["minimax-portal-auth"]
        let entries = plugins
            .entry("entries")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("plugins.entries is not an object")?;
        entries.insert(plugin_id.to_string(), json!({ "enabled": true }));
    }

    // ── agents.defaults.model ─────────────────────────────────────────────────
    {
        let agents = root_map
            .entry("agents")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("agents is not an object")?;
        let defaults = agents
            .entry("defaults")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("agents.defaults is not an object")?;
        defaults.insert(
            "model".to_string(),
            json!({
                "primary": "minimax-portal/MiniMax-M2.5",
                "fallbacks": []
            }),
        );
    }

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(&config_path, format!("{out}\n")).map_err(|e| e.to_string())?;
    Ok(())
}

// ── OpenAI Codex PKCE + Local Callback Flow ───────────────────────────────────

const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_AUTH_URL: &str = "https://auth.openai.com/oauth/authorize";
const CODEX_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const CODEX_REDIRECT_URI: &str = "http://localhost:1455/auth/callback";
const CODEX_SCOPE: &str = "openid profile email offline_access";
const CODEX_JWT_CLAIM_PATH: &str = "https://api.openai.com/auth";
const CODEX_CALLBACK_TIMEOUT_SECS: u64 = 300; // 5 minutes

fn build_codex_auth_url(challenge: &str, state: &str) -> String {
    let params = form_urlencoded_body(&[
        ("response_type", "code"),
        ("client_id", CODEX_CLIENT_ID),
        ("redirect_uri", CODEX_REDIRECT_URI),
        ("scope", CODEX_SCOPE),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
        ("id_token_add_organizations", "true"),
        ("codex_cli_simplified_flow", "true"),
        ("originator", "codex_cli_rs"),
    ]);
    format!("{CODEX_AUTH_URL}?{params}")
}

fn codex_exchange_code(code: &str, verifier: &str) -> Result<Value, String> {
    let body = form_urlencoded_body(&[
        ("grant_type", "authorization_code"),
        ("client_id", CODEX_CLIENT_ID),
        ("code", code),
        ("code_verifier", verifier),
        ("redirect_uri", CODEX_REDIRECT_URI),
    ]);
    let resp = ureq::post(CODEX_TOKEN_URL)
        .set("Content-Type", "application/x-www-form-urlencoded")
        .send_string(&body)
        .map_err(|e| format!("OpenAI Codex token exchange failed: {e}"))?;

    resp.into_json::<Value>()
        .map_err(|e| format!("OpenAI Codex token response parse failed: {e}"))
}

fn extract_account_id_from_jwt(token: &str) -> Option<String> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let padded = {
        let s = parts[1];
        let pad = (4 - s.len() % 4) % 4;
        format!("{s}{}", "=".repeat(pad))
    };
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(padded.replace('-', "+").replace('_', "/"))
        .ok()?;
    let payload: Value = serde_json::from_slice(&decoded).ok()?;
    payload
        .get(CODEX_JWT_CLAIM_PATH)?
        .get("chatgpt_account_id")?
        .as_str()
        .map(|s| s.to_string())
}

const CODEX_SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Authentication successful</title>
<style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5}
.box{background:#fff;padding:2rem 3rem;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}
h1{color:#1a1a1a;font-size:1.5rem}p{color:#666}</style>
</head><body><div class="box"><h1>✓ Authentication successful</h1><p>Return to DidClaw to continue.</p></div></body></html>"#;

/// Full OpenAI Codex PKCE flow with local callback server on :1455.
pub async fn run_openai_codex_oauth(app: tauri::AppHandle) -> Result<Value, String> {
    use axum::{
        extract::Query,
        response::{Html, IntoResponse},
        routing::get,
        Router,
    };
    use tokio::sync::oneshot;

    let verifier = pkce_verifier();
    let challenge = pkce_challenge(&verifier);
    let state = random_state();
    let auth_url = build_codex_auth_url(&challenge, &state);

    let (tx, rx) = oneshot::channel::<Result<String, String>>();
    let tx = Arc::new(Mutex::new(Some(tx)));
    let expected_state = state.clone();

    let tx_clone = tx.clone();
    let state_clone = expected_state.clone();

    let router = Router::new().route(
        "/auth/callback",
        get(move |Query(params): Query<HashMap<String, String>>| {
            let tx = tx_clone.clone();
            let expected = state_clone.clone();
            async move {
                let code = params.get("code").cloned();
                let got_state = params.get("state").cloned();
                if got_state.as_deref() != Some(&expected) {
                    return (
                        axum::http::StatusCode::BAD_REQUEST,
                        "State mismatch".to_string(),
                    )
                        .into_response();
                }
                match code {
                    Some(c) => {
                        if let Some(sender) = tx.lock().unwrap().take() {
                            let _ = sender.send(Ok(c));
                        }
                        Html(CODEX_SUCCESS_HTML).into_response()
                    }
                    None => {
                        if let Some(sender) = tx.lock().unwrap().take() {
                            let _ = sender.send(Err("Missing code".to_string()));
                        }
                        (
                            axum::http::StatusCode::BAD_REQUEST,
                            "Missing authorization code".to_string(),
                        )
                            .into_response()
                    }
                }
            }
        }),
    );

    let listener = tokio::net::TcpListener::bind("127.0.0.1:1455")
        .await
        .map_err(|e| format!("Cannot start OpenAI Codex callback server on :1455 — {e}"))?;

    let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
        "provider": "openai-codex",
        "step": "browser_opening",
        "authUrl": auth_url,
    }));

    // Open browser.
    let _ = open::that(&auth_url);

    let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
        "provider": "openai-codex",
        "step": "waiting_callback"
    }));

    // Serve callback with timeout.
    let code = tokio::select! {
        _ = axum::serve(listener, router) => {
            return Err("OpenAI Codex callback server exited unexpectedly".to_string());
        }
        result = async {
            tokio::time::timeout(
                Duration::from_secs(CODEX_CALLBACK_TIMEOUT_SECS),
                rx,
            ).await
        } => {
            match result {
                Ok(Ok(inner)) => inner?,
                Ok(Err(_)) => return Err("OpenAI Codex OAuth: channel closed unexpectedly".to_string()),
                Err(_) => return Err("OpenAI Codex OAuth timed out (5 min). The browser did not redirect back.".to_string()),
            }
        }
    };

    let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
        "provider": "openai-codex",
        "step": "exchanging_code"
    }));

    // Exchange code for tokens (blocking HTTP).
    let verifier_clone = verifier.clone();
    let code_clone = code.clone();
    let token_resp = tokio::task::spawn_blocking(move || codex_exchange_code(&code_clone, &verifier_clone))
        .await
        .map_err(|e| e.to_string())??;

    let access = token_resp["access_token"]
        .as_str()
        .ok_or("OpenAI Codex: missing access_token")?
        .to_string();
    let refresh = token_resp["refresh_token"]
        .as_str()
        .ok_or("OpenAI Codex: missing refresh_token (requires ChatGPT Plus/Codex subscription)")?
        .to_string();
    let expires_in = token_resp["expires_in"].as_i64().unwrap_or(3600);
    let expires_ms = chrono::Utc::now().timestamp_millis() + expires_in * 1000;

    let account_id = extract_account_id_from_jwt(&access)
        .unwrap_or_default();

    let mut extra: Map<String, Value> = Map::new();
    if !account_id.is_empty() {
        extra.insert("accountId".into(), Value::String(account_id));
    }

    save_oauth_token(
        "openai-codex",
        &access,
        &refresh,
        expires_ms,
        if extra.is_empty() { None } else { Some(&extra) },
    )?;

    // Write provider config.
    let patch = json!({
        "patch": {
            "openai": {
                "baseUrl": "https://api.openai.com/v1",
                "api": "openai-responses"
            }
        }
    });
    crate::openclaw_providers::write_open_claw_providers_patch(patch);

    crate::openclaw_model_config::write_open_claw_model_config(json!({
        "primary": "openai/codex-mini-latest"
    }));

    let _ = app.emit(OAUTH_PROGRESS_EVENT, json!({
        "provider": "openai-codex",
        "step": "success"
    }));

    Ok(json!({
        "ok": true,
        "provider": "openai-codex",
    }))
}

// ── Shared utility ────────────────────────────────────────────────────────────

fn form_urlencoded_body(pairs: &[(&str, &str)]) -> String {
    // Simple percent-encoding for form data; sufficient for OAuth params.
    fn encode(s: &str) -> String {
        let mut out = String::with_capacity(s.len() * 3);
        for b in s.bytes() {
            match b {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9'
                | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
                _ => out.push_str(&format!("%{b:02X}")),
            }
        }
        out
    }
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}
