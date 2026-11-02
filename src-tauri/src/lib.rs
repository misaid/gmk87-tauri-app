//! Tauri command and event adapter over `gmk87-app`.

mod app_state;
mod commands;
mod dto;

use app_state::AppState;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_target(false).init();
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::list_devices,
            commands::connect,
            commands::disconnect,
            commands::read_state,
            commands::set_lighting,
            commands::sync_clock,
            commands::list_presets,
            commands::apply_preset,
            commands::preview_display,
            commands::copy_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the GMK87 configurator");
}
