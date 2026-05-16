mod commands;
mod stream_proxy;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};

#[derive(Clone)]
pub struct AppState {
    pub http: reqwest::Client,
    pub proxy_port: u16,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let http = reqwest::Client::builder()
                .user_agent("Glo/0.1")
                .build()
                .expect("reqwest client");
            let (port, handle) = stream_proxy::spawn(http.clone(), app.handle().clone());
            log::info!("stream proxy listening on http://127.0.0.1:{port}");
            // Proxy thread runs for the lifetime of the process.
            std::mem::forget(handle);

            let state = AppState { http, proxy_port: port };
            app.manage(Arc::new(state));

            // System tray keeps audio playing when the window is hidden.
            let show_item = MenuItem::with_id(app, "show", "Show window", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Glo", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Glo")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }
            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        if let Some(w) = tray.app_handle().get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_proxy_port,
            commands::save_clip,
            commands::list_clips,
            commands::count_clips,
            commands::delete_clip,
            commands::open_clip_in_folder,
            commands::pick_clips_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running glo");
}
