//! System tray: hide-to-tray on close, context menu.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Manager,
};

pub const TRAY_ID: &str = "didclaw-tray";

/// Show and focus the main window.
pub fn show_main_window(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn tray_strings() -> (&'static str, &'static str) {
    if crate::app_locale::is_en() {
        ("Show DidClaw", "Quit DidClaw")
    } else {
        ("显示 DidClaw", "退出 DidClaw")
    }
}

fn build_tray_menu<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error>> {
    let (show_t, quit_t) = tray_strings();
    let show_item = MenuItem::with_id(app, "show", show_t, true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", quit_t, true, None::<&str>)?;
    Ok(Menu::with_items(app, &[&show_item, &sep, &quit_item])?)
}

/// Recreate tray menu labels after locale change (best-effort).
pub fn refresh_tray_menu<R: tauri::Runtime>(app: &AppHandle<R>) {
    let Ok(menu) = build_tray_menu(app) else {
        return;
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(menu));
    }
}

/// Create tray icon (call from `app.setup()`).
pub fn setup_tray(app: &mut App) -> Result<(), Box<dyn std::error::Error>> {
    crate::app_locale::init_default_from_env();
    let menu = build_tray_menu(app.handle())?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| {
            if crate::app_locale::is_en() {
                "Default window icon not found"
            } else {
                "未找到默认窗口图标"
            }
        })?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("DidClaw")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "quit" => {
                crate::launch_log::line("tray: user chose quit");
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray: &TrayIcon, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app: &AppHandle = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    let visible: bool = w.is_visible().unwrap_or(false);
                    if visible {
                        let _ = w.hide();
                    } else {
                        show_main_window(app);
                    }
                }
            }
        })
        .build(app)?;

    crate::launch_log::line("tray: tray icon created");
    Ok(())
}
