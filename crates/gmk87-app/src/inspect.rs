//! Frame count and delay for a chosen source, for the budget meter.

use crate::error::AppError;
use crate::job::{is_gif, DEFAULT_STATIC_DELAY_MS};
use gmk87_protocol::frames::inspect_gif_frames;
use gmk87_protocol::image::{probe, CropSpec};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub is_gif: bool,
    pub frames: u32,
    pub delay_ms: u16,
    /// Frames the source held before compression.
    pub source_frames: u32,
    /// Source frame indices dropped to fit the slot's remaining budget.
    pub dropped: Vec<u32>,
}

/// Measures a source for the budget meter.
///
/// This deliberately does not prepare the pixels: selecting a file already
/// asks for a preview, and rendering every GIF frame twice made inspection as
/// expensive as the upload itself. For a GIF one decode pass is still needed to
/// count frames; a static image only has its header checked.
pub fn inspect(
    bytes: &[u8],
    _crop: &CropSpec,
    delay_ms: u16,
    max_frames: u32,
) -> Result<SourceInfo, AppError> {
    if is_gif(bytes) {
        let info = inspect_gif_frames(bytes, max_frames)?;
        return Ok(SourceInfo {
            is_gif: true,
            frames: info.frames,
            delay_ms: if delay_ms == 0 {
                info.delay_ms
            } else {
                delay_ms
            },
            source_frames: info.source_frames,
            dropped: info.dropped,
        });
    }

    if max_frames == 0 {
        return Err(gmk87_protocol::error::ProtocolError::FrameBudget { frames: 1, max: 0 }.into());
    }
    probe(bytes)?;
    Ok(SourceInfo {
        is_gif: false,
        frames: 1,
        delay_ms: if delay_ms == 0 {
            DEFAULT_STATIC_DELAY_MS
        } else {
            delay_ms
        },
        source_frames: 1,
        dropped: Vec::new(),
    })
}
