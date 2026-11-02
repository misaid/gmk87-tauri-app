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
/// A hard ceiling on streaming one upload, independent of packet count.
///
/// The 2.4 GHz dongle acknowledges at roughly one packet per second, so the
/// old per-packet wait had to go; this bounds the whole stream instead.
pub const UPLOAD_TOTAL_TIMEOUT: Duration = Duration::from_secs(300);
/// How long one packet's acknowledgement is awaited before moving on.
pub const FRAME_ACK_WINDOW: Duration = Duration::from_millis(25);
/// Consecutive packets without a `FrameData` acknowledgement after which the
/// device is considered to be not responding at all.
pub const FRAME_ACK_MISS_LIMIT: u32 = 64;
/// Consecutive unacknowledged packets after which the stream waits for the
/// device instead of queueing more writes.
///
/// Writes race ahead of a dongle that acknowledges about once a second; a
/// bounded number of outstanding packets keeps the slot from being silently
/// truncated while still allowing bursts between acknowledgements.
pub const FRAME_ACK_PACING_THRESHOLD: u32 = 8;

pub struct Session<T: Transport> {
    transport: T,
    synced: bool,
    config: DeviceConfig,
}

impl<T: Transport> Session<T> {
    pub fn new(transport: T) -> Self {
        Self::with_config(transport, DeviceConfig::default_config())
    }

    /// Opens a session seeded with a known configuration, such as the
    /// snapshot the application last wrote to the device.
    pub fn with_config(transport: T, config: DeviceConfig) -> Self {
        Self {
            transport,
            synced: false,
            config,
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
    /// A failure reported as itself after the repair attempt, such as
    /// [`DeviceError::UploadTimeout`].
    Fatal(DeviceError),
    /// A transport failure, reported wrapped in [`DeviceError::UploadFailed`].
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
        self.upload_with_timeout(plan, cancel, progress, UPLOAD_TOTAL_TIMEOUT)
    }

    /// [`Session::upload`] with an injectable stream deadline.
    ///
    /// Tests use a short deadline instead of waiting five minutes; production
    /// always goes through [`Session::upload`] and [`UPLOAD_TOTAL_TIMEOUT`].
    pub fn upload_with_timeout(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
        total_timeout: Duration,
    ) -> Result<()> {
        plan.validate()?;

        // The block in place before this upload: the repair path restores it,
        // because the CONFIG sent below already overwrites both frame counts
        // and the delay — including the count of the slot not being uploaded.
        let previous = self.config.clone();

        // Patch a *local* copy, not `self.config`. Until the handshake COMMIT
        // is acknowledged the device holds nothing that this block describes,
        // so a `to_memory` or handshake failure must leave the session's
        // in-memory block untouched. Otherwise the next `set_lighting` or
        // `sync_clock` would commit frame counts for a slot never written.
        let mut patched = previous.clone();
        patched.set_slot0_frames(plan.slot0_frames.len().min(u8::MAX as usize) as u8);
        patched.set_slot1_frames(plan.slot1_frames.len().min(u8::MAX as usize) as u8);
        patched.set_frame_delay_ms(plan.delay_ms);
        patched.set_show_image(plan.show);

        let memory = plan.to_memory()?;

        // INIT ×2 → CONFIG → COMMIT → READY
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, patched.as_bytes())?;
        std::thread::sleep(WRITE_SETTLE);
        self.send_and_wait(Command::Commit, 0, &[])?;
        if !self.wait_for_ready(COMMAND_TIMEOUT)? {
            tracing::debug!("device sent no READY; continuing after the COMMIT acknowledgement");
        }
        // The handshake completed, so streaming may begin and the device now
        // holds the patched block; publish it only at this point.
        self.config = patched;
        self.synced = true;

        // The device now holds a partially written slot, so every exit below
        // must leave the display somewhere safe.
        if let Err(failure) = self.stream_frames(&memory, cancel, progress, total_timeout) {
            // Best-effort: a failed repair must never mask the real cause.
            let _ = self.repair_display(&previous, plan);
            self.synced = false;
            return Err(match failure {
                UploadFailure::Cancelled => DeviceError::InvalidJob(
                    "upload cancelled; display repair attempted — verify or reconnect".into(),
                ),
                UploadFailure::Fatal(error) => error,
                UploadFailure::Transport(error) => DeviceError::UploadFailed {
                    source: Box::new(error),
                },
            });
        }
        Ok(())
    }

    /// Streams every frame packet, then commits. Runs only after READY.
    ///
    /// Packets are written without waiting for an acknowledgement: the 2.4 GHz
    /// dongle answers about one packet per second, so a per-packet wait turned
    /// a 1,171-packet slot into a ~20-minute upload. Each packet is followed by
    /// a short probe instead, and the final COMMIT confirms the transaction.
    ///
    /// Once the device has demonstrated it is alive, the number of outstanding
    /// writes is bounded: after [`FRAME_ACK_PACING_THRESHOLD`] consecutive
    /// misses the stream waits for an acknowledgement before queueing more, so
    /// a host that outruns the dongle cannot silently truncate the slot. This
    /// is not a per-packet wait — it only engages when the host is ahead — and
    /// the wait is capped by what is left of `total_timeout`.
    fn stream_frames(
        &mut self,
        memory: &[u8],
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
        total_timeout: Duration,
    ) -> std::result::Result<(), UploadFailure> {
        let total_bytes = memory.len();
        let started = Instant::now();
        let mut position = 0usize;
        let mut misses = 0u32;
        let mut seen_ack = false;

        while position < total_bytes {
            if cancel.is_cancelled() || !self.synced {
                return Err(UploadFailure::Cancelled);
            }
            if started.elapsed() > total_timeout {
                return Err(UploadFailure::Fatal(DeviceError::UploadTimeout {
                    sent: position,
                    total: total_bytes,
                }));
            }

            let end = (position + gmk87_protocol::packet::MAX_PAYLOAD).min(total_bytes);
            let packet = Packet::new(Command::FrameData, position as u32, &memory[position..end])
                .map_err(|error| UploadFailure::Fatal(DeviceError::from(error)))?;
            self.transport
                .write_report(&packet.encode())
                .map_err(UploadFailure::Transport)?;

            match self.frame_acknowledged() {
                Ok(true) => {
                    misses = 0;
                    seen_ack = true;
                }
                Ok(false) => {
                    misses += 1;
                    if misses >= FRAME_ACK_MISS_LIMIT {
                        return Err(UploadFailure::Fatal(DeviceError::ProtocolTimeout {
                            cmd: Command::FrameData.as_u8(),
                        }));
                    }
                }
                Err(error) => return Err(UploadFailure::Transport(error)),
            }

            position = end;
            progress(UploadProgress {
                bytes_sent: position,
                total_bytes,
            });

            // Pace only once the device has answered at least once: a device
            // that has never answered is diagnosed quickly by the miss limit
            // above rather than by burning the whole upload budget on a wait.
            if seen_ack && misses >= FRAME_ACK_PACING_THRESHOLD {
                let budget = total_timeout.saturating_sub(started.elapsed());
                match self.wait_for_frame_ack(budget) {
                    Ok(true) => misses = 0,
                    Ok(false) => {
                        return Err(UploadFailure::Fatal(DeviceError::UploadTimeout {
                            sent: position,
                            total: total_bytes,
                        }))
                    }
                    Err(error) => return Err(UploadFailure::Transport(error)),
                }
            }
        }

        if started.elapsed() > total_timeout {
            return Err(UploadFailure::Fatal(DeviceError::UploadTimeout {
                sent: position,
                total: total_bytes,
            }));
        }

        self.send_and_wait(Command::Commit, 0, &[])
            .map_err(UploadFailure::Transport)?;
        Ok(())
    }

    /// Reads for at most [`FRAME_ACK_WINDOW`], returning whether a `FrameData`
    /// acknowledgement arrived.
    ///
    /// A missing acknowledgement is not an error: the dongle acknowledges
    /// slowly and the final COMMIT confirms the whole transaction. Anything
    /// that is not a `FrameData` report is noise and is discarded.
    fn frame_acknowledged(&mut self) -> Result<bool> {
        match self.transport.read_report(FRAME_ACK_WINDOW)? {
            Some(report) if report.len() >= 4 && report[3] == Command::FrameData.as_u8() => {
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// Blocks up to `budget` for a `FrameData` acknowledgement.
    ///
    /// Used to pace a host that is outrunning the device. Returns `Ok(false)`
    /// only when the whole budget is spent without an acknowledgement; reports
    /// for other commands cannot confirm the frames, so they are discarded.
    fn wait_for_frame_ack(&mut self, budget: Duration) -> Result<bool> {
        let deadline = Instant::now() + budget;
        loop {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(false);
            }
            match self.transport.read_report(remaining)? {
                Some(report) if report.len() >= 4 && report[3] == Command::FrameData.as_u8() => {
                    return Ok(true)
                }
                // A read timeout or an unrelated report: keep waiting while
                // there is budget left.
                _ => continue,
            }
        }
    }

    /// Waits for READY for at most `timeout`.
    ///
    /// The 2.4 GHz dongle never sends READY: no `0x23` report arrives within
    /// 10 s of COMMIT, while FRAME_DATA is accepted immediately afterwards.
    /// The wired interface does send it. Returns whether READY was seen; the
    /// caller proceeds either way because the COMMIT acknowledgement already
    /// confirmed the configuration. Public so tests can use a short timeout.
    pub fn wait_for_ready(&mut self, timeout: Duration) -> Result<bool> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self
                .transport
                .read_report(remaining.min(Duration::from_millis(100)))?
            {
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
    /// is a config write accepted. The whole pre-upload block is restored —
    /// frame counts, delay and every unknown byte — because the upload's own
    /// CONFIG already zeroed the other slot's count, so restoring only the
    /// shown slot would leave an untouched slot with nothing to animate. The
    /// previously shown slot is restored unless the plan wrote it, whose memory
    /// is the torn one — that falls back to the clock. Both steps are attempted
    /// independently so a failed commit still gets a rewrite attempt; the
    /// commit error is reported first.
    fn repair_display(&mut self, previous: &DeviceConfig, plan: &FramePlan) -> Result<()> {
        let commit = self.send_and_wait(Command::Commit, 0, &[]);

        // `to_memory` streams slot 0 and then slot 1, so either slot can be
        // torn — not just the one `plan.show` selects.
        let shown = previous.show_image();
        let torn = |slot: ShowSlot| match slot {
            ShowSlot::Slot0 => !plan.slot0_frames.is_empty(),
            ShowSlot::Slot1 => !plan.slot1_frames.is_empty(),
            ShowSlot::Clock => false,
        };
        let target = if torn(shown) { ShowSlot::Clock } else { shown };

        let mut restored = previous.clone();
        restored.set_show_image(target);
        let rewrite = self.write_config(&restored);

        commit?;
        rewrite
    }
}
