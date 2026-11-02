//! Byte transport abstraction so the session can be tested without hardware.

use crate::error::{DeviceError, Result};
use std::time::{Duration, Instant};

pub trait Transport: Send {
    fn write_report(&mut self, report: &[u8]) -> Result<()>;
    /// Returns `Ok(None)` when the timeout elapses with no report.
    fn read_report(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>>;

    /// Reads and discards everything available within `window`.
    fn drain(&mut self, window: Duration) -> Vec<Vec<u8>> {
        let deadline = Instant::now() + window;
        let mut out = Vec::new();
        while Instant::now() < deadline {
            match self.read_report(Duration::from_millis(10)) {
                Ok(Some(report)) => out.push(report),
                Ok(None) => {}
                Err(_) => break,
            }
        }
        out
    }
}

pub struct HidTransport {
    device: hidapi::HidDevice,
}

impl HidTransport {
    pub fn open(path: &str) -> Result<Self> {
        let api = hidapi::HidApi::new().map_err(|e| DeviceError::Hid(e.to_string()))?;
        let c_path = std::ffi::CString::new(path)
            .map_err(|_| DeviceError::Hid("device path contains a NUL byte".to_string()))?;
        let device = api.open_path(&c_path).map_err(|e| {
            let message = e.to_string();
            if message.to_lowercase().contains("permission") {
                DeviceError::PermissionDenied {
                    path: path.to_string(),
                }
            } else {
                DeviceError::Hid(message)
            }
        })?;
        device
            .set_blocking_mode(false)
            .map_err(|e| DeviceError::Hid(e.to_string()))?;
        Ok(Self { device })
    }
}

impl Transport for HidTransport {
    fn write_report(&mut self, report: &[u8]) -> Result<()> {
        self.device
            .write(report)
            .map(|_| ())
            .map_err(|e| DeviceError::Hid(e.to_string()))
    }

    fn read_report(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>> {
        let mut buf = [0u8; 64];
        match self
            .device
            .read_timeout(&mut buf, timeout.as_millis() as i32)
        {
            Ok(0) => Ok(None),
            Ok(n) => Ok(Some(buf[..n].to_vec())),
            Err(e) => {
                let message = e.to_string();
                if message.to_lowercase().contains("timeout") {
                    Ok(None)
                } else {
                    Err(DeviceError::Hid(message))
                }
            }
        }
    }
}
