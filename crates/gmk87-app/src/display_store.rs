//! The last image or GIF stored in each display slot, kept on disk.
//!
//! The device's image memory cannot be read back, and the desktop file picker
//! gives no usable filesystem path, so this record (plus the source bytes
//! beside it) is the only way the two slots survive an app restart.

use crate::job::SlotTarget;
use crate::slots::SlotMeta;
use gmk87_protocol::image::{CropSpec, Fit};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// Sources larger than this keep their metadata but not their bytes.
pub const MAX_SOURCE_BYTES: usize = 25 * 1024 * 1024;

/// A crop position in a form that serializes cleanly.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropRecord {
    pub offset_x: f32,
    pub offset_y: f32,
    pub zoom: f32,
    pub fit: String,
}

impl CropRecord {
    pub fn from_spec(spec: &CropSpec) -> Self {
        Self {
            offset_x: spec.offset_x,
            offset_y: spec.offset_y,
            zoom: spec.zoom,
            fit: match spec.fit {
                Fit::Cover => "cover".into(),
                Fit::Contain => "contain".into(),
            },
        }
    }

    pub fn to_spec(&self) -> CropSpec {
        CropSpec {
            offset_x: self.offset_x,
            offset_y: self.offset_y,
            zoom: self.zoom,
            fit: if self.fit == "contain" {
                Fit::Contain
            } else {
                Fit::Cover
            },
        }
    }
}

/// One slot's stored source: what it is, where it is framed, and how it was fit
/// into the frame budget.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SlotRecord {
    pub name: String,
    pub is_gif: bool,
    pub frames: u32,
    pub source_frames: u32,
    #[serde(default)]
    pub dropped: Vec<u32>,
    pub delay_ms: u16,
    pub crop: CropRecord,
    /// Whether the source bytes were small enough to keep beside the record.
    #[serde(default)]
    pub has_bytes: bool,
}

impl SlotRecord {
    /// Builds a record from a slot's metadata and the crop it was uploaded with.
    pub fn from_parts(meta: &SlotMeta, crop: &CropSpec, has_bytes: bool) -> Self {
        Self {
            name: meta.name.clone(),
            is_gif: meta.is_gif,
            frames: meta.frames,
            source_frames: meta.source_frames,
            dropped: meta.dropped.clone(),
            delay_ms: meta.delay_ms,
            crop: CropRecord::from_spec(crop),
            has_bytes,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayStore {
    #[serde(default)]
    pub slot0: Option<SlotRecord>,
    #[serde(default)]
    pub slot1: Option<SlotRecord>,
}

impl DisplayStore {
    pub fn get(&self, target: SlotTarget) -> Option<&SlotRecord> {
        match target {
            SlotTarget::Slot0 => self.slot0.as_ref(),
            SlotTarget::Slot1 => self.slot1.as_ref(),
        }
    }

    pub fn set(&mut self, target: SlotTarget, record: SlotRecord) {
        match target {
            SlotTarget::Slot0 => self.slot0 = Some(record),
            SlotTarget::Slot1 => self.slot1 = Some(record),
        }
    }
}

/// What was loaded back: the records and any source bytes still on disk.
#[derive(Debug, Clone, Default)]
pub struct Loaded {
    pub store: DisplayStore,
    /// `[slot0, slot1]`.
    pub sources: [Option<Vec<u8>>; 2],
}

/// `display.json` under the app data dir.
pub fn record_path(dir: &Path) -> PathBuf {
    dir.join("display.json")
}

/// `slots/slot{n}.img` under the app data dir.
pub fn source_path(dir: &Path, target: SlotTarget) -> PathBuf {
    let slot = match target {
        SlotTarget::Slot0 => 0,
        SlotTarget::Slot1 => 1,
    };
    dir.join("slots").join(format!("slot{slot}.img"))
}

/// Writes the metadata for both slots, creating parent directories as needed.
pub fn save(dir: &Path, store: &DisplayStore) -> io::Result<()> {
    fs::create_dir_all(dir)?;
    let text = serde_json::to_string_pretty(store)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(record_path(dir), text)
}

/// Writes a slot's source bytes, unless they are over the size cap. Returns
/// whether the bytes were written.
pub fn save_source(dir: &Path, target: SlotTarget, bytes: &[u8]) -> io::Result<bool> {
    if bytes.len() > MAX_SOURCE_BYTES {
        return Ok(false);
    }
    let path = source_path(dir, target);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, bytes)?;
    Ok(true)
}

/// Loads only the records, without reading the (potentially large) source
/// files beside them. Callers that need the bytes ask [`load_source`].
pub fn load_store(dir: &Path) -> DisplayStore {
    fs::read_to_string(record_path(dir))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Loads the stored records and any source bytes, or empty defaults.
pub fn load(dir: &Path) -> Loaded {
    let store = load_store(dir);
    let sources = [
        load_source(dir, SlotTarget::Slot0),
        load_source(dir, SlotTarget::Slot1),
    ];
    Loaded { store, sources }
}

/// Reads one slot's stored source bytes, if present and within the size cap.
pub fn load_source(dir: &Path, target: SlotTarget) -> Option<Vec<u8>> {
    let bytes = fs::read(source_path(dir, target)).ok()?;
    (bytes.len() <= MAX_SOURCE_BYTES).then_some(bytes)
}
