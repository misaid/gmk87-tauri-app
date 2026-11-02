//! The last configuration the app wrote, kept because the device cannot be read.

use std::path::PathBuf;

/// `$XDG_DATA_HOME/gmk87/config.snapshot`, falling back to
/// `$HOME/.local/share/gmk87/config.snapshot`.
pub fn path() -> PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|home| PathBuf::from(home).join(".local/share"))
        })
        .unwrap_or_else(|| PathBuf::from(".local/share"));
    base.join("gmk87").join("config.snapshot")
}

/// Writes the 48-byte configuration as one line of hex and returns the path.
pub fn write(hex: &str) -> std::io::Result<PathBuf> {
    let path = path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&path, format!("{hex}\n"))?;
    Ok(path)
}
