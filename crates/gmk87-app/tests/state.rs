use gmk87_app::state::DeviceStateDto;
use gmk87_protocol::config::{DeviceConfig, ShowSlot};

#[test]
fn projects_a_config_into_a_serializable_state() {
    let mut raw = [0u8; 48];
    raw[1] = 5;
    raw[2] = 7;
    raw[6] = 10;
    raw[7] = 20;
    raw[8] = 30;
    raw[21] = 1;
    raw[28] = 3;
    raw[29] = 9;
    raw[31] = 0;
    raw[32] = 4;
    raw[33] = ShowSlot::Slot1.as_u8();
    raw[34] = 3;
    raw[46] = 4;
    raw[43] = 100;
    raw[44] = 0;
    let config = DeviceConfig::from_bytes(&raw).unwrap();

    let state = DeviceStateDto::from_config(&config, true, true);
    assert!(state.connected && state.synced);
    assert_eq!(state.underglow.effect, 5);
    assert_eq!(state.underglow.brightness, 7);
    assert_eq!(state.underglow.color, (10, 20, 30));
    assert!(state.win_lock);
    assert_eq!(state.led.mode, 3);
    assert_eq!(state.led.color, 4);
    assert_eq!(state.show, 2);
    assert_eq!(state.slot0_frames, 3);
    assert_eq!(state.slot1_frames, 4);
    assert_eq!(state.frame_delay_ms, 100);
}
