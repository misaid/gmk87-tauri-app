//! A serializable error shape for the command boundary.

use gmk87_device::error::DeviceError;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    DeviceNotFound,
    PermissionDenied,
    Transport,
    Hid,
    ProtocolTimeout,
    UploadTimeout,
    ChecksumMismatch,
    DeviceDesynced,
    InvalidJob,
    UploadFailed,
    Protocol,
    Io,
}

impl ErrorKind {
    /// Classifies a device error by its variant.
    pub fn of(error: &DeviceError) -> Self {
        match error {
            DeviceError::DeviceNotFound => Self::DeviceNotFound,
            DeviceError::PermissionDenied { .. } => Self::PermissionDenied,
            DeviceError::Transport(_) => Self::Transport,
            DeviceError::Hid(_) => Self::Hid,
            DeviceError::ProtocolTimeout { .. } => Self::ProtocolTimeout,
            DeviceError::UploadTimeout { .. } => Self::UploadTimeout,
            DeviceError::ChecksumMismatch { .. } => Self::ChecksumMismatch,
            DeviceError::DeviceDesynced => Self::DeviceDesynced,
            DeviceError::InvalidJob(_) => Self::InvalidJob,
            DeviceError::UploadFailed { .. } => Self::UploadFailed,
            DeviceError::Protocol(_) => Self::Protocol,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn io(error: std::io::Error) -> Self {
        Self {
            kind: ErrorKind::Io,
            message: error.to_string(),
        }
    }
}

impl From<DeviceError> for AppError {
    fn from(error: DeviceError) -> Self {
        Self {
            kind: ErrorKind::of(&error),
            message: error.to_string(),
        }
    }
}

impl From<gmk87_protocol::error::ProtocolError> for AppError {
    fn from(error: gmk87_protocol::error::ProtocolError) -> Self {
        use gmk87_protocol::error::ProtocolError as P;
        // A frame-budget or delay violation is a bad job, not a protocol fault:
        // the UI treats it as user-correctable input.
        let kind = match &error {
            P::FrameBudget { .. } | P::FrameDelayTooShort { .. } | P::InvalidJob(_) => {
                ErrorKind::InvalidJob
            }
            _ => ErrorKind::Protocol,
        };
        Self {
            kind,
            message: error.to_string(),
        }
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
