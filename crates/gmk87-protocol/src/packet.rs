use crate::error::ProtocolError;

pub const REPORT_ID: u8 = 0x04;
pub const PACKET_LEN: usize = 64;
pub const MAX_PAYLOAD: usize = 56;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Command {
    Init,
    Commit,
    PrepRead,
    ReadConfig,
    Config,
    FrameData,
    /// `0x23`, sent by the **host** once, with an empty payload at position 0,
    /// between the configuration `COMMIT` and the first frame packet. It opens
    /// the frame upload session (the official application sends it exactly
    /// once there). The name is historical: it was once mistaken for a device
    /// "ready" notification.
    Ready,
}

impl Command {
    pub fn as_u8(self) -> u8 {
        match self {
            Command::Init => 0x01,
            Command::Commit => 0x02,
            Command::PrepRead => 0x03,
            Command::ReadConfig => 0x05,
            Command::Config => 0x06,
            Command::FrameData => 0x21,
            Command::Ready => 0x23,
        }
    }

    pub fn from_u8(value: u8) -> Option<Command> {
        match value {
            0x01 => Some(Command::Init),
            0x02 => Some(Command::Commit),
            0x03 => Some(Command::PrepRead),
            0x05 => Some(Command::ReadConfig),
            0x06 => Some(Command::Config),
            0x21 => Some(Command::FrameData),
            0x23 => Some(Command::Ready),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Packet {
    pub command: Command,
    pub position: u32,
    pub payload: Vec<u8>,
}

impl Packet {
    pub fn new(command: Command, position: u32, payload: &[u8]) -> Result<Self, ProtocolError> {
        if payload.len() > MAX_PAYLOAD {
            return Err(ProtocolError::PayloadTooLong {
                actual: payload.len(),
                max: MAX_PAYLOAD,
            });
        }
        Ok(Self {
            command,
            position,
            payload: payload.to_vec(),
        })
    }

    pub fn encode(&self) -> [u8; PACKET_LEN] {
        let mut raw = [0u8; PACKET_LEN];
        raw[0] = REPORT_ID;
        raw[3] = self.command.as_u8();
        raw[4] = self.payload.len() as u8;
        raw[5] = (self.position & 0xff) as u8;
        raw[6] = ((self.position >> 8) & 0xff) as u8;
        raw[7] = ((self.position >> 16) & 0xff) as u8;
        raw[8..8 + self.payload.len()].copy_from_slice(&self.payload);
        let sum = checksum(&raw);
        raw[1] = (sum & 0xff) as u8;
        raw[2] = (sum >> 8) as u8;
        raw
    }

    pub fn decode(raw: &[u8]) -> Result<Self, ProtocolError> {
        if raw.len() < PACKET_LEN {
            return Err(ProtocolError::ShortPacket {
                actual: raw.len(),
                expected: PACKET_LEN,
            });
        }
        let command = Command::from_u8(raw[3]).ok_or(ProtocolError::UnknownCommand(raw[3]))?;
        let len = raw[4].min(MAX_PAYLOAD as u8) as usize;
        let position = u32::from(raw[5]) | (u32::from(raw[6]) << 8) | (u32::from(raw[7]) << 16);
        Ok(Self {
            command,
            position,
            payload: raw[8..8 + len].to_vec(),
        })
    }
}

/// Sum of bytes 3..64, mod 65536.
pub fn checksum(raw: &[u8]) -> u16 {
    raw.iter()
        .skip(3)
        .fold(0u16, |acc, byte| acc.wrapping_add(u16::from(*byte)))
}
