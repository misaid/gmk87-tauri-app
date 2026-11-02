use gmk87_app::error::ErrorKind;
use gmk87_app::presets;
use gmk87_protocol::config::{DeviceConfig, ShowSlot};

#[test]
fn lists_the_eight_named_presets() {
    let names: Vec<&str> = presets::list().iter().map(|p| p.name).collect();
    assert_eq!(
        names,
        vec![
            "gaming",
            "relaxed",
            "party",
            "minimal",
            "productivity",
            "purple-wave",
            "matrix",
            "sunset"
        ]
    );
}

#[test]
fn applies_the_gaming_preset_fields() {
    let mut config = DeviceConfig::default_config();
    presets::apply("gaming", &mut config).unwrap();
    assert_eq!(config.underglow_effect(), 5);
    assert_eq!(config.underglow_brightness(), 9);
    assert_eq!(config.underglow_speed(), 1);
    assert_eq!(config.underglow_orientation(), 1);
    assert_eq!(config.underglow_rainbow(), 0);
    assert_eq!(config.underglow_color(), (255, 0, 0));
    assert_eq!(config.led_mode(), 3);
    assert_eq!(config.led_saturation(), 9);
    assert_eq!(config.led_rainbow(), 0);
    assert_eq!(config.led_color(), 0);
}

#[test]
fn applying_a_preset_does_not_change_the_display() {
    let mut config = DeviceConfig::default_config();
    config.set_show_image(ShowSlot::Slot1);
    config.set_slot0_frames(4);
    presets::apply("minimal", &mut config).unwrap();
    assert_eq!(
        config.show_image(),
        ShowSlot::Slot1,
        "the shown slot is untouched"
    );
    assert_eq!(config.slot0_frames(), 4, "frame counts are untouched");
}

#[test]
fn an_unknown_preset_is_an_error_naming_the_known_ones() {
    let mut config = DeviceConfig::default_config();
    let error = presets::apply("disco", &mut config).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(
        error.message.contains("gaming"),
        "lists known presets: {}",
        error.message
    );
}
