use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::Session;
use gmk87_protocol::config::DeviceConfig;
use gmk87_protocol::packet::{Command, Packet};

fn wrong_command_report(command: Command) -> Vec<u8> {
    Packet::new(command, 0, &[]).unwrap().encode().to_vec()
}

#[test]
fn discards_responses_for_other_commands() {
    let mut mock = MockTransport::new();
    // Noise for FrameData arrives before the Init ack.
    mock.push_unsolicited(wrong_command_report(Command::FrameData));
    mock.push_unsolicited(wrong_command_report(Command::Ready));
    mock.expect(Command::Init, vec![vec![0xAA]]);

    let mut session = Session::new(mock);
    let payload = session.send_and_wait(Command::Init, 0, &[]).unwrap();
    assert_eq!(payload, vec![0xAA]);
}

#[test]
fn a_failed_commit_marks_the_device_desynced() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    // No Commit response queued — the write hangs and times out.

    let config = DeviceConfig::from_bytes(&[0u8; 48]).unwrap();
    let mut session = Session::new(mock);
    let err = session.write_config(&config).unwrap_err();

    assert!(matches!(err, DeviceError::DeviceDesynced));
    assert!(!session.is_synced());
}

#[test]
fn a_write_error_propagates_without_retry() {
    let mut mock = MockTransport::new();
    mock.fail_next_write();

    let mut session = Session::new(mock);
    let err = session.send_and_wait(Command::Init, 0, &[]).unwrap_err();
    assert!(matches!(err, DeviceError::Hid(_)));
    assert_eq!(session.transport().writes().len(), 0, "nothing recorded");
}
