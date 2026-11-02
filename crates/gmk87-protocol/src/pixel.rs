//! RGB565 conversion and display-slot layout.

use crate::error::ProtocolError;

pub const DISPLAY_WIDTH: u32 = 240;
pub const DISPLAY_HEIGHT: u32 = 135;
pub const FRAME_BYTES: usize = (DISPLAY_WIDTH * DISPLAY_HEIGHT * 2) as usize;
pub const SLOT_BYTES: usize = 65536;

pub fn rgb565_be(r: u8, g: u8, b: u8) -> u16 {
    ((u16::from(r) & 0xF8) << 8) | ((u16::from(g) & 0xFC) << 3) | (u16::from(b) >> 3)
}

/// Encodes `DISPLAY_WIDTH * DISPLAY_HEIGHT * 3` RGB8 bytes into a padded slot.
pub fn encode_slot(rgb: &[u8]) -> Result<Vec<u8>, ProtocolError> {
    let expected = (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize;
    if rgb.len() != expected {
        return Err(ProtocolError::InvalidJob(format!(
            "expected {expected} RGB bytes, received {}",
            rgb.len()
        )));
    }
    let mut out = vec![0u8; SLOT_BYTES];
    for (i, px) in rgb.as_chunks::<3>().0.iter().enumerate() {
        let packed = rgb565_be(px[0], px[1], px[2]);
        out[i * 2] = (packed >> 8) as u8;
        out[i * 2 + 1] = (packed & 0xff) as u8;
    }
    Ok(out)
}
