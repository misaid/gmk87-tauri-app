use anyhow::Context;

use super::open_session;

pub fn run() -> anyhow::Result<()> {
    let mut session = open_session()?;
    let config = session
        .read_config()
        .context("reading device configuration")?;
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
    Ok(())
}
