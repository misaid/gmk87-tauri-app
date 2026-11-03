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
    let mut out = Vec::with_capacity(SLOT_BYTES);
    encode_slot_into(rgb, &mut out)?;
    Ok(out)
}

/// Appends one padded slot to `out`, so callers can build the multi-frame
/// memory image with a single allocation instead of one buffer per frame.
pub fn encode_slot_into(rgb: &[u8], out: &mut Vec<u8>) -> Result<(), ProtocolError> {
    let expected = (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize;
    if rgb.len() != expected {
        return Err(ProtocolError::InvalidJob(format!(
            "expected {expected} RGB bytes, received {}",
            rgb.len()
        )));
    }
    let start = out.len();
    out.resize(start + SLOT_BYTES, 0);
    let slot = &mut out[start..];
    for (i, px) in rgb.as_chunks::<3>().0.iter().enumerate() {
        let packed = rgb565_be(px[0], px[1], px[2]);
        slot[i * 2] = (packed >> 8) as u8;
        slot[i * 2 + 1] = (packed & 0xff) as u8;
    }
    Ok(())
}
