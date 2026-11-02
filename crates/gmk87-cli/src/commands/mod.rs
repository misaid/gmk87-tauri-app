pub mod clock;
pub mod config;
pub mod lights;
pub mod probe;
pub mod snapshot;
pub mod upload;

use anyhow::{bail, Context};
use gmk87_device::discovery::discover;
use gmk87_device::session::Session;
use gmk87_device::transport::HidTransport;
use gmk87_protocol::config::DeviceConfig;
use std::path::Path;

/// Opens the first detected keyboard, seeded with the snapshot the app last
/// wrote. The device cannot be read, so that snapshot is the only way to carry
/// lighting and clock settings from one run to the next.
pub fn open_session() -> anyhow::Result<Session<HidTransport>> {
    let devices = discover().context("enumerating HID devices")?;
    let Some(device) = devices.first() else {
        bail!("no GMK87 found — is it plugged in?");
    };
    let transport = HidTransport::open(&device.path)?;
    Ok(Session::with_config(transport, load_config()))
}

/// The last configuration this app wrote, or the reference defaults.
///
/// A missing, unreadable or malformed snapshot is never an error: the first
/// run has no file at all, and a corrupt one must not stop the command.
pub fn load_config() -> DeviceConfig {
    load_config_from(&snapshot::path())
}

fn load_config_from(path: &Path) -> DeviceConfig {
    let hex = match std::fs::read_to_string(path) {
        Ok(hex) => hex,
        Err(error) => {
            tracing::debug!(path = %path.display(), %error, "no config snapshot; using defaults");
            return DeviceConfig::default_config();
        }
    };
    match DeviceConfig::from_hex(&hex) {
        Ok(config) => config,
        Err(error) => {
            tracing::warn!(
                path = %path.display(),
                %error,
                "ignoring malformed config snapshot; using defaults"
            );
            DeviceConfig::default_config()
        }
    }
}

/// Records the configuration the session just wrote, for the next run.
pub fn save_snapshot(session: &Session<HidTransport>) -> anyhow::Result<()> {
    let path = snapshot::write(&session.snapshot_hex()).context("writing config snapshot")?;
    println!("snapshot   {}", path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// A unique scratch path per test, so parallel tests cannot collide.
    fn scratch(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("gmk87-snapshot-test-{}-{name}", std::process::id()))
    }

    #[test]
    fn a_missing_snapshot_falls_back_to_defaults() {
        let path = scratch("missing");
        let _ = std::fs::remove_file(&path);
        assert_eq!(load_config_from(&path), DeviceConfig::default_config());
    }

    #[test]
    fn a_snapshot_seeds_the_session_byte_for_byte() {
        let path = scratch("valid");
        let mut raw = [0u8; 48];
        raw[1] = 5; // underglow effect
        raw[33] = 2; // show slot 1
        raw[35] = 0x59; // clock seconds, proving the clock survives
        let expected = DeviceConfig::from_bytes(&raw).unwrap();
        std::fs::write(&path, format!("{}\n", expected.to_hex())).unwrap();

        let loaded = load_config_from(&path);
        let _ = std::fs::remove_file(&path);

        assert_eq!(loaded, expected, "the snapshot must survive verbatim");
        assert_eq!(loaded.underglow_effect(), 5);
        assert_eq!(loaded.show_image(), gmk87_protocol::config::ShowSlot::Slot1);
    }

    #[test]
    fn a_malformed_snapshot_falls_back_to_defaults() {
        let path = scratch("malformed");
        for contents in [
            "not hex at all".to_string(),
            "00".to_string(),
            "ff".repeat(49),
            "zz".repeat(48),
        ] {
            std::fs::write(&path, &contents).unwrap();
            assert_eq!(
                load_config_from(&path),
                DeviceConfig::default_config(),
                "malformed snapshot was not ignored: {contents}"
            );
        }
        let _ = std::fs::remove_file(&path);
    }
}
