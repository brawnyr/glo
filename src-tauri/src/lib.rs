mod commands;
mod stream_proxy;

use std::sync::Arc;
use tauri::Manager;

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
                .user_agent("RadioSampler/0.1")
                .build()
                .expect("reqwest client");
            // Launch the local stream proxy on a random free port
            let (port, handle) = stream_proxy::spawn(http.clone());
            log::info!("stream proxy listening on http://127.0.0.1:{port}");
            // keep the handle alive for the lifetime of the app
            std::mem::forget(handle);

            let state = AppState { http, proxy_port: port };
            app.manage(Arc::new(state));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_proxy_port,
            commands::save_clip,
            commands::list_clips,
            commands::delete_clip,
            commands::open_clip_in_folder,
            commands::pick_clips_dir,
            commands::default_clips_dir,
            commands::ensure_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running radio-sampler");
}
