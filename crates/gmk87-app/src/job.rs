//! Display jobs: what to upload, and how to preview it.

use crate::error::AppError;
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::{extract_gif_frames, MAX_TOTAL_FRAMES};
use gmk87_protocol::image::{prepare_static, CropSpec, Fit};
use gmk87_protocol::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotTarget {
    Slot0,
    Slot1,
}

impl SlotTarget {
    pub fn as_show(self) -> ShowSlot {
        match self {
            SlotTarget::Slot0 => ShowSlot::Slot0,
            SlotTarget::Slot1 => ShowSlot::Slot1,
        }
    }

    pub fn from_show(show: ShowSlot) -> Option<SlotTarget> {
        match show {
            ShowSlot::Slot0 => Some(SlotTarget::Slot0),
            ShowSlot::Slot1 => Some(SlotTarget::Slot1),
            ShowSlot::Clock => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            SlotTarget::Slot0 => "slot 0",
            SlotTarget::Slot1 => "slot 1",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitDto {
    Cover,
    Contain,
}

impl From<FitDto> for Fit {
    fn from(fit: FitDto) -> Self {
        match fit {
            FitDto::Cover => Fit::Cover,
            FitDto::Contain => Fit::Contain,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropDto {
    pub offset_x: f32,
    pub offset_y: f32,
    pub zoom: f32,
    pub fit: FitDto,
}

impl CropDto {
    pub fn to_spec(&self) -> CropSpec {
        CropSpec {
            offset_x: self.offset_x,
            offset_y: self.offset_y,
            zoom: self.zoom,
            fit: self.fit.into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayJob {
    pub slot: SlotTarget,
    pub bytes: Vec<u8>,
    pub crop: CropDto,
    /// 0 means "use the GIF's own delay"; static images use 100 ms.
    pub delay_ms: u16,
    pub show_after: bool,
}

/// A GIF's magic number, so a mislabelled static file is not fed to the GIF
/// decoder.
pub fn is_gif(bytes: &[u8]) -> bool {
    bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

const DEFAULT_STATIC_DELAY_MS: u16 = 100;

/// Decodes a source into per-frame RGB8 at display size, with the delay to use.
pub fn decode_frames(
    bytes: &[u8],
    crop: &CropSpec,
    delay_ms: u16,
) -> Result<(Vec<Vec<u8>>, u16), AppError> {
    if is_gif(bytes) {
        let (frames, source_delay) = extract_gif_frames(bytes, crop, MAX_TOTAL_FRAMES)?;
        let delay = if delay_ms == 0 {
            source_delay
        } else {
            delay_ms
        };
        Ok((frames, delay))
    } else {
        let frame = prepare_static(bytes, crop)?;
        let delay = if delay_ms == 0 {
            DEFAULT_STATIC_DELAY_MS
        } else {
            delay_ms
        };
        Ok((vec![frame], delay))
    }
}

/// Renders the first frame (for a GIF) or the image itself to a 240×135 PNG.
pub fn preview_png(bytes: &[u8], crop: &CropSpec) -> Result<Vec<u8>, AppError> {
    let rgb = prepare_static(bytes, crop)?;
    let image =
        image::RgbImage::from_raw(DISPLAY_WIDTH, DISPLAY_HEIGHT, rgb).ok_or_else(|| AppError {
            kind: crate::error::ErrorKind::Protocol,
            message: "prepared frame has the wrong size".into(),
        })?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|error| AppError {
            kind: crate::error::ErrorKind::Protocol,
            message: error.to_string(),
        })?;
    Ok(out.into_inner())
}
