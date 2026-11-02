//! The device state machine: handshake, configuration and upload streaming.

use crate::error::{DeviceError, Result};
use crate::transport::Transport;
use gmk87_protocol::config::{DeviceConfig, CONFIG_LEN};
use gmk87_protocol::frames::FramePlan;
use gmk87_protocol::packet::{checksum, Command, Packet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
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

/// Cooperative cancellation flag, cheap to clone.
#[derive(Clone, Default)]
pub struct CancelToken {
    flag: Arc<AtomicBool>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadProgress {
    pub bytes_sent: usize,
    pub total_bytes: usize,
}

impl<T: Transport> Session<T> {
    /// Reads, applies `edit`, and writes back — never touching unknown bytes.
    pub fn set_lighting(&mut self, edit: &dyn Fn(&mut DeviceConfig)) -> Result<()> {
        let mut config = self.read_config()?;
        edit(&mut config);
        self.write_config(&config)
    }

    /// Sets the keyboard clock, preserving every other setting.
    pub fn sync_clock(&mut self, now: &chrono::DateTime<chrono::Local>) -> Result<()> {
        use chrono::{Datelike, Timelike};
        let weekday = now.weekday().num_days_from_sunday() as u8;
        let (year, month, day) = (now.year(), now.month() as u8, now.day() as u8);
        let (hour, minute, second) = (now.hour() as u8, now.minute() as u8, now.second() as u8);
        self.set_lighting(&|config: &mut DeviceConfig| {
            let _ = config.set_time(year as u16, month, day, weekday, hour, minute, second);
        })
    }

    /// Full upload: validate, patch config, stream frames, commit.
    pub fn upload(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<()> {
        plan.validate()?;

        let previous = self.read_config()?;

        let mut config = previous.clone();
        config.set_slot0_frames(plan.slot0_frames.len().min(u8::MAX as usize) as u8);
        config.set_slot1_frames(plan.slot1_frames.len().min(u8::MAX as usize) as u8);
        config.set_frame_delay_ms(plan.delay_ms);
        config.set_show_image(plan.show);

        let memory = plan.to_memory()?;
        let total_bytes = memory.len();

        // INIT ×2 → CONFIG → COMMIT → READY
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, config.as_bytes())?;
        std::thread::sleep(WRITE_SETTLE);
        self.send_and_wait(Command::Commit, 0, &[])?;
        self.wait_for_ready()?;

        let mut position = 0usize;
        while position < total_bytes {
            if cancel.is_cancelled() || !self.synced {
                // Best-effort: point the display back at the clock so a torn
                // frame is never shown. Failure here does not mask the cancel.
                let _ = self.repair_display(&previous);
                self.synced = false;
                return Err(DeviceError::InvalidJob("upload cancelled".into()));
            }
            let end = (position + gmk87_protocol::packet::MAX_PAYLOAD).min(total_bytes);
            self.send_and_wait(Command::FrameData, position as u32, &memory[position..end])?;
            position = end;
            progress(UploadProgress {
                bytes_sent: position,
                total_bytes,
            });
        }

        self.send_and_wait(Command::Commit, 0, &[])?;
        Ok(())
    }

    fn wait_for_ready(&mut self) -> Result<()> {
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        while Instant::now() < deadline {
            match self.transport.read_report(Duration::from_millis(100))? {
                Some(report) if report.len() >= 4 && report[3] == Command::Ready.as_u8() => {
                    return Ok(());
                }
                _ => continue,
            }
        }
        Err(DeviceError::ProtocolTimeout {
            cmd: Command::Ready.as_u8(),
        })
    }

    /// After a failed or cancelled upload, point the display back at a known slot.
    fn repair_display(&mut self, previous: &DeviceConfig) -> Result<()> {
        let mut safe = previous.clone();
        safe.set_show_image(gmk87_protocol::config::ShowSlot::Clock);
        let _ = self.write_config(&safe);
        Ok(())
    }
}
