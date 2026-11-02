use thiserror::Error;

/// Errors raised while encoding or decoding the vendor protocol.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("payload of {actual} bytes exceeds the {max}-byte maximum")]
    PayloadTooLong { actual: usize, max: usize },
    #[error("packet of {actual} bytes is shorter than the {expected}-byte minimum")]
    ShortPacket { actual: usize, expected: usize },
    #[error("unknown command byte 0x{0:02x}")]
    UnknownCommand(u8),
    #[error("configuration buffer of {actual} bytes is shorter than the {expected}-byte minimum")]
    ShortConfig { actual: usize, expected: usize },
    #[error("value {value} is outside the valid range 0..={max} for {field}")]
    OutOfRange {
        field: &'static str,
        value: u32,
        max: u32,
    },
    #[error("image decode failed: {0}")]
    ImageDecode(String),
    #[error("animation of {frames} frames exceeds the {max}-frame budget")]
    FrameBudget { frames: u32, max: u32 },
    #[error("frame delay of {delay_ms} ms is below the {min_ms} ms minimum")]
    FrameDelayTooShort { delay_ms: u16, min_ms: u16 },
    #[error("invalid upload job: {0}")]
    InvalidJob(String),
}
