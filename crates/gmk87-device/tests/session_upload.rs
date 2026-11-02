use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::{CancelToken, Session, UploadProgress};
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::FramePlan;
use gmk87_protocol::packet::Command;

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

#[test]
fn uploads_one_slot_with_read_modify_write_config() {
    let mut mock = MockTransport::new();
    // read_config handshake
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::PrepRead, vec![vec![]; 10]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::ReadConfig, vec![vec![0u8; 4]; 13]);
    // upload handshake
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.push_unsolicited(
        gmk87_protocol::packet::Packet::new(Command::Ready, 0, &[])
            .unwrap()
            .encode()
            .to_vec(),
    );
    mock.expect(Command::FrameData, frame_data_responses());
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    let cancel = CancelToken::new();
    let mut last = UploadProgress {
        bytes_sent: 0,
        total_bytes: 0,
    };
    session
        .upload(&one_frame_plan(), &cancel, &mut |p| last = p)
        .unwrap();

    assert_eq!(last.total_bytes, 65536);
    assert_eq!(last.bytes_sent, 65536);
    let commands = session.transport().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "ends with COMMIT");
}

#[test]
fn cancellation_stops_streaming_and_repairs_the_display() {
    let mut mock = MockTransport::new();
    // read_config handshake
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::PrepRead, vec![vec![]; 10]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::ReadConfig, vec![vec![0u8; 4]; 12]);
    // upload handshake
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.push_unsolicited(
        gmk87_protocol::packet::Packet::new(Command::Ready, 0, &[])
            .unwrap()
            .encode()
            .to_vec(),
    );
    // repair write_config (Init, Config, Commit) — reached before any frames stream
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    let cancel = CancelToken::new();
    cancel.cancel();
    let result = session.upload(&one_frame_plan(), &cancel, &mut |_| {});

    assert!(matches!(result, Err(DeviceError::InvalidJob(_))));
    let commands = session.transport().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "repair COMMIT was sent");
    assert!(
        !commands.contains(&0x21),
        "no frame data was streamed after cancellation"
    );
    assert!(!session.is_synced());
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
