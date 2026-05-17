mod commands;
mod stream_proxy;

use std::sync::Arc;

use tauri::{Manager, WindowEvent};

#[derive(Clone)]
pub struct AppState {
    pub proxy_port: u16,
}

const USER_AGENT: &str = concat!("Glo/", env!("CARGO_PKG_VERSION"));

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let (port, handle) = stream_proxy::spawn(app.handle().clone());
            log::info!("stream proxy listening on http://127.0.0.1:{port}");
            // Proxy thread runs for the lifetime of the process.
            std::mem::forget(handle);

            app.manage(Arc::new(AppState { proxy_port: port }));

            Ok(())
        })
        .on_window_event(|window, event| {
            // Quit when the user closes the window — including on macOS, where
            // Tauri's default is to hide. Glo is a single-window app and the
            // tray that justified background audio is gone.
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
