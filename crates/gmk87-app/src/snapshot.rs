//! The last 48-byte block written, kept on disk so settings survive restarts.
//!
//! The device cannot be read (spec §3.3), so this file is the only record of
//! what the app last wrote.

use gmk87_protocol::config::DeviceConfig;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// `~/.local/share/gmk87/snapshot`, honouring `XDG_DATA_HOME`.
pub fn default_path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })?;
    Some(base.join("gmk87").join("snapshot"))
}

/// Loads a snapshot, or `None` when it is missing or malformed.
pub fn load(path: &Path) -> Option<DeviceConfig> {
    let text = fs::read_to_string(path).ok()?;
    DeviceConfig::from_hex(text.trim()).ok()
}

/// Writes the snapshot, creating parent directories as needed.
pub fn save(path: &Path, config: &DeviceConfig) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, config.to_hex())
}
