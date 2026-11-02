use gmk87_device::error::{DeviceError, Result as DeviceResult};
use gmk87_device::mock::MockTransport;
use gmk87_device::session::{
    CancelToken, Session, StreamTiming, UploadProgress, CANCEL_POLL_SLICE, FRAME_ACK_MISS_LIMIT,
    FRAME_ACK_PACING_THRESHOLD, FRAME_ACK_WINDOW,
};
use gmk87_device::transport::Transport;
use gmk87_protocol::config::{DeviceConfig, ShowSlot};
use gmk87_protocol::frames::FramePlan;
use gmk87_protocol::packet::Command;
use std::collections::VecDeque;
use std::time::{Duration, Instant};

fn one_frame_plan() -> FramePlan {
    FramePlan {
        slot0_frames: vec![vec![0u8; (240 * 135 * 3) as usize]],
        slot1_frames: vec![],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    }
}

fn frame_data_responses() -> Vec<Vec<u8>> {
    // 65536 bytes / 56 per packet = 1171 packets.
    vec![vec![]; 1171]
}

/// A previous config whose every field is distinct, so a rewrite that clobbers
/// unknown bytes or skips a field is visible.
fn previous_config(show: ShowSlot) -> DeviceConfig {
    let mut raw = [0x5Au8; 48];
    raw[33] = show.as_u8();
    raw[34] = 7; // slot 0 frame count
    raw[43] = 90; // frame delay, little-endian
    raw[44] = 0;
    raw[46] = 2; // slot 1 frame count
    DeviceConfig::from_bytes(&raw).unwrap()
}

/// A repair restores the whole pre-upload block — frame counts, delay and every
/// unknown byte — changing only `show_image`. Restoring only the shown slot
/// would leave the untouched slot with nothing to animate, because the upload's
/// CONFIG already zeroed its frame count.
fn restored(previous: &DeviceConfig, show: ShowSlot) -> Vec<u8> {
    let mut expected = previous.as_bytes().to_vec();
    expected[33] = show.as_u8();
    expected
}

/// `INIT ×2 → CONFIG → COMMIT`, then the host's `UPLOAD_START (0x23)`, which
/// this mock acknowledges. The device never sends `0x23`; the host does.
fn expect_upload_handshake(mock: &mut MockTransport) {
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::Ready, vec![vec![]]);
}

/// A repair always closes the frame transaction with a bare COMMIT, then
/// rewrites the config: INIT, CONFIG, COMMIT.
fn expect_repair(mock: &mut MockTransport) {
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
}

fn reports(writes: &[Vec<u8>], command: Command) -> Vec<&Vec<u8>> {
    writes.iter().filter(|w| w[3] == command.as_u8()).collect()
}

/// 24-bit little-endian stream position, bytes 5..8.
fn position_of(report: &[u8]) -> u32 {
    u32::from(report[5]) | (u32::from(report[6]) << 8) | (u32::from(report[7]) << 16)
}

/// The payload, trimmed to the length byte at offset 4.
fn payload_of(report: &[u8]) -> &[u8] {
    &report[8..8 + report[4] as usize]
}

fn assert_cancelled(error: &DeviceError) {
    match error {
        DeviceError::InvalidJob(message) => assert!(
            message.contains("display repair attempted"),
            "error does not name the display state: {message}"
        ),
        other => panic!("expected InvalidJob, got {other:?}"),
    }
}

/// The device cannot be read, so no code path may ever emit these.
fn assert_no_read_commands(commands: &[u8]) {
    assert!(
        !commands.contains(&Command::PrepRead.as_u8()),
        "PREP_READ (0x03) was sent: {commands:?}"
    );
    assert!(
        !commands.contains(&Command::ReadConfig.as_u8()),
        "READ_CFG (0x05) was sent: {commands:?}"
    );
}

#[test]
fn uploads_one_slot_with_config_from_memory() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    mock.expect(Command::FrameData, frame_data_responses());
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    session.set_config(previous.clone());
    let cancel = CancelToken::new();
    let mut last = UploadProgress {
        bytes_sent: 0,
        total_bytes: 0,
    };
    session.upload(&plan, &cancel, &mut |p| last = p).unwrap();

    assert_eq!(last.total_bytes, 65536);
    assert_eq!(last.bytes_sent, 65536);
    let commands = session.transport().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "ends with COMMIT");
    assert_no_read_commands(&commands);

    // UPLOAD_START (0x23) is a host command, sent once between the
    // configuration COMMIT and the first FRAME_DATA.
    assert_eq!(
        &commands[3..6],
        &[0x02, 0x23, 0x21],
        "COMMIT → UPLOAD_START → first frame packet"
    );
    assert_eq!(
        commands.iter().filter(|command| **command == 0x23).count(),
        1,
        "UPLOAD_START is sent exactly once per upload"
    );

    // Frame streaming: exactly one packet per 56 bytes, positions contiguous
    // and advancing by each packet's own payload length.
    let writes = session.transport().writes();
    let frames = reports(writes, Command::FrameData);
    assert_eq!(frames.len(), 1171, "65536 bytes at 56 bytes per packet");
    let mut expected_position = 0u32;
    for frame in &frames {
        assert_eq!(
            position_of(frame),
            expected_position,
            "positions must be monotonic and contiguous"
        );
        expected_position += u32::from(frame[4]);
    }
    assert_eq!(expected_position, 65536);
    assert_eq!(frames.last().unwrap()[4], 16, "65536 - 1170 * 56");
    assert!(
        frames[..frames.len() - 1].iter().all(|f| f[4] == 56),
        "only the last packet is short"
    );

    // CONFIG: the session's in-memory block with only the upload's own fields
    // changed; every other byte is preserved.
    let config_writes = reports(writes, Command::Config);
    assert_eq!(config_writes.len(), 1, "one config write per upload");
    let mut expected = previous.as_bytes().to_vec();
    expected[33] = plan.show.as_u8();
    expected[34] = plan.slot0_frames.len() as u8;
    expected[43..45].copy_from_slice(&plan.delay_ms.to_le_bytes());
    expected[46] = plan.slot1_frames.len() as u8;
    assert_eq!(
        payload_of(config_writes[0]),
        expected.as_slice(),
        "frame counts, delay and show_image patched, unknown bytes preserved"
    );
    assert_eq!(payload_of(config_writes[0])[33], ShowSlot::Slot0.as_u8());
    assert_eq!(
        &payload_of(config_writes[0])[0..33],
        &previous.as_bytes()[0..33]
    );
}

#[test]
fn upload_writes_the_default_config_when_the_session_is_fresh() {
    let plan = one_frame_plan();
    let default = DeviceConfig::default_config();

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    mock.expect(Command::FrameData, frame_data_responses());
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    session
        .upload(&plan, &CancelToken::new(), &mut |_| {})
        .unwrap();

    let mut expected = default.as_bytes().to_vec();
    expected[33] = plan.show.as_u8();
    expected[34] = 1;
    expected[43..45].copy_from_slice(&plan.delay_ms.to_le_bytes());
    expected[46] = 0;
    let writes = session.transport().writes();
    let config_writes = reports(writes, Command::Config);
    assert_eq!(payload_of(config_writes[0]), expected.as_slice());
    assert_no_read_commands(&session.transport().commands_sent());
}

#[test]
fn a_missing_upload_start_acknowledgement_does_not_fail_the_upload() {
    // On the 2.4 GHz dongle acknowledgements are sparse, so UPLOAD_START (0x23)
    // may go unanswered. The handshake must proceed and stream anyway, while
    // still sending 0x23 exactly once.
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    let device = ScriptedDevice::new(Some(1))
        .ignoring(Command::Ready)
        .block_empty_reads();
    let mut session = Session::with_config(device, previous.clone());
    session
        .upload(&plan, &CancelToken::new(), &mut |_| {})
        .expect("a missing UPLOAD_START ack must not fail the upload");

    let writes = session.transport().writes();
    let commands: Vec<u8> = writes.iter().map(|w| w[3]).collect();
    assert_eq!(
        commands.iter().filter(|command| **command == 0x23).count(),
        1,
        "UPLOAD_START is sent once and not retried"
    );
    assert_eq!(
        &commands[3..6],
        &[0x02, 0x23, 0x21],
        "COMMIT → UPLOAD_START → first frame packet"
    );
    assert_eq!(
        reports(writes, Command::FrameData).len(),
        1171,
        "the whole slot was streamed"
    );
    assert_eq!(
        writes.last().map(|w| w[3]),
        Some(Command::Commit.as_u8()),
        "the transaction ends with COMMIT"
    );
    assert_no_read_commands(&commands);
}

#[test]
fn cancellation_stops_streaming_and_repairs_the_display() {
    let previous = previous_config(ShowSlot::Clock);
    let plan = one_frame_plan();

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    expect_repair(&mut mock);

    let mut session = Session::new(mock);
    session.set_config(previous.clone());
    let cancel = CancelToken::new();
    cancel.cancel();
    let result = session.upload(&plan, &cancel, &mut |_| {});

    let err = result.unwrap_err();
    assert_cancelled(&err);
    let commands = session.transport().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "repair COMMIT was sent");
    assert!(
        !commands.contains(&0x21),
        "no frame data was streamed after cancellation"
    );
    assert!(!session.is_synced());
}

#[test]
fn cancellation_restores_the_previous_slot_instead_of_the_clock() {
    // The display is on slot 1 and slot 0 is being uploaded, so slot 1's
    // memory is untouched and stays safe to show.
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    expect_repair(&mut mock);

    let mut session = Session::new(mock);
    session.set_config(previous.clone());
    let cancel = CancelToken::new();
    cancel.cancel();
    let err = session.upload(&plan, &cancel, &mut |_| {}).unwrap_err();

    assert_cancelled(&err);
    let writes = session.transport().writes();
    let config_writes = reports(writes, Command::Config);
    let repair = payload_of(config_writes.last().unwrap());
    assert_eq!(
        repair[33],
        ShowSlot::Slot1.as_u8(),
        "the display must stay on the untouched slot"
    );
    assert_eq!(
        repair,
        restored(&previous, ShowSlot::Slot1).as_slice(),
        "the whole pre-upload block is rewritten, with the untouched slot shown"
    );
    // The upload's CONFIG zeroed slot 1's frame count; the repair must put the
    // pre-upload value back, not the plan's.
    assert_eq!(
        repair[46],
        previous.slot1_frames(),
        "the untouched slot keeps its pre-upload frame count"
    );
    assert_eq!(repair[34], previous.slot0_frames());
    assert_eq!(
        &repair[43..45],
        &previous.frame_delay_ms().to_le_bytes(),
        "the pre-upload delay is restored"
    );
    assert_ne!(repair[46], 0, "slot 1 must still have frames to animate");
    assert!(!session.is_synced());
}

#[test]
fn cancellation_falls_back_to_the_clock_when_the_target_slot_is_on_screen() {
    // The display is already on slot 0 and slot 0 is being overwritten, so the
    // clock is the only safe target.
    let previous = previous_config(ShowSlot::Slot0);
    let plan = one_frame_plan();

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    expect_repair(&mut mock);

    let mut session = Session::new(mock);
    session.set_config(previous.clone());
    let cancel = CancelToken::new();
    cancel.cancel();
    session.upload(&plan, &cancel, &mut |_| {}).unwrap_err();

    let writes = session.transport().writes();
    let config_writes = reports(writes, Command::Config);
    let repair = payload_of(config_writes.last().unwrap());

    let expected = restored(&previous, ShowSlot::Clock);
    assert_eq!(repair, expected.as_slice());
    assert_eq!(repair[33], ShowSlot::Clock.as_u8());
    assert_eq!(
        repair[34],
        previous.slot0_frames(),
        "the torn slot's count is restored too, not left at the plan's"
    );
}

#[test]
fn a_plan_that_writes_both_slots_never_repairs_onto_a_torn_slot() {
    // Both slots carry frames, so `to_memory` overwrites both; displaying slot 1
    // instead does not make the previous slot 0 safe.
    let previous = previous_config(ShowSlot::Slot0);
    let plan = FramePlan {
        slot0_frames: vec![vec![0u8; (240 * 135 * 3) as usize]],
        slot1_frames: vec![vec![0u8; (240 * 135 * 3) as usize]],
        delay_ms: 100,
        show: ShowSlot::Slot1,
    };

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    expect_repair(&mut mock);

    let mut session = Session::new(mock);
    session.set_config(previous.clone());
    let cancel = CancelToken::new();
    cancel.cancel();
    let err = session.upload(&plan, &cancel, &mut |_| {}).unwrap_err();

    assert_cancelled(&err);
    let writes = session.transport().writes();
    let config_writes = reports(writes, Command::Config);
    let repair = payload_of(config_writes.last().unwrap());

    assert_ne!(
        repair[33],
        ShowSlot::Slot0.as_u8(),
        "slot 0 was torn by the plan and must not be re-shown"
    );
    assert_eq!(
        repair[33],
        ShowSlot::Clock.as_u8(),
        "the repair falls back to the clock"
    );
    let expected = restored(&previous, ShowSlot::Clock);
    assert_eq!(repair, expected.as_slice());
    assert_eq!(
        repair[46],
        previous.slot1_frames(),
        "neither slot keeps the plan's frame counts"
    );
    assert!(!session.is_synced());
}

/// Fails exactly one `write_report` by ordinal, passing everything else through
/// to the mock so read responses still line up.
struct FlakyTransport {
    inner: MockTransport,
    writes: usize,
    fail_on_write: usize,
}

impl FlakyTransport {
    fn new(inner: MockTransport, fail_on_write: usize) -> Self {
        Self {
            inner,
            writes: 0,
            fail_on_write,
        }
    }

    fn inner(&self) -> &MockTransport {
        &self.inner
    }
}

impl Transport for FlakyTransport {
    fn write_report(&mut self, report: &[u8]) -> DeviceResult<()> {
        self.writes += 1;
        if self.writes == self.fail_on_write {
            return Err(DeviceError::Hid("injected mid-upload write failure".into()));
        }
        self.inner.write_report(report)
    }

    fn read_report(&mut self, timeout: Duration) -> DeviceResult<Option<Vec<u8>>> {
        self.inner.read_report(timeout)
    }
}

#[test]
fn a_mid_upload_transport_failure_repairs_the_display() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    let mut mock = MockTransport::new();
    expect_upload_handshake(&mut mock);
    // Only three frame acks are queued: the fourth FRAME_DATA write fails.
    mock.expect(Command::FrameData, vec![vec![]; 3]);
    expect_repair(&mut mock);

    // The upload handshake writes 5 reports (INIT ×2, CONFIG, COMMIT,
    // UPLOAD_START), then three frame reports.
    let fail_on_write = 5 + 3 + 1;
    let mut session = Session::new(FlakyTransport::new(mock, fail_on_write));
    session.set_config(previous.clone());
    let err = session
        .upload(&plan, &CancelToken::new(), &mut |_| {})
        .unwrap_err();

    match &err {
        DeviceError::UploadFailed { source } => {
            assert!(
                matches!(**source, DeviceError::Hid(_)),
                "the original transport variant was lost: {source:?}"
            );
            assert!(
                source
                    .to_string()
                    .contains("injected mid-upload write failure"),
                "the transport cause was lost: {source}"
            );
        }
        other => panic!("expected UploadFailed, got {other:?}"),
    }
    assert!(
        err.to_string().contains("display repair attempted"),
        "error does not name the display state: {err}"
    );
    assert!(
        std::error::Error::source(&err).is_some(),
        "UploadFailed must preserve its source"
    );

    let writes = session.transport().inner().writes();
    let commands = session.transport().inner().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "repair COMMIT was sent");
    assert_eq!(
        reports(writes, Command::FrameData).len(),
        3,
        "no frame data after the failed write"
    );
    assert!(!session.is_synced());

    let config_writes = reports(writes, Command::Config);
    let repair = payload_of(config_writes.last().unwrap());
    assert_eq!(
        repair,
        restored(&previous, ShowSlot::Slot1).as_slice(),
        "the pre-upload block is rewritten with the untouched slot shown"
    );
    assert_eq!(
        repair[46],
        previous.slot1_frames(),
        "the untouched slot's frame count survives a transport failure"
    );
}

#[test]
fn a_frame_budget_violation_never_touches_the_device() {
    let plan = FramePlan {
        slot0_frames: vec![vec![0u8; (240 * 135 * 3) as usize]; 40],
        slot1_frames: vec![],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };
    let mut session = Session::new(MockTransport::new());
    let cancel = CancelToken::new();
    let err = session.upload(&plan, &cancel, &mut |_| {}).unwrap_err();
    assert!(matches!(
        err,
        DeviceError::Protocol(gmk87_protocol::error::ProtocolError::FrameBudget { .. })
    ));
    assert!(session.transport().writes().is_empty(), "no USB traffic");
}

#[test]
fn a_to_memory_failure_leaves_the_in_memory_config_untouched() {
    // A frame with the wrong length passes `validate` but fails `to_memory`.
    let previous = previous_config(ShowSlot::Slot1);
    let plan = FramePlan {
        slot0_frames: vec![vec![0u8; 10]],
        slot1_frames: vec![],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };

    let mut session = Session::with_config(MockTransport::new(), previous.clone());
    let err = session
        .upload(&plan, &CancelToken::new(), &mut |_| {})
        .unwrap_err();

    assert!(matches!(
        err,
        DeviceError::Protocol(gmk87_protocol::error::ProtocolError::InvalidJob(_))
    ));
    assert_eq!(
        session.config(),
        &previous,
        "a failed memory build must not publish the patched frame counts"
    );
    assert!(
        session.transport().writes().is_empty(),
        "no USB traffic after a memory failure"
    );
}

#[test]
fn a_failed_handshake_leaves_the_in_memory_config_untouched() {
    // Seed the session with a successful write so `synced` is true and the
    // in-memory block is the one the device holds.
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    // Upload handshake: both INITs are acknowledged, CONFIG is never answered.
    mock.expect(Command::Init, vec![vec![]; 2]);

    let mut session = Session::new(mock);
    session.write_config(&previous).unwrap();
    assert!(session.is_synced());

    let err = session
        .upload(&plan, &CancelToken::new(), &mut |_| {})
        .unwrap_err();

    assert!(matches!(
        err,
        DeviceError::ProtocolTimeout { cmd } if cmd == Command::Config.as_u8()
    ));
    assert_eq!(
        session.config(),
        &previous,
        "a failed handshake must not publish a block the device never took"
    );
    assert_eq!(
        session.config().show_image(),
        ShowSlot::Slot1,
        "the attempted `show` must not leak into the in-memory block"
    );
    assert_eq!(session.config().slot0_frames(), previous.slot0_frames());
}

#[test]
fn no_test_source_touches_a_device_node() {
    // The suite is hardware-free by construction: every transport is an
    // in-process mock. Guard against an accidental hardware dependency
    // creeping into a test.
    let device_node = concat!("/dev/", "hidraw");
    let hardware_transport = concat!("Hid", "Transport");
    let tests = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests");
    for entry in std::fs::read_dir(&tests).expect("tests directory") {
        let path = entry.expect("directory entry").path();
        if path.extension().is_none_or(|extension| extension != "rs") {
            continue;
        }
        let source = std::fs::read_to_string(&path).expect("test source");
        assert!(
            !source.contains(device_node),
            "{} references a device node",
            path.display()
        );
        assert!(
            !source.contains(hardware_transport),
            "{} uses the hardware transport",
            path.display()
        );
    }
}

/// A transport that answers every command immediately, like a healthy wired
/// keyboard, but acknowledges `FRAME_DATA` only every `ack_every` packets (or
/// never, when `ack_every` is `None`).
///
/// Reads return instantly instead of blocking for the acknowledgement window,
/// so a 1,171-packet upload runs in milliseconds rather than one 25 ms window
/// per packet.
struct ScriptedDevice {
    responses: VecDeque<Vec<u8>>,
    writes: Vec<Vec<u8>>,
    ack_every: Option<u32>,
    frames: u32,
    acks: u32,
    ack_limit: Option<u32>,
    frame_write_delay: Duration,
    empty_read_sleep: Duration,
    frame_ack_reads: Vec<Duration>,
    ignore: Option<Command>,
}

impl ScriptedDevice {
    fn new(ack_every: Option<u32>) -> Self {
        Self {
            responses: VecDeque::new(),
            writes: Vec::new(),
            ack_every,
            frames: 0,
            acks: 0,
            ack_limit: None,
            frame_write_delay: Duration::ZERO,
            empty_read_sleep: Duration::ZERO,
            frame_ack_reads: Vec::new(),
            ignore: None,
        }
    }

    /// Makes each `FRAME_DATA` write take real time, so a test can spend a
    /// stream deadline without waiting for a whole upload.
    fn delay_frame_writes(mut self, delay: Duration) -> Self {
        self.frame_write_delay = delay;
        self
    }

    /// Stops acknowledging after `limit` `FRAME_DATA` acknowledgements, as a
    /// dongle that goes silent mid-stream.
    fn stop_acking_after(mut self, limit: u32) -> Self {
        self.ack_limit = Some(limit);
        self
    }

    /// Sleeps when no report is queued, like a blocking transport, so a wait
    /// for an acknowledgement spends wall time instead of spinning.
    fn block_empty_reads(mut self) -> Self {
        self.empty_read_sleep = Duration::from_millis(1);
        self
    }

    /// Never acknowledges `command`, as a sparsely answering dongle does.
    fn ignoring(mut self, command: Command) -> Self {
        self.ignore = Some(command);
        self
    }

    /// The timeouts of the reads that returned a `FRAME_DATA` acknowledgement,
    /// in order. A longer request means the stream was in paced mode rather
    /// than probing with [`FRAME_ACK_WINDOW`].
    fn frame_ack_reads(&self) -> &[Duration] {
        &self.frame_ack_reads
    }

    /// The 2.4 GHz dongle's acknowledgement shape: 64 bytes, report ID `0x01`,
    /// the command echoed at offset 3, and no application checksum.
    fn ack(&mut self, command: Command) {
        let mut report = vec![0u8; 64];
        report[0] = 0x01;
        report[1] = command.as_u8();
        report[2] = 0x09;
        report[3] = command.as_u8();
        self.responses.push_back(report);
    }

    fn writes(&self) -> &[Vec<u8>] {
        &self.writes
    }
}

impl Transport for ScriptedDevice {
    fn write_report(&mut self, report: &[u8]) -> DeviceResult<()> {
        self.writes.push(report.to_vec());
        let Some(command) = Command::from_u8(report[3]) else {
            return Ok(());
        };
        match command {
            Command::FrameData => {
                if !self.frame_write_delay.is_zero() {
                    std::thread::sleep(self.frame_write_delay);
                }
                self.frames += 1;
                let allowed = self.ack_limit.is_none_or(|limit| self.acks < limit);
                if allowed
                    && matches!(self.ack_every, Some(every) if self.frames.is_multiple_of(every))
                {
                    self.acks += 1;
                    self.ack(Command::FrameData);
                }
            }
            // Every other command, including the host's UPLOAD_START (0x23),
            // is acknowledged immediately — unless the test made it one the
            // device ignores.
            other => {
                if self.ignore != Some(other) {
                    self.ack(other);
                }
            }
        }
        Ok(())
    }

    fn read_report(&mut self, timeout: Duration) -> DeviceResult<Option<Vec<u8>>> {
        if let Some(report) = self.responses.pop_front() {
            if report.len() >= 4 && report[3] == Command::FrameData.as_u8() {
                self.frame_ack_reads.push(timeout);
            }
            return Ok(Some(report));
        }
        if !self.empty_read_sleep.is_zero() {
            std::thread::sleep(self.empty_read_sleep);
        }
        Ok(None)
    }
}

#[test]
fn upload_completes_when_only_every_eighth_frame_is_acknowledged() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    // The first three paced waits miss, which switches the stream to the
    // tolerant mode; from then on every eighth packet is acknowledged and the
    // seven silent packets in between are tolerated.
    let device = ScriptedDevice::new(Some(8)).block_empty_reads();
    let mut session = Session::with_config(device, previous.clone());
    let timing = StreamTiming {
        paced_ack_window: Duration::from_millis(5),
        cancel_poll: Duration::from_millis(1),
        ..StreamTiming::PRODUCTION
    };
    let mut last = UploadProgress {
        bytes_sent: 0,
        total_bytes: 0,
    };
    session
        .upload_with_timing(&plan, &CancelToken::new(), &mut |p| last = p, timing)
        .expect("sparse acknowledgements must not fail the upload");

    assert_eq!(last.bytes_sent, 65536);
    assert_eq!(last.total_bytes, 65536);

    let writes = session.transport().writes();
    let frames = reports(writes, Command::FrameData);
    assert_eq!(frames.len(), 1171, "every packet must still be written");
    assert_eq!(
        writes.last().map(|w| w[3]),
        Some(Command::Commit.as_u8()),
        "the transaction still ends with COMMIT"
    );

    // Those acknowledgements were read by the tolerant probe, not by a paced
    // wait: every read that saw one offered the short probe window.
    assert!(
        session
            .transport()
            .frame_ack_reads()
            .iter()
            .all(|timeout| *timeout <= FRAME_ACK_WINDOW),
        "the stream never left the tolerant mode"
    );

    // The frame counts and show slot reached the device even though most
    // packets were never acknowledged.
    let config_writes = reports(writes, Command::Config);
    assert_eq!(payload_of(config_writes[0])[33], ShowSlot::Slot0.as_u8());
    let commands: Vec<u8> = writes.iter().map(|w| w[3]).collect();
    assert_no_read_commands(&commands);
}

#[test]
fn a_promptly_acknowledged_stream_completes_in_paced_mode() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    // Every packet is acknowledged immediately, as the wired interface does.
    let mut session = Session::with_config(ScriptedDevice::new(Some(1)), previous.clone());
    let mut last = UploadProgress {
        bytes_sent: 0,
        total_bytes: 0,
    };
    session
        .upload(&plan, &CancelToken::new(), &mut |p| last = p)
        .expect("a promptly acknowledged stream must complete");

    assert_eq!(last.bytes_sent, 65536);
    let writes = session.transport().writes();
    assert_eq!(
        reports(writes, Command::FrameData).len(),
        1171,
        "every packet must be written"
    );

    // One acknowledgement read per packet, each offering the paced window.
    // The tolerant probe would have asked for only FRAME_ACK_WINDOW.
    let ack_reads = session.transport().frame_ack_reads();
    assert_eq!(ack_reads.len(), 1171, "one acknowledgement per packet");
    assert!(
        ack_reads.iter().all(|timeout| *timeout > FRAME_ACK_WINDOW),
        "the stream was not waiting per packet: first read {:?}",
        ack_reads.first()
    );
    assert_no_read_commands(&writes.iter().map(|w| w[3]).collect::<Vec<_>>());
}

#[test]
fn an_unacknowledged_stream_fails_with_a_frame_timeout_and_repairs() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    // The three paced waits miss, the stream switches to the tolerant mode,
    // and the miss limit then ends it.
    let device = ScriptedDevice::new(None).block_empty_reads();
    let mut session = Session::with_config(device, previous.clone());
    let timing = StreamTiming {
        paced_ack_window: Duration::from_millis(5),
        cancel_poll: Duration::from_millis(1),
        ..StreamTiming::PRODUCTION
    };
    let err = session
        .upload_with_timing(&plan, &CancelToken::new(), &mut |_| {}, timing)
        .unwrap_err();

    match &err {
        DeviceError::ProtocolTimeout { cmd } => assert_eq!(*cmd, Command::FrameData.as_u8()),
        other => panic!("expected a FRAME_DATA protocol timeout, got {other:?}"),
    }
    assert_eq!(
        reports(session.transport().writes(), Command::FrameData).len(),
        FRAME_ACK_MISS_LIMIT as usize,
        "the stream stops after the consecutive-miss limit"
    );

    // The failure still repairs: a bare COMMIT closes the transaction, then
    // the config is rewritten with the untouched slot shown.
    let writes = session.transport().writes();
    assert_eq!(
        writes.last().map(|w| w[3]),
        Some(Command::Commit.as_u8()),
        "repair COMMIT was sent"
    );
    let config_writes = reports(writes, Command::Config);
    assert_eq!(config_writes.len(), 2, "the upload plus the repair rewrite");
    assert_eq!(
        payload_of(config_writes.last().unwrap()),
        restored(&previous, ShowSlot::Slot1).as_slice()
    );
    assert!(!session.is_synced());
}

#[test]
fn a_stream_that_goes_silent_times_out_instead_of_queueing_forever() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    // The device answers the first packet — proving it is alive — and then
    // goes silent. Three paced misses switch the stream to the tolerant mode;
    // the next time the outstanding-write threshold is reached the stream waits
    // for an acknowledgement and the budget ends it. Nothing keeps queueing.
    let transport = ScriptedDevice::new(Some(1))
        .stop_acking_after(1)
        .block_empty_reads();
    let mut session = Session::with_config(transport, previous.clone());
    let timing = StreamTiming {
        total: Duration::from_millis(200),
        paced_ack_window: Duration::from_millis(10),
        cancel_poll: Duration::from_millis(2),
        ..StreamTiming::PRODUCTION
    };
    let err = session
        .upload_with_timing(&plan, &CancelToken::new(), &mut |_| {}, timing)
        .unwrap_err();

    match &err {
        DeviceError::UploadTimeout { sent, total } => {
            assert_eq!(
                *sent,
                (FRAME_ACK_PACING_THRESHOLD as usize + 1) * 56,
                "the tolerant mode stopped writing at its pacing threshold"
            );
            assert_eq!(*total, 65536);
        }
        other => panic!("expected UploadTimeout, got {other:?}"),
    }

    let writes = session.transport().writes();
    assert_eq!(
        reports(writes, Command::FrameData).len(),
        FRAME_ACK_PACING_THRESHOLD as usize + 1,
        "the stream must not keep writing once the device is silent"
    );
    assert_eq!(
        writes.last().map(|w| w[3]),
        Some(Command::Commit.as_u8()),
        "repair COMMIT was sent"
    );
    assert_eq!(
        payload_of(reports(writes, Command::Config).last().unwrap()),
        restored(&previous, ShowSlot::Slot1).as_slice()
    );
    assert!(!session.is_synced());
}

#[test]
fn an_upload_past_its_deadline_times_out_and_repairs() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    // Each frame packet takes longer than the stubbed deadline, so exactly one
    // packet is sent before the ceiling is hit — no five-minute wait.
    let transport = ScriptedDevice::new(Some(16)).delay_frame_writes(Duration::from_millis(2));
    let mut session = Session::with_config(transport, previous.clone());
    let err = session
        .upload_with_timeout(
            &plan,
            &CancelToken::new(),
            &mut |_| {},
            Duration::from_millis(1),
        )
        .unwrap_err();

    match &err {
        DeviceError::UploadTimeout { sent, total } => {
            assert_eq!(*sent, 56, "one packet was streamed before the ceiling");
            assert_eq!(*total, 65536);
        }
        other => panic!("expected UploadTimeout, got {other:?}"),
    }
    assert!(
        err.to_string().contains("56 of 65536"),
        "the message must name what was sent: {err}"
    );

    let writes = session.transport().writes();
    assert_eq!(
        reports(writes, Command::FrameData).len(),
        1,
        "no packet after the deadline"
    );
    assert_eq!(
        writes.last().map(|w| w[3]),
        Some(Command::Commit.as_u8()),
        "repair COMMIT was sent"
    );
    assert_eq!(
        payload_of(reports(writes, Command::Config).last().unwrap()),
        restored(&previous, ShowSlot::Slot1).as_slice()
    );
    assert!(!session.is_synced());
}

/// Wraps a scripted device and cancels the token on the first framing read
/// after a `FRAME_DATA` write that was offered more than the tolerant probe
/// window — i.e. inside a paced wait rather than a probe. Records the largest
/// read timeout it was given.
///
/// This is the "acknowledged once, then went silent" dongle: the only way to
/// leave the wait is the cancel check between reads, not an acknowledgement.
struct CancelDuringPacingWait {
    inner: ScriptedDevice,
    cancel: CancelToken,
    max_read_timeout: Duration,
    cancelled_in_wait: bool,
}

impl CancelDuringPacingWait {
    fn new(inner: ScriptedDevice, cancel: CancelToken) -> Self {
        Self {
            inner,
            cancel,
            max_read_timeout: Duration::ZERO,
            cancelled_in_wait: false,
        }
    }

    fn inner(&self) -> &ScriptedDevice {
        &self.inner
    }
}

impl Transport for CancelDuringPacingWait {
    fn write_report(&mut self, report: &[u8]) -> DeviceResult<()> {
        self.inner.write_report(report)
    }

    fn read_report(&mut self, timeout: Duration) -> DeviceResult<Option<Vec<u8>>> {
        self.max_read_timeout = self.max_read_timeout.max(timeout);
        // `frames` is only non-zero once the stream is writing; a read longer
        // than the tolerant probe window after that is a paced wait.
        if !self.cancelled_in_wait && self.inner.frames > 0 && timeout > FRAME_ACK_WINDOW {
            self.cancelled_in_wait = true;
            self.cancel.cancel();
        }
        self.inner.read_report(timeout)
    }
}

#[test]
fn cancellation_during_the_pacing_wait_returns_and_repairs_promptly() {
    let previous = previous_config(ShowSlot::Slot1);
    let plan = one_frame_plan();

    // First packet is written and its paced wait starts; the device stays
    // silent, so the only way out is the cancel check between reads.
    let device = ScriptedDevice::new(Some(1)).stop_acking_after(1);
    let cancel = CancelToken::new();
    let mut session = Session::with_config(
        CancelDuringPacingWait::new(device, cancel.clone()),
        previous.clone(),
    );

    let started = Instant::now();
    let err = session
        .upload(&plan, &cancel, &mut |_| {})
        .expect_err("the paced wait must observe cancellation");
    let elapsed = started.elapsed();

    assert_cancelled(&err);
    assert!(
        elapsed < Duration::from_secs(5),
        "the wait must observe cancellation, not run out the upload budget: {elapsed:?}"
    );

    let transport = session.transport();
    assert!(
        transport.cancelled_in_wait,
        "the test must cancel inside the pacing wait"
    );
    assert!(
        transport.max_read_timeout > FRAME_ACK_WINDOW,
        "the wait should offer more than the tolerant probe: {:?}",
        transport.max_read_timeout
    );
    assert!(
        transport.max_read_timeout <= CANCEL_POLL_SLICE,
        "no single read may block for the whole budget: {:?}",
        transport.max_read_timeout
    );

    let writes = transport.inner().writes();
    assert_eq!(
        reports(writes, Command::FrameData).len(),
        1,
        "the paced wait stopped the stream at the first packet"
    );
    assert_eq!(
        writes.last().map(|w| w[3]),
        Some(Command::Commit.as_u8()),
        "repair COMMIT was sent"
    );
    assert_eq!(
        payload_of(reports(writes, Command::Config).last().unwrap()),
        restored(&previous, ShowSlot::Slot1).as_slice(),
        "the display was put back on the untouched slot"
    );
    assert!(!session.is_synced());
}
