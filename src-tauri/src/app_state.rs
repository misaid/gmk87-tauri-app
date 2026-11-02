//! Shared state: one device manager behind a mutex, and the live cancel token.

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
    /// Wired up by `cancel_upload` in the upload task; present from the start so
    /// the state shape does not change under the commands that will use it.
    #[allow(dead_code)]
    pub cancel: Arc<Mutex<Option<CancelToken>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(Runtime::default())),
            cancel: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
