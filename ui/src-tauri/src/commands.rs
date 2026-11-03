//! Tauri commands. Every device operation runs on a blocking thread so the
//! webview never stalls, and all of them share one `DeviceManager` mutex so
//! device operations are serialized (the keyboard has one state machine).

use crate::app_state::{AppState, Manager};
use crate::dto::{DeviceInfoDto, PresetDto, PreviewMeta, UploadMeta, UploadProgressDto};
use gmk87_app::error::{AppError, ErrorKind};
use gmk87_app::job::{DisplayJob, SlotTarget};
use gmk87_app::lighting::LightingPatch;
use gmk87_app::state::DeviceStateDto;
use gmk87_device::session::CancelToken;
use tauri::ipc::{InvokeBody, Request};
use tauri::{AppHandle, Emitter, State};

/// Header carrying the JSON metadata that accompanies a raw IPC payload.
const JOB_HEADER: &str = "x-gmk87-job";

fn not_connected() -> AppError {
    AppError {
        kind: ErrorKind::DeviceNotFound,
        message: "no keyboard is connected; connect from the Device screen".into(),
    }
}

fn invalid_job(message: impl Into<String>) -> AppError {
    AppError {
        kind: ErrorKind::InvalidJob,
        message: message.into(),
    }
}

/// The raw request body, used so image bytes never travel as a JSON number
/// array (which costs roughly an order of magnitude more to serialise).
fn raw_bytes(request: &Request<'_>) -> Result<Vec<u8>, AppError> {
    match request.body() {
        InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        InvokeBody::Json(_) => Err(invalid_job("expected a raw byte payload")),
    }
}

fn job_header<T: serde::de::DeserializeOwned>(request: &Request<'_>) -> Result<T, AppError> {
    let value = request
        .headers()
        .get(JOB_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| invalid_job(format!("missing {JOB_HEADER} header")))?;
    serde_json::from_str(value)
        .map_err(|error| invalid_job(format!("invalid {JOB_HEADER} header: {error}")))
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
        let mut manager = Manager::new(transport, snapshot_path);
        // The device's image memory cannot be read back, so an upload resends
        // whatever the manager holds for the untouched slot. Restore both
        // slots from disk before the first upload can use the store.
        if let Some(dir) = gmk87_app::snapshot::data_dir() {
            manager.restore_slots(&dir);
        }
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

/// Renders a 240×135 preview PNG. The source bytes arrive as the raw request
/// body; the crop rides in a header.
#[tauri::command]
pub async fn preview_display(
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<tauri::ipc::Response, AppError> {
    let meta: PreviewMeta = job_header(&request)?;
    let bytes = raw_bytes(&request)?;
    if bytes.is_empty() {
        return Err(invalid_job("no image bytes were provided"));
    }
    let cache = state.preview.clone();
    tauri::async_runtime::spawn_blocking(move || {
        cache
            .preview(&bytes, &meta.crop.to_spec())
            .map(|png| tauri::ipc::Response::new(png.as_ref().clone()))
            .map_err(AppError::from)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn inspect_source(request: Request<'_>) -> Result<crate::dto::SourceInfoDto, AppError> {
    use gmk87_protocol::frames::MAX_TOTAL_FRAMES;
    let meta: PreviewMeta = job_header(&request)?;
    let bytes = raw_bytes(&request)?;
    let max_frames = meta.max_frames.unwrap_or(MAX_TOTAL_FRAMES);
    let crop = meta.crop.to_spec();
    tauri::async_runtime::spawn_blocking(move || {
        gmk87_app::inspect::inspect(&bytes, &crop, 0, max_frames)
            .map(crate::dto::SourceInfoDto::from)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub fn load_display_store() -> crate::dto::StoredDisplayDto {
    let Some(dir) = gmk87_app::snapshot::data_dir() else {
        return crate::dto::StoredDisplayDto::default();
    };
    crate::dto::StoredDisplayDto::from(gmk87_app::display_store::load_store(&dir))
}

/// One slot's stored source bytes, as a raw response. An empty buffer means
/// there is no stored source (a zero-byte image is not a valid source anyway).
#[tauri::command]
pub async fn load_display_source(target: SlotTarget) -> Result<tauri::ipc::Response, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = gmk87_app::snapshot::data_dir()
            .and_then(|dir| gmk87_app::display_store::load_source(&dir, target))
            .unwrap_or_default();
        Ok::<_, AppError>(tauri::ipc::Response::new(bytes))
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
    if let Some(dir) = gmk87_app::snapshot::data_dir() {
        let stored = gmk87_app::display_store::load_store(&dir);
        for (label, record) in [
            ("slot 0", stored.slot0.as_ref()),
            ("slot 1", stored.slot1.as_ref()),
        ] {
            match record {
                Some(r) => report.push_str(&format!(
                    "{label}: {} ({} frame(s), delay {} ms, offset {:.2},{:.2} zoom {:.2}, \
                     {} dropped)\n",
                    r.name,
                    r.frames,
                    r.delay_ms,
                    r.crop.offset_x,
                    r.crop.offset_y,
                    r.crop.zoom,
                    r.dropped.len(),
                )),
                None => report.push_str(&format!("{label}: (empty)\n")),
            }
        }
    }
    Ok(report)
}

#[tauri::command]
pub async fn upload_display(
    app: AppHandle,
    state: State<'_, AppState>,
    request: Request<'_>,
) -> Result<(), AppError> {
    let meta: UploadMeta = job_header(&request)?;
    let job = DisplayJob {
        slot: meta.slot,
        name: meta.name,
        bytes: raw_bytes(&request)?,
        crop: meta.crop,
        delay_ms: meta.delay_ms,
        show_after: meta.show_after,
    };
    let runtime = state.runtime.clone();
    let cancel_handle = state.cancel.clone();
    let token = CancelToken::new();
    *cancel_handle.lock().expect("cancel lock") = Some(token.clone());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        let manager = rt.manager.as_mut().ok_or_else(not_connected)?;
        manager.upload(&job, &token, &mut |progress| {
            let _ = app.emit("upload://progress", UploadProgressDto::from(progress));
        })?;
        persist_slot(&job, manager);
        Ok::<_, AppError>(())
    })
    .await
    .map_err(join_error);

    *cancel_handle.lock().expect("cancel lock") = None;
    result??;
    Ok(())
}

/// Records what the just-uploaded slot holds, and its bytes, so both slots
/// survive an app restart. Persistence failures are logged, not surfaced: the
/// upload itself already succeeded.
fn persist_slot(job: &gmk87_app::job::DisplayJob, manager: &Manager) {
    let Some(dir) = gmk87_app::snapshot::data_dir() else {
        return;
    };
    let meta = manager.slots().meta(job.slot).cloned().unwrap_or_default();
    let crop = job.crop.to_spec();
    match gmk87_app::display_store::save_source(&dir, job.slot, &job.bytes) {
        Ok(has_bytes) => {
            let mut store = gmk87_app::display_store::load_store(&dir);
            store.set(
                job.slot,
                gmk87_app::display_store::SlotRecord::from_parts(&meta, &crop, has_bytes),
            );
            if let Err(error) = gmk87_app::display_store::save(&dir, &store) {
                tracing::warn!(%error, "could not store the display record");
            }
            tracing::info!(
                slot = job.slot.label(),
                name = %job.name,
                frames = meta.frames,
                source_frames = meta.source_frames,
                dropped = meta.dropped.len(),
                offset_x = crop.offset_x,
                offset_y = crop.offset_y,
                zoom = crop.zoom,
                "stored display slot"
            );
        }
        Err(error) => tracing::warn!(%error, "could not store the display source"),
    }
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
