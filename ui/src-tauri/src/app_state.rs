//! Shared state: one device manager behind a mutex, and the live cancel token.

use crate::preview_cache::PreviewCache;
use gmk87_app::manager::DeviceManager;
use gmk87_device::session::CancelToken;
use gmk87_device::transport::HidTransport;
use std::sync::{Arc, Mutex};

pub type Manager = DeviceManager<HidTransport>;

#[derive(Default)]
pub struct Runtime {
    pub manager: Option<Manager>,
    pub path: Option<String>,
}

pub struct AppState {
    pub runtime: Arc<Mutex<Runtime>>,
    /// Wired up by `cancel_upload`; the token is stored so a cancel command can
    /// reach the running upload without taking the runtime mutex.
    pub cancel: Arc<Mutex<Option<CancelToken>>>,
    /// Decoded sources and rendered previews for the Display screen.
    pub preview: Arc<PreviewCache>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(Runtime::default())),
            cancel: Arc::new(Mutex::new(None)),
            preview: Arc::new(PreviewCache::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
