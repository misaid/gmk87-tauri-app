//! Animation frames and the device upload layout.
//!
//! Known limitation: each GIF frame is decoded independently — frame offsets
//! and disposal methods are not composited — so GIFs that rely on partial-frame
//! updates render incorrectly. Full compositing is deferred; the animated-GIF
//! entry in `docs/hardware-testing.md` (Task 14) characterizes the impact.

use crate::config::ShowSlot;
use crate::error::ProtocolError;
use crate::image::{prepare_rgba, CropSpec};
use crate::pixel::{encode_slot_into, SLOT_BYTES};

/// Total frames allowed across both display slots.
pub const MAX_TOTAL_FRAMES: u32 = 36;
/// The device refuses frame delays shorter than this.
pub const MIN_FRAME_DELAY_MS: u16 = 60;
/// The longest frame delay the app will ask the device for. A GIF compressed
/// into fewer frames keeps its total duration by stretching the delay, but the
/// stretch stops here.
pub const MAX_FRAME_DELAY_MS: u16 = 500;

/// Frames decoded from a source, plus the timing and sampling record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedFrames {
    /// The prepared RGB8 frames, already fitted to the display.
    pub frames: Vec<Vec<u8>>,
    /// The per-frame delay to use, in milliseconds.
    pub delay_ms: u16,
    /// How many frames the source held before any compression.
    pub source_frames: u32,
    /// Source frame indices dropped to fit the budget, in ascending order.
    pub dropped: Vec<u32>,
}

impl DecodedFrames {
    /// Whether the source had to be compressed to fit the budget.
    pub fn compressed(&self) -> bool {
        !self.dropped.is_empty()
    }
}

fn read_decoder(bytes: &[u8]) -> Result<gif::Decoder<std::io::Cursor<&[u8]>>, ProtocolError> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    options
        .read_info(std::io::Cursor::new(bytes))
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))
}

/// The frame-budget decision for one GIF, before any pixels are prepared.
///
/// Counting and sampling happen in one decode pass, so [`inspect_gif_frames`]
/// can answer the budget meter without paying for crop/scale work.
struct GifPlan {
    total: u32,
    delay_ms: u16,
    keep: Vec<u32>,
    dropped: Vec<u32>,
}

/// What the budget meter needs from a GIF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GifInfo {
    /// Frames the source held before any compression.
    pub source_frames: u32,
    /// Frames that will actually be uploaded.
    pub frames: u32,
    pub delay_ms: u16,
    /// Source frame indices dropped to fit the budget, in ascending order.
    pub dropped: Vec<u32>,
}

fn plan_gif(bytes: &[u8], max_frames: u32) -> Result<GifPlan, ProtocolError> {
    let mut decoder = read_decoder(bytes)?;
    let mut total = 0u32;
    let mut delay_centisec = 10u16; // 100 ms default
    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?
    {
        total += 1;
        if frame.delay > 0 {
            delay_centisec = frame.delay;
        }
    }

    if total == 0 {
        return Err(ProtocolError::InvalidJob("GIF contains no frames".into()));
    }
    if max_frames == 0 {
        return Err(ProtocolError::FrameBudget {
            frames: total,
            max: 0,
        });
    }

    let keep = if total <= max_frames {
        (0..total).collect::<Vec<_>>()
    } else {
        sample_indices(total, max_frames)
    };

    let source_delay_ms = delay_centisec.saturating_mul(10);
    let delay_ms = if total <= max_frames {
        source_delay_ms
    } else {
        let scaled = (u64::from(source_delay_ms) * u64::from(total) + u64::from(max_frames) / 2)
            / u64::from(max_frames);
        (scaled as u16).clamp(MIN_FRAME_DELAY_MS, MAX_FRAME_DELAY_MS)
    };

    // `keep` is ascending (a full range or an even sample), so the complement
    // is one linear merge rather than a set and a scan.
    let mut dropped = Vec::with_capacity(total.saturating_sub(keep.len() as u32) as usize);
    let mut next_keep = 0usize;
    for index in 0..total {
        if next_keep < keep.len() && keep[next_keep] == index {
            next_keep += 1;
        } else {
            dropped.push(index);
        }
    }

    Ok(GifPlan {
        total,
        delay_ms,
        keep,
        dropped,
    })
}

/// Counts a GIF's frames and computes its upload delay without preparing any
/// pixels. Used by the budget meter.
pub fn inspect_gif_frames(bytes: &[u8], max_frames: u32) -> Result<GifInfo, ProtocolError> {
    let plan = plan_gif(bytes, max_frames)?;
    Ok(GifInfo {
        source_frames: plan.total,
        frames: plan.keep.len() as u32,
        delay_ms: plan.delay_ms,
        dropped: plan.dropped,
    })
}

/// Decodes a GIF into at most `max_frames` display frames (RGB8), sampling
/// evenly and stretching the delay to keep the overall duration when the source
/// is longer than the budget allows.
pub fn extract_gif_frames(
    bytes: &[u8],
    crop: &CropSpec,
    max_frames: u32,
) -> Result<DecodedFrames, ProtocolError> {
    // First pass: count frames and find the source delay, so we know which
    // frames to keep before paying for crop/scale work.
    let plan = plan_gif(bytes, max_frames)?;

    // Second pass: prepare only the frames we keep. The decoder yields RGBA
    // straight from the source, so the frame goes to the resizer without an
    // encode/decode round trip through PNG.
    let mut decoder = read_decoder(bytes)?;
    let mut frames = Vec::with_capacity(plan.keep.len());
    let mut index = 0u32;
    let mut next_keep = 0usize;
    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?
    {
        if next_keep < plan.keep.len() && plan.keep[next_keep] == index {
            frames.push(prepare_rgba(
                frame.width,
                frame.height,
                frame.buffer.to_vec(),
                crop,
            )?);
            next_keep += 1;
        }
        index += 1;
    }

    Ok(DecodedFrames {
        frames,
        delay_ms: plan.delay_ms,
        source_frames: plan.total,
        dropped: plan.dropped,
    })
}

/// `max_frames` indices spread evenly across `total` frames, always including
/// the first and last. Only called when `total > max_frames > 0`.
fn sample_indices(total: u32, max_frames: u32) -> Vec<u32> {
    if max_frames == 1 {
        return vec![0];
    }
    let last = total - 1;
    let steps = max_frames - 1;
    (0..max_frames)
        .map(|i| {
            ((u64::from(i) * u64::from(last) + u64::from(steps) / 2) / u64::from(steps)) as u32
        })
        .collect()
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
        let frame_count = self.slot0_frames.len() + self.slot1_frames.len();
        let mut out = Vec::with_capacity(frame_count * SLOT_BYTES);
        for frame in self.slot0_frames.iter().chain(&self.slot1_frames) {
            encode_slot_into(frame, &mut out)?;
        }
        Ok(out)
    }
}

fn encode_frames(frames: &[Vec<u8>]) -> Result<Vec<u8>, ProtocolError> {
    let mut out = Vec::with_capacity(frames.len() * SLOT_BYTES);
    for frame in frames {
        encode_slot_into(frame, &mut out)?;
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> Vec<u8> {
        vec![0u8; (crate::pixel::DISPLAY_WIDTH * crate::pixel::DISPLAY_HEIGHT * 3) as usize]
    }

    fn plan(frames: usize, delay_ms: u16) -> FramePlan {
        FramePlan {
            slot0_frames: vec![frame(); frames],
            slot1_frames: Vec::new(),
            delay_ms,
            show: ShowSlot::Clock,
        }
    }

    #[test]
    fn exactly_the_maximum_frame_count_is_accepted() {
        assert_eq!(MAX_TOTAL_FRAMES, 36);
        // The frame budget is inclusive: exactly 36 frames is valid.
        assert!(plan(36, MIN_FRAME_DELAY_MS).validate().is_ok());
    }

    #[test]
    fn exactly_the_minimum_frame_delay_is_accepted() {
        assert_eq!(MIN_FRAME_DELAY_MS, 60);
        // The delay floor is inclusive: exactly 60 ms is valid, 59 ms is not.
        assert!(plan(1, 60).validate().is_ok());
        assert!(matches!(
            plan(1, 59).validate(),
            Err(ProtocolError::FrameDelayTooShort {
                delay_ms: 59,
                min_ms: 60
            })
        ));
    }
}
