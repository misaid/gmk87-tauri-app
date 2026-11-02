//! Frame count and delay for a chosen source, for the budget meter.

use crate::error::AppError;
use crate::job::{decode_frames, is_gif};
use gmk87_protocol::image::CropSpec;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub is_gif: bool,
    pub frames: u32,
    pub delay_ms: u16,
}

pub fn inspect(bytes: &[u8], crop: &CropSpec, delay_ms: u16) -> Result<SourceInfo, AppError> {
    let (frames, delay_ms) = decode_frames(bytes, crop, delay_ms)?;
    Ok(SourceInfo {
        is_gif: is_gif(bytes),
        frames: frames.len() as u32,
        delay_ms,
    })
}
