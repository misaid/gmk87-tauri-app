use super::snapshot;
use super::{load_config_from, ConfigOrigin};

/// Prints the configuration the app would write. Performs no device I/O: the
/// keyboard cannot be read, so the snapshot is the app's best knowledge of it.
pub fn run() -> anyhow::Result<()> {
    let path = snapshot::path();
    let (config, origin) = load_config_from(&path);
    match origin {
        ConfigOrigin::Snapshot => {
            println!("device     write-only: cannot be read; showing the saved snapshot")
        }
        ConfigOrigin::Defaults => {
            println!("device     write-only: cannot be read; no usable snapshot; showing the app defaults")
        }
    }
    let bytes = config.as_bytes();
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
    println!("snapshot   {}", path.display());
    Ok(())
}
