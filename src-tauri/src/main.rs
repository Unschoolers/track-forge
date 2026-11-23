#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod lan;

fn main() {
    tauri::Builder::default()
        .manage(lan::LanManager::default())
        .invoke_handler(tauri::generate_handler![
            lan::lan_host,
            lan::lan_scan,
            lan::lan_connect,
            lan::lan_respond,
            lan::lan_lock,
            lan::lan_send,
            lan::lan_stop,
            lan::lan_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("TrackForge desktop application failed to start");
}
