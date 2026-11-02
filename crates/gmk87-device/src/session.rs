//! The device state machine: handshake, configuration and upload streaming.
//!
//! The device is write-only: commands are acknowledged but never read back, so
//! the session owns the authoritative 48-byte configuration in memory and
//! writes the whole block each time. Nothing here issues `PREP_READ (0x03)` or
//! `READ_CFG (0x05)`.

use crate::error::{DeviceError, Result};
use crate::transport::Transport;
use gmk87_protocol::config::{DeviceConfig, ShowSlot, CONFIG_LEN};
use gmk87_protocol::frames::FramePlan;
use gmk87_protocol::packet::{checksum, Command, Packet, MAX_PAYLOAD};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const COMMAND_TIMEOUT: Duration = Duration::from_millis(1500);
pub const WRITE_SETTLE: Duration = Duration::from_millis(100);

pub struct Session<T: Transport> {
    transport: T,
    synced: bool,
    config: DeviceConfig,
}

impl<T: Transport> Session<T> {
    pub fn new(transport: T) -> Self {
        Self {
            transport,
            synced: false,
            config: DeviceConfig::default_config(),
        }
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    pub fn is_synced(&self) -> bool {
        self.synced
    }

    /// The configuration this session believes the device holds.
    pub fn config(&self) -> &DeviceConfig {
        &self.config
    }

    /// Seeds the session from a known configuration (for example a snapshot).
    pub fn set_config(&mut self, config: DeviceConfig) {
        self.config = config;
    }

    /// Hex of the configuration the session last wrote, for a snapshot file.
    pub fn snapshot_hex(&self) -> String {
        self.config.to_hex()
    }

    /// INIT → CONFIG → COMMIT. Write-only: never preceded by a read.
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
        self.config = config.clone();
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
                    // Two acknowledgement shapes exist. The wired interface
                    // answers with 8 bytes (`04 cs cs cmd …`), while the
                    // 2.4 GHz dongle answers with a full 64 bytes framed as
                    // report ID 0x01 (`01 cmd 09 cmd …`). Only app-framed
                    // reports carry the checksum the codec defines; the dongle
                    // echoes the command without one and the working community
                    // tool likewise checks only the command byte. Either way an
                    // acknowledgement has no payload to protect.
                    if report.len() < 12 || report[0] != gmk87_protocol::packet::REPORT_ID {
                        return Ok(Vec::new());
                    }
                    // A report can arrive intact-looking but with a damaged
                    // checksum. Discard it and keep reading: the device may
                    // resend, and a stale corrupt report must never be
                    // mistaken for this command's answer.
                    let expected = u16::from_le_bytes([report[1], report[2]]);
                    if checksum(&report) != expected {
                        continue;
                    }
                    let len = usize::from(report[4]).min(MAX_PAYLOAD);
                    return Ok(report[8..(8 + len).min(report.len())].to_vec());
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

/// Why the streaming phase stopped, so `upload` can repair once and report.
enum UploadFailure {
    Cancelled,
    Transport(DeviceError),
}

impl<T: Transport> Session<T> {
    /// Applies `edit` to the in-memory configuration and writes the result.
    pub fn set_lighting(&mut self, edit: &dyn Fn(&mut DeviceConfig)) -> Result<()> {
        edit(&mut self.config);
        let config = self.config.clone();
        self.write_config(&config)
    }

    /// Sets the keyboard clock, preserving every other in-memory setting.
    pub fn sync_clock(&mut self, now: &chrono::DateTime<chrono::Local>) -> Result<()> {
        use chrono::{Datelike, Timelike};
        let weekday = now.weekday().num_days_from_sunday() as u8;
        let (year, month, day) = (now.year(), now.month() as u8, now.day() as u8);
        let (hour, minute, second) = (now.hour() as u8, now.minute() as u8, now.second() as u8);
        self.config
            .set_time(year as u16, month, day, weekday, hour, minute, second)?;
        let config = self.config.clone();
        self.write_config(&config)
    }

    /// Full upload: validate, patch the in-memory config, stream frames, commit.
    ///
    /// Any failure below the handshake — cancellation, a transport error while
    /// streaming, or a failed final COMMIT — first closes the frame transaction
    /// and puts a safe display target back, then returns the failure.
    pub fn upload(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<()> {
        plan.validate()?;

        let previous_show = self.config.show_image();
        self.config
            .set_slot0_frames(plan.slot0_frames.len().min(u8::MAX as usize) as u8);
        self.config
            .set_slot1_frames(plan.slot1_frames.len().min(u8::MAX as usize) as u8);
        self.config.set_frame_delay_ms(plan.delay_ms);
        self.config.set_show_image(plan.show);

        let memory = plan.to_memory()?;
        let config = self.config.clone();

        // INIT ×2 → CONFIG → COMMIT → READY
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, config.as_bytes())?;
        std::thread::sleep(WRITE_SETTLE);
        self.send_and_wait(Command::Commit, 0, &[])?;
        if !self.wait_for_ready()? {
            tracing::debug!("device sent no READY; continuing after the COMMIT acknowledgement");
        }
        // The handshake completed, so streaming may begin.
        self.synced = true;

        // The device now holds a partially written slot, so every exit below
        // must leave the display somewhere safe.
        if let Err(failure) = self.stream_frames(&memory, cancel, progress) {
            // Best-effort: a failed repair must never mask the real cause.
            let _ = self.repair_display(previous_show, plan);
            self.synced = false;
            return Err(match failure {
                UploadFailure::Cancelled => {
                    DeviceError::InvalidJob("upload cancelled; display left unchanged".into())
                }
                UploadFailure::Transport(error) => DeviceError::UploadFailed {
                    source: Box::new(error),
                },
            });
        }
        Ok(())
    }

    /// Streams every frame packet, then commits. Runs only after READY.
    fn stream_frames(
        &mut self,
        memory: &[u8],
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
    ) -> std::result::Result<(), UploadFailure> {
        let total_bytes = memory.len();
        let mut position = 0usize;
        while position < total_bytes {
            if cancel.is_cancelled() || !self.synced {
                return Err(UploadFailure::Cancelled);
            }
            let end = (position + gmk87_protocol::packet::MAX_PAYLOAD).min(total_bytes);
            self.send_and_wait(Command::FrameData, position as u32, &memory[position..end])
                .map_err(UploadFailure::Transport)?;
            position = end;
            progress(UploadProgress {
                bytes_sent: position,
                total_bytes,
            });
        }

        self.send_and_wait(Command::Commit, 0, &[])
            .map_err(UploadFailure::Transport)?;
        Ok(())
    }

    /// Waits for READY up to [`COMMAND_TIMEOUT`].
    ///
    /// The 2.4 GHz dongle never sends READY: no `0x23` report arrives within
    /// 10 s of COMMIT, while FRAME_DATA is accepted immediately afterwards.
    /// The wired interface does send it. Returns whether READY was seen; the
    /// caller proceeds either way because the COMMIT acknowledgement already
    /// confirmed the configuration.
    fn wait_for_ready(&mut self) -> Result<bool> {
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        while Instant::now() < deadline {
            match self.transport.read_report(Duration::from_millis(100))? {
                Some(report) if report.len() >= 4 && report[3] == Command::Ready.as_u8() => {
                    return Ok(true);
                }
                _ => continue,
            }
        }
        Ok(false)
    }

    /// Puts the display back after an aborted upload.
    ///
    /// A bare COMMIT closes the interrupted frame transaction first; only then
    /// is a config write accepted. `previous_show` is restored unless its slot
    /// is one the plan wrote, whose memory is the torn one — that falls back to
    /// the clock. Both steps are attempted independently so a failed commit
    /// still gets a rewrite attempt; the commit error is reported first.
    fn repair_display(&mut self, previous_show: ShowSlot, plan: &FramePlan) -> Result<()> {
        let commit = self.send_and_wait(Command::Commit, 0, &[]);

        // `to_memory` streams slot 0 and then slot 1, so either slot can be
        // torn — not just the one `plan.show` selects.
        let torn = |slot: ShowSlot| match slot {
            ShowSlot::Slot0 => !plan.slot0_frames.is_empty(),
            ShowSlot::Slot1 => !plan.slot1_frames.is_empty(),
            ShowSlot::Clock => false,
        };
        let target = if torn(previous_show) {
            ShowSlot::Clock
        } else {
            previous_show
        };

        self.config.set_show_image(target);
        let config = self.config.clone();
        let rewrite = self.write_config(&config);

        commit?;
        rewrite
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mock::MockTransport;

    #[test]
    fn ready_is_optional() {
        // The dongle never answers READY; the wait must give up, not fail.
        let mut session = Session::new(MockTransport::new());
        assert!(!session.wait_for_ready().unwrap());
    }
}
