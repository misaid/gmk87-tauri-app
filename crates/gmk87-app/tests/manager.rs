use gmk87_app::lighting::LightingPatch;
use gmk87_app::manager::DeviceManager;
use gmk87_device::mock::MockTransport;
use gmk87_protocol::config::DeviceConfig;
use gmk87_protocol::packet::Command;

/// `INIT → CONFIG → COMMIT`, the write_config handshake.
fn expect_write(mock: &mut MockTransport) {
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
}

#[test]
fn lighting_a_patch_writes_a_new_block_and_persists_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");

    let mut mock = MockTransport::new();
    expect_write(&mut mock);
    let mut manager = DeviceManager::new(mock, Some(path.clone()));

    manager
        .apply_lighting_patch(&LightingPatch {
            underglow_effect: Some(9),
            ..LightingPatch::default()
        })
        .unwrap();

    assert_eq!(manager.config().underglow_effect(), 9);
    let saved = gmk87_app::snapshot::load(&path).expect("snapshot written");
    assert_eq!(saved.underglow_effect(), 9);
}

#[test]
fn a_session_seeds_from_an_existing_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");
    let mut seeded = DeviceConfig::default_config();
    seeded.set_underglow_effect(17);
    gmk87_app::snapshot::save(&path, &seeded).unwrap();

    let mut mock = MockTransport::new();
    expect_write(&mut mock);
    let mut manager = DeviceManager::new(mock, Some(path));

    manager
        .set_lighting(&|cfg| cfg.set_underglow_brightness(2))
        .unwrap();
    assert_eq!(
        manager.config().underglow_effect(),
        17,
        "snapshot preserved"
    );
    assert_eq!(manager.config().underglow_brightness(), 2);
}

#[test]
fn syncing_the_clock_writes_bcd_and_persists() {
    use chrono::TimeZone;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");

    let mut mock = MockTransport::new();
    expect_write(&mut mock);
    let mut manager = DeviceManager::new(mock, Some(path.clone()));

    let now = chrono::Local
        .with_ymd_and_hms(2026, 11, 1, 14, 5, 9)
        .unwrap();
    manager.sync_clock(&now).unwrap();

    let bytes = manager.config().as_bytes();
    assert_eq!(bytes[35], 0x09, "second");
    assert_eq!(bytes[36], 0x05, "minute");
    assert_eq!(bytes[37], 0x14, "hour");
    assert_eq!(bytes[40], 0x11, "month");
    assert_eq!(bytes[41], 0x26, "year");
    assert!(gmk87_app::snapshot::load(&path).is_some());
}

#[test]
fn read_state_reports_connection_and_fields() {
    let mock = MockTransport::new();
    let mut manager = DeviceManager::new(mock, None);
    manager
        .apply_lighting_patch(&LightingPatch {
            led_mode: Some(3),
            ..LightingPatch::default()
        })
        .unwrap_err();
    // No scripted acks: the write fails, so the state is reported as unsynced.
    let state = manager.read_state();
    assert!(state.connected);
    assert!(!state.synced);
}
