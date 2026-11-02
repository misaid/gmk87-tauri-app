//! Wire shapes crossing the command boundary.

use gmk87_app::error::AppError;
use gmk87_app::job::{preview_png, CropDto};
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

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewJob {
    pub bytes: Vec<u8>,
    pub crop: CropDto,
}

/// Renders a preview PNG, mapping an empty buffer to a named fault.
pub fn preview_bytes(job: &PreviewJob) -> Result<Vec<u8>, AppError> {
    if job.bytes.is_empty() {
        return Err(AppError {
            kind: gmk87_app::error::ErrorKind::Protocol,
            message: "no image bytes were provided".into(),
        });
    }
    preview_png(&job.bytes, &job.crop.to_spec())
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

    #[test]
    fn a_preview_job_without_bytes_names_the_fault() {
        let job = PreviewJob {
            bytes: Vec::new(),
            crop: CropDto {
                offset_x: 0.0,
                offset_y: 0.0,
                zoom: 1.0,
                fit: gmk87_app::job::FitDto::Cover,
            },
        };
        let error = super::preview_bytes(&job).unwrap_err();
        assert_eq!(error.kind, gmk87_app::error::ErrorKind::Protocol);
    }
}
