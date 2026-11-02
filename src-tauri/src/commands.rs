//! Tauri commands. Every device operation runs on a blocking thread so the
//! webview never stalls, and all of them share one `DeviceManager` mutex so
//! device operations are serialized (the keyboard has one state machine).

use crate::app_state::{AppState, Manager};
use crate::dto::{preview_bytes, DeviceInfoDto, PresetDto, PreviewJob, UploadProgressDto};
use gmk87_app::error::{AppError, ErrorKind};
use gmk87_app::lighting::LightingPatch;
use gmk87_app::state::DeviceStateDto;
use gmk87_device::session::CancelToken;
use tauri::{AppHandle, Emitter, State};

fn not_connected() -> AppError {
    AppError {
        kind: ErrorKind::DeviceNotFound,
        message: "no keyboard is connected; connect from the Device screen".into(),
    }
}

fn join_error(error: tauri::Error) -> AppError {
    AppError {
        kind: ErrorKind::Io,
        message: error.to_string(),
    }
}

#[tauri::command]
pub async fn list_devices() -> Result<Vec<DeviceInfoDto>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        gmk87_device::discovery::discover()
            .map(|devices| devices.into_iter().map(DeviceInfoDto::from).collect())
            .map_err(AppError::from)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<DeviceStateDto, AppError> {
    let runtime = state.runtime.clone();
    let snapshot_path = gmk87_app::snapshot::default_path();
    let connect_path = path.clone();
    let state_dto = tauri::async_runtime::spawn_blocking(move || {
        let transport = gmk87_device::transport::HidTransport::open(&connect_path)?;
        let manager = Manager::new(transport, snapshot_path);
        let state_dto = manager.read_state();
        let mut rt = runtime.lock().expect("runtime lock");
        rt.manager = Some(manager);
        rt.path = Some(connect_path);
        Ok::<_, AppError>(state_dto)
    })
    .await
    .map_err(join_error)??;

    spawn_reconnect_monitor(app, &state, path);
    Ok(state_dto)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), AppError> {
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        rt.manager = None;
        rt.path = None;
        Ok(())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub fn read_state(state: State<'_, AppState>) -> DeviceStateDto {
    let rt = state.runtime.lock().expect("runtime lock");
    match rt.manager.as_ref() {
        Some(manager) => manager.read_state(),
        None => DeviceStateDto::from_config(
            &gmk87_protocol::config::DeviceConfig::default_config(),
            false,
            false,
        ),
    }
}

#[tauri::command]
pub async fn set_lighting(
    state: State<'_, AppState>,
    patch: LightingPatch,
) -> Result<DeviceStateDto, AppError> {
    run_on_manager(state, move |manager| {
        manager.apply_lighting_patch(&patch)?;
        Ok(manager.read_state())
    })
    .await
}

#[tauri::command]
pub async fn sync_clock(state: State<'_, AppState>) -> Result<DeviceStateDto, AppError> {
    run_on_manager(state, move |manager| {
        manager.sync_clock(&chrono::Local::now())?;
        Ok(manager.read_state())
    })
    .await
}

#[tauri::command]
pub fn list_presets() -> Vec<PresetDto> {
    gmk87_app::presets::list()
        .into_iter()
        .map(|preset| PresetDto {
            name: preset.name.to_string(),
            description: preset.description.to_string(),
        })
        .collect()
}

#[tauri::command]
pub async fn apply_preset(
    state: State<'_, AppState>,
    name: String,
) -> Result<DeviceStateDto, AppError> {
    run_on_manager(state, move |manager| {
        // Apply to a clone first so an unknown preset is rejected before any
        // block is written (Ruling: no silent no-op writes).
        let mut next = manager.config().clone();
        gmk87_app::presets::apply(&name, &mut next)?;
        manager.set_lighting(&move |cfg| *cfg = next.clone())?;
        Ok(manager.read_state())
    })
    .await
}

#[tauri::command]
pub async fn preview_display(job: PreviewJob) -> Result<Vec<u8>, AppError> {
    tauri::async_runtime::spawn_blocking(move || preview_bytes(&job))
        .await
        .map_err(join_error)?
}

#[tauri::command]
pub async fn inspect_source(job: PreviewJob) -> Result<crate::dto::SourceInfoDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        gmk87_app::inspect::inspect(&job.bytes, &job.crop.to_spec(), 0)
            .map(crate::dto::SourceInfoDto::from)
    })
    .await
    .map_err(join_error)?
}

/// Runs `body` against the connected manager; `not_connected` when there is none.
async fn run_on_manager<T, F>(state: State<'_, AppState>, body: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&mut Manager) -> Result<T, AppError> + Send + 'static,
{
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        let manager = rt.manager.as_mut().ok_or_else(not_connected)?;
        body(manager)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn copy_diagnostics(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = state.runtime.lock().expect("runtime lock").path.clone();
    let mut report = String::new();
    report.push_str(&format!(
        "gmk87-configurator {}\n",
        env!("CARGO_PKG_VERSION")
    ));
    report.push_str(&format!(
        "device: {}\n",
        path.as_deref().unwrap_or("(none)")
    ));
    if let Ok(uname) = std::fs::read_to_string("/proc/sys/kernel/osrelease") {
        report.push_str(&format!("kernel: {}\n", uname.trim()));
    }
    Ok(report)
}

#[tauri::command]
pub async fn upload_display(
    app: AppHandle,
    state: State<'_, AppState>,
    job: gmk87_app::job::DisplayJob,
) -> Result<(), AppError> {
    let runtime = state.runtime.clone();
    let cancel_handle = state.cancel.clone();
    let token = CancelToken::new();
    *cancel_handle.lock().expect("cancel lock") = Some(token.clone());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        let manager = rt.manager.as_mut().ok_or_else(not_connected)?;
        manager.upload(&job, &token, &mut |progress| {
            let _ = app.emit("upload://progress", UploadProgressDto::from(progress));
        })
    })
    .await
    .map_err(join_error);

    *cancel_handle.lock().expect("cancel lock") = None;
    result?
}

#[tauri::command]
pub fn cancel_upload(state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(token) = state.cancel.lock().expect("cancel lock").as_ref() {
        token.cancel();
    }
    Ok(())
}

/// Watches the connected hidraw node and reports when it disappears.
///
/// Called once after a successful connect; the loop ends when the path changes
/// or the manager is dropped.
pub fn spawn_reconnect_monitor(app: AppHandle, state: &AppState, path: String) {
    let runtime = state.runtime.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        // Hold the lock from the check through the mutation so a concurrent
        // connect() cannot be clobbered in a gap between them.
        let mut rt = runtime.lock().expect("runtime lock");
        match rt.path.as_deref() {
            Some(current) if current == path.as_str() => {}
            _ => return,
        }
        if std::path::Path::new(&path).exists() {
            continue;
        }
        rt.manager = None;
        rt.path = None;
        drop(rt);
        let _ = app.emit("device://disconnected", path.clone());
        return;
    });
}
