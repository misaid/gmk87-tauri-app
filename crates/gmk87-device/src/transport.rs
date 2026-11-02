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

/// Returns `true` when a libhidapi message reports a permission problem.
fn is_permission(message: &str) -> bool {
    message.to_lowercase().contains("permission")
}

/// Maps a hidapi open failure to the matching `DeviceError`.
fn classify_open_error(path: &str, message: &str) -> DeviceError {
    if is_permission(message) {
        DeviceError::PermissionDenied {
            path: path.to_string(),
        }
    } else {
        DeviceError::Hid(message.to_string())
    }
}

/// Returns `true` only for messages that explicitly report a wait timeout.
///
/// Real timeouts surface from `read_timeout` as `Ok(0)`. Anything else that
/// looks like a timeout is matched by phrase, never by bare `"timeout"`:
/// libhidapi prefixes disconnect and poll failures with `hid_read_timeout:`,
/// and those are genuine transport errors.
fn is_read_timeout(message: &str) -> bool {
    let lowered = message.to_lowercase();
    lowered.contains("timed out") || lowered.contains("time out")
}

/// Maps a hidapi read failure to a transport error. Read failures are real
/// errors (disconnect, thread shutdown, poll failure), not empty reads.
fn classify_read_error(message: &str) -> DeviceError {
    DeviceError::Hid(message.to_string())
}

/// Converts a timeout to hidapi's `i32` milliseconds without wrapping.
fn timeout_millis(timeout: Duration) -> i32 {
    timeout.as_millis().min(i32::MAX as u128) as i32
}

impl HidTransport {
    pub fn open(path: &str) -> Result<Self> {
        let api = hidapi::HidApi::new().map_err(|e| DeviceError::Hid(e.to_string()))?;
        let c_path = std::ffi::CString::new(path)
            .map_err(|_| DeviceError::Hid("device path contains a NUL byte".to_string()))?;
        let device = api
            .open_path(&c_path)
            .map_err(|e| classify_open_error(path, &e.to_string()))?;
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
        match self.device.read_timeout(&mut buf, timeout_millis(timeout)) {
            Ok(0) => Ok(None),
            Ok(n) => Ok(Some(buf[..n].to_vec())),
            Err(e) => {
                let message = e.to_string();
                if is_read_timeout(&message) {
                    Ok(None)
                } else {
                    Err(classify_read_error(&message))
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn disconnect_is_not_a_timeout() {
        let message = "hidapi error: hid_read_timeout: unexpected poll error (device disconnected)";
        assert!(!is_read_timeout(message));
        assert!(matches!(
            classify_read_error(message),
            DeviceError::Hid(inner) if inner == message
        ));
    }

    #[test]
    fn hid_read_timeout_prefix_is_not_a_timeout() {
        for message in [
            "hid_read_timeout: device disconnected",
            "hid_read_timeout: thread shutdown",
            "hid_read_timeout: error waiting for more data",
        ] {
            assert!(!is_read_timeout(message), "misclassified: {message}");
            assert!(matches!(classify_read_error(message), DeviceError::Hid(_)));
        }
    }

    #[test]
    fn explicit_timeout_phrases_are_timeouts() {
        for message in ["operation timed out", "Error: time out"] {
            assert!(is_read_timeout(message), "not classified: {message}");
        }
    }

    #[test]
    fn permission_denied_open_error() {
        let message = "Failed to open a device with path '/dev/hidraw1': Permission denied";
        assert!(is_permission(message));
        assert!(matches!(
            classify_open_error("/dev/hidraw1", message),
            DeviceError::PermissionDenied { path } if path == "/dev/hidraw1"
        ));
    }

    #[test]
    fn other_open_errors_are_hid_errors() {
        let message = "Failed to open a device with path '/dev/hidraw1': No such device";
        assert!(!is_permission(message));
        assert!(matches!(
            classify_open_error("/dev/hidraw1", message),
            DeviceError::Hid(inner) if inner == message
        ));
    }

    #[test]
    fn huge_timeout_is_clamped() {
        assert_eq!(timeout_millis(Duration::from_millis(10)), 10);
        assert_eq!(timeout_millis(Duration::from_secs(u64::MAX)), i32::MAX);
    }
}
