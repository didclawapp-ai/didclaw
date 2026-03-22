mod commands;
mod gateway_local;
mod openclaw_common;
mod openclaw_gateway;
mod openclaw_model_config;
mod openclaw_providers;
mod paths;
mod preview_local;

#[cfg(not(debug_assertions))]
mod static_server;

#[cfg(not(debug_assertions))]
fn prod_static_server_and_navigate<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    let window = app
        .get_webview_window("main")
        .ok_or("未找到主窗口 main")?;
    let dist = static_server::resolve_bundle_dist(app.path())?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(static_server::start_server(dist, tx));
    });
    let msg = rx.recv().map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::Other, "静态服务通道已关闭")
    })?;
    let port = match msg {
        Ok(p) => p,
        Err(e) => {
            log::error!("启动本地静态服务失败: {e}");
            return Ok(());
        }
    };
    let href = format!("http://127.0.0.1:{port}/index.html");
    let js = format!(
        "window.location.replace({})",
        serde_json::to_string(&href).unwrap_or_else(|_| "\"about:blank\"".into())
    );
    window.eval(&js)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            #[cfg(not(debug_assertions))]
            {
                prod_static_server_and_navigate(&*app)?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::preview_open_local,
            commands::preview_libre_office_status,
            commands::preview_open_libre_office_download_page,
            commands::preview_show_libre_office_install_dialog,
            commands::shell_open_file_url,
            commands::file_save_copy_as,
            commands::shell_prepare_email_with_local_file,
            commands::shell_copy_local_file_for_share,
            commands::dialog_open_file,
            commands::read_gateway_local_config,
            commands::write_gateway_local_config,
            commands::ensure_open_claw_gateway,
            commands::read_open_claw_model_config,
            commands::write_open_claw_model_config,
            commands::restore_open_claw_config_to_latest_backup,
            commands::read_open_claw_providers,
            commands::write_open_claw_providers_patch,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                openclaw_gateway::dispose_managed_open_claw_gateway(app_handle);
            }
        });
}
