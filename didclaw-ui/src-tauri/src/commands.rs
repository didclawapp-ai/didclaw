//! Desktop Tauri IPC; errors use stable codes or JSON `errorKey` for vue-i18n `tauriErr.*`.

use serde_json::{json, Value};
use std::fs;

#[tauri::command]
pub fn didclaw_set_app_locale(app: tauri::AppHandle, locale: String) -> Result<(), String> {
    crate::app_locale::set_locale(locale.trim());
    crate::tray_icon::refresh_tray_menu(&app);
    Ok(())
}

#[tauri::command]
pub async fn preview_open_local(file_url: String) -> Result<Value, String> {
    Ok(crate::preview_local::open_local_preview(file_url).await)
}

#[tauri::command]
pub fn preview_libre_office_status() -> Result<Value, String> {
    Ok(json!({
        "available": crate::preview_local::libre_office_available()
    }))
}

#[tauri::command]
pub fn preview_open_libre_office_download_page() -> Result<(), String> {
    open::that("https://www.libreoffice.org/download/download-libreoffice/")
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn preview_show_libre_office_install_dialog() -> Result<Value, String> {
    Ok(crate::preview_local::show_libre_office_install_dialog())
}

#[tauri::command]
pub fn shell_open_file_url(file_url: String) -> Result<Value, String> {
    let p = match crate::paths::resolve_existing_local_file(&file_url) {
        Ok(p) => p,
        Err(e) => return Ok(json!({"ok": false, "error": e})),
    };
    open::that(&p).map_err(|e| e.to_string())?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn shell_open_external_url(url: String) -> Result<Value, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Ok(json!({
            "ok": false,
            "errorKey": "shellExternalEmpty",
            "error": "链接不能为空",
        }));
    }
    let lower = trimmed.to_ascii_lowercase();
    let allowed =
        lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:");
    if !allowed {
        return Ok(json!({
            "ok": false,
            "errorKey": "shellExternalScheme",
            "error": "仅支持打开 http/https/mailto 外链",
        }));
    }
    open::that(trimmed).map_err(|e| e.to_string())?;
    Ok(json!({"ok": true}))
}

/// 将纯 base64 解码后通过「另存为」写入磁盘（用于聊天内嵌 `data:image/...;base64,...`）。
#[tauri::command]
pub fn dialog_save_base64_file(
    base64_data: String,
    default_file_name: String,
) -> Result<Value, String> {
    use base64::Engine;
    // base64 膨胀比约 1.37x；限制 50MB 二进制对应约 68MB base64 输入
    const MAX_BASE64_INPUT: usize = 68 * 1024 * 1024;
    if base64_data.len() > MAX_BASE64_INPUT {
        return Ok(json!({
            "ok": false,
            "errorKey": "saveBase64TooLarge",
            "error": "文件过大（超过 50MB 限制）",
        }));
    }
    let cleaned: String = base64_data.chars().filter(|c| !c.is_whitespace()).collect();
    let bytes = match base64::engine::general_purpose::STANDARD.decode(cleaned.as_bytes()) {
        Ok(b) => b,
        Err(e) => {
            return Ok(json!({
                "ok": false,
                "errorKey": "saveBase64DecodeFailed",
                "detail": e.to_string(),
                "error": format!("base64 decode failed: {e}"),
            }));
        }
    };
    let name = default_file_name.trim();
    let name = if name.is_empty() {
        "image.png".to_string()
    } else {
        name.to_string()
    };
    let dest = rfd::FileDialog::new().set_file_name(&name).save_file();
    let Some(dest) = dest else {
        return Ok(json!({"ok": true, "saved": false}));
    };
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    Ok(json!({"ok": true, "saved": true}))
}

#[tauri::command]
pub fn file_save_copy_as(file_url: String) -> Result<Value, String> {
    let src = match crate::paths::resolve_existing_local_file(&file_url) {
        Ok(p) => p,
        Err(e) => return Ok(json!({"ok": false, "error": e})),
    };
    let name = src
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("file");
    let dest = rfd::FileDialog::new()
        .set_file_name(name)
        .save_file();
    let Some(dest) = dest else {
        return Ok(json!({"ok": true, "saved": false}));
    };
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(json!({"ok": true, "saved": true}))
}

#[tauri::command]
pub fn shell_prepare_email_with_local_file(file_url: String) -> Result<Value, String> {
    let p = match crate::paths::resolve_existing_local_file(&file_url) {
        Ok(p) => p,
        Err(e) => return Ok(json!({"ok": false, "error": e})),
    };
    #[cfg(windows)]
    {
        let p_str = p.to_string_lossy().to_string();
        let arg = format!("/select,\"{}\"", p_str.replace('"', ""));
        std::process::Command::new("explorer")
            .arg(arg)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        return Ok(json!({
            "ok": false,
            "errorKey": "emailPrepareUnsupported",
            "error": "Tauri: 当前平台「邮件准备」尚未实现",
        }));
    }
    let mut clip = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clip
        .set_text(p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn shell_copy_local_file_for_share(file_url: String, label: Option<String>) -> Result<Value, String> {
    let p = match crate::paths::resolve_existing_local_file(&file_url) {
        Ok(p) => p,
        Err(e) => return Ok(json!({"ok": false, "error": e})),
    };
    let name = label
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from)
        .unwrap_or_else(|| {
            p.file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("file")
                .to_string()
        });
    let href = url::Url::from_file_path(&p)
        .map(|u| u.to_string())
        .unwrap_or_default();
    let path_label = if crate::app_locale::is_en() {
        "Path:"
    } else {
        "路径："
    };
    let text = format!("{name}\n{path_label} {}\n{href}", p.to_string_lossy());
    let mut clip = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clip.set_text(text).map_err(|e| e.to_string())?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn dialog_open_file() -> Result<Option<String>, String> {
    let (md_label, img_label) = if crate::app_locale::is_en() {
        ("Markdown / Text", "Images")
    } else {
        ("Markdown / 文本", "图片")
    };
    let file = rfd::FileDialog::new()
        .add_filter("Office", &["ppt", "pptx", "xls", "xlsx", "doc", "docx"])
        .add_filter(md_label, &["md", "markdown", "txt", "log", "csv"])
        .add_filter("PDF", &["pdf"])
        .add_filter(img_label, &["png", "jpg", "jpeg", "gif", "webp", "svg"])
        .pick_file();
    Ok(file.and_then(|p| url::Url::from_file_path(&p).ok().map(|u| u.to_string())))
}

#[tauri::command]
pub fn get_open_claw_setup_status(app: tauri::AppHandle) -> Result<Value, String> {
    Ok(crate::setup_status::build_open_claw_setup_status(&app))
}

#[tauri::command]
pub async fn check_openclaw_update(app: tauri::AppHandle) -> Result<Value, String> {
    let app = app.clone();
    let v = tokio::task::spawn_blocking(move || crate::openclaw_version_check::check_openclaw_update_impl(&app))
        .await
        .map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub async fn check_didclaw_update(
    app: tauri::AppHandle,
    endpoint: Option<String>,
) -> Result<Value, String> {
    let app = app.clone();
    let endpoint = endpoint.unwrap_or_default();
    let v = tokio::task::spawn_blocking(move || {
        crate::didclaw_update::check_didclaw_update_impl(&app, &endpoint)
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(v)
}

#[tauri::command]
pub async fn install_didclaw_update(download_url: String) -> Result<Value, String> {
    let url = download_url.clone();
    let path = tokio::task::spawn_blocking(move || {
        crate::didclaw_update::install_didclaw_update_impl(&url)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e)?;
    Ok(json!({ "ok": true, "installerPath": path }))
}

#[tauri::command]
pub async fn run_ensure_openclaw_windows_install(
    app: tauri::AppHandle,
    skip_onboard: bool,
    upgrade: Option<bool>,
) -> Result<Value, String> {
    crate::openclaw_ensure_install::run_ensure_openclaw_windows_install_impl(app, skip_onboard, upgrade.unwrap_or(false)).await
}

#[tauri::command]
pub fn read_gateway_local_config(app: tauri::AppHandle) -> Result<Value, String> {
    let m = crate::gateway_local::read_merged_map(&app)?;
    let mut v = crate::gateway_local::merged_to_frontend_value(&m);
    if let Value::Object(ref mut map) = v {
        let token_missing = match map.get("token") {
            None => true,
            Some(Value::String(s)) => s.trim().is_empty(),
            _ => false,
        };
        if token_missing {
            if let Some(t) = crate::openclaw_common::read_openclaw_gateway_token_for_client() {
                map.insert("token".into(), json!(t));
            }
        }
    }
    Ok(v)
}

#[tauri::command]
pub fn write_gateway_local_config(app: tauri::AppHandle, data: Value) -> Result<Value, String> {
    crate::gateway_local::write_merged_from_payload(&app, &data)?;
    Ok(json!({"ok": true}))
}

#[tauri::command]
pub fn didclaw_kv_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    crate::didclaw_db::user_kv_get(&app, key.trim())
}

#[tauri::command]
pub fn didclaw_kv_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    crate::didclaw_db::user_kv_set(&app, key.trim(), &value)
}

#[tauri::command]
pub fn didclaw_kv_remove(app: tauri::AppHandle, key: String) -> Result<(), String> {
    crate::didclaw_db::user_kv_remove(&app, key.trim())
}

#[tauri::command]
pub async fn ensure_open_claw_gateway(
    app: tauri::AppHandle,
    ws_url: String,
) -> Result<Value, String> {
    crate::openclaw_gateway::ensure_open_claw_gateway_running(app, ws_url).await
}

#[tauri::command]
pub fn restart_open_claw_gateway(app: tauri::AppHandle) -> Result<Value, String> {
    Ok(crate::openclaw_gateway::restart_open_claw_gateway_service(&app))
}

#[tauri::command]
pub fn stop_open_claw_gateway(app: tauri::AppHandle) -> Result<Value, String> {
    Ok(crate::openclaw_gateway::stop_open_claw_gateway_service(&app))
}

#[tauri::command]
pub fn openclaw_plugins_install(
    app: tauri::AppHandle,
    package_spec: String,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    Ok(crate::openclaw_gateway::run_open_claw_plugins_install_service(
        &app,
        package_spec,
        clawhub_token,
        clawhub_registry,
    ))
}

#[tauri::command]
pub fn plugins_pick_package_file() -> Result<Option<String>, String> {
    Ok(crate::openclaw_gateway::pick_plugin_package_file())
}

#[tauri::command]
pub async fn openclaw_plugins_list(
    app: tauri::AppHandle,
    enabled_only: Option<bool>,
) -> Result<Value, String> {
    let app = app.clone();
    let enabled_only = enabled_only.unwrap_or(false);
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::list_open_claw_plugins_service(&app, enabled_only)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_plugins_inspect(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::inspect_open_claw_plugin_service(&app, &plugin_id)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_plugins_set_enabled(
    app: tauri::AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::set_open_claw_plugin_enabled_service(&app, &plugin_id, enabled)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_plugins_update(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::update_open_claw_plugin_service(&app, &plugin_id)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_plugins_uninstall(
    app: tauri::AppHandle,
    plugin_id: String,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::uninstall_open_claw_plugin_service(&app, &plugin_id)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_list(
    app: tauri::AppHandle,
    eligible_only: Option<bool>,
    verbose: Option<bool>,
) -> Result<Value, String> {
    let app = app.clone();
    let eligible_only = eligible_only.unwrap_or(false);
    let verbose = verbose.unwrap_or(false);
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::list_open_claw_skills_service(&app, eligible_only, verbose)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_search(
    app: tauri::AppHandle,
    query: String,
    limit: Option<u32>,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::search_open_claw_skills_service(
            &app,
            &query,
            limit,
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_info(
    app: tauri::AppHandle,
    skill_name: String,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::inspect_open_claw_skill_service(&app, &skill_name)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_install(
    app: tauri::AppHandle,
    skill_slug: String,
    version: Option<String>,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::install_open_claw_skill_service(
            &app,
            &skill_slug,
            version.as_deref(),
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_update(
    app: tauri::AppHandle,
    skill_name: String,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::update_open_claw_skill_service(
            &app,
            &skill_name,
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_uninstall(
    app: tauri::AppHandle,
    skill_name: String,
) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::uninstall_open_claw_skill_service(&app, &skill_name)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn openclaw_skills_check(app: tauri::AppHandle) -> Result<Value, String> {
    let app = app.clone();
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::check_open_claw_skills_service(&app)
    })
    .await
    .map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn clawhub_packages_search(
    query: String,
    limit: Option<u32>,
    family: Option<String>,
    channel: Option<String>,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_clawhub::clawhub_packages_search_service(
            &query,
            limit,
            family.as_deref(),
            channel.as_deref(),
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??)
}

#[tauri::command]
pub async fn clawhub_package_detail(
    name: String,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_clawhub::clawhub_package_detail_service(
            &name,
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??)
}

#[tauri::command]
pub async fn clawhub_skill_detail(
    slug: String,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<Value, String> {
    Ok(tokio::task::spawn_blocking(move || {
        crate::openclaw_clawhub::clawhub_skill_detail_service(
            &slug,
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??)
}

#[tauri::command]
pub async fn clawhub_download_skill_zip(
    slug: String,
    version: Option<String>,
    clawhub_token: Option<String>,
    clawhub_registry: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || {
        crate::openclaw_clawhub::clawhub_download_skill_zip_service(
            &slug,
            version.as_deref(),
            clawhub_token.as_deref(),
            clawhub_registry.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn gateway_tunnel_open(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<crate::gateway_tunnel::GatewayTunnelSlot>>>,
    ws_url: String,
    token: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    crate::gateway_tunnel::gateway_tunnel_open(
        app,
        std::sync::Arc::clone(&state),
        ws_url,
        token,
        password,
    )
    .await
}

#[tauri::command]
pub async fn gateway_tunnel_send(
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<crate::gateway_tunnel::GatewayTunnelSlot>>>,
    text: String,
) -> Result<(), String> {
    crate::gateway_tunnel::gateway_tunnel_send(std::sync::Arc::clone(&state), text).await
}

#[tauri::command]
pub async fn gateway_tunnel_close(
    state: tauri::State<'_, std::sync::Arc<tokio::sync::Mutex<crate::gateway_tunnel::GatewayTunnelSlot>>>,
) -> Result<(), String> {
    crate::gateway_tunnel::gateway_tunnel_close(std::sync::Arc::clone(&state)).await
}

#[tauri::command]
pub fn read_open_claw_model_config() -> Result<Value, String> {
    Ok(crate::openclaw_model_config::read_open_claw_model_config())
}

#[tauri::command]
pub fn write_open_claw_model_config(payload: Value) -> Result<Value, String> {
    Ok(crate::openclaw_model_config::write_open_claw_model_config(payload))
}

#[tauri::command]
pub fn write_open_claw_env(payload: Value) -> Result<Value, String> {
    Ok(crate::openclaw_model_config::write_open_claw_env(payload))
}

#[tauri::command]
pub fn write_open_claw_skill_enabled(skill_key: String, enabled: bool) -> Result<Value, String> {
    Ok(crate::openclaw_skill_config::write_open_claw_skill_enabled(
        &skill_key, enabled,
    ))
}

#[tauri::command]
pub fn restore_open_claw_config_to_latest_backup() -> Result<Value, String> {
    Ok(crate::openclaw_model_config::restore_open_claw_config_to_latest_backup())
}

#[tauri::command]
pub fn read_open_claw_providers() -> Result<Value, String> {
    Ok(crate::openclaw_providers::read_open_claw_providers())
}

#[tauri::command]
pub fn read_open_claw_ai_snapshot() -> Result<Value, String> {
    Ok(crate::openclaw_ai_snapshot::read_open_claw_ai_snapshot())
}

#[tauri::command]
pub fn write_open_claw_providers_patch(payload: Value) -> Result<Value, String> {
    Ok(crate::openclaw_providers::write_open_claw_providers_patch(payload))
}

#[tauri::command]
pub fn skills_default_install_root() -> Result<String, String> {
    crate::skills::default_install_root()
}

#[tauri::command]
pub fn skills_list_installed(install_root: String) -> Result<Value, String> {
    crate::skills::list_installed(install_root)
}

#[tauri::command]
pub fn skills_install_zip_base64(
    install_root: String,
    slug: String,
    zip_base64: String,
    origin: Option<Value>,
) -> Result<Value, String> {
    crate::skills::install_zip_base64(install_root, slug, zip_base64, origin)
}

#[tauri::command]
pub fn skills_install_zip_path(install_root: String, slug: String, zip_path: String) -> Result<Value, String> {
    crate::skills::install_zip_path(install_root, slug, zip_path)
}

#[tauri::command]
pub fn skills_install_from_folder(install_root: String, slug: String, source_path: String) -> Result<Value, String> {
    crate::skills::install_from_folder(install_root, slug, source_path)
}

#[tauri::command]
pub fn skills_delete(install_root: String, slug: String) -> Result<(), String> {
    crate::skills::delete_skill(install_root, slug)
}

#[tauri::command]
pub fn skills_pick_zip_file() -> Result<Option<String>, String> {
    Ok(crate::skills::pick_zip_file())
}

#[tauri::command]
pub fn skills_pick_folder() -> Result<Option<String>, String> {
    Ok(crate::skills::pick_folder())
}

#[tauri::command]
pub fn read_workspace_identity() -> Result<Value, String> {
    Ok(crate::workspace_identity::read_workspace_identity())
}

#[tauri::command]
pub async fn run_openclaw_doctor(
    repair: Option<bool>,
    executable: Option<String>,
) -> Result<Value, String> {
    let repair = repair.unwrap_or(false);
    let exe = executable
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(String::from);
    tokio::task::spawn_blocking(move || {
        crate::openclaw_gateway::run_openclaw_doctor_impl(repair, exe.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn estimate_openclaw_backup_size() -> Result<Value, String> {
    Ok(crate::openclaw_backup::estimate_backup_size())
}

#[tauri::command]
pub async fn backup_openclaw_config() -> Result<Value, String> {
    tokio::task::spawn_blocking(crate::openclaw_backup::backup_openclaw_config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn restore_openclaw_config() -> Result<Value, String> {
    tokio::task::spawn_blocking(crate::openclaw_backup::restore_openclaw_config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_channel_config(channel_key: String, payload: Value) -> Result<Value, String> {
    Ok(crate::openclaw_channel_config::write_channel_config(&channel_key, payload))
}

#[tauri::command]
pub fn check_channel_plugin_installed(channel: String) -> Result<Value, String> {
    Ok(crate::openclaw_channel_config::check_channel_plugin_installed(&channel))
}

#[tauri::command]
pub fn cleanup_channel_residue(channel: String) -> Result<Value, String> {
    Ok(crate::openclaw_channel_config::cleanup_channel_residue(&channel))
}

#[tauri::command]
pub fn configure_feishu_plugin(
    app_id: String,
    app_secret: String,
    domain: String,
) -> Result<Value, String> {
    Ok(crate::openclaw_channel_config::configure_feishu_plugin(
        &app_id,
        &app_secret,
        &domain,
    ))
}

#[tauri::command]
pub async fn start_channel_qr_flow(
    app: tauri::AppHandle,
    channel: String,
    gateway_url: String,
    flow_id: String,
) -> Result<Value, String> {
    Ok(crate::openclaw_channel_config::start_channel_qr_flow(app, channel, gateway_url, flow_id).await)
}

#[tauri::command]
pub async fn run_openclaw_onboard(
    app: tauri::AppHandle,
    auth_choice: String,
) -> Result<Value, String> {
    crate::openclaw_gateway::run_openclaw_onboard_oauth_impl(app, auth_choice).await
}

#[tauri::command]
pub fn get_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    crate::general_settings::get_autostart(&app)
}

#[tauri::command]
pub fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    crate::general_settings::set_autostart(&app, enabled)
}

#[tauri::command]
pub fn get_prevent_sleep_enabled() -> bool {
    crate::general_settings::get_prevent_sleep()
}

#[tauri::command]
pub fn set_prevent_sleep_enabled(enabled: bool) -> Result<(), String> {
    crate::general_settings::set_prevent_sleep(enabled)
}

#[tauri::command]
pub fn get_global_shortcut_key(app: tauri::AppHandle) -> String {
    crate::global_shortcut::get_shortcut_key(&app)
}

#[tauri::command]
pub fn set_global_shortcut_key(app: tauri::AppHandle, key: String) -> Result<(), String> {
    crate::global_shortcut::set_shortcut_key(&app, key)
}

#[tauri::command]
pub async fn run_minimax_oauth(
    app: tauri::AppHandle,
    region: String,
) -> Result<Value, String> {
    crate::oauth_providers::run_minimax_oauth(app, region).await
}

#[tauri::command]
pub async fn run_openai_codex_oauth(app: tauri::AppHandle) -> Result<Value, String> {
    crate::oauth_providers::run_openai_codex_oauth(app).await
}
