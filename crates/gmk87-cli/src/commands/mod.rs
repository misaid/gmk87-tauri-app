pub mod config;
pub mod probe;

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
