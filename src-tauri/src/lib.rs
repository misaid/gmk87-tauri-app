//! Tauri command and event adapter over `gmk87-app`.

use tauri::Emitter;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn log_ready(app: tauri::AppHandle) {
    let _ = app.emit("device://ready", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_target(false).init();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, log_ready])
        .run(tauri::generate_context!())
        .expect("error while running the GMK87 configurator");
}
