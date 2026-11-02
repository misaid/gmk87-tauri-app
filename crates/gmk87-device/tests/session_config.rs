use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::Session;
use gmk87_protocol::packet::{Command, Packet};

fn config_payloads() -> Vec<Vec<u8>> {
    let raw = vec![0xABu8; 48];
    // The device returns the config spread across several read responses; the
    // session concatenates whatever arrives.
    let mut chunks = Vec::new();
    let mut rest = raw.as_slice();
    while !rest.is_empty() {
        let take = rest.len().min(4);
        chunks.push(rest[..take].to_vec());
        rest = &rest[take..];
    }
    chunks
}

#[test]
fn reads_the_configuration_from_the_device() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::PrepRead, vec![vec![]; 10]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::ReadConfig, config_payloads());

    let mut session = Session::new(mock);
    let config = session.read_config().unwrap();
    assert_eq!(config.as_bytes(), &[0xABu8; 48]);
    assert!(session.is_synced());
}

#[test]
fn errors_when_a_read_times_out() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    // No PrepRead responses queued: the handshake stalls.
    let mut session = Session::new(mock);
    assert!(matches!(
        session.read_config(),
        Err(DeviceError::ProtocolTimeout { .. })
    ));
}

#[test]
fn writes_the_configuration_in_three_steps() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let config = gmk87_protocol::config::DeviceConfig::from_bytes(&[0x11u8; 48]).unwrap();
    let mut session = Session::new(mock);
    session.write_config(&config).unwrap();

    assert_eq!(session.transport().commands_sent(), vec![0x01, 0x06, 0x02]);
    assert!(session.is_synced());
}

#[test]
fn a_commit_timeout_leaves_the_device_desynced() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    // No Commit response queued: the write cannot be confirmed.

    let config = gmk87_protocol::config::DeviceConfig::from_bytes(&[0x11u8; 48]).unwrap();
    let mut session = Session::new(mock);
    assert!(matches!(
        session.write_config(&config),
        Err(DeviceError::DeviceDesynced)
    ));
    assert!(!session.is_synced());
}

#[test]
fn discards_a_matching_response_with_a_corrupt_checksum() {
    let mut mock = MockTransport::new();
    // A report for the command we are waiting on, but with a damaged
    // checksum: the session must drop it and keep reading.
    let mut corrupt = Packet::new(Command::ReadConfig, 0, &[0xEE, 0xEE])
        .unwrap()
        .encode();
    corrupt[2] ^= 0xff;
    mock.push_unsolicited(corrupt.to_vec());
    mock.expect(Command::ReadConfig, vec![vec![0x11, 0x22]]);

    let mut session = Session::new(mock);
    let payload = session.send_and_wait(Command::ReadConfig, 0, &[]).unwrap();
    assert_eq!(payload, vec![0x11, 0x22]);
}
