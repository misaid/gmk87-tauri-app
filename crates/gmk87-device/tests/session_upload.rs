use gmk87_device::error::{DeviceError, Result as DeviceResult};
use gmk87_device::mock::MockTransport;
use gmk87_device::session::{CancelToken, Session, UploadProgress};
use gmk87_device::transport::Transport;
use gmk87_protocol::config::{DeviceConfig, ShowSlot};
use gmk87_protocol::frames::FramePlan;
use gmk87_protocol::packet::{Command, Packet};
use std::time::Duration;

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

/// The upload's CONFIG is written before streaming starts, so a repair rewrites
/// the in-memory block with the frame counts and delay already patched, changing
/// only `show_image`.
fn patched(previous: &DeviceConfig, plan: &FramePlan, show: ShowSlot) -> Vec<u8> {
    let mut expected = previous.as_bytes().to_vec();
    expected[33] = show.as_u8();
    expected[34] = plan.slot0_frames.len() as u8;
    expected[43..45].copy_from_slice(&plan.delay_ms.to_le_bytes());
    expected[46] = plan.slot1_frames.len() as u8;
    expected
}

fn expect_upload_handshake(mock: &mut MockTransport) {
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.push_unsolicited(
        Packet::new(Command::Ready, 0, &[])
            .unwrap()
            .encode()
            .to_vec(),
    );
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
            message.contains("display left unchanged"),
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
        patched(&previous, &plan, ShowSlot::Slot1).as_slice(),
        "the patched config is rewritten with the untouched slot shown"
    );
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

    let expected = patched(&previous, &plan, ShowSlot::Clock);
    assert_eq!(repair, expected.as_slice());
    assert_eq!(repair[33], ShowSlot::Clock.as_u8());
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
    let expected = patched(&previous, &plan, ShowSlot::Clock);
    assert_eq!(repair, expected.as_slice());
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

    // The upload handshake writes 4 reports, then three frame reports.
    let fail_on_write = 4 + 3 + 1;
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
        err.to_string().contains("display left unchanged"),
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
        patched(&previous, &plan, ShowSlot::Slot1).as_slice(),
        "the patched config is rewritten with the untouched slot shown"
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
