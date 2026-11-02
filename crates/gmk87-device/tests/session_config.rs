use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::Session;
use gmk87_protocol::config::DeviceConfig;
use gmk87_protocol::packet::{Command, Packet};
use std::time::{Duration, Instant};

fn config_payload(report: &[u8]) -> &[u8] {
    &report[8..8 + report[4] as usize]
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
fn write_config_sends_init_config_commit_without_a_read() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let config = DeviceConfig::from_bytes(&[0x11u8; 48]).unwrap();
    let mut session = Session::new(mock);
    session.write_config(&config).unwrap();

    let commands = session.transport().commands_sent();
    assert_eq!(commands, vec![0x01, 0x06, 0x02]);
    assert_no_read_commands(&commands);
    assert!(session.is_synced());
    assert_eq!(session.config(), &config);
}

#[test]
fn a_session_writes_the_default_config_bytes_verbatim() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let default = DeviceConfig::default_config();
    let mut session = Session::new(mock);
    session.write_config(&default).unwrap();

    let writes = session.transport().writes();
    let config_writes: Vec<&Vec<u8>> = writes.iter().filter(|w| w[3] == 0x06).collect();
    assert_eq!(config_writes.len(), 1);
    assert_eq!(config_payload(config_writes[0]), default.as_bytes());
    assert_no_read_commands(&session.transport().commands_sent());
}

#[test]
fn accepts_an_eight_byte_acknowledgement() {
    let mut mock = MockTransport::new();
    mock.ack_short(Command::Init);

    let mut session = Session::new(mock);
    let payload = session.send_and_wait(Command::Init, 0, &[]).unwrap();
    assert!(payload.is_empty(), "a short ack carries no payload");
}

#[test]
fn writes_config_over_eight_byte_acknowledgements() {
    let mut mock = MockTransport::new();
    mock.ack_short(Command::Init);
    mock.ack_short(Command::Config);
    mock.ack_short(Command::Commit);

    let config = DeviceConfig::default_config();
    let mut session = Session::new(mock);
    session.write_config(&config).unwrap();

    assert_eq!(session.transport().commands_sent(), vec![0x01, 0x06, 0x02]);
}

#[test]
fn accepts_the_dongle_acknowledgement_shape() {
    // On 2.4 GHz the dongle answers with report ID 0x01 and no app checksum:
    // `01 cmd 09 cmd` followed by zeros. The command byte is what matters.
    let mut mock = MockTransport::new();
    mock.ack_dongle(Command::Init);
    mock.ack_dongle(Command::Config);
    mock.ack_dongle(Command::Commit);

    let config = DeviceConfig::default_config();
    let mut session = Session::new(mock);
    session.write_config(&config).unwrap();

    assert_eq!(session.transport().commands_sent(), vec![0x01, 0x06, 0x02]);
    assert_no_read_commands(&session.transport().commands_sent());
}

#[test]
fn a_commit_timeout_leaves_the_device_desynced() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    // No Commit response queued: the write cannot be confirmed.

    let config = DeviceConfig::from_bytes(&[0x11u8; 48]).unwrap();
    let mut session = Session::new(mock);
    assert!(matches!(
        session.write_config(&config),
        Err(DeviceError::DeviceDesynced)
    ));
    assert!(!session.is_synced());
}

#[test]
fn set_lighting_edits_memory_and_writes_it() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    session
        .set_lighting(&|config: &mut DeviceConfig| {
            config.set_underglow_brightness(5);
            config.set_underglow_effect(7);
        })
        .unwrap();

    let commands = session.transport().commands_sent();
    assert_eq!(commands, vec![0x01, 0x06, 0x02]);
    assert_no_read_commands(&commands);
    assert_eq!(session.config().underglow_brightness(), 5);
    assert_eq!(session.config().underglow_effect(), 7);

    let writes = session.transport().writes();
    let config_write = writes.iter().find(|w| w[3] == 0x06).unwrap();
    assert_eq!(config_payload(config_write)[2], 5);
}

#[test]
fn sync_clock_sets_the_in_memory_time_and_writes_it() {
    use chrono::{Datelike, Timelike};

    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let now = chrono::Local::now();
    let mut session = Session::new(mock);
    session.sync_clock(&now).unwrap();

    let commands = session.transport().commands_sent();
    assert_eq!(commands, vec![0x01, 0x06, 0x02]);
    assert_no_read_commands(&commands);

    let (year, month, day, weekday, hour, minute, second) = session.config().time();
    assert_eq!(year, now.year() as u16);
    assert_eq!(month, now.month() as u8);
    assert_eq!(day, now.day() as u8);
    assert_eq!(weekday, now.weekday().num_days_from_sunday() as u8);
    assert_eq!(hour, now.hour() as u8);
    assert_eq!(minute, now.minute() as u8);
    assert_eq!(second, now.second() as u8);
}

#[test]
fn ready_is_optional_and_the_wait_honours_its_timeout() {
    // The dongle never answers READY; the wait must give up, not fail, and it
    // must do so in the injected time rather than in COMMAND_TIMEOUT.
    let mut session = Session::new(MockTransport::new());
    let started = Instant::now();
    assert!(!session.wait_for_ready(Duration::from_millis(5)).unwrap());
    assert!(
        started.elapsed() < Duration::from_secs(1),
        "the READY wait ignored its timeout"
    );
}

#[test]
fn discards_a_matching_response_with_a_corrupt_checksum() {
    let mut mock = MockTransport::new();
    // A report for the command we are waiting on, but with a damaged
    // checksum: the session must drop it and keep reading.
    let mut corrupt = Packet::new(Command::Config, 0, &[0xEE, 0xEE])
        .unwrap()
        .encode();
    corrupt[2] ^= 0xff;
    mock.push_unsolicited(corrupt.to_vec());
    mock.expect(Command::Config, vec![vec![0x11, 0x22]]);

    let mut session = Session::new(mock);
    let payload = session.send_and_wait(Command::Config, 0, &[]).unwrap();
    assert_eq!(payload, vec![0x11, 0x22]);
}
