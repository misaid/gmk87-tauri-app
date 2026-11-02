//! Serializable projections of the in-memory configuration for the UI.

use gmk87_protocol::config::DeviceConfig;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UnderglowState {
    pub effect: u8,
    pub brightness: u8,
    pub speed: u8,
    pub orientation: u8,
    pub rainbow: u8,
    pub color: (u8, u8, u8),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LedState {
    pub mode: u8,
    pub saturation: u8,
    pub rainbow: u8,
    pub color: u8,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStateDto {
    pub connected: bool,
    pub synced: bool,
    pub underglow: UnderglowState,
    pub led: LedState,
    pub win_lock: bool,
    pub show: u8,
    pub slot0_frames: u8,
    pub slot1_frames: u8,
    pub frame_delay_ms: u16,
    pub time: (u16, u8, u8, u8, u8, u8, u8),
}

impl DeviceStateDto {
    pub fn from_config(config: &DeviceConfig, connected: bool, synced: bool) -> Self {
        Self {
            connected,
            synced,
            underglow: UnderglowState {
                effect: config.underglow_effect(),
                brightness: config.underglow_brightness(),
                speed: config.underglow_speed(),
                orientation: config.underglow_orientation(),
                rainbow: config.underglow_rainbow(),
                color: config.underglow_color(),
            },
            led: LedState {
                mode: config.led_mode(),
                saturation: config.led_saturation(),
                rainbow: config.led_rainbow(),
                color: config.led_color(),
            },
            win_lock: config.win_lock() != 0,
            show: config.show_image().as_u8(),
            slot0_frames: config.slot0_frames(),
            slot1_frames: config.slot1_frames(),
            frame_delay_ms: config.frame_delay_ms(),
            time: config.time(),
        }
    }
}
