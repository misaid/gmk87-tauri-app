//! Wire shapes crossing the command boundary.

use gmk87_app::job::{CropDto, SlotTarget};
use gmk87_device::discovery::{DeviceInfo, TransportKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfoDto {
    pub path: String,
    pub label: String,
    pub transport: String,
    pub product_id: u16,
    pub has_via: bool,
}

impl From<DeviceInfo> for DeviceInfoDto {
    fn from(info: DeviceInfo) -> Self {
        let label = info.label();
        Self {
            path: info.path,
            label,
            transport: match info.transport {
                TransportKind::Wired => "wired".to_string(),
                TransportKind::Wireless24G => "wireless24g".to_string(),
            },
            product_id: info.product_id,
            has_via: info.has_via,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetDto {
    pub name: String,
    pub description: String,
}

/// Metadata that travels in an IPC header beside a raw image payload.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewMeta {
    pub crop: CropDto,
    #[serde(default)]
    pub max_frames: Option<u32>,
}

/// Metadata that travels in an IPC header beside a raw upload payload.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadMeta {
    pub slot: SlotTarget,
    #[serde(default)]
    pub name: String,
    pub crop: CropDto,
    pub delay_ms: u16,
    pub show_after: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgressDto {
    pub bytes_sent: usize,
    pub total_bytes: usize,
}

impl From<gmk87_device::session::UploadProgress> for UploadProgressDto {
    fn from(progress: gmk87_device::session::UploadProgress) -> Self {
        Self {
            bytes_sent: progress.bytes_sent,
            total_bytes: progress.total_bytes,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfoDto {
    pub is_gif: bool,
    pub frames: u32,
    pub delay_ms: u16,
    pub source_frames: u32,
    pub dropped: Vec<u32>,
}

impl From<gmk87_app::inspect::SourceInfo> for SourceInfoDto {
    fn from(info: gmk87_app::inspect::SourceInfo) -> Self {
        Self {
            is_gif: info.is_gif,
            frames: info.frames,
            delay_ms: info.delay_ms,
            source_frames: info.source_frames,
            dropped: info.dropped,
        }
    }
}

/// One slot's persisted display record. Source bytes are fetched separately as
/// a raw response so a 25 MiB image never becomes a JSON number array.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSlotDto {
    pub name: String,
    pub is_gif: bool,
    pub frames: u32,
    pub source_frames: u32,
    pub dropped: Vec<u32>,
    pub delay_ms: u16,
    pub crop: gmk87_app::display_store::CropRecord,
}

/// The persisted record of both display slots, restored on startup.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredDisplayDto {
    pub slot0: Option<StoredSlotDto>,
    pub slot1: Option<StoredSlotDto>,
}

impl From<gmk87_app::display_store::DisplayStore> for StoredDisplayDto {
    fn from(store: gmk87_app::display_store::DisplayStore) -> Self {
        let record = |stored: Option<&gmk87_app::display_store::SlotRecord>| {
            stored.map(|r| StoredSlotDto {
                name: r.name.clone(),
                is_gif: r.is_gif,
                frames: r.frames,
                source_frames: r.source_frames,
                dropped: r.dropped.clone(),
                delay_ms: r.delay_ms,
                crop: r.crop.clone(),
            })
        };
        Self {
            slot0: record(store.slot0.as_ref()),
            slot1: record(store.slot1.as_ref()),
        }
    }
}

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn converts_upload_progress_to_a_camel_case_dto() {
        let dto = UploadProgressDto::from(gmk87_device::session::UploadProgress {
            bytes_sent: 512,
            total_bytes: 65536,
        });
        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("\"bytesSent\":512"));
        assert!(json.contains("\"totalBytes\":65536"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gmk87_device::discovery::{DeviceInfo, TransportKind};

    #[test]
    fn a_wired_device_projects_to_a_labelled_dto() {
        let info = DeviceInfo {
            path: "/dev/hidraw12".into(),
            product_id: 0x5055,
            transport: TransportKind::Wired,
            interface_number: 3,
            has_via: true,
        };
        let dto = DeviceInfoDto::from(info);
        assert_eq!(dto.label, "GMK87 (wired)");
        assert_eq!(dto.path, "/dev/hidraw12");
        assert!(dto.has_via);
        assert_eq!(dto.transport, "wired");
    }

    #[test]
    fn a_wireless_device_is_labelled_24g() {
        let info = DeviceInfo {
            path: "/dev/hidraw6".into(),
            product_id: 0x5088,
            transport: TransportKind::Wireless24G,
            interface_number: 3,
            has_via: false,
        };
        let dto = DeviceInfoDto::from(info);
        assert_eq!(dto.label, "GMK87 (2.4 GHz)");
        assert_eq!(dto.transport, "wireless24g");
    }
}
