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
/// The longest single `read_report` inside an acknowledgement wait.
///
/// A tolerant-mode wait can run against the whole remaining upload budget (up
/// to [`UPLOAD_TOTAL_TIMEOUT`]). A single read for all of it would leave a
/// cancellation — Ctrl-C against a dongle that acknowledged once and then went
/// silent — unobserved for minutes, so each read is clamped to this slice and
/// the token is checked between them.
pub const CANCEL_POLL_SLICE: Duration = Duration::from_millis(200);
/// Consecutive unacknowledged packets after which the stream waits for the
/// device instead of queueing more writes.
///
/// Writes race ahead of a dongle that acknowledges about once a second; a
/// bounded number of outstanding packets keeps the slot from being silently
/// truncated while still allowing bursts between acknowledgements.
pub const FRAME_ACK_PACING_THRESHOLD: u32 = 8;
/// How long the paced mode waits for one frame packet's acknowledgement.
///
/// The wired interface answers each packet in milliseconds, so this bounds the
/// wait without adding per-packet latency in the normal case.
pub const FRAME_PACED_ACK_WINDOW: Duration = Duration::from_millis(200);
/// Consecutive paced-mode misses after which the stream stops waiting per
/// packet and falls back to the tolerant mode.
///
/// The 2.4 GHz dongle acknowledges roughly once per second, so a per-packet
/// wait cannot be satisfied there. Three misses is enough to tell "slow
/// transport" from "one late packet".
pub const FRAME_PACED_MISS_LIMIT: u32 = 3;

/// Timings for one frame stream.
///
/// Production always uses [`StreamTiming::PRODUCTION`]. Tests shrink the
/// windows so the paced and tolerant paths run in milliseconds; the structure
/// exists so no test has to wait a real 200 ms acknowledgement window.
#[derive(Debug, Clone, Copy)]
pub struct StreamTiming {
    /// Hard ceiling on the whole stream, independent of packet count.
    pub total: Duration,
    /// How long paced mode waits for one packet's acknowledgement.
    pub paced_ack_window: Duration,
    /// How long tolerant mode probes each packet.
    pub ack_window: Duration,
    /// Longest single blocking read inside a wait, so cancellation is checked
    /// at least this often.
    pub cancel_poll: Duration,
}

impl StreamTiming {
    /// The values production uses.
    pub const PRODUCTION: Self = Self {
        total: UPLOAD_TOTAL_TIMEOUT,
        paced_ack_window: FRAME_PACED_ACK_WINDOW,
        ack_window: FRAME_ACK_WINDOW,
        cancel_poll: CANCEL_POLL_SLICE,
    };
}

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
        self.upload_with_timing(
            plan,
            cancel,
            progress,
            StreamTiming {
                total: total_timeout,
                ..StreamTiming::PRODUCTION
            },
        )
    }

    /// [`Session::upload`] with every stream timing injectable.
    ///
    /// Production uses [`StreamTiming::PRODUCTION`]; tests use it to exercise
    /// the paced and tolerant acknowledgement paths without waiting real
    /// windows.
    pub fn upload_with_timing(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
        timing: StreamTiming,
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

        // INIT ×2 → CONFIG → COMMIT → UPLOAD_START(0x23)
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, patched.as_bytes())?;
        std::thread::sleep(WRITE_SETTLE);
        self.send_and_wait(Command::Commit, 0, &[])?;
        // 0x23 opens the frame upload session. The host sends it, once, with an
        // empty payload at position 0, between the configuration COMMIT and the
        // first FRAME_DATA — the official application's captured traffic shows
        // exactly one occurrence there. Without it the device accepts writes
        // for about sixteen seconds and then resets.
        //
        // Its acknowledgement is optional: the 2.4 GHz dongle acknowledges
        // sparsely, so a missing ack must not fail an otherwise valid upload.
        match self.send_and_wait(Command::Ready, 0, &[]) {
            Ok(_) => {}
            Err(DeviceError::ProtocolTimeout { .. }) => {
                tracing::debug!(
                    "no UPLOAD_START (0x23) acknowledgement; continuing before the frame stream"
                );
            }
            Err(error) => return Err(error),
        }
        // The handshake completed, so streaming may begin and the device now
        // holds the patched block; publish it only at this point.
        self.config = patched;
        self.synced = true;

        // The device now holds a partially written slot, so every exit below
        // must leave the display somewhere safe.
        if let Err(failure) = self.stream_frames(&memory, cancel, progress, timing) {
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

    /// Streams every frame packet, then commits. Runs only after the host has
    /// sent UPLOAD_START (`0x23`).
    ///
    /// The stream has two acknowledgement modes and picks between them from
    /// what the transport actually does:
    ///
    /// * **Paced** (the starting mode). After each packet, wait up to
    ///   `timing.paced_ack_window` for that packet's acknowledgement. The wired
    ///   interface answers each packet in milliseconds, so the cost is the real
    ///   round-trip and the device is never left with a backlog of unread
    ///   acknowledgements.
    /// * **Tolerant** (fallback). A transport that misses
    ///   [`FRAME_PACED_MISS_LIMIT`] paced acknowledgements in a row cannot be
    ///   paced — the 2.4 GHz dongle acknowledges roughly once per second — so
    ///   the stream stops waiting per packet, probes [`FRAME_ACK_WINDOW`]
    ///   instead, and only waits after [`FRAME_ACK_PACING_THRESHOLD`]
    ///   consecutive misses. The switch is one-way for the rest of the upload,
    ///   so a single slow packet cannot make the mode flap.
    ///
    /// Both modes are bounded by `timing.total`; the acceptance waits check
    /// `cancel` at least every `timing.cancel_poll`. Sixty-four consecutive
    /// silent packets fail with [`DeviceError::ProtocolTimeout`] and a spent
    /// budget fails with [`DeviceError::UploadTimeout`]; the caller repairs the
    /// display on every failure path.
    fn stream_frames(
        &mut self,
        memory: &[u8],
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
        timing: StreamTiming,
    ) -> std::result::Result<(), UploadFailure> {
        let total_bytes = memory.len();
        let started = Instant::now();
        let mut position = 0usize;
        let mut misses = 0u32;
        let mut seen_ack = false;
        // One-way: once the acknowledgements are shown to be sparse, do not
        // wait for every packet again for the rest of this upload.
        let mut paced = true;

        while position < total_bytes {
            if cancel.is_cancelled() || !self.synced {
                return Err(UploadFailure::Cancelled);
            }
            if started.elapsed() > timing.total {
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

            if paced {
                let budget = timing.total.saturating_sub(started.elapsed());
                let window = timing.paced_ack_window.min(budget);
                if self.wait_for_frame_ack(cancel, window, timing.cancel_poll)? {
                    misses = 0;
                    seen_ack = true;
                } else {
                    // The window was the whole remaining budget: no time is
                    // left for another packet.
                    if window == budget {
                        return Err(UploadFailure::Fatal(DeviceError::UploadTimeout {
                            sent: end,
                            total: total_bytes,
                        }));
                    }
                    misses += 1;
                    if misses >= FRAME_PACED_MISS_LIMIT {
                        paced = false;
                        tracing::debug!(
                            "frame acknowledgements are sparse; switching to tolerant streaming"
                        );
                    }
                }
            } else {
                match self.frame_acknowledged(timing.ack_window) {
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
            }

            position = end;
            progress(UploadProgress {
                bytes_sent: position,
                total_bytes,
            });

            // Tolerant-mode pacing: once the device has answered at least
            // once, stop queueing after FRAME_ACK_PACING_THRESHOLD misses and
            // wait for the next acknowledgement inside what is left of the
            // budget. A device that has never answered is diagnosed by the
            // miss limit above instead of burning the budget here.
            if !paced && seen_ack && misses >= FRAME_ACK_PACING_THRESHOLD {
                let budget = timing.total.saturating_sub(started.elapsed());
                if self.wait_for_frame_ack(cancel, budget, timing.cancel_poll)? {
                    misses = 0;
                } else {
                    return Err(UploadFailure::Fatal(DeviceError::UploadTimeout {
                        sent: position,
                        total: total_bytes,
                    }));
                }
            }
        }

        if started.elapsed() > timing.total {
            return Err(UploadFailure::Fatal(DeviceError::UploadTimeout {
                sent: position,
                total: total_bytes,
            }));
        }

        self.send_and_wait(Command::Commit, 0, &[])
            .map_err(UploadFailure::Transport)?;
        Ok(())
    }

    /// Reads for at most `window`, returning whether a `FrameData`
    /// acknowledgement arrived.
    ///
    /// A missing acknowledgement is not an error in the tolerant mode: the
    /// dongle acknowledges slowly and the final COMMIT confirms the whole
    /// transaction. Anything that is not a `FrameData` report is noise and is
    /// discarded.
    fn frame_acknowledged(&mut self, window: Duration) -> Result<bool> {
        match self.transport.read_report(window)? {
            Some(report) if report.len() >= 4 && report[3] == Command::FrameData.as_u8() => {
                Ok(true)
            }
            _ => Ok(false),
        }
    }

    /// Blocks up to `window` for a `FrameData` acknowledgement.
    ///
    /// Used for every packet in the paced mode and to resume a tolerant stream
    /// that has too many writes outstanding. Returns `Ok(false)` only when the
    /// window is spent without an acknowledgement; reports for other commands
    /// cannot confirm the frames, so they are discarded.
    ///
    /// The window can be the whole remaining upload ceiling, so no single read
    /// is allowed to run for it: each read is clamped to `cancel_poll` and
    /// `cancel` is re-checked between reads. Cancellation is reported as
    /// [`UploadFailure::Cancelled`] — the same failure the packet loop returns —
    /// so the caller's display repair runs.
    fn wait_for_frame_ack(
        &mut self,
        cancel: &CancelToken,
        window: Duration,
        cancel_poll: Duration,
    ) -> std::result::Result<bool, UploadFailure> {
        let deadline = Instant::now() + window;
        loop {
            if cancel.is_cancelled() || !self.synced {
                return Err(UploadFailure::Cancelled);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Ok(false);
            }
            match self.transport.read_report(remaining.min(cancel_poll)) {
                Ok(Some(report))
                    if report.len() >= 4 && report[3] == Command::FrameData.as_u8() =>
                {
                    return Ok(true)
                }
                // A read timeout or an unrelated report: keep waiting while
                // there is budget left.
                Ok(_) => continue,
                Err(error) => return Err(UploadFailure::Transport(error)),
            }
        }
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
