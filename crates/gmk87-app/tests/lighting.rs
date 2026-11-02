use gmk87_app::lighting::LightingPatch;
use gmk87_protocol::config::DeviceConfig;

#[test]
fn applies_only_the_fields_that_are_set() {
    let mut config = DeviceConfig::default_config();
    let before = config.underglow_effect();

    let patch = LightingPatch {
        underglow_brightness: Some(3),
        led_color: Some(5),
        ..LightingPatch::default()
    };
    patch.apply(&mut config);

    assert_eq!(config.underglow_brightness(), 3);
    assert_eq!(config.led_color(), 5);
    assert_eq!(
        config.underglow_effect(),
        before,
        "unset fields are untouched"
    );
    assert_eq!(
        config.underglow_color(),
        (0xf8, 0xff, 0x00),
        "colour untouched"
    );
}

#[test]
fn sets_a_full_colour_when_given() {
    let mut config = DeviceConfig::default_config();
    LightingPatch {
        underglow_color: Some((1, 2, 3)),
        win_lock: Some(true),
        ..LightingPatch::default()
    }
    .apply(&mut config);
    assert_eq!(config.underglow_color(), (1, 2, 3));
    assert_eq!(config.win_lock(), 1);
}
