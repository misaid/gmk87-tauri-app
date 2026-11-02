use gmk87_protocol::error::ProtocolError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DeviceError {
    #[error("no GMK87 keyboard found")]
    DeviceNotFound,
    #[error("permission denied opening {path}; install packaging/50-gmk87.rules")]
    PermissionDenied { path: String },
    #[error("transport error: {0}")]
    Transport(#[from] std::io::Error),
    #[error("hid error: {0}")]
    Hid(String),
    #[error("timed out waiting for command 0x{cmd:02x}")]
    ProtocolTimeout { cmd: u8 },
    #[error("response checksum mismatch (expected 0x{expected:04x}, got 0x{actual:04x})")]
    ChecksumMismatch { expected: u16, actual: u16 },
    #[error("device state is unknown after an interrupted write; reconnect and retry")]
    DeviceDesynced,
    #[error("invalid job: {0}")]
    InvalidJob(String),
    #[error("upload failed: {source}; display left unchanged")]
    UploadFailed {
        #[source]
        source: Box<DeviceError>,
    },
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
}

pub type Result<T> = std::result::Result<T, DeviceError>;
