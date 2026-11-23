#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lan;
mod desktop_update;

fn main() {
    tauri::Builder::default()
        .manage(lan::LanManager::default())
        .invoke_handler(tauri::generate_handler![
            lan::lan_host,
            lan::lan_scan,
            lan::lan_connect,
            lan::lan_connect_direct,
            lan::lan_respond,
            lan::lan_lock,
            lan::lan_send,
            lan::lan_stop,
            lan::lan_diagnostics,
            desktop_update::desktop_download_update,
        ])
        .run(tauri::generate_context!())
        .expect("TrackForge desktop application failed to start");
}
