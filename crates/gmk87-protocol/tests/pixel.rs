use gmk87_protocol::error::ProtocolError;
use gmk87_protocol::pixel::*;

#[test]
fn rgb565_packs_big_endian_channel_bits() {
    // Pure red -> R=31, G=0, B=0 -> 0xF800, written high byte first.
    assert_eq!(rgb565_be(255, 0, 0), 0xF800);
    assert_eq!(rgb565_be(0, 255, 0), 0x07E0);
    assert_eq!(rgb565_be(0, 0, 255), 0x001F);
    assert_eq!(rgb565_be(255, 255, 255), 0xFFFF);
    assert_eq!(rgb565_be(0, 0, 0), 0x0000);
}

#[test]
fn encodes_a_slot_with_high_byte_first_and_pads_to_64k() {
    let mut rgb = vec![0u8; (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize];
    rgb[0] = 255; // first pixel red
    rgb[1] = 0;
    rgb[2] = 0;

    let slot = encode_slot(&rgb).unwrap();
    assert_eq!(slot.len(), SLOT_BYTES);
    assert_eq!(slot[0], 0xF8, "high byte of 0xF800");
    assert_eq!(slot[1], 0x00, "low byte of 0xF800");
    assert!(
        slot[FRAME_BYTES..].iter().all(|b| *b == 0),
        "padding is zero"
    );
}

#[test]
fn rejects_buffers_of_the_wrong_length() {
    let err = encode_slot(&[0u8; 10]).unwrap_err();
    assert!(matches!(err, ProtocolError::InvalidJob(_)));
}
