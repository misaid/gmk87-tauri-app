//! Owns the device session and serializes every operation against it.

use crate::error::AppError;
use crate::job::{decode_frames, DisplayJob, SlotTarget};
use crate::lighting::LightingPatch;
use crate::slots::{SlotMeta, SlotStore};
use crate::snapshot;
use crate::state::DeviceStateDto;
use gmk87_device::session::{CancelToken, Session, UploadProgress};
use gmk87_device::transport::Transport;
use gmk87_protocol::config::DeviceConfig;
use gmk87_protocol::frames::FramePlan;
use std::path::{Path, PathBuf};

pub struct DeviceManager<T: Transport> {
    session: Session<T>,
    snapshot_path: Option<PathBuf>,
    slots: SlotStore,
}

impl<T: Transport> DeviceManager<T> {
    /// Opens a manager over `transport`, seeding the configuration from the
    /// snapshot at `snapshot_path` when one is readable.
    pub fn new(transport: T, snapshot_path: Option<PathBuf>) -> Self {
        let config = snapshot_path
            .as_deref()
            .and_then(snapshot::load)
            .unwrap_or_else(DeviceConfig::default_config);
        Self {
            session: Session::with_config(transport, config),
            snapshot_path,
            slots: SlotStore::default(),
        }
    }

    pub fn config(&self) -> &DeviceConfig {
        self.session.config()
    }

    pub fn is_synced(&self) -> bool {
        self.session.is_synced()
    }

    pub fn read_state(&self) -> DeviceStateDto {
        DeviceStateDto::from_config(self.session.config(), true, self.session.is_synced())
    }

    /// Applies `edit` to the in-memory configuration and writes the block.
    pub fn set_lighting(&mut self, edit: &dyn Fn(&mut DeviceConfig)) -> Result<(), AppError> {
        self.session.set_lighting(edit)?;
        self.persist()
    }

    /// Applies a partial lighting patch.
    pub fn apply_lighting_patch(&mut self, patch: &LightingPatch) -> Result<(), AppError> {
        self.set_lighting(&|cfg| patch.apply(cfg))
    }

    /// Sets the clock and writes the block.
    pub fn sync_clock(&mut self, now: &chrono::DateTime<chrono::Local>) -> Result<(), AppError> {
        self.session.sync_clock(now)?;
        self.persist()
    }

    pub fn slots(&self) -> &SlotStore {
        &self.slots
    }

    /// Rebuilds both slots from the stored display record and sources.
    ///
    /// The device's image memory cannot be read back, so an upload of one slot
    /// resends whatever this store holds for the other. Without this the store
    /// starts with a black frame and the first upload after a restart would
    /// blank the slot the user did not touch.
    ///
    /// A stored source that no longer decodes, or that no longer fits the
    /// budget, is skipped with a warning: a corrupt record must not make the
    /// app unable to connect.
    pub fn restore_slots(&mut self, dir: &Path) {
        let loaded = crate::display_store::load(dir);
        for (target, record, source) in [
            (
                SlotTarget::Slot0,
                loaded.store.slot0.as_ref(),
                loaded.sources[0].as_ref(),
            ),
            (
                SlotTarget::Slot1,
                loaded.store.slot1.as_ref(),
                loaded.sources[1].as_ref(),
            ),
        ] {
            let (Some(record), Some(bytes)) = (record, source) else {
                continue;
            };
            match self.restore_slot(target, record, bytes) {
                Ok(()) => {}
                Err(error) => tracing::warn!(
                    slot = target.label(),
                    %error,
                    "could not restore the stored display slot"
                ),
            }
        }
    }

    fn restore_slot(
        &mut self,
        target: SlotTarget,
        record: &crate::display_store::SlotRecord,
        bytes: &[u8],
    ) -> Result<(), AppError> {
        let crop = record.crop.to_spec();
        let limit = self.slots.remaining(target);
        let decoded = decode_frames(bytes, &crop, record.delay_ms, limit)?;
        let meta = SlotMeta {
            name: record.name.clone(),
            is_gif: decoded.is_gif,
            frames: decoded.frames.len() as u32,
            source_frames: decoded.source_frames,
            dropped: decoded.dropped.clone(),
            delay_ms: decoded.delay_ms,
        };
        self.slots.set(target, decoded.frames, meta)
    }

    /// The underlying transport, for tests that inspect what was sent.
    pub fn transport(&self) -> &T {
        self.session.transport()
    }

    /// Streams a prepared plan, then persists the block the session committed.
    pub fn upload_plan(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        on_progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<(), AppError> {
        self.session.upload(plan, cancel, on_progress)?;
        self.persist()
    }

    /// Decodes a job into the target slot, then streams both slots.
    pub fn upload(
        &mut self,
        job: &DisplayJob,
        cancel: &CancelToken,
        on_progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<(), AppError> {
        let crop = job.crop.to_spec();
        let limit = self.slots.remaining(job.slot);
        let decoded = decode_frames(&job.bytes, &crop, job.delay_ms, limit)?;
        let meta = SlotMeta {
            name: job.name.clone(),
            is_gif: decoded.is_gif,
            frames: decoded.frames.len() as u32,
            source_frames: decoded.source_frames,
            dropped: decoded.dropped.clone(),
            delay_ms: decoded.delay_ms,
        };
        self.slots.set(job.slot, decoded.frames, meta)?;
        let show = if job.show_after {
            job.slot.as_show()
        } else {
            self.session.config().show_image()
        };
        let plan = self.slots.build_plan(decoded.delay_ms, show);
        self.upload_plan(&plan, cancel, on_progress)
    }

    fn persist(&self) -> Result<(), AppError> {
        if let Some(path) = &self.snapshot_path {
            snapshot::save(path, self.session.config()).map_err(AppError::io)?;
        }
        Ok(())
    }
}
