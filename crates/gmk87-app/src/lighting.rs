//! A partial lighting update: every field is optional, so a command changes
//! only what the UI actually edited.

use gmk87_protocol::config::DeviceConfig;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LightingPatch {
    pub underglow_effect: Option<u8>,
    pub underglow_brightness: Option<u8>,
    pub underglow_speed: Option<u8>,
    pub underglow_orientation: Option<u8>,
    pub underglow_rainbow: Option<u8>,
    pub underglow_color: Option<(u8, u8, u8)>,
    pub win_lock: Option<bool>,
    pub led_mode: Option<u8>,
    pub led_saturation: Option<u8>,
    pub led_rainbow: Option<u8>,
    pub led_color: Option<u8>,
}

impl LightingPatch {
    pub fn apply(&self, config: &mut DeviceConfig) {
        if let Some(v) = self.underglow_effect {
            config.set_underglow_effect(v);
        }
        if let Some(v) = self.underglow_brightness {
            config.set_underglow_brightness(v);
        }
        if let Some(v) = self.underglow_speed {
            config.set_underglow_speed(v);
        }
        if let Some(v) = self.underglow_orientation {
            config.set_underglow_orientation(v);
        }
        if let Some(v) = self.underglow_rainbow {
            config.set_underglow_rainbow(v);
        }
        if let Some((r, g, b)) = self.underglow_color {
            config.set_underglow_color(r, g, b);
        }
        if let Some(v) = self.win_lock {
            config.set_win_lock(v);
        }
        if let Some(v) = self.led_mode {
            config.set_led_mode(v);
        }
        if let Some(v) = self.led_saturation {
            config.set_led_saturation(v);
        }
        if let Some(v) = self.led_rainbow {
            config.set_led_rainbow(v);
        }
        if let Some(v) = self.led_color {
            config.set_led_color(v);
        }
    }
}
