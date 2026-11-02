//! Find GMK87 vendor interfaces among the system's HID devices.

use crate::error::DeviceError;

pub const VENDOR_ID: u16 = 0x320f;
pub const PRODUCT_WIRED: u16 = 0x5055;
pub const PRODUCT_WIRELESS: u16 = 0x5088;
pub const USAGE_PAGE_VENDOR: u16 = 0xff1c;
pub const USAGE_PAGE_VIA: u16 = 0xff60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    Wired,
    Wireless24G,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    pub path: String,
    pub product_id: u16,
    pub transport: TransportKind,
    pub interface_number: i32,
    pub has_via: bool,
}

impl DeviceInfo {
    pub fn label(&self) -> String {
        match self.transport {
            TransportKind::Wired => "GMK87 (wired)".to_string(),
            TransportKind::Wireless24G => "GMK87 (2.4 GHz)".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawHidDevice {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub usage_page: u16,
    pub interface_number: i32,
}

pub trait HidEnumerator {
    fn list(&self) -> Result<Vec<RawHidDevice>, DeviceError>;
}

/// Pure selection: one `DeviceInfo` per physical keyboard, from the raw list.
pub fn select_devices(raw: &[RawHidDevice]) -> Vec<DeviceInfo> {
    let is_gmk = |d: &RawHidDevice| {
        d.vendor_id == VENDOR_ID
            && (d.product_id == PRODUCT_WIRED || d.product_id == PRODUCT_WIRELESS)
    };

    let mut out = Vec::new();
    for keyboard_pid in [PRODUCT_WIRED, PRODUCT_WIRELESS] {
        let group: Vec<&RawHidDevice> = raw
            .iter()
            .filter(|d| is_gmk(d) && d.product_id == keyboard_pid)
            .collect();
        let Some(vendor) = group.iter().find(|d| d.usage_page == USAGE_PAGE_VENDOR) else {
            continue;
        };
        let has_via = group.iter().any(|d| d.usage_page == USAGE_PAGE_VIA);
        out.push(DeviceInfo {
            path: vendor.path.clone(),
            product_id: keyboard_pid,
            transport: if keyboard_pid == PRODUCT_WIRED {
                TransportKind::Wired
            } else {
                TransportKind::Wireless24G
            },
            interface_number: vendor.interface_number,
            has_via,
        });
    }
    out
}

pub struct SystemEnumerator;

impl HidEnumerator for SystemEnumerator {
    fn list(&self) -> Result<Vec<RawHidDevice>, DeviceError> {
        let api = hidapi::HidApi::new().map_err(|e| DeviceError::Hid(e.to_string()))?;
        Ok(api
            .device_list()
            .filter(|d| d.vendor_id() == VENDOR_ID)
            .map(|d| RawHidDevice {
                path: d.path().to_string_lossy().into_owned(),
                vendor_id: d.vendor_id(),
                product_id: d.product_id(),
                usage_page: d.usage_page(),
                interface_number: d.interface_number(),
            })
            .collect())
    }
}

/// Convenience wrapper used by the CLI and the app.
pub fn discover() -> Result<Vec<DeviceInfo>, DeviceError> {
    Ok(select_devices(&SystemEnumerator.list()?))
}
