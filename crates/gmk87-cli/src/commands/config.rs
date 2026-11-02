use gmk87_protocol::config::DeviceConfig;

use super::snapshot;

/// Prints the app's default configuration. Performs no device I/O: the
/// keyboard cannot be read, so there is nothing to query.
pub fn run() -> anyhow::Result<()> {
    let config = DeviceConfig::default_config();
    let bytes = config.as_bytes();
    println!("device     write-only: cannot be read; showing the app's config");
    println!(
        "raw: {}",
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    );
    println!(
        "underglow  effect={} brightness={} speed={} color={:?}",
        config.underglow_effect(),
        config.underglow_brightness(),
        config.underglow_speed(),
        config.underglow_color()
    );
    println!(
        "led        mode={} saturation={} color={}",
        config.led_mode(),
        config.led_saturation(),
        config.led_color()
    );
    println!(
        "display    show={:?} slot0_frames={} slot1_frames={} delay_ms={}",
        config.show_image(),
        config.slot0_frames(),
        config.slot1_frames(),
        config.frame_delay_ms()
    );
    println!("clock      {:?}", config.time());
    println!("snapshot   {}", snapshot::path().display());
    Ok(())
}
