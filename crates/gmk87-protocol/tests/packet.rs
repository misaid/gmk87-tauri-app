use gmk87_protocol::packet::{checksum, Command, Packet, PACKET_LEN, REPORT_ID};

#[test]
fn encodes_a_frame_data_packet_to_the_documented_layout() {
    let payload = [0xABu8; 56];
    let pkt = Packet::new(Command::FrameData, 0x000102, &payload).unwrap();
    let raw = pkt.encode();

    assert_eq!(raw.len(), PACKET_LEN);
    assert_eq!(raw[0], REPORT_ID);
    assert_eq!(raw[3], 0x21);
    assert_eq!(raw[4], 56);
    assert_eq!(raw[5], 0x02, "position LSB");
    assert_eq!(raw[6], 0x01, "position mid");
    assert_eq!(raw[7], 0x00, "position MSB");
    assert_eq!(&raw[8..64], &payload);
    assert_eq!(checksum(&raw), u16::from_le_bytes([raw[1], raw[2]]));
}

#[test]
fn round_trips_through_decode() {
    let pkt = Packet::new(Command::Config, 7, &[1, 2, 3]).unwrap();
    let decoded = Packet::decode(&pkt.encode()).unwrap();
    assert_eq!(decoded, pkt);
}

#[test]
fn rejects_payloads_over_56_bytes() {
    let err = Packet::new(Command::FrameData, 0, &[0u8; 57]).unwrap_err();
    assert!(matches!(
        err,
        gmk87_protocol::error::ProtocolError::PayloadTooLong { .. }
    ));
}

#[test]
fn rejects_short_packets_on_decode() {
    let err = Packet::decode(&[0u8; 10]).unwrap_err();
    assert!(matches!(
        err,
        gmk87_protocol::error::ProtocolError::ShortPacket { .. }
    ));
}

#[test]
fn checksum_sums_bytes_three_through_sixty_three() {
    let mut raw = [0u8; PACKET_LEN];
    raw[3] = 1;
    raw[63] = 2;
    assert_eq!(checksum(&raw), 3);
}
