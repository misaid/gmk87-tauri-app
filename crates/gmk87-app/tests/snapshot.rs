use gmk87_app::snapshot;
use gmk87_protocol::config::DeviceConfig;

#[test]
fn round_trips_a_config_through_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/gmk87/snapshot");

    let mut config = DeviceConfig::default_config();
    config.set_underglow_effect(12);
    snapshot::save(&path, &config).unwrap();

    let loaded = snapshot::load(&path).expect("snapshot loads");
    assert_eq!(loaded.as_bytes(), config.as_bytes());
}

#[test]
fn a_missing_file_is_none() {
    let dir = tempfile::tempdir().unwrap();
    assert!(snapshot::load(&dir.path().join("absent")).is_none());
}

#[test]
fn a_malformed_file_is_none_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");
    std::fs::write(&path, "not hex at all").unwrap();
    assert!(snapshot::load(&path).is_none());
}
