//! Animation frames and the device upload layout.
//!
//! Known limitation: each GIF frame is decoded independently — frame offsets
//! and disposal methods are not composited — so GIFs that rely on partial-frame
//! updates render incorrectly. Full compositing is deferred; the animated-GIF
//! entry in `docs/hardware-testing.md` (Task 14) characterizes the impact.

use crate::config::ShowSlot;
use crate::error::ProtocolError;
use crate::image::{prepare_static, CropSpec};
use crate::pixel::encode_slot;

/// Total frames allowed across both display slots.
pub const MAX_TOTAL_FRAMES: u32 = 36;
/// The device refuses frame delays shorter than this.
pub const MIN_FRAME_DELAY_MS: u16 = 60;

/// Decodes a GIF into display frames (RGB8), returning the source frame delay.
pub fn extract_gif_frames(
    bytes: &[u8],
    crop: &CropSpec,
    max_frames: u32,
) -> Result<(Vec<Vec<u8>>, u16), ProtocolError> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options
        .read_info(std::io::Cursor::new(bytes))
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;

    let mut frames = Vec::new();
    let mut delay_centisec = 10u16; // 100 ms default
    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?
    {
        if frames.len() as u32 >= max_frames {
            // Stop paying for crop/scale work, but keep reading so the error
            // reports the real frame count rather than just the first one over
            // the limit.
            let mut total = frames.len() as u32 + 1;
            while decoder
                .read_next_frame()
                .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?
                .is_some()
            {
                total += 1;
            }
            return Err(ProtocolError::FrameBudget {
                frames: total,
                max: max_frames,
            });
        }
        if frame.delay > 0 {
            delay_centisec = frame.delay;
        }
        let rgba = frame.buffer.to_vec();
        let png = encode_rgba_png(frame.width, frame.height, &rgba)?;
        frames.push(prepare_static(&png, crop)?);
    }

    if frames.is_empty() {
        return Err(ProtocolError::InvalidJob("GIF contains no frames".into()));
    }
    Ok((frames, delay_centisec.saturating_mul(10)))
}

fn encode_rgba_png(width: u16, height: u16, rgba: &[u8]) -> Result<Vec<u8>, ProtocolError> {
    let buffer = image::RgbaImage::from_raw(u32::from(width), u32::from(height), rgba.to_vec())
        .ok_or_else(|| ProtocolError::ImageDecode("frame buffer size mismatch".into()))?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(buffer)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;
    Ok(out.into_inner())
}

/// A validated set of frames for both display slots plus the device timing.
#[derive(Debug, Clone)]
pub struct FramePlan {
    pub slot0_frames: Vec<Vec<u8>>,
    pub slot1_frames: Vec<Vec<u8>>,
    pub delay_ms: u16,
    pub show: ShowSlot,
}

impl FramePlan {
    /// The gate every upload passes before any device traffic.
    pub fn validate(&self) -> Result<(), ProtocolError> {
        let total = (self.slot0_frames.len() + self.slot1_frames.len()) as u32;
        if total > MAX_TOTAL_FRAMES {
            return Err(ProtocolError::FrameBudget {
                frames: total,
                max: MAX_TOTAL_FRAMES,
            });
        }
        if total == 0 {
            return Err(ProtocolError::InvalidJob("no frames to upload".into()));
        }
        if self.delay_ms < MIN_FRAME_DELAY_MS {
            return Err(ProtocolError::FrameDelayTooShort {
                delay_ms: self.delay_ms,
                min_ms: MIN_FRAME_DELAY_MS,
            });
        }
        Ok(())
    }

    pub fn slot0_memory(&self) -> Result<Vec<u8>, ProtocolError> {
        encode_frames(&self.slot0_frames)
    }

    pub fn slot1_memory(&self) -> Result<Vec<u8>, ProtocolError> {
        encode_frames(&self.slot1_frames)
    }

    /// Slot 0 memory followed by slot 1 memory, as the device stores it.
    ///
    /// Re-runs [`FramePlan::validate`] first, so an invalid plan never
    /// allocates the (potentially multi-megabyte) upload buffer.
    pub fn to_memory(&self) -> Result<Vec<u8>, ProtocolError> {
        self.validate()?;
        let mut out = self.slot0_memory()?;
        out.extend_from_slice(&self.slot1_memory()?);
        Ok(out)
    }
}

fn encode_frames(frames: &[Vec<u8>]) -> Result<Vec<u8>, ProtocolError> {
    let mut out = Vec::new();
    for frame in frames {
        out.extend_from_slice(&encode_slot(frame)?);
    }
    Ok(out)
}
