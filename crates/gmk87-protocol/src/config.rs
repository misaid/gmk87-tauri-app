//! The 48-byte device configuration block.
//!
//! Every write is read-modify-write against the raw bytes so that fields this
//! crate does not understand are preserved exactly.

use crate::error::ProtocolError;

pub const CONFIG_LEN: usize = 48;

const U_BRIGHTNESS: usize = 2;
const U_COLOR: usize = 6;
const WINLOCK: usize = 21;
const LED_MODE: usize = 28;
const LED_SATURATION: usize = 29;
const LED_RAINBOW: usize = 31;
const LED_COLOR: usize = 32;
const SHOW_IMAGE: usize = 33;
const SLOT0_FRAMES: usize = 34;
const TIME: usize = 35; // 35..42
const FRAME_DELAY: usize = 43; // 43..45, little-endian
const SLOT1_FRAMES: usize = 46;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShowSlot {
    Clock,
    Slot0,
    Slot1,
}

impl ShowSlot {
    pub fn as_u8(self) -> u8 {
        match self {
            ShowSlot::Clock => 0,
            ShowSlot::Slot0 => 1,
            ShowSlot::Slot1 => 2,
        }
    }

    pub fn from_u8(value: u8) -> ShowSlot {
        match value {
            1 => ShowSlot::Slot0,
            2 => ShowSlot::Slot1,
            _ => ShowSlot::Clock,
        }
    }
}

/// Encode 0..=99 as packed BCD.
pub fn encode_bcd(value: u8) -> Result<u8, ProtocolError> {
    if value > 99 {
        return Err(ProtocolError::OutOfRange {
            field: "bcd",
            value: u32::from(value),
            max: 99,
        });
    }
    Ok(((value / 10) << 4) | (value % 10))
}

/// Decode packed BCD (tolerates non-BCD nibbles by masking).
pub fn decode_bcd(value: u8) -> u8 {
    ((value >> 4) & 0x0f) * 10 + (value & 0x0f)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceConfig {
    raw: [u8; CONFIG_LEN],
}

impl DeviceConfig {
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, ProtocolError> {
        if bytes.len() < CONFIG_LEN {
            return Err(ProtocolError::ShortConfig {
                actual: bytes.len(),
                expected: CONFIG_LEN,
            });
        }
        let mut raw = [0u8; CONFIG_LEN];
        raw.copy_from_slice(&bytes[..CONFIG_LEN]);
        Ok(Self { raw })
    }

    pub fn as_bytes(&self) -> &[u8] {
        &self.raw
    }

    pub fn underglow_effect(&self) -> u8 {
        self.raw[1]
    }
    pub fn set_underglow_effect(&mut self, v: u8) {
        self.raw[1] = v;
    }
    pub fn underglow_brightness(&self) -> u8 {
        self.raw[U_BRIGHTNESS]
    }
    pub fn set_underglow_brightness(&mut self, v: u8) {
        self.raw[U_BRIGHTNESS] = v;
    }
    pub fn underglow_speed(&self) -> u8 {
        self.raw[3]
    }
    pub fn set_underglow_speed(&mut self, v: u8) {
        self.raw[3] = v;
    }
    pub fn underglow_orientation(&self) -> u8 {
        self.raw[4]
    }
    pub fn set_underglow_orientation(&mut self, v: u8) {
        self.raw[4] = v;
    }
    pub fn underglow_rainbow(&self) -> u8 {
        self.raw[5]
    }
    pub fn set_underglow_rainbow(&mut self, v: u8) {
        self.raw[5] = v;
    }
    pub fn underglow_color(&self) -> (u8, u8, u8) {
        (
            self.raw[U_COLOR],
            self.raw[U_COLOR + 1],
            self.raw[U_COLOR + 2],
        )
    }
    pub fn set_underglow_color(&mut self, r: u8, g: u8, b: u8) {
        self.raw[U_COLOR] = r;
        self.raw[U_COLOR + 1] = g;
        self.raw[U_COLOR + 2] = b;
    }

    pub fn win_lock(&self) -> u8 {
        self.raw[WINLOCK]
    }
    pub fn set_win_lock(&mut self, v: bool) {
        self.raw[WINLOCK] = u8::from(v);
    }

    pub fn led_mode(&self) -> u8 {
        self.raw[LED_MODE]
    }
    pub fn set_led_mode(&mut self, v: u8) {
        self.raw[LED_MODE] = v;
    }
    pub fn led_saturation(&self) -> u8 {
        self.raw[LED_SATURATION]
    }
    pub fn set_led_saturation(&mut self, v: u8) {
        self.raw[LED_SATURATION] = v;
    }
    pub fn led_rainbow(&self) -> u8 {
        self.raw[LED_RAINBOW]
    }
    pub fn set_led_rainbow(&mut self, v: u8) {
        self.raw[LED_RAINBOW] = v;
    }
    pub fn led_color(&self) -> u8 {
        self.raw[LED_COLOR]
    }
    pub fn set_led_color(&mut self, v: u8) {
        self.raw[LED_COLOR] = v;
    }

    pub fn show_image(&self) -> ShowSlot {
        ShowSlot::from_u8(self.raw[SHOW_IMAGE])
    }
    pub fn set_show_image(&mut self, slot: ShowSlot) {
        self.raw[SHOW_IMAGE] = slot.as_u8();
    }
    pub fn slot0_frames(&self) -> u8 {
        self.raw[SLOT0_FRAMES]
    }
    pub fn set_slot0_frames(&mut self, v: u8) {
        self.raw[SLOT0_FRAMES] = v;
    }
    pub fn slot1_frames(&self) -> u8 {
        self.raw[SLOT1_FRAMES]
    }
    pub fn set_slot1_frames(&mut self, v: u8) {
        self.raw[SLOT1_FRAMES] = v;
    }

    pub fn frame_delay_ms(&self) -> u16 {
        u16::from(self.raw[FRAME_DELAY]) | (u16::from(self.raw[FRAME_DELAY + 1]) << 8)
    }
    pub fn set_frame_delay_ms(&mut self, ms: u16) {
        self.raw[FRAME_DELAY] = (ms & 0xff) as u8;
        self.raw[FRAME_DELAY + 1] = (ms >> 8) as u8;
    }

    /// Sets the clock. `weekday` is 0..=6 (Sunday = 0) and is stored raw.
    // The argument list mirrors the device clock fields; a struct would obscure
    // the call sites that later tasks rely on.
    #[allow(clippy::too_many_arguments)]
    pub fn set_time(
        &mut self,
        year: u16,
        month: u8,
        day: u8,
        weekday: u8,
        hour: u8,
        minute: u8,
        second: u8,
    ) -> Result<(), ProtocolError> {
        check("hour", u32::from(hour), 23)?;
        check("minute", u32::from(minute), 59)?;
        check("second", u32::from(second), 59)?;
        check("month", u32::from(month), 12)?;
        check("date", u32::from(day), 31)?;
        check("weekday", u32::from(weekday), 6)?;
        self.raw[TIME] = encode_bcd(second)?;
        self.raw[TIME + 1] = encode_bcd(minute)?;
        self.raw[TIME + 2] = encode_bcd(hour)?;
        self.raw[TIME + 3] = weekday;
        self.raw[TIME + 4] = encode_bcd(day)?;
        self.raw[TIME + 5] = encode_bcd(month)?;
        self.raw[TIME + 6] = encode_bcd((year % 100) as u8)?;
        Ok(())
    }

    /// Returns `(year, month, day, weekday, hour, minute, second)` with a
    /// four-digit year reconstructed in the 2000s.
    pub fn time(&self) -> (u16, u8, u8, u8, u8, u8, u8) {
        (
            2000 + u16::from(decode_bcd(self.raw[TIME + 6])),
            decode_bcd(self.raw[TIME + 5]),
            decode_bcd(self.raw[TIME + 4]),
            self.raw[TIME + 3],
            decode_bcd(self.raw[TIME + 2]),
            decode_bcd(self.raw[TIME + 1]),
            decode_bcd(self.raw[TIME]),
        )
    }
}

fn check(field: &'static str, value: u32, max: u32) -> Result<(), ProtocolError> {
    if value > max {
        return Err(ProtocolError::OutOfRange { field, value, max });
    }
    Ok(())
}
