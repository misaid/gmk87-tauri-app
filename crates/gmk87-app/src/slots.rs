//! What the app last uploaded to each display slot.
//!
//! The upload session overwrites *all* image memory, so an upload must stream
//! both slots; the slot it is not changing is resent from here rather than
//! blanked. A default store holds one black frame per slot.

use crate::error::{AppError, ErrorKind};
use crate::job::SlotTarget;
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::{FramePlan, MAX_TOTAL_FRAMES};
use gmk87_protocol::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};

pub const BLACK_FRAME_BYTES: usize = (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize;

pub struct SlotStore {
    slot0: Vec<Vec<u8>>,
    slot1: Vec<Vec<u8>>,
}

impl Default for SlotStore {
    fn default() -> Self {
        let black = vec![0u8; BLACK_FRAME_BYTES];
        Self {
            slot0: vec![black.clone()],
            slot1: vec![black],
        }
    }
}

impl SlotStore {
    pub fn frames(&self, target: SlotTarget) -> &[Vec<u8>] {
        match target {
            SlotTarget::Slot0 => &self.slot0,
            SlotTarget::Slot1 => &self.slot1,
        }
    }

    /// Replaces one slot's frames, refusing to exceed the combined budget.
    pub fn set(&mut self, target: SlotTarget, frames: Vec<Vec<u8>>) -> Result<(), AppError> {
        let other = match target {
            SlotTarget::Slot0 => self.slot1.len(),
            SlotTarget::Slot1 => self.slot0.len(),
        };
        let total = other + frames.len();
        if total > MAX_TOTAL_FRAMES as usize {
            return Err(AppError {
                kind: ErrorKind::InvalidJob,
                message: format!(
                    "animation is {total} frames across both slots, over the {MAX_TOTAL_FRAMES}-frame budget \
                     ({} in {} and {other} in the other slot)",
                    frames.len(),
                    target.label(),
                ),
            });
        }
        match target {
            SlotTarget::Slot0 => self.slot0 = frames,
            SlotTarget::Slot1 => self.slot1 = frames,
        }
        Ok(())
    }

    pub fn build_plan(&self, delay_ms: u16, show: ShowSlot) -> FramePlan {
        FramePlan {
            slot0_frames: self.slot0.clone(),
            slot1_frames: self.slot1.clone(),
            delay_ms,
            show,
        }
    }
}
