//! The device state machine: handshake, configuration and upload streaming.

use crate::error::{DeviceError, Result};
use crate::transport::Transport;
use gmk87_protocol::config::{DeviceConfig, CONFIG_LEN};
use gmk87_protocol::packet::{checksum, Command, Packet};
use std::time::{Duration, Instant};

pub const COMMAND_TIMEOUT: Duration = Duration::from_millis(1500);
pub const WRITE_SETTLE: Duration = Duration::from_millis(100);
const PREP_READ_COUNT: usize = 10;
const READ_CONFIG_COUNT: usize = 13;

pub struct Session<T: Transport> {
    transport: T,
    synced: bool,
}

impl<T: Transport> Session<T> {
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            synced: false,
        }
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    pub fn is_synced(&self) -> bool {
        self.synced
    }

    /// INIT → PREP_READ ×10 → COMMIT → READ_CFG until 48 bytes arrive.
    pub fn read_config(&mut self) -> Result<DeviceConfig> {
        self.send_and_wait(Command::Init, 0, &[])?;
        for _ in 0..PREP_READ_COUNT {
            self.send_and_wait(Command::PrepRead, 0, &[])?;
        }
        self.send_and_wait(Command::Commit, 0, &[])?;

        let mut raw = Vec::with_capacity(CONFIG_LEN);
        for _ in 0..READ_CONFIG_COUNT {
            if raw.len() >= CONFIG_LEN {
                break;
            }
            let payload = self.send_and_wait(Command::ReadConfig, 0, &[])?;
            raw.extend_from_slice(&payload);
        }
        let config = DeviceConfig::from_bytes(&raw)?;
        self.synced = true;
        Ok(config)
    }

    /// INIT → CONFIG → COMMIT.
    pub fn write_config(&mut self, config: &DeviceConfig) -> Result<()> {
        let bytes = config.as_bytes();
        if bytes.len() != CONFIG_LEN {
            return Err(DeviceError::InvalidJob(format!(
                "config must be {CONFIG_LEN} bytes, got {}",
                bytes.len()
            )));
        }
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, bytes)?;
        // A failed commit leaves the device state unknown.
        self.send_and_wait(Command::Commit, 0, &[])
            .map_err(|error| {
                self.synced = false;
                match error {
                    DeviceError::ProtocolTimeout { .. } => DeviceError::DeviceDesynced,
                    other => other,
                }
            })?;
        self.synced = true;
        Ok(())
    }

    /// Writes one packet and waits for a report whose command byte matches.
    /// Public so tests and the CLI can drive individual commands.
    pub fn send_and_wait(
        &mut self,
        command: Command,
        position: u32,
        payload: &[u8],
    ) -> Result<Vec<u8>> {
        let packet = Packet::new(command, position, payload)?;
        self.transport.write_report(&packet.encode())?;

        let deadline = Instant::now() + COMMAND_TIMEOUT;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self
                .transport
                .read_report(remaining.min(Duration::from_millis(100)))?
            {
                Some(report) if report.len() >= 8 && report[3] == command.as_u8() => {
                    // A report can arrive intact-looking but with a damaged
                    // checksum. Discard it and keep reading: the device may
                    // resend, and a stale corrupt report must never be
                    // mistaken for this command's answer.
                    let expected = u16::from_le_bytes([report[1], report[2]]);
                    if checksum(&report) != expected {
                        continue;
                    }
                    let decoded = Packet::decode(&report)?;
                    return Ok(decoded.payload);
                }
                // Wrong command or short report: discard and keep reading.
                _ => continue,
            }
        }
        Err(DeviceError::ProtocolTimeout {
            cmd: command.as_u8(),
        })
    }
}
