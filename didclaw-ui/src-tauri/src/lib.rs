mod app_locale;
mod commands;
mod general_settings;
mod global_shortcut;
mod didclaw_db;
mod tauri_user_error;
mod didclaw_update;
mod tray_icon;
mod openclaw_backup;
mod openclaw_ai_snapshot;
mod openclaw_clawhub;
mod openclaw_channel_config;
mod gateway_local;
mod gateway_tunnel;
mod launch_log;
mod openclaw_common;
mod openclaw_ensure_install;
mod openclaw_gateway;
mod openclaw_gateway_origins;
mod openclaw_version_check;
mod openclaw_model_config;
mod openclaw_exec_approvals_defaults;
mod oauth_providers;
mod openclaw_providers;
mod openclaw_skill_config;
mod paths;
mod preview_local;
mod skills;
mod setup_status;
mod workspace_identity;
mod openclaw_workspace_memory;
mod bundled_skills;
mod command_registration;
mod live_edit_patch;
mod pheromone;

#[cfg(not(debug_assertions))]
mod static_server;

#[cfg(not(debug_assertions))]
fn prod_static_server_and_navigate<R: tauri::Runtime>(
    app: &tauri::App<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::Manager;
    launch_log::line("prod: 查找主窗口 main");
    let window = app.get_webview_window("main").ok_or_else(|| {
        let m = "未找到主窗口 main";
        launch_log::line(m);
        std::io::Error::new(std::io::ErrorKind::NotFound, m)
    })?;
    launch_log::line("prod: resolve_bundle_dist");
    let dist = static_server::resolve_bundle_dist(app.path()).map_err(|e| {
        launch_log::line(&format!("resolve_bundle_dist 失败: {e}"));
        std::io::Error::new(std::io::ErrorKind::NotFound, e)
    })?;
    launch_log::line(&format!("prod: 静态根目录 = {}", dist.display()));
    let (tx, rx) = std::sync::mpsc::channel::<Result<u16, String>>();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        rt.block_on(static_server::start_server(dist, tx));
    });
    launch_log::line("prod: 等待静态服务绑定端口…");
    let msg = rx.recv().map_err(|_| {
        launch_log::line("静态服务通道 recv 失败（通道已关闭）");
        std::io::Error::new(std::io::ErrorKind::Other, "静态服务通道已关闭")
    })?;
    let port = match msg {
        Ok(p) => {
            launch_log::line(&format!("prod: 静态服务已监听 127.0.0.1:{p}"));
            p
        }
        Err(e) => {
            launch_log::line(&format!("启动本地静态服务失败: {e}"));
            log::error!("启动本地静态服务失败: {e}");
            return Ok(());
        }
    };
    let href = format!("http://127.0.0.1:{port}/index.html");
    launch_log::line(&format!("prod: WebviewWindow::navigate -> {href}"));
    // 勿用 eval + location.replace：从 tauri 内置 URL 跳到 loopback 时，WebView2 可能不挂载渲染子进程，
    // 任务管理器里只见 app.exe ~数 MB、界面空白；navigate 由宿主发起，行为与官方 localhost 方案一致。
    let u = href.parse::<url::Url>().map_err(|e| {
        launch_log::line(&format!("prod: 解析导航 URL 失败: {e}"));
        std::io::Error::new(std::io::ErrorKind::InvalidInput, e.to_string())
    })?;
    window.navigate(u).map_err(|e| {
        launch_log::line(&format!("prod: navigate 失败: {e}"));
        e
    })?;
    launch_log::line("prod: navigate 完成");
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;

    launch_log::init();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        crate::tray_icon::show_main_window(app);
                    }
                })
                .build(),
        )
        .manage(std::sync::Arc::new(tokio::sync::Mutex::new(
            gateway_tunnel::GatewayTunnelSlot::default(),
        )))
        .setup(|app| {
            launch_log::line("setup: 开始");
            if cfg!(debug_assertions) {
                let _ = app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                );
            }

            // 内置 https://tauri.localhost 等需在网关 allowedOrigins 中；若启动时尚无 openclaw.json，会在预检/拉起网关时再次合并。
            if let Err(e) = openclaw_gateway_origins::ensure_didclaw_desktop_allowed_origins() {
                launch_log::line(&format!(
                    "openclaw: 启动时合并 allowedOrigins 未成功（可忽略）: {e}"
                ));
            }

            bundled_skills::sync_bundled_workspace_skills(app.handle());

            #[cfg(not(debug_assertions))]
            {
                // 可选：DIDCLAW_HTTP_LOOPBACK=1 使用本机 axum + navigate 到 127.0.0.1（若仍白屏可对比排查；capabilities 已含 remote.urls）。
                let http_loopback = std::env::var("DIDCLAW_HTTP_LOOPBACK")
                    .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                    .unwrap_or(false);
                if http_loopback {
                    launch_log::line("prod: DIDCLAW_HTTP_LOOPBACK=1，使用本机 axum 静态页");
                    if let Err(e) = prod_static_server_and_navigate(&*app) {
                        launch_log::line(&format!(
                            "setup: prod_static_server_and_navigate 返回错误: {e}"
                        ));
                        return Err(e);
                    }
                } else {
                    launch_log::line("prod: 使用 Tauri 内置前端");
                }
            }

            if std::env::var("DIDCLAW_DEVTOOLS")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
            {
                launch_log::line("DIDCLAW_DEVTOOLS: 已请求打开 WebView 开发者工具");
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    w.open_devtools();
                }
            }

            if let Err(e) = tray_icon::setup_tray(app) {
                launch_log::line(&format!("tray: 创建系统托盘图标失败（可忽略）: {e}"));
            }

            global_shortcut::setup_global_shortcut(app.handle());

            launch_log::line("setup: 成功，进入事件循环");
            Ok(())
        })
        .invoke_handler(didclaw_invoke_handlers!())
        .build(tauri::generate_context!())
        .map_err(|e| {
            launch_log::line(&format!("tauri build 失败: {e}"));
            e
        })
        .expect("error while building tauri application");
    launch_log::line("tauri: 开始 run 事件循环");
    app.run(|app_handle, event| {
        match event {
            // Close button → hide to tray instead of quitting
            tauri::RunEvent::WindowEvent {
                ref label,
                event: tauri::WindowEvent::CloseRequested { ref api, .. },
                ..
            } if label == "main" => {
                api.prevent_close();
                if let Some(w) = app_handle.get_webview_window("main") {
                    let _ = w.hide();
                }
                launch_log::line("tray: 主窗口已隐藏到托盘");
            }
            tauri::RunEvent::Exit => {
                launch_log::line("RunEvent::Exit");
                if let Some(st) = app_handle.try_state::<std::sync::Arc<
                    tokio::sync::Mutex<gateway_tunnel::GatewayTunnelSlot>,
                >>() {
                    let s = std::sync::Arc::clone(st.inner());
                    tauri::async_runtime::block_on(gateway_tunnel::shutdown_tunnel_slot(&s));
                }
                openclaw_gateway::dispose_managed_open_claw_gateway(app_handle);
                #[cfg(windows)]
                openclaw_gateway::cleanup_windows_gateway_console_titles();
            }
            _ => {}
        }
    });
}
