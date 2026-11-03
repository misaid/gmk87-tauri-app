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

/// What the app knows about a slot's current source: the name, whether it was
/// compressed to fit, and the position within the source budget.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SlotMeta {
    pub name: String,
    pub is_gif: bool,
    /// Frames actually stored in the slot after any compression.
    pub frames: u32,
    /// Frames the source held before compression.
    pub source_frames: u32,
    /// Source frame indices dropped to fit the budget.
    pub dropped: Vec<u32>,
    pub delay_ms: u16,
}

pub struct SlotStore {
    slot0: Vec<Vec<u8>>,
    slot1: Vec<Vec<u8>>,
    meta0: Option<SlotMeta>,
    meta1: Option<SlotMeta>,
}

impl Default for SlotStore {
    fn default() -> Self {
        let black = vec![0u8; BLACK_FRAME_BYTES];
        Self {
            slot0: vec![black.clone()],
            slot1: vec![black],
            meta0: None,
            meta1: None,
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

    pub fn meta(&self, target: SlotTarget) -> Option<&SlotMeta> {
        match target {
            SlotTarget::Slot0 => self.meta0.as_ref(),
            SlotTarget::Slot1 => self.meta1.as_ref(),
        }
    }

    fn other(&self, target: SlotTarget) -> &[Vec<u8>] {
        match target {
            SlotTarget::Slot0 => &self.slot1,
            SlotTarget::Slot1 => &self.slot0,
        }
    }

    /// Frames this slot may still hold without exceeding the combined budget.
    pub fn remaining(&self, target: SlotTarget) -> u32 {
        MAX_TOTAL_FRAMES.saturating_sub(self.other(target).len() as u32)
    }

    /// Replaces one slot's frames and metadata, refusing to exceed the budget.
    pub fn set(
        &mut self,
        target: SlotTarget,
        frames: Vec<Vec<u8>>,
        meta: SlotMeta,
    ) -> Result<(), AppError> {
        let other = self.other(target).len();
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
            SlotTarget::Slot0 => {
                self.slot0 = frames;
                self.meta0 = Some(meta);
            }
            SlotTarget::Slot1 => {
                self.slot1 = frames;
                self.meta1 = Some(meta);
            }
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
