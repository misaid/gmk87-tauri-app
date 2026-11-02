use gmk87_protocol::config::{decode_bcd, encode_bcd, DeviceConfig, ShowSlot};
use gmk87_protocol::error::ProtocolError;
use proptest::prelude::*;

#[test]
fn reads_documented_offsets() {
    let mut raw = [0u8; 48];
    raw[1] = 5; // underglow effect
    raw[2] = 7; // brightness
    raw[6] = 10; // red
    raw[7] = 20; // green
    raw[8] = 30; // blue
    raw[21] = 1; // winlock
    raw[33] = 2; // show slot 1
    raw[34] = 3; // slot 0 frames
    raw[46] = 4; // slot 1 frames
    raw[43] = 0x64; // frame delay low
    raw[44] = 0x00; // frame delay high

    let cfg = DeviceConfig::from_bytes(&raw).unwrap();
    assert_eq!(cfg.underglow_effect(), 5);
    assert_eq!(cfg.underglow_brightness(), 7);
    assert_eq!(cfg.underglow_color(), (10, 20, 30));
    assert_eq!(cfg.win_lock(), 1);
    assert_eq!(cfg.show_image(), ShowSlot::Slot1);
    assert_eq!(cfg.slot0_frames(), 3);
    assert_eq!(cfg.slot1_frames(), 4);
    assert_eq!(cfg.frame_delay_ms(), 100);
}

#[test]
fn rejects_short_buffers() {
    let err = DeviceConfig::from_bytes(&[0u8; 47]).unwrap_err();
    assert!(matches!(err, ProtocolError::ShortConfig { .. }));
}

#[test]
fn bcd_round_trips_and_rejects_out_of_range() {
    assert_eq!(encode_bcd(59).unwrap(), 0x59);
    assert_eq!(decode_bcd(0x59), 59);
    assert_eq!(encode_bcd(9).unwrap(), 0x09);
    assert_eq!(encode_bcd(0).unwrap(), 0x00);
    assert_eq!(encode_bcd(99).unwrap(), 0x99);
    assert_eq!(decode_bcd(0x00), 0);
    assert_eq!(decode_bcd(0x99), 99);
    assert!(matches!(
        encode_bcd(100),
        Err(ProtocolError::OutOfRange { .. })
    ));
}

#[test]
fn writes_time_as_bcd_and_rejects_bad_values() {
    let mut cfg = DeviceConfig::from_bytes(&[0u8; 48]).unwrap();
    cfg.set_time(2026, 11, 1, 6, 23, 59, 58).unwrap();
    let bytes = cfg.as_bytes();
    assert_eq!(bytes[35], 0x58, "second");
    assert_eq!(bytes[36], 0x59, "minute");
    assert_eq!(bytes[37], 0x23, "hour");
    assert_eq!(bytes[38], 6, "weekday is raw");
    assert_eq!(bytes[39], 0x01, "date");
    assert_eq!(bytes[40], 0x11, "month");
    assert_eq!(bytes[41], 0x26, "year 26");
    assert_eq!(cfg.time(), (2026, 11, 1, 6, 23, 59, 58));

    assert!(matches!(
        cfg.set_time(2026, 13, 1, 0, 0, 0, 0),
        Err(ProtocolError::OutOfRange { .. })
    ));
    assert!(matches!(
        cfg.set_time(2026, 1, 1, 0, 24, 0, 0),
        Err(ProtocolError::OutOfRange { .. })
    ));
}

#[test]
fn show_slot_maps_known_values_and_falls_back_to_clock() {
    assert_eq!(ShowSlot::Clock.as_u8(), 0);
    assert_eq!(ShowSlot::Slot0.as_u8(), 1);
    assert_eq!(ShowSlot::Slot1.as_u8(), 2);
    assert_eq!(ShowSlot::from_u8(1), ShowSlot::Slot0);
    assert_eq!(ShowSlot::from_u8(2), ShowSlot::Slot1);
    assert_eq!(ShowSlot::from_u8(0), ShowSlot::Clock);
    assert_eq!(ShowSlot::from_u8(0xff), ShowSlot::Clock);
}

#[test]
fn each_setter_touches_only_its_own_bytes() {
    let mut cfg = DeviceConfig::from_bytes(&[0u8; 48]).unwrap();
    cfg.set_underglow_effect(1);
    cfg.set_underglow_brightness(2);
    cfg.set_underglow_speed(3);
    cfg.set_underglow_orientation(4);
    cfg.set_underglow_rainbow(5);
    cfg.set_underglow_color(6, 7, 8);
    cfg.set_win_lock(true);
    cfg.set_led_mode(9);
    cfg.set_led_saturation(10);
    cfg.set_led_rainbow(11);
    cfg.set_led_color(12);
    cfg.set_show_image(ShowSlot::Slot1);
    cfg.set_slot0_frames(13);
    cfg.set_slot1_frames(14);
    cfg.set_frame_delay_ms(0x0102);
    cfg.set_time(2026, 11, 29, 3, 23, 59, 58).unwrap();

    let mut expected = [0u8; 48];
    expected[1] = 1;
    expected[2] = 2;
    expected[3] = 3;
    expected[4] = 4;
    expected[5] = 5;
    expected[6] = 6;
    expected[7] = 7;
    expected[8] = 8;
    expected[21] = 1;
    expected[28] = 9;
    expected[29] = 10;
    expected[31] = 11;
    expected[32] = 12;
    expected[33] = 2;
    expected[34] = 13;
    expected[35] = 0x58;
    expected[36] = 0x59;
    expected[37] = 0x23;
    expected[38] = 3;
    expected[39] = 0x29;
    expected[40] = 0x11;
    expected[41] = 0x26;
    expected[43] = 0x02;
    expected[44] = 0x01;
    expected[46] = 14;

    assert_eq!(cfg.as_bytes(), &expected);
}

#[test]
fn from_hex_is_the_inverse_of_to_hex() {
    let default = DeviceConfig::default_config();
    assert_eq!(DeviceConfig::from_hex(&default.to_hex()).unwrap(), default);

    let mut raw = [0u8; 48];
    for (index, byte) in raw.iter_mut().enumerate() {
        *byte = (index as u8).wrapping_mul(7).wrapping_add(3);
    }
    let config = DeviceConfig::from_bytes(&raw).unwrap();
    assert_eq!(DeviceConfig::from_hex(&config.to_hex()).unwrap(), config);

    // A snapshot file ends with a newline, and uppercase hex is accepted.
    let uppercase = format!("{}\n", config.to_hex().to_uppercase());
    assert_eq!(DeviceConfig::from_hex(&uppercase).unwrap(), config);
}

#[test]
fn from_hex_rejects_wrong_length_and_non_hex() {
    let short = "00".repeat(47);
    assert!(matches!(
        DeviceConfig::from_hex(&short),
        Err(ProtocolError::InvalidConfigHexLength {
            actual: 94,
            expected: 96
        })
    ));

    let long = "00".repeat(49);
    assert!(matches!(
        DeviceConfig::from_hex(&long),
        Err(ProtocolError::InvalidConfigHexLength {
            actual: 98,
            expected: 96
        })
    ));

    let mut non_hex = "00".repeat(48);
    non_hex.replace_range(10..12, "zz");
    assert!(matches!(
        DeviceConfig::from_hex(&non_hex),
        Err(ProtocolError::InvalidConfigHexCharacter { offset: 10 })
    ));

    // `+1` parses as a number but is not a hex digit.
    let mut plus = "00".repeat(48);
    plus.replace_range(0..2, "+1");
    assert!(matches!(
        DeviceConfig::from_hex(&plus),
        Err(ProtocolError::InvalidConfigHexCharacter { offset: 0 })
    ));

    assert!(matches!(
        DeviceConfig::from_hex(""),
        Err(ProtocolError::InvalidConfigHexLength {
            actual: 0,
            expected: 96
        })
    ));
}

proptest! {
    /// Any read-then-write round trip must preserve every byte not explicitly changed.
    #[test]
    fn untouched_bytes_survive_a_read_modify_write(raw in prop::collection::vec(any::<u8>(), 48..=48)) {
        let original = DeviceConfig::from_bytes(&raw).unwrap();
        let mut edited = DeviceConfig::from_bytes(&raw).unwrap();
        edited.set_underglow_brightness(9);
        edited.set_show_image(ShowSlot::Slot0);
        let out = edited.as_bytes();

        for (i, (out_byte, original_byte)) in out.iter().zip(original.as_bytes()).enumerate() {
            if i != 2 && i != 33 {
                prop_assert_eq!(out_byte, original_byte, "byte {} changed", i);
            }
        }
        prop_assert_eq!(out[2], 9);
        prop_assert_eq!(out[33], 1);
    }
}
