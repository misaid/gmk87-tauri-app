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

/// Opens the first detected keyboard.
pub fn open_session() -> anyhow::Result<Session<HidTransport>> {
    let devices = discover().context("enumerating HID devices")?;
    let Some(device) = devices.first() else {
        bail!("no GMK87 found — is it plugged in?");
    };
    let transport = HidTransport::open(&device.path)?;
    Ok(Session::new(transport))
}

/// Records the configuration the session just wrote, for the next run.
pub fn save_snapshot(session: &Session<HidTransport>) -> anyhow::Result<()> {
    let path = snapshot::write(&session.snapshot_hex()).context("writing config snapshot")?;
    println!("snapshot   {}", path.display());
    Ok(())
}
