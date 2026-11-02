//! Scripted transport for tests.

use crate::error::{DeviceError, Result};
use crate::transport::Transport;
use gmk87_protocol::packet::{checksum, Command, Packet};
use std::collections::VecDeque;
use std::time::Duration;

#[derive(Default)]
pub struct MockTransport {
    responses: VecDeque<Vec<u8>>,
    writes: Vec<Vec<u8>>,
    fail_writes: usize,
}

impl MockTransport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queues one response report for each call to `command`.
    pub fn expect(&mut self, command: Command, payloads: Vec<Vec<u8>>) -> &mut Self {
        for payload in payloads {
            let packet = Packet::new(command, 0, &payload).expect("mock payload fits");
            self.responses.push_back(packet.encode().to_vec());
        }
        self
    }

    /// Queues one 8-byte acknowledgement, the shape the wired vendor
    /// interface's 7-byte input report produces.
    pub fn ack_short(&mut self, command: Command) -> &mut Self {
        let mut report = vec![0u8; 8];
        report[0] = gmk87_protocol::packet::REPORT_ID;
        report[3] = command.as_u8();
        let sum = checksum(&report);
        report[1] = (sum & 0xff) as u8;
        report[2] = (sum >> 8) as u8;
        self.responses.push_back(report);
        self
    }

    /// Queues the 2.4 GHz dongle's full acknowledgement shape: report ID
    /// `0x01`, the command echoed at offsets 1 and 3, and no app checksum.
    pub fn ack_dongle(&mut self, command: Command) -> &mut Self {
        let mut report = vec![0u8; 64];
        report[0] = 0x01;
        report[1] = command.as_u8();
        report[2] = 0x09;
        report[3] = command.as_u8();
        self.responses.push_back(report);
        self
    }

    /// Queues a report the device sends on its own, such as `READY` or noise
    /// for another command.
    ///
    /// Reports are delivered strictly in arrival order: this appends to the
    /// same queue `expect` fills, so an unsolicited report lands behind
    /// everything already scripted and ahead of everything scripted later. A
    /// jump-the-line queue would let a `READY` that belongs to a later phase be
    /// consumed and discarded by an earlier command's acknowledgement read.
    pub fn push_unsolicited(&mut self, report: Vec<u8>) -> &mut Self {
        self.responses.push_back(report);
        self
    }

    pub fn fail_next_write(&mut self) -> &mut Self {
        self.fail_writes += 1;
        self
    }

    pub fn writes(&self) -> &[Vec<u8>] {
        &self.writes
    }

    pub fn commands_sent(&self) -> Vec<u8> {
        self.writes.iter().map(|w| w[3]).collect()
    }
}

impl Transport for MockTransport {
    fn write_report(&mut self, report: &[u8]) -> Result<()> {
        if self.fail_writes > 0 {
            self.fail_writes -= 1;
            return Err(DeviceError::Hid("injected write failure".into()));
        }
        self.writes.push(report.to_vec());
        Ok(())
    }

    fn read_report(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>> {
        if let Some(report) = self.responses.pop_front() {
            return Ok(Some(report));
        }
        // Behave like a blocking transport with nothing to deliver, so callers
        // polling for a response do not spin a core while the timeout elapses.
        std::thread::sleep(timeout.min(Duration::from_millis(10)));
        Ok(None)
    }
}
