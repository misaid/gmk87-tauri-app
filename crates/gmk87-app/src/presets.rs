//! The eight lighting presets, ported from the MIT reference
//! `codedgar/gmk87-node` (presets.json). Values are applied verbatim; the
//! display selection and frame counts are deliberately left alone.

use crate::error::{AppError, ErrorKind};
use gmk87_protocol::config::DeviceConfig;
use serde::Serialize;

pub const NAMES: [&str; 8] = [
    "gaming",
    "relaxed",
    "party",
    "minimal",
    "productivity",
    "purple-wave",
    "matrix",
    "sunset",
];

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Preset {
    pub name: &'static str,
    pub description: &'static str,
}

struct Values {
    effect: u8,
    brightness: u8,
    speed: u8,
    orientation: u8,
    rainbow: u8,
    color: (u8, u8, u8),
    led_mode: u8,
    led_saturation: u8,
    led_rainbow: u8,
    led_color: u8,
}

fn values(name: &str) -> Option<Values> {
    Some(match name {
        "gaming" => Values {
            effect: 5,
            brightness: 9,
            speed: 1,
            orientation: 1,
            rainbow: 0,
            color: (255, 0, 0),
            led_mode: 3,
            led_saturation: 9,
            led_rainbow: 0,
            led_color: 0,
        },
        "relaxed" => Values {
            effect: 5,
            brightness: 3,
            speed: 7,
            orientation: 1,
            rainbow: 0,
            color: (0, 255, 255),
            led_mode: 3,
            led_saturation: 3,
            led_rainbow: 0,
            led_color: 4,
        },
        "party" => Values {
            effect: 12,
            brightness: 9,
            speed: 0,
            orientation: 1,
            rainbow: 1,
            color: (255, 255, 255),
            led_mode: 1,
            led_saturation: 9,
            led_rainbow: 1,
            led_color: 0,
        },
        "minimal" => Values {
            effect: 0,
            brightness: 0,
            speed: 5,
            orientation: 1,
            rainbow: 0,
            color: (0, 0, 0),
            led_mode: 3,
            led_saturation: 0,
            led_rainbow: 0,
            led_color: 8,
        },
        "productivity" => Values {
            effect: 6,
            brightness: 4,
            speed: 5,
            orientation: 1,
            rainbow: 0,
            color: (255, 255, 255),
            led_mode: 3,
            led_saturation: 5,
            led_rainbow: 0,
            led_color: 7,
        },
        "purple-wave" => Values {
            effect: 16,
            brightness: 6,
            speed: 4,
            orientation: 1,
            rainbow: 0,
            color: (128, 0, 255),
            led_mode: 3,
            led_saturation: 6,
            led_rainbow: 0,
            led_color: 6,
        },
        "matrix" => Values {
            effect: 15,
            brightness: 7,
            speed: 2,
            orientation: 1,
            rainbow: 0,
            color: (0, 255, 0),
            led_mode: 3,
            led_saturation: 7,
            led_rainbow: 0,
            led_color: 3,
        },
        "sunset" => Values {
            effect: 5,
            brightness: 6,
            speed: 6,
            orientation: 1,
            rainbow: 0,
            color: (255, 128, 0),
            led_mode: 3,
            led_saturation: 6,
            led_rainbow: 0,
            led_color: 1,
        },
        _ => return None,
    })
}

pub fn list() -> Vec<Preset> {
    NAMES
        .iter()
        .map(|name| Preset {
            name,
            description: description(name),
        })
        .collect()
}

fn description(name: &str) -> &'static str {
    match name {
        "gaming" => "Aggressive red theme with fast effects",
        "relaxed" => "Calm cyan breathing effect for typing",
        "party" => "Fast rainbow effects for maximum visual impact",
        "minimal" => "All lighting off for minimal distraction",
        "productivity" => "Subtle white backlight for focused work",
        "purple-wave" => "Purple wave effect with moderate brightness",
        "matrix" => "Green rain effect for Matrix-style aesthetics",
        "sunset" => "Warm orange/yellow sunset colors",
        _ => "",
    }
}

pub fn apply(name: &str, config: &mut DeviceConfig) -> Result<(), AppError> {
    let Some(v) = values(name) else {
        return Err(AppError {
            kind: ErrorKind::InvalidJob,
            message: format!(
                "unknown preset {name:?}; known presets: {}",
                NAMES.join(", ")
            ),
        });
    };
    config.set_underglow_effect(v.effect);
    config.set_underglow_brightness(v.brightness);
    config.set_underglow_speed(v.speed);
    config.set_underglow_orientation(v.orientation);
    config.set_underglow_rainbow(v.rainbow);
    config.set_underglow_color(v.color.0, v.color.1, v.color.2);
    config.set_led_mode(v.led_mode);
    config.set_led_saturation(v.led_saturation);
    config.set_led_rainbow(v.led_rainbow);
    config.set_led_color(v.led_color);
    Ok(())
}
