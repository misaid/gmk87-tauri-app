use super::{open_session, save_snapshot};
use gmk87_protocol::config::DeviceConfig;

#[allow(clippy::too_many_arguments)]
pub fn run(
    effect: Option<u8>,
    brightness: Option<u8>,
    speed: Option<u8>,
    orientation: Option<u8>,
    underglow_rainbow: Option<u8>,
    rgb: Option<(u8, u8, u8)>,
    winlock: Option<bool>,
    led_mode: Option<u8>,
    led_saturation: Option<u8>,
    led_rainbow: Option<u8>,
    led_color: Option<u8>,
) -> anyhow::Result<()> {
    let mut session = open_session()?;
    session.set_lighting(&|config: &mut DeviceConfig| {
        if let Some(v) = effect {
            config.set_underglow_effect(v);
        }
        if let Some(v) = brightness {
            config.set_underglow_brightness(v);
        }
        if let Some(v) = speed {
            config.set_underglow_speed(v);
        }
        if let Some(v) = orientation {
            config.set_underglow_orientation(v);
        }
        if let Some(v) = underglow_rainbow {
            config.set_underglow_rainbow(v);
        }
        if let Some((r, g, b)) = rgb {
            config.set_underglow_color(r, g, b);
        }
        if let Some(v) = winlock {
            config.set_win_lock(v);
        }
        if let Some(v) = led_mode {
            config.set_led_mode(v);
        }
        if let Some(v) = led_saturation {
            config.set_led_saturation(v);
        }
        if let Some(v) = led_rainbow {
            config.set_led_rainbow(v);
        }
        if let Some(v) = led_color {
            config.set_led_color(v);
        }
    })?;
    println!("Lighting updated.");
    save_snapshot(&session)?;
    Ok(())
}
