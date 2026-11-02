# GMK87 Rust Core + CLI Implementation Plan

> ## ⛔ SUPERSEDED — historical record, do not implement
>
> **This plan is retained only as a record of what was attempted. It no longer
> describes the device or the code.** The design was corrected on 2026-11-01
> after testing on the physical keyboard. Do not follow the read path or the
> hardware-verification steps below.
>
> - **The device is write-only.** The `read_config` handshake specified in
>   Tasks 9 and 10 (`INIT → PREP_READ ×10 → COMMIT → READ_CFG ×13`) is
>   **forbidden**. `PREP_READ (0x03)` reset and re-enumerated the keyboard
>   twice, and `READ_CFG (0x05)` only echoes its request payload. **Never send
>   `0x03` or `0x05`.**
> - **There is no read-modify-write.** The host keeps the complete 48-byte block
>   as local state, seeds it from a snapshot, and writes the whole block.
> - **Hardware verification is deferred.** Do not run the "Verify against
>   hardware" steps. The only authorised procedure is the one in
>   [`hardware-testing.md`](../../hardware-testing.md), and it runs only after a
>   human explicitly re-authorises it.
>
> Authority for every corrected detail:
>
> - [`../specs/2026-11-01-gmk87-configurator-design.md`](../specs/2026-11-01-gmk87-configurator-design.md)
>   — especially §3.3 (the device cannot be read) and §3.3a (vendor interface
>   and acknowledgement shape).
> - [`../../protocol.md`](../../protocol.md) — the corrected protocol reference,
>   including the no-read rule (§5, §6) and the upload/repair sequence (§11).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> *Historical note: the instruction above applied to the original run. This plan
> is now superseded; use the amended spec and `docs/protocol.md` instead.*

**Goal:** Build the Rust workspace that speaks the GMK87 vendor USB protocol — packet codec, configuration buffer, image/GIF preparation, device session with retry rules — and a `gmk87-cli` that uploads display images, sets lighting and syncs the clock on real hardware.

**Architecture:** A Cargo workspace with `gmk87-protocol` (pure, I/O-free encoding, config, and image math), `gmk87-device` (discovery, a `Transport` trait, the hidapi implementation, and the `Session` state machine), and `gmk87-cli` (a thin debug/recovery binary). The Tauri app in the follow-on plan calls `gmk87-device` directly; nothing in this plan depends on the UI.

**Tech Stack:** Rust (2021 edition, stable), `hidapi`, `image`, `gif`, `thiserror`, `clap`, `tracing`, `proptest` (dev).

**Spec:** `docs/superpowers/specs/2026-11-01-gmk87-configurator-design.md`

## Global Constraints

- Rust stable, edition 2021. `cargo fmt` and `cargo clippy -- -D warnings` must pass.
- Device identity: vendor `0x320f`, product IDs `0x5055` (wired) and `0x5088` (2.4 GHz dongle).
- Vendor channel selected by HID usage page `0xff1c`; VIA channel usage page `0xff60` is detected and reported, never driven.
- Report ID for all vendor traffic is `0x04`; report length is exactly 64 bytes.
- Checksum covers bytes 3..64, little-endian, mod 65536.
- Maximum payload per packet is 56 bytes.
- Display is 240×135, RGB565 **big-endian** (high byte first).
- Each display slot is padded to 65536 bytes and streamed with a monotonic 24-bit position.
- Configuration block is 48 bytes. ~~All writes are read-modify-write; only known fields may change.~~ **Superseded:** the device cannot be read, so there is no read-modify-write. The host keeps the whole block locally, seeds it from a snapshot, and writes it verbatim (spec §3.3; `docs/protocol.md` §6).
- Clock fields (second, minute, hour, date, month, year) are packed BCD; day-of-week is raw.
- Animation budget: at most 36 frames total across both slots; minimum frame delay 60 ms.
- `show_image`: `0` = clock, `1` = slot 0, `2` = slot 1.

## Review Focus

1. **Corrupt or non-image file passed to upload** — a `.txt`, truncated PNG, or unsupported codec must produce a clear `InvalidJob`/decode error and no USB traffic, never a panic or a partly-streamed upload.
2. **Image whose dimensions are enormous (e.g. 20000×20000)** — must be rejected or downscaled within a bounded memory budget, not allocated at full size.
3. **Animated GIF that exceeds the frame budget** — more than 36 frames, or a frame delay below 60 ms, must fail validation before any packet is sent, with the offending numbers in the message.
4. **Time values at field boundaries** — minute/hour/date/month at 59/23/31/12 and a two-digit year must encode to correct BCD, and out-of-range values (hour 24, month 13) must be rejected.
5. **~~A short or malformed configuration read~~ — superseded.** There is no read path; the device cannot be read (spec §3.3). The equivalent live rule is that a malformed local snapshot falls back to the defaults, and a short/failed `CONFIG`/`COMMIT` leaves the session unsynced rather than writing a truncated buffer back.

---

### Task 1: Workspace scaffold, tooling and license

**Files:**
- Create: `Cargo.toml`, `rust-toolchain.toml`, `.gitignore`, `LICENSE`, `NOTICE`, `README.md`
- Create: `.github/workflows/ci.yml`
- Create: `packaging/50-gmk87.rules`
- Create: `crates/gmk87-protocol/Cargo.toml`, `crates/gmk87-protocol/src/lib.rs`
- Create: `crates/gmk87-device/Cargo.toml`, `crates/gmk87-device/src/lib.rs`
- Create: `crates/gmk87-cli/Cargo.toml`, `crates/gmk87-cli/src/main.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: three crates named `gmk87-protocol`, `gmk87-device`, `gmk87-cli` that compile and whose tests run.

- [ ] **Step 1: Create the workspace manifest**

`Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = ["crates/gmk87-protocol", "crates/gmk87-device", "crates/gmk87-cli"]

[workspace.package]
version = "0.1.0"
edition = "2021"
license = "GPL-3.0-or-later"
repository = "https://example.invalid/gmk87-configurator"

[workspace.dependencies]
thiserror = "1"
tracing = "0.1"

[profile.release]
lto = true
codegen-units = 1
```

- [ ] **Step 2: Create the three crate manifests and stub libraries**

`crates/gmk87-protocol/Cargo.toml`:

```toml
[package]
name = "gmk87-protocol"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
thiserror.workspace = true
image = "0.25"
gif = "0.13"

[dev-dependencies]
proptest = "1"
```

`crates/gmk87-device/Cargo.toml`:

```toml
[package]
name = "gmk87-device"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
gmk87-protocol = { path = "../gmk87-protocol" }
thiserror.workspace = true
tracing.workspace = true
hidapi = "2"
chrono = "0.4"
```

`crates/gmk87-cli/Cargo.toml`:

```toml
[package]
name = "gmk87-cli"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
gmk87-device = { path = "../gmk87-device" }
gmk87-protocol = { path = "../gmk87-protocol" }
clap = { version = "4", features = ["derive"] }
anyhow = "1"
tracing.workspace = true
tracing-subscriber = "0.3"
chrono = "0.4"
```

`crates/gmk87-protocol/src/lib.rs`:

```rust
//! Pure encoding, configuration and image math for the GMK87. No I/O.
```

`crates/gmk87-device/src/lib.rs`:

```rust
//! Device discovery, transport and session state machine for the GMK87.
```

`crates/gmk87-cli/src/main.rs`:

```rust
fn main() {
    println!("gmk87-cli");
}
```

- [ ] **Step 3: Add tooling, license and the udev rule**

`rust-toolchain.toml`:

```toml
[toolchain]
channel = "stable"
components = ["rustfmt", "clippy"]
```

`.gitignore`:

```
/target
/node_modules
/ui/dist
/src-tauri/target
*.log
```

`packaging/50-gmk87.rules`:

```
# ZUOYA GMK87 — grant the active seat access without root.
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5055", TAG+="uaccess"
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5088", TAG+="uaccess"
```

`LICENSE`: the full GPL-3.0 text. `NOTICE`:

```
This project implements the ZUOYA GMK87 USB protocol, documented by the
community. The packet format and command sequence were ported from the
following MIT-licensed work:

  - codedgar/gmk87-node (MIT)
  - ikkentim/gmk87-usb-reverse (MIT)

Their copyright notices are reproduced here in accordance with the MIT License.
```

`README.md`: a short paragraph naming the project, the supported keyboard, the crates, and the build command `cargo build --release`.

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: sudo apt-get update && sudo apt-get install -y libudev-dev pkg-config
      - run: cargo fmt --all --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --all
```

- [ ] **Step 4: Verify the workspace builds and tests run**

Run: `cargo test --all`
Expected: PASS — three crates compile, zero tests, exit code 0.

Run: `cargo clippy --all-targets -- -D warnings`
Expected: PASS, no warnings.

- [ ] **Step 5: Commit**

```bash
git add Cargo.toml rust-toolchain.toml .gitignore LICENSE NOTICE README.md .github packaging crates
git commit -m "chore: scaffold gmk87 workspace, tooling and udev rule"
```

---

### Task 2: Packet codec

**Files:**
- Create: `crates/gmk87-protocol/src/error.rs`
- Create: `crates/gmk87-protocol/src/packet.rs`
- Modify: `crates/gmk87-protocol/src/lib.rs`
- Test: `crates/gmk87-protocol/tests/packet.rs`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub const REPORT_ID: u8 = 0x04;`, `pub const PACKET_LEN: usize = 64;`, `pub const MAX_PAYLOAD: usize = 56;`
  - `pub enum Command { Init, Commit, PrepRead, ReadConfig, Config, FrameData, Ready }` with `as_u8(self) -> u8` and `from_u8(u8) -> Option<Command>`
  - `pub struct Packet { pub command: Command, pub position: u32, pub payload: Vec<u8> }`
  - `Packet::new(command, position, payload: &[u8]) -> Result<Packet, ProtocolError>`
  - `Packet::encode(&self) -> [u8; PACKET_LEN]`
  - `Packet::decode(raw: &[u8]) -> Result<Packet, ProtocolError>`
  - `pub fn checksum(raw: &[u8]) -> u16`
  - `pub enum ProtocolError` (thiserror), including `PayloadTooLong`, `ShortPacket`, `UnknownCommand(u8)`

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-protocol/tests/packet.rs`:

```rust
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
    assert!(matches!(err, gmk87_protocol::error::ProtocolError::PayloadTooLong { .. }));
}

#[test]
fn rejects_short_packets_on_decode() {
    let err = Packet::decode(&[0u8; 10]).unwrap_err();
    assert!(matches!(err, gmk87_protocol::error::ProtocolError::ShortPacket { .. }));
}

#[test]
fn checksum_sums_bytes_three_through_sixty_three() {
    let mut raw = [0u8; PACKET_LEN];
    raw[3] = 1;
    raw[63] = 2;
    assert_eq!(checksum(&raw), 3);
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-protocol --test packet`
Expected: FAIL — unresolved imports (`gmk87_protocol::packet` does not exist).

- [ ] **Step 3: Write the error type**

`crates/gmk87-protocol/src/error.rs`:

```rust
use thiserror::Error;

/// Errors raised while encoding or decoding the vendor protocol.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProtocolError {
    #[error("payload of {actual} bytes exceeds the {max}-byte maximum")]
    PayloadTooLong { actual: usize, max: usize },
    #[error("packet of {actual} bytes is shorter than the {expected}-byte minimum")]
    ShortPacket { actual: usize, expected: usize },
    #[error("unknown command byte 0x{0:02x}")]
    UnknownCommand(u8),
    #[error("configuration buffer of {actual} bytes is shorter than the {expected}-byte minimum")]
    ShortConfig { actual: usize, expected: usize },
    #[error("value {value} is outside the valid range 0..={max} for {field}")]
    OutOfRange { field: &'static str, value: u32, max: u32 },
    #[error("image decode failed: {0}")]
    ImageDecode(String),
    #[error("animation of {frames} frames exceeds the {max}-frame budget")]
    FrameBudget { frames: u32, max: u32 },
    #[error("frame delay of {delay_ms} ms is below the {min_ms} ms minimum")]
    FrameDelayTooShort { delay_ms: u16, min_ms: u16 },
    #[error("invalid upload job: {0}")]
    InvalidJob(String),
}
```

- [ ] **Step 4: Write the packet codec**

`crates/gmk87-protocol/src/packet.rs`:

```rust
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
```

- [ ] **Step 5: Wire up the module tree**

`crates/gmk87-protocol/src/lib.rs`:

```rust
//! Pure encoding, configuration and image math for the GMK87. No I/O.

pub mod error;
pub mod packet;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p gmk87-protocol --test packet`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/gmk87-protocol
git commit -m "feat(protocol): vendor packet codec with checksum and position"
```

---

### Task 3: Configuration buffer

**Files:**
- Create: `crates/gmk87-protocol/src/config.rs`
- Modify: `crates/gmk87-protocol/src/lib.rs`
- Test: `crates/gmk87-protocol/tests/config.rs`

**Interfaces:**
- Consumes: `ProtocolError` from Task 2.
- Produces:
  - `pub const CONFIG_LEN: usize = 48;`
  - `pub struct DeviceConfig` with `from_bytes(&[u8]) -> Result<DeviceConfig, ProtocolError>`, `as_bytes(&self) -> &[u8]`
  - Getters/setters: `underglow_effect`, `underglow_brightness`, `underglow_speed`, `underglow_orientation`, `underglow_rainbow`, `underglow_color() -> (u8, u8, u8)`, `win_lock`, `led_mode`, `led_saturation`, `led_rainbow`, `led_color`, `show_image`, `slot0_frames`, `slot1_frames`, `frame_delay_ms`, `set_frame_delay_ms(u16)`
  - `pub enum ShowSlot { Clock, Slot0, Slot1 }` with `from_u8`/`as_u8`
  - `pub fn encode_bcd(u8) -> Result<u8, ProtocolError>`, `pub fn decode_bcd(u8) -> u8`
  - `DeviceConfig::set_time(&mut self, year: u16, month: u8, day: u8, weekday: u8, hour: u8, minute: u8, second: u8) -> Result<(), ProtocolError>`
  - `DeviceConfig::time(&self) -> (u16, u8, u8, u8, u8, u8, u8)`

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-protocol/tests/config.rs`:

```rust
use gmk87_protocol::config::{decode_bcd, encode_bcd, DeviceConfig, ShowSlot};
use gmk87_protocol::error::ProtocolError;
use proptest::prelude::*;

#[test]
fn reads_documented_offsets() {
    let mut raw = [0u8; 48];
    raw[1] = 5;   // underglow effect
    raw[2] = 7;   // brightness
    raw[6] = 10;  // red
    raw[7] = 20;  // green
    raw[8] = 30;  // blue
    raw[21] = 1;  // winlock
    raw[33] = 2;  // show slot 1
    raw[34] = 3;  // slot 0 frames
    raw[46] = 4;  // slot 1 frames
    raw[43] = 0x64; // frame delay low
    raw[44] = 0x00; // frame delay high

    let cfg = DeviceConfig::from_bytes(&raw).unwrap();
    assert_eq!(cfg.underglow_effect(), 5);
    assert_eq!(cfg.underglow_brightness(), 7);
    assert_eq!(cfg.underglow_color(), (10, 20, 30));
    assert_eq!(cfg.win_lock(), 1);
    assert_eq!(cfg.show_image(), ShowSlot::Slot1);
    assert_eq!(cfg.slot0_frames(), 3);
    assert_eq!(cfg.slot1_frames(), 4);
    assert_eq!(cfg.frame_delay_ms(), 100);
}

#[test]
fn rejects_short_buffers() {
    let err = DeviceConfig::from_bytes(&[0u8; 47]).unwrap_err();
    assert!(matches!(err, ProtocolError::ShortConfig { .. }));
}

#[test]
fn bcd_round_trips_and_rejects_out_of_range() {
    assert_eq!(encode_bcd(59).unwrap(), 0x59);
    assert_eq!(decode_bcd(0x59), 59);
    assert_eq!(encode_bcd(9).unwrap(), 0x09);
    assert!(matches!(encode_bcd(100), Err(ProtocolError::OutOfRange { .. })));
}

#[test]
fn writes_time_as_bcd_and_rejects_bad_values() {
    let mut cfg = DeviceConfig::from_bytes(&[0u8; 48]).unwrap();
    cfg.set_time(2026, 11, 1, 6, 23, 59, 58).unwrap();
    let bytes = cfg.as_bytes();
    assert_eq!(bytes[35], 0x58, "second");
    assert_eq!(bytes[36], 0x59, "minute");
    assert_eq!(bytes[37], 0x23, "hour");
    assert_eq!(bytes[38], 6, "weekday is raw");
    assert_eq!(bytes[39], 0x01, "date");
    assert_eq!(bytes[40], 0x11, "month");
    assert_eq!(bytes[41], 0x26, "year 26");

    assert!(matches!(cfg.set_time(2026, 13, 1, 0, 0, 0, 0), Err(ProtocolError::OutOfRange { .. })));
    assert!(matches!(cfg.set_time(2026, 1, 1, 0, 24, 0, 0), Err(ProtocolError::OutOfRange { .. })));
}

proptest! {
    /// SUPERSEDED: the name says "read modify write", which does not exist.
    /// Current test: `untouched_bytes_survive_an_edit`.
    /// Any edit must preserve every byte not explicitly changed.
    #[test]
    fn untouched_bytes_survive_a_read_modify_write(raw in prop::array::uniform48(any::<u8>())) {
        let original = DeviceConfig::from_bytes(&raw).unwrap();
        let mut edited = DeviceConfig::from_bytes(&raw).unwrap();
        edited.set_underglow_brightness(9);
        edited.set_show_image(ShowSlot::Slot0);
        let out = edited.as_bytes();

        for i in 0..48 {
            if i != 2 && i != 33 {
                prop_assert_eq!(out[i], original.as_bytes()[i], "byte {} changed", i);
            }
        }
        prop_assert_eq!(out[2], 9);
        prop_assert_eq!(out[33], 1);
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-protocol --test config`
Expected: FAIL — `gmk87_protocol::config` does not exist.

- [ ] **Step 3: Implement the configuration buffer**

`crates/gmk87-protocol/src/config.rs`:

```rust
//! The 48-byte device configuration block.
//!
//! SUPERSEDED wording: there is no read-modify-write, because the device
//! cannot be read. The crate carries the whole block verbatim as local state.
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

    pub fn underglow_effect(&self) -> u8 { self.raw[1] }
    pub fn set_underglow_effect(&mut self, v: u8) { self.raw[1] = v; }
    pub fn underglow_brightness(&self) -> u8 { self.raw[U_BRIGHTNESS] }
    pub fn set_underglow_brightness(&mut self, v: u8) { self.raw[U_BRIGHTNESS] = v; }
    pub fn underglow_speed(&self) -> u8 { self.raw[3] }
    pub fn set_underglow_speed(&mut self, v: u8) { self.raw[3] = v; }
    pub fn underglow_orientation(&self) -> u8 { self.raw[4] }
    pub fn set_underglow_orientation(&mut self, v: u8) { self.raw[4] = v; }
    pub fn underglow_rainbow(&self) -> u8 { self.raw[5] }
    pub fn set_underglow_rainbow(&mut self, v: u8) { self.raw[5] = v; }
    pub fn underglow_color(&self) -> (u8, u8, u8) {
        (self.raw[U_COLOR], self.raw[U_COLOR + 1], self.raw[U_COLOR + 2])
    }
    pub fn set_underglow_color(&mut self, r: u8, g: u8, b: u8) {
        self.raw[U_COLOR] = r;
        self.raw[U_COLOR + 1] = g;
        self.raw[U_COLOR + 2] = b;
    }

    pub fn win_lock(&self) -> u8 { self.raw[WINLOCK] }
    pub fn set_win_lock(&mut self, v: bool) { self.raw[WINLOCK] = u8::from(v); }

    pub fn led_mode(&self) -> u8 { self.raw[LED_MODE] }
    pub fn set_led_mode(&mut self, v: u8) { self.raw[LED_MODE] = v; }
    pub fn led_saturation(&self) -> u8 { self.raw[LED_SATURATION] }
    pub fn set_led_saturation(&mut self, v: u8) { self.raw[LED_SATURATION] = v; }
    pub fn led_rainbow(&self) -> u8 { self.raw[LED_RAINBOW] }
    pub fn set_led_rainbow(&mut self, v: u8) { self.raw[LED_RAINBOW] = v; }
    pub fn led_color(&self) -> u8 { self.raw[LED_COLOR] }
    pub fn set_led_color(&mut self, v: u8) { self.raw[LED_COLOR] = v; }

    pub fn show_image(&self) -> ShowSlot { ShowSlot::from_u8(self.raw[SHOW_IMAGE]) }
    pub fn set_show_image(&mut self, slot: ShowSlot) { self.raw[SHOW_IMAGE] = slot.as_u8(); }
    pub fn slot0_frames(&self) -> u8 { self.raw[SLOT0_FRAMES] }
    pub fn set_slot0_frames(&mut self, v: u8) { self.raw[SLOT0_FRAMES] = v; }
    pub fn slot1_frames(&self) -> u8 { self.raw[SLOT1_FRAMES] }
    pub fn set_slot1_frames(&mut self, v: u8) { self.raw[SLOT1_FRAMES] = v; }

    pub fn frame_delay_ms(&self) -> u16 {
        u16::from(self.raw[FRAME_DELAY]) | (u16::from(self.raw[FRAME_DELAY + 1]) << 8)
    }
    pub fn set_frame_delay_ms(&mut self, ms: u16) {
        self.raw[FRAME_DELAY] = (ms & 0xff) as u8;
        self.raw[FRAME_DELAY + 1] = (ms >> 8) as u8;
    }

    /// Sets the clock. `weekday` is 0..=6 (Sunday = 0) and is stored raw.
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
```

- [ ] **Step 4: Add the module**

Append to `crates/gmk87-protocol/src/lib.rs`:

```rust
pub mod config;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p gmk87-protocol --test config`
Expected: PASS, 4 tests plus the proptest case.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-protocol
git commit -m "feat(protocol): 48-byte config buffer with byte-preserving accessors"
```

---

### Task 4: RGB565 pixel encoding and slot padding

**Files:**
- Create: `crates/gmk87-protocol/src/pixel.rs`
- Modify: `crates/gmk87-protocol/src/lib.rs`
- Test: `crates/gmk87-protocol/tests/pixel.rs`

**Interfaces:**
- Consumes: `ProtocolError`.
- Produces:
  - `pub const DISPLAY_WIDTH: u32 = 240;`, `pub const DISPLAY_HEIGHT: u32 = 135;`
  - `pub const FRAME_BYTES: usize = 64800;`, `pub const SLOT_BYTES: usize = 65536;`
  - `pub fn rgb565_be(r: u8, g: u8, b: u8) -> u16`
  - `pub fn encode_slot(rgb: &[u8]) -> Result<Vec<u8>, ProtocolError>` where `rgb` is `DISPLAY_WIDTH * DISPLAY_HEIGHT * 3` bytes in RGB8 order; returns `SLOT_BYTES` bytes.

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-protocol/tests/pixel.rs`:

```rust
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
    assert!(slot[FRAME_BYTES..].iter().all(|b| *b == 0), "padding is zero");
}

#[test]
fn rejects_buffers_of_the_wrong_length() {
    let err = encode_slot(&[0u8; 10]).unwrap_err();
    assert!(matches!(err, ProtocolError::InvalidJob(_)));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-protocol --test pixel`
Expected: FAIL — `gmk87_protocol::pixel` does not exist.

- [ ] **Step 3: Implement the pixel module**

`crates/gmk87-protocol/src/pixel.rs`:

```rust
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
    for (i, px) in rgb.chunks_exact(3).enumerate() {
        let packed = rgb565_be(px[0], px[1], px[2]);
        out[i * 2] = (packed >> 8) as u8;
        out[i * 2 + 1] = (packed & 0xff) as u8;
    }
    Ok(out)
}
```

- [ ] **Step 4: Add the module**

Append to `crates/gmk87-protocol/src/lib.rs`:

```rust
pub mod pixel;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p gmk87-protocol --test pixel`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-protocol
git commit -m "feat(protocol): RGB565 big-endian encoding and 64K slot padding"
```

---

### Task 5: Image decoding, crop/zoom and fit modes

**Files:**
- Create: `crates/gmk87-protocol/src/image.rs`
- Modify: `crates/gmk87-protocol/src/lib.rs`
- Test: `crates/gmk87-protocol/tests/image.rs`

**Interfaces:**
- Consumes: `ProtocolError`, `pixel::{DISPLAY_WIDTH, DISPLAY_HEIGHT}`.
- Produces:
  - `pub enum Fit { Cover, Contain }`
  - `pub struct CropSpec { pub offset_x: f32, pub offset_y: f32, pub zoom: f32, pub fit: Fit }` with `Default`
  - `pub const MAX_SOURCE_PIXELS: u64 = 64_000_000;`
  - `pub fn prepare_static(bytes: &[u8], crop: &CropSpec) -> Result<Vec<u8>, ProtocolError>` — returns RGB8 bytes of exactly `DISPLAY_WIDTH * DISPLAY_HEIGHT * 3`, suitable for `encode_slot`.

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-protocol/tests/image.rs`:

```rust
use gmk87_protocol::error::ProtocolError;
use gmk87_protocol::image::{prepare_static, CropSpec, Fit};
use gmk87_protocol::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};

fn png(width: u32, height: u32) -> Vec<u8> {
    let img = image::RgbImage::from_fn(width, height, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
    });
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

#[test]
fn produces_exactly_one_display_frame() {
    let out = prepare_static(&png(800, 600), &CropSpec::default()).unwrap();
    assert_eq!(out.len(), (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize);
}

#[test]
fn cover_and_contain_both_fill_the_frame() {
    let wide = png(1000, 100);
    for fit in [Fit::Cover, Fit::Contain] {
        let crop = CropSpec { fit, ..CropSpec::default() };
        let out = prepare_static(&wide, &crop).unwrap();
        assert_eq!(out.len(), (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize);
    }
}

#[test]
fn rejects_non_image_data() {
    let err = prepare_static(b"this is not an image", &CropSpec::default()).unwrap_err();
    assert!(matches!(err, ProtocolError::ImageDecode(_)));
}

#[test]
fn rejects_a_truncated_png() {
    let mut bytes = png(64, 64);
    bytes.truncate(bytes.len() / 2);
    assert!(prepare_static(&bytes, &CropSpec::default()).is_err());
}

#[test]
fn rejects_an_absurdly_large_image() {
    // A PNG header claiming 50000x50000 is refused before allocation.
    let header = {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&50_000u32.to_be_bytes());
        v.extend_from_slice(&50_000u32.to_be_bytes());
        v.extend_from_slice(&[8, 2, 0, 0, 0]);
        v.extend_from_slice(&[0, 0, 0, 0]);
        v.extend_from_slice(&[0, 0, 0, 0]);
        v
    };
    let err = prepare_static(&header, &CropSpec::default()).unwrap_err();
    assert!(matches!(err, ProtocolError::ImageDecode(_)), "got {err:?}");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-protocol --test image`
Expected: FAIL — `gmk87_protocol::image` does not exist.

- [ ] **Step 3: Implement the image module**

`crates/gmk87-protocol/src/image.rs`:

```rust
//! Decode, crop and scale a source image down to one display frame.

use crate::error::ProtocolError;
use crate::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageReader, Limits};

/// Refuse sources larger than this before decoding.
pub const MAX_SOURCE_PIXELS: u64 = 64_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    /// Fill the frame, cropping overflow (default).
    Cover,
    /// Fit inside the frame, letterboxing with black.
    Contain,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropSpec {
    /// Pan in source-image fractions, -1.0..=1.0.
    pub offset_x: f32,
    pub offset_y: f32,
    /// Zoom multiplier, 1.0 is neutral.
    pub zoom: f32,
    pub fit: Fit,
}

impl Default for CropSpec {
    fn default() -> Self {
        Self { offset_x: 0.0, offset_y: 0.0, zoom: 1.0, fit: Fit::Cover }
    }
}

/// Decodes `bytes` and returns `DISPLAY_WIDTH * DISPLAY_HEIGHT * 3` RGB8 bytes.
pub fn prepare_static(bytes: &[u8], crop: &CropSpec) -> Result<Vec<u8>, ProtocolError> {
    let image = decode(bytes)?;
    Ok(render(&image, crop))
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, ProtocolError> {
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;

    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_PIXELS.min(u32::MAX as u64) as u32);
    limits.max_image_height = Some(MAX_SOURCE_PIXELS.min(u32::MAX as u64) as u32);
    reader.limits(limits);

    let image = reader
        .decode()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;

    let (w, h) = image.dimensions();
    if u64::from(w) * u64::from(h) > MAX_SOURCE_PIXELS {
        return Err(ProtocolError::ImageDecode(format!(
            "source {w}x{h} exceeds the {MAX_SOURCE_PIXELS}-pixel budget"
        )));
    }
    Ok(image)
}

fn render(image: &DynamicImage, crop: &CropSpec) -> Vec<u8> {
    let (src_w, src_h) = image.dimensions();
    let target_ratio = DISPLAY_WIDTH as f32 / DISPLAY_HEIGHT as f32;
    let src_ratio = src_w as f32 / src_h.max(1) as f32;

    // Determine the visible source rectangle for the requested fit.
    let (mut vis_w, mut vis_h) = match crop.fit {
        Fit::Cover => {
            if src_ratio > target_ratio {
                (src_h as f32 * target_ratio, src_h as f32)
            } else {
                (src_w as f32, src_w as f32 / target_ratio)
            }
        }
        Fit::Contain => {
            if src_ratio > target_ratio {
                (src_w as f32, src_w as f32 / target_ratio)
            } else {
                (src_h as f32 * target_ratio, src_h as f32)
            }
        }
    };

    let zoom = crop.zoom.clamp(1.0, 8.0);
    vis_w /= zoom;
    vis_h /= zoom;

    let max_x = (src_w as f32 - vis_w).max(0.0);
    let max_y = (src_h as f32 - vis_h).max(0.0);
    let x0 = (max_x / 2.0) * (1.0 + crop.offset_x.clamp(-1.0, 1.0));
    let y0 = (max_y / 2.0) * (1.0 + crop.offset_y.clamp(-1.0, 1.0));

    let visible = image.crop_imm(
        x0.round() as u32,
        y0.round() as u32,
        vis_w.round().max(1.0) as u32,
        vis_h.round().max(1.0) as u32,
    );

    let resized = match crop.fit {
        Fit::Cover => visible.resize_exact(DISPLAY_WIDTH, DISPLAY_HEIGHT, FilterType::Lanczos3),
        Fit::Contain => visible.resize(DISPLAY_WIDTH, DISPLAY_HEIGHT, FilterType::Lanczos3),
    };

    let mut canvas =
        image::RgbImage::from_pixel(DISPLAY_WIDTH, DISPLAY_HEIGHT, image::Rgb([0, 0, 0]));
    let (rw, rh) = resized.dimensions();
    let ox = (DISPLAY_WIDTH - rw.min(DISPLAY_WIDTH)) / 2;
    let oy = (DISPLAY_HEIGHT - rh.min(DISPLAY_HEIGHT)) / 2;
    let rgb = resized.to_rgb8();
    image::imageops::replace(&mut canvas, &rgb, i64::from(ox), i64::from(oy));
    canvas.into_raw()
}
```

- [ ] **Step 4: Add the module**

Append to `crates/gmk87-protocol/src/lib.rs`:

```rust
pub mod image;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p gmk87-protocol --test image`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-protocol
git commit -m "feat(protocol): image decode, crop/zoom and cover/contain fit"
```

---

### Task 6: GIF frames and the upload frame plan

**Files:**
- Create: `crates/gmk87-protocol/src/frames.rs`
- Modify: `crates/gmk87-protocol/src/lib.rs`
- Test: `crates/gmk87-protocol/tests/frames.rs`

**Interfaces:**
- Consumes: `error::ProtocolError`, `image::{CropSpec, prepare_static}`, `pixel::{encode_slot, SLOT_BYTES}`, `config::ShowSlot`.
- Produces:
  - `pub const MAX_TOTAL_FRAMES: u32 = 36;`, `pub const MIN_FRAME_DELAY_MS: u16 = 60;`
  - `pub fn extract_gif_frames(bytes: &[u8], crop: &CropSpec, max_frames: u32) -> Result<(Vec<Vec<u8>>, u16), ProtocolError>` returning per-frame RGB8 plus the source delay in ms
  - `pub struct FramePlan { pub slot0_frames: Vec<Vec<u8>>, pub slot1_frames: Vec<Vec<u8>>, pub delay_ms: u16, pub show: ShowSlot }`
  - `FramePlan::validate(&self) -> Result<(), ProtocolError>`
  - `FramePlan::slot0_memory(&self) -> Result<Vec<u8>, ProtocolError>` and `slot1_memory(&self) -> Result<Vec<u8>, ProtocolError>` (concatenated padded slots)
  - `FramePlan::to_memory(&self) -> Result<Vec<u8>, ProtocolError>` (slot 0 then slot 1, the device's linear layout)

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-protocol/tests/frames.rs`:

```rust
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::error::ProtocolError;
use gmk87_protocol::frames::*;
use gmk87_protocol::image::CropSpec;
use gmk87_protocol::pixel::SLOT_BYTES;

fn frame() -> Vec<u8> {
    vec![0u8; (240 * 135 * 3) as usize]
}

fn gif_with(frames: usize, delay_ms: u16) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, 8, 8, &[]).unwrap();
        enc.set_repeat(gif::Repeat::Infinite).unwrap();
        for i in 0..frames {
            let mut f = gif::Frame::from_rgb(8, 8, &vec![(i % 255) as u8; 8 * 8 * 3]);
            f.delay = delay_ms / 10;
            enc.write_frame(&f).unwrap();
        }
    }
    out
}

#[test]
fn slots_are_padded_and_ordered() {
    let plan = FramePlan {
        slot0_frames: vec![frame(), frame()],
        slot1_frames: vec![frame()],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };
    plan.validate().unwrap();
    assert_eq!(plan.slot0_memory().unwrap().len(), SLOT_BYTES * 2);
    assert_eq!(plan.to_memory().unwrap().len(), SLOT_BYTES * 3);
}

#[test]
fn rejects_more_than_thirty_six_frames_across_both_slots() {
    let plan = FramePlan {
        slot0_frames: vec![frame(); 30],
        slot1_frames: vec![frame(); 7],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };
    let err = plan.validate().unwrap_err();
    assert!(matches!(err, ProtocolError::FrameBudget { frames: 37, max: 36 }));
}

#[test]
fn rejects_a_delay_below_sixty_ms() {
    let plan = FramePlan {
        slot0_frames: vec![frame()],
        slot1_frames: vec![],
        delay_ms: 59,
        show: ShowSlot::Slot0,
    };
    assert!(matches!(plan.validate(), Err(ProtocolError::FrameDelayTooShort { .. })));
}

#[test]
fn extracts_gif_frames_and_reads_their_delay() {
    let (frames, delay) = extract_gif_frames(&gif_with(4, 100), &CropSpec::default(), 36).unwrap();
    assert_eq!(frames.len(), 4);
    assert_eq!(delay, 100);
    assert_eq!(frames[0].len(), (240 * 135 * 3) as usize);
}

#[test]
fn refuses_a_gif_that_exceeds_the_frame_budget() {
    let err = extract_gif_frames(&gif_with(40, 100), &CropSpec::default(), 36).unwrap_err();
    assert!(matches!(err, ProtocolError::FrameBudget { frames: 40, max: 36 }));
}

#[test]
fn rejects_an_empty_gif() {
    let err = extract_gif_frames(&gif_with(0, 100), &CropSpec::default(), 36).unwrap_err();
    assert!(matches!(err, ProtocolError::InvalidJob(_)));
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-protocol --test frames`
Expected: FAIL — `gmk87_protocol::frames` does not exist.

- [ ] **Step 3: Implement the frames module**

`crates/gmk87-protocol/src/frames.rs`:

```rust
//! Animation frames and the device upload layout.

use crate::config::ShowSlot;
use crate::error::ProtocolError;
use crate::image::{prepare_static, CropSpec};
use crate::pixel::encode_slot;

pub const MAX_TOTAL_FRAMES: u32 = 36;
pub const MIN_FRAME_DELAY_MS: u16 = 60;

/// Decodes a GIF into display frames (RGB8), returning the source frame delay.
pub fn extract_gif_frames(
    bytes: &[u8],
    crop: &CropSpec,
    max_frames: u32,
) -> Result<(Vec<Vec<u8>>, u16), ProtocolError> {
    let mut options = gif::DecodeOptions::new();
    options.set_color_output(gif::ColorOutput::RGBA);
    let mut decoder = options
        .read_info(std::io::Cursor::new(bytes))
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;

    let mut frames = Vec::new();
    let mut delay_centisec = 10u16; // 100 ms default
    while let Some(frame) = decoder
        .read_next_frame()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?
    {
        if frames.len() as u32 >= max_frames {
            return Err(ProtocolError::FrameBudget {
                frames: frames.len() as u32 + 1,
                max: max_frames,
            });
        }
        if frame.delay > 0 {
            delay_centisec = frame.delay;
        }
        let rgba = frame.buffer.to_vec();
        let png = encode_rgba_png(frame.width, frame.height, &rgba)?;
        frames.push(prepare_static(&png, crop)?);
    }

    if frames.is_empty() {
        return Err(ProtocolError::InvalidJob("GIF contains no frames".into()));
    }
    Ok((frames, delay_centisec.saturating_mul(10)))
}

fn encode_rgba_png(width: u16, height: u16, rgba: &[u8]) -> Result<Vec<u8>, ProtocolError> {
    let buffer = image::RgbaImage::from_raw(u32::from(width), u32::from(height), rgba.to_vec())
        .ok_or_else(|| ProtocolError::ImageDecode("frame buffer size mismatch".into()))?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(buffer)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;
    Ok(out.into_inner())
}

#[derive(Debug, Clone)]
pub struct FramePlan {
    pub slot0_frames: Vec<Vec<u8>>,
    pub slot1_frames: Vec<Vec<u8>>,
    pub delay_ms: u16,
    pub show: ShowSlot,
}

impl FramePlan {
    pub fn validate(&self) -> Result<(), ProtocolError> {
        let total = (self.slot0_frames.len() + self.slot1_frames.len()) as u32;
        if total > MAX_TOTAL_FRAMES {
            return Err(ProtocolError::FrameBudget {
                frames: total,
                max: MAX_TOTAL_FRAMES,
            });
        }
        if total == 0 {
            return Err(ProtocolError::InvalidJob("no frames to upload".into()));
        }
        if self.delay_ms < MIN_FRAME_DELAY_MS {
            return Err(ProtocolError::FrameDelayTooShort {
                delay_ms: self.delay_ms,
                min_ms: MIN_FRAME_DELAY_MS,
            });
        }
        Ok(())
    }

    pub fn slot0_memory(&self) -> Result<Vec<u8>, ProtocolError> {
        encode_frames(&self.slot0_frames)
    }

    pub fn slot1_memory(&self) -> Result<Vec<u8>, ProtocolError> {
        encode_frames(&self.slot1_frames)
    }

    /// Slot 0 memory followed by slot 1 memory, as the device stores it.
    pub fn to_memory(&self) -> Result<Vec<u8>, ProtocolError> {
        let mut out = self.slot0_memory()?;
        out.extend_from_slice(&self.slot1_memory()?);
        Ok(out)
    }
}

fn encode_frames(frames: &[Vec<u8>]) -> Result<Vec<u8>, ProtocolError> {
    let mut out = Vec::new();
    for frame in frames {
        out.extend_from_slice(&encode_slot(frame)?);
    }
    Ok(out)
}
```

**Known limitation:** each GIF frame is decoded independently and does not
composite frame offsets or disposal methods, so GIFs that rely on partial-frame
updates render incorrectly. Full compositing is deferred; the animated-GIF entry
in `docs/hardware-testing.md` (Task 14) characterizes the impact, and the Tauri
plan revisits it.

- [ ] **Step 4: Add the module and dev-dependency**

Append to `crates/gmk87-protocol/src/lib.rs`:

```rust
pub mod frames;
```

Add to `crates/gmk87-protocol/Cargo.toml` under `[dev-dependencies]`:

```toml
gif = "0.13"
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p gmk87-protocol --test frames`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-protocol
git commit -m "feat(protocol): GIF frame extraction and upload frame plan"
```

---

### Task 7: Device discovery

**Files:**
- Create: `crates/gmk87-device/src/error.rs`
- Create: `crates/gmk87-device/src/discovery.rs`
- Modify: `crates/gmk87-device/src/lib.rs`
- Test: `crates/gmk87-device/tests/discovery.rs`

**Interfaces:**
- Consumes: `ProtocolError` (converted into `DeviceError`).
- Produces:
  - `pub const VENDOR_ID: u16 = 0x320f;`, `pub const PRODUCT_WIRED: u16 = 0x5055;`, `pub const PRODUCT_WIRELESS: u16 = 0x5088;`
  - `pub const USAGE_PAGE_VENDOR: u16 = 0xff1c;`, `pub const USAGE_PAGE_VIA: u16 = 0xff60;`
  - `pub enum TransportKind { Wired, Wireless24G }`
  - `pub struct DeviceInfo { pub path: String, pub product_id: u16, pub transport: TransportKind, pub interface_number: i32, pub has_via: bool }` with `DeviceInfo::label(&self) -> String`
  - `pub trait HidEnumerator { fn list(&self) -> Result<Vec<RawHidDevice>, DeviceError>; }`
  - `pub struct RawHidDevice { pub path: String, pub vendor_id: u16, pub product_id: u16, pub usage_page: u16, pub interface_number: i32 }`
  - `pub fn select_devices(raw: &[RawHidDevice]) -> Vec<DeviceInfo>` (pure, testable)
  - `pub struct SystemEnumerator` implementing `HidEnumerator` via hidapi
  - `pub enum DeviceError` (thiserror) with at least `DeviceNotFound`, `PermissionDenied`, `Transport`, `ProtocolTimeout`, `ChecksumMismatch`, `DeviceDesynced`, `InvalidJob`, `Protocol(#[from] ProtocolError)`, `Hid(String)`

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-device/tests/discovery.rs`:

```rust
use gmk87_device::discovery::{
    select_devices, RawHidDevice, TransportKind,
};

fn raw(pid: u16, usage_page: u16, path: &str) -> RawHidDevice {
    RawHidDevice {
        path: path.to_string(),
        vendor_id: 0x320f,
        product_id: pid,
        usage_page,
        interface_number: 0,
    }
}

#[test]
fn picks_the_vendor_interface_for_the_wired_keyboard() {
    let devices = select_devices(&[
        raw(0x5055, 0x0001, "keyboard"),
        raw(0x5055, 0xff60, "via"),
        raw(0x5055, 0xff1c, "vendor"),
    ]);
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].path, "vendor");
    assert_eq!(devices[0].transport, TransportKind::Wired);
    assert!(devices[0].has_via, "VIA interface was present");
}

#[test]
fn detects_the_2_4_ghz_dongle() {
    let devices = select_devices(&[raw(0x5088, 0xff1c, "dongle")]);
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].transport, TransportKind::Wireless24G);
    assert!(!devices[0].has_via);
}

#[test]
fn ignores_other_vendors_and_products() {
    let mut other = raw(0x5055, 0xff1c, "other");
    other.vendor_id = 0x1234;
    assert!(select_devices(&[other]).is_empty());
}

#[test]
fn lists_wired_and_wireless_separately_when_both_are_present() {
    let devices = select_devices(&[
        raw(0x5055, 0xff1c, "wired"),
        raw(0x5088, 0xff1c, "dongle"),
    ]);
    assert_eq!(devices.len(), 2);
    assert_eq!(devices[0].label(), "GMK87 (wired)");
    assert_eq!(devices[1].label(), "GMK87 (2.4 GHz)");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-device --test discovery`
Expected: FAIL — `gmk87_device::discovery` does not exist.

- [ ] **Step 3: Write the device error type**

`crates/gmk87-device/src/error.rs`:

```rust
use gmk87_protocol::error::ProtocolError;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum DeviceError {
    #[error("no GMK87 keyboard found")]
    DeviceNotFound,
    #[error("permission denied opening {path}; install packaging/50-gmk87.rules")]
    PermissionDenied { path: String },
    #[error("transport error: {0}")]
    Transport(#[from] std::io::Error),
    #[error("hid error: {0}")]
    Hid(String),
    #[error("timed out waiting for command 0x{cmd:02x}")]
    ProtocolTimeout { cmd: u8 },
    #[error("response checksum mismatch (expected 0x{expected:04x}, got 0x{actual:04x})")]
    ChecksumMismatch { expected: u16, actual: u16 },
    #[error("device state is unknown after an interrupted write; reconnect and retry")]
    DeviceDesynced,
    #[error("invalid job: {0}")]
    InvalidJob(String),
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
}

pub type Result<T> = std::result::Result<T, DeviceError>;
```

- [ ] **Step 4: Implement discovery**

`crates/gmk87-device/src/discovery.rs`:

```rust
//! Find GMK87 vendor interfaces among the system's HID devices.

use crate::error::DeviceError;

pub const VENDOR_ID: u16 = 0x320f;
pub const PRODUCT_WIRED: u16 = 0x5055;
pub const PRODUCT_WIRELESS: u16 = 0x5088;
pub const USAGE_PAGE_VENDOR: u16 = 0xff1c;
pub const USAGE_PAGE_VIA: u16 = 0xff60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransportKind {
    Wired,
    Wireless24G,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceInfo {
    pub path: String,
    pub product_id: u16,
    pub transport: TransportKind,
    pub interface_number: i32,
    pub has_via: bool,
}

impl DeviceInfo {
    pub fn label(&self) -> String {
        match self.transport {
            TransportKind::Wired => "GMK87 (wired)".to_string(),
            TransportKind::Wireless24G => "GMK87 (2.4 GHz)".to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawHidDevice {
    pub path: String,
    pub vendor_id: u16,
    pub product_id: u16,
    pub usage_page: u16,
    pub interface_number: i32,
}

pub trait HidEnumerator {
    fn list(&self) -> Result<Vec<RawHidDevice>, DeviceError>;
}

/// Pure selection: one `DeviceInfo` per physical keyboard, from the raw list.
pub fn select_devices(raw: &[RawHidDevice]) -> Vec<DeviceInfo> {
    let is_gmk = |d: &RawHidDevice| {
        d.vendor_id == VENDOR_ID
            && (d.product_id == PRODUCT_WIRED || d.product_id == PRODUCT_WIRELESS)
    };

    let mut out = Vec::new();
    for keyboard_pid in [PRODUCT_WIRED, PRODUCT_WIRELESS] {
        let group: Vec<&RawHidDevice> = raw
            .iter()
            .filter(|d| is_gmk(d) && d.product_id == keyboard_pid)
            .collect();
        let Some(vendor) = group.iter().find(|d| d.usage_page == USAGE_PAGE_VENDOR) else {
            continue;
        };
        let has_via = group.iter().any(|d| d.usage_page == USAGE_PAGE_VIA);
        out.push(DeviceInfo {
            path: vendor.path.clone(),
            product_id: keyboard_pid,
            transport: if keyboard_pid == PRODUCT_WIRED {
                TransportKind::Wired
            } else {
                TransportKind::Wireless24G
            },
            interface_number: vendor.interface_number,
            has_via,
        });
    }
    out
}

pub struct SystemEnumerator;

impl HidEnumerator for SystemEnumerator {
    fn list(&self) -> Result<Vec<RawHidDevice>, DeviceError> {
        let api = hidapi::HidApi::new().map_err(|e| DeviceError::Hid(e.to_string()))?;
        Ok(api
            .device_list()
            .filter(|d| d.vendor_id() == VENDOR_ID)
            .map(|d| RawHidDevice {
                path: d.path().to_string_lossy().into_owned(),
                vendor_id: d.vendor_id(),
                product_id: d.product_id(),
                usage_page: d.usage_page(),
                interface_number: d.interface_number(),
            })
            .collect())
    }
}

/// Convenience wrapper used by the CLI and the app.
pub fn discover() -> Result<Vec<DeviceInfo>, DeviceError> {
    Ok(select_devices(&SystemEnumerator.list()?))
}
```

- [ ] **Step 5: Wire the module tree**

`crates/gmk87-device/src/lib.rs`:

```rust
//! Device discovery, transport and session state machine for the GMK87.

pub mod discovery;
pub mod error;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p gmk87-device --test discovery`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/gmk87-device
git commit -m "feat(device): discovery of wired and 2.4 GHz vendor interfaces"
```

---

### Task 8: Transport trait and hidapi implementation

**Files:**
- Create: `crates/gmk87-device/src/transport.rs`
- Modify: `crates/gmk87-device/src/lib.rs`

**Interfaces:**
- Consumes: `DeviceError`.
- Produces:
  - `pub trait Transport: Send { fn write_report(&mut self, report: &[u8]) -> Result<()>; fn read_report(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>>; fn drain(&mut self, window: Duration) -> Vec<Vec<u8>>; }`
  - `pub struct HidTransport` with `HidTransport::open(path: &str) -> Result<HidTransport>`

- [ ] **Step 1: Write the transport**

`crates/gmk87-device/src/transport.rs`:

```rust
//! Byte transport abstraction so the session can be tested without hardware.

use crate::error::{DeviceError, Result};
use std::time::{Duration, Instant};

pub trait Transport: Send {
    fn write_report(&mut self, report: &[u8]) -> Result<()>;
    /// Returns `Ok(None)` when the timeout elapses with no report.
    fn read_report(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>>;

    /// Reads and discards everything available within `window`.
    fn drain(&mut self, window: Duration) -> Vec<Vec<u8>> {
        let deadline = Instant::now() + window;
        let mut out = Vec::new();
        while Instant::now() < deadline {
            match self.read_report(Duration::from_millis(10)) {
                Ok(Some(report)) => out.push(report),
                Ok(None) => {}
                Err(_) => break,
            }
        }
        out
    }
}

pub struct HidTransport {
    device: hidapi::HidDevice,
}

impl HidTransport {
    pub fn open(path: &str) -> Result<Self> {
        let api = hidapi::HidApi::new().map_err(|e| DeviceError::Hid(e.to_string()))?;
        let device = api.open_path(std::ffi::OsStr::new(path)).map_err(|e| {
            let message = e.to_string();
            if message.to_lowercase().contains("permission") {
                DeviceError::PermissionDenied { path: path.to_string() }
            } else {
                DeviceError::Hid(message)
            }
        })?;
        device
            .set_blocking_mode(false)
            .map_err(|e| DeviceError::Hid(e.to_string()))?;
        Ok(Self { device })
    }
}

impl Transport for HidTransport {
    fn write_report(&mut self, report: &[u8]) -> Result<()> {
        self.device
            .write(report)
            .map_err(|e| DeviceError::Hid(e.to_string()))
    }

    fn read_report(&mut self, timeout: Duration) -> Result<Option<Vec<u8>>> {
        let mut buf = [0u8; 64];
        match self.device.read_timeout(&mut buf, timeout.as_millis() as i32) {
            Ok(0) => Ok(None),
            Ok(n) => Ok(Some(buf[..n].to_vec())),
            Err(e) => {
                let message = e.to_string();
                if message.to_lowercase().contains("timeout") {
                    Ok(None)
                } else {
                    Err(DeviceError::Hid(message))
                }
            }
        }
    }
}
```

- [ ] **Step 2: Add the module**

Append to `crates/gmk87-device/src/lib.rs`:

```rust
pub mod transport;
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `cargo clippy -p gmk87-device --all-targets -- -D warnings`
Expected: PASS, no warnings.

- [ ] **Step 4: Commit**

```bash
git add crates/gmk87-device
git commit -m "feat(device): Transport trait and hidapi implementation"
```

---

### ~~Task 9: Session configuration read and write~~ — superseded, do not implement

> **Superseded 2026-11-01.** Everything below that reads the device —
> `Session::read_config`, the `INIT → PREP_READ ×10 → COMMIT → READ_CFG ×13`
> handshake, and the tests that script it — is forbidden. `0x03` reset and
> re-enumerated the keyboard twice and `0x05` only echoes its payload. The
> implemented session has **no read path**: see spec §3.3/§3.3a and
> `docs/protocol.md` §5–§6. The `write_config` half (INIT → CONFIG → COMMIT) is
> real; Task 9's hardware-free steps still describe it. Hardware verification is
> deferred to `docs/hardware-testing.md`.

**Files:**
- Create: `crates/gmk87-device/src/session.rs`
- Create: `crates/gmk87-device/src/mock.rs`
- Modify: `crates/gmk87-device/src/lib.rs`
- Test: `crates/gmk87-device/tests/session_config.rs`

**Interfaces:**
- Consumes: `Transport`, `DeviceError`, `ProtocolError`, `gmk87_protocol::packet::{Packet, Command}`, `gmk87_protocol::config::DeviceConfig`.
- Produces:
  - `pub const COMMAND_TIMEOUT: Duration` (1500 ms), `pub const WRITE_SETTLE: Duration` (100 ms)
  - `pub struct Session<T: Transport>`
  - `Session::new(transport: T) -> Session<T>`
  - `Session::read_config(&mut self) -> Result<DeviceConfig>`
  - `Session::write_config(&mut self, config: &DeviceConfig) -> Result<()>`
  - In `mock.rs`: `pub struct MockTransport` with `MockTransport::new()`, `.expect(command: Command, response_payloads: Vec<Vec<u8>>)`, `.fail_next_write()`, `.push_unsolicited(report: Vec<u8>)`, `.writes() -> Vec<Vec<u8>>`

- [ ] **Step 1: Write the mock transport**

`crates/gmk87-device/src/mock.rs`:

```rust
//! Scripted transport for tests.

use crate::error::{DeviceError, Result};
use crate::transport::Transport;
use gmk87_protocol::packet::Command;
use std::collections::VecDeque;
use std::time::Duration;

#[derive(Default)]
pub struct MockTransport {
    responses: VecDeque<Vec<u8>>,
    writes: Vec<Vec<u8>>,
    fail_writes: usize,
    unsolicited: VecDeque<Vec<u8>>,
}

impl MockTransport {
    pub fn new() -> Self {
        Self::default()
    }

    /// Queues one response report for each call to `command`.
    pub fn expect(&mut self, command: Command, payloads: Vec<Vec<u8>>) -> &mut Self {
        for payload in payloads {
            let packet = gmk87_protocol::packet::Packet::new(command, 0, &payload)
                .expect("mock payload fits");
            self.responses.push_back(packet.encode().to_vec());
        }
        self
    }

    pub fn push_unsolicited(&mut self, report: Vec<u8>) -> &mut Self {
        self.unsolicited.push_back(report);
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

    fn read_report(&mut self, _timeout: Duration) -> Result<Option<Vec<u8>>> {
        if let Some(report) = self.unsolicited.pop_front() {
            return Ok(Some(report));
        }
        Ok(self.responses.pop_front())
    }
}
```

- [ ] **Step 2: Write the failing tests**

> **Superseded:** the `read_config` tests below must not be implemented. They
> send `PREP_READ (0x03)` and `READ_CFG (0x05)`. The current suite instead
> asserts that no code path emits either command.

`crates/gmk87-device/tests/session_config.rs`:

```rust
use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::Session;
use gmk87_protocol::packet::Command;

fn config_payloads() -> Vec<Vec<u8>> {
    let raw = vec![0xABu8; 48];
    // The device returns the config spread across 13 read responses; the
    // session concatenates whatever arrives.
    let mut chunks = Vec::new();
    let mut rest = raw.as_slice();
    while !rest.is_empty() {
        let take = rest.len().min(4);
        chunks.push(rest[..take].to_vec());
        rest = &rest[take..];
    }
    chunks
}

#[test]
fn reads_the_configuration_from_the_device() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::PrepRead, vec![vec![]; 10]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::ReadConfig, config_payloads());

    let mut session = Session::new(mock);
    let config = session.read_config().unwrap();
    assert_eq!(config.as_bytes(), &[0xABu8; 48]);
}

#[test]
fn errors_when_a_read_times_out() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    // No PrepRead responses queued: the handshake stalls.
    let mut session = Session::new(mock);
    assert!(matches!(
        session.read_config(),
        Err(DeviceError::ProtocolTimeout { .. })
    ));
}

#[test]
fn writes_the_configuration_in_three_steps() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let config = gmk87_protocol::config::DeviceConfig::from_bytes(&[0x11u8; 48]).unwrap();
    let mut session = Session::new(mock);
    session.write_config(&config).unwrap();

    assert_eq!(
        session.transport().commands_sent(),
        vec![0x01, 0x06, 0x02]
    );
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p gmk87-device --test session_config`
Expected: FAIL — `gmk87_device::session` does not exist.

- [ ] **Step 4: Implement the session handshake**

> **Superseded:** the `read_config` implementation below must not be written.
> Keep only `write_config` and `send_and_wait` (without `Packet::decode` on a
> short acknowledgement). See the current `crates/gmk87-device/src/session.rs`
> and `docs/protocol.md` §4.

`crates/gmk87-device/src/session.rs`:

```rust
//! The device state machine: handshake, configuration and upload streaming.

use crate::error::{DeviceError, Result};
use crate::transport::Transport;
use gmk87_protocol::config::{DeviceConfig, CONFIG_LEN};
use gmk87_protocol::packet::{Command, Packet};
use std::time::{Duration, Instant};

pub const COMMAND_TIMEOUT: Duration = Duration::from_millis(1500);
pub const WRITE_SETTLE: Duration = Duration::from_millis(100);
const PREP_READ_COUNT: usize = 10;
const READ_CONFIG_COUNT: usize = 13;

pub struct Session<T: Transport> {
    transport: T,
    synced: bool,
}

impl<T: Transport> Session<T> {
    pub fn new(transport: T) -> Self {
        Self { transport, synced: false }
    }

    pub fn transport(&self) -> &T {
        &self.transport
    }

    pub fn is_synced(&self) -> bool {
        self.synced
    }

    /// INIT → PREP_READ ×10 → COMMIT → READ_CFG ×13, concatenated.
    pub fn read_config(&mut self) -> Result<DeviceConfig> {
        self.send_and_wait(Command::Init, 0, &[])?;
        for _ in 0..PREP_READ_COUNT {
            self.send_and_wait(Command::PrepRead, 0, &[])?;
        }
        self.send_and_wait(Command::Commit, 0, &[])?;

        let mut raw = Vec::with_capacity(CONFIG_LEN);
        for _ in 0..READ_CONFIG_COUNT {
            if raw.len() >= CONFIG_LEN {
                break;
            }
            let payload = self.send_and_wait(Command::ReadConfig, 0, &[])?;
            raw.extend_from_slice(&payload);
        }
        let config = DeviceConfig::from_bytes(&raw)?;
        self.synced = true;
        Ok(config)
    }

    /// INIT → CONFIG → COMMIT.
    pub fn write_config(&mut self, config: &DeviceConfig) -> Result<()> {
        let bytes = config.as_bytes();
        if bytes.len() != CONFIG_LEN {
            return Err(DeviceError::InvalidJob(format!(
                "config must be {CONFIG_LEN} bytes, got {}",
                bytes.len()
            )));
        }
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, bytes)?;
        // A failed commit leaves the device state unknown.
        self.send_and_wait(Command::Commit, 0, &[]).map_err(|error| {
            self.synced = false;
            match error {
                DeviceError::ProtocolTimeout { .. } => DeviceError::DeviceDesynced,
                other => other,
            }
        })?;
        self.synced = true;
        Ok(())
    }

    /// Writes one packet and waits for a report whose command byte matches.
    /// Public so tests and the CLI can drive individual commands.
    pub fn send_and_wait(
        &mut self,
        command: Command,
        position: u32,
        payload: &[u8],
    ) -> Result<Vec<u8>> {
        let packet = Packet::new(command, position, payload)?;
        self.transport.write_report(&packet.encode())?;

        let deadline = Instant::now() + COMMAND_TIMEOUT;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match self.transport.read_report(remaining.min(Duration::from_millis(100)))? {
                Some(report) if report.len() >= 8 && report[3] == command.as_u8() => {
                    let decoded = Packet::decode(&report)?;
                    return Ok(decoded.payload);
                }
                // Wrong command or short report: discard and keep reading.
                _ => continue,
            }
        }
        Err(DeviceError::ProtocolTimeout { cmd: command.as_u8() })
    }
}
```

- [ ] **Step 5: Add the modules**

Append to `crates/gmk87-device/src/lib.rs`:

```rust
pub mod mock;
pub mod session;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p gmk87-device --test session_config`
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/gmk87-device
git commit -m "feat(device): session config read/write handshake with mock transport"
```

---

### ~~Task 10: Display upload, progress, cancellation and restore~~ — read path superseded

> **Superseded 2026-11-01.** The upload shape is real, but every `read_config`
> call below (and the `uploads_one_slot_with_read_modify_write_config` test) is
> forbidden. The implementation starts from the session's local configuration
> (seeded from a snapshot), never reads the device, and patches a **local**
> copy that is published only after the handshake `COMMIT` succeeds. The repair
> path restores the complete pre-upload block and falls back to the clock if the
> shown slot was torn. See `docs/protocol.md` §11 and spec §3.3.

**Files:**
- Modify: `crates/gmk87-device/src/session.rs`
- Test: `crates/gmk87-device/tests/session_upload.rs`

**Interfaces:**
- Consumes: everything from Tasks 6 and 9.
- Produces:
  - `pub struct CancelToken` with `CancelToken::new()`, `.cancel()`, `.is_cancelled() -> bool`
  - `pub struct UploadProgress { pub bytes_sent: usize, pub total_bytes: usize }`
  - `Session::upload(&mut self, plan: &FramePlan, cancel: &CancelToken, progress: &mut dyn FnMut(UploadProgress)) -> Result<()>`
  - `Session::sync_clock(&mut self, now: &chrono::DateTime<chrono::Local>) -> Result<()>`
  - `Session::set_lighting(&mut self, edit: &dyn Fn(&mut DeviceConfig)) -> Result<()>`

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-device/tests/session_upload.rs`:

```rust
use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::{CancelToken, Session, UploadProgress};
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::FramePlan;
use gmk87_protocol::packet::Command;

fn one_frame_plan() -> FramePlan {
    FramePlan {
        slot0_frames: vec![vec![0u8; (240 * 135 * 3) as usize]],
        slot1_frames: vec![],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    }
}

fn frame_data_responses() -> Vec<Vec<u8>> {
    // 65536 bytes / 56 per packet = 1171 packets.
    vec![vec![]; 1171]
}

#[test]
fn uploads_one_slot_with_read_modify_write_config() {  // SUPERSEDED: no read path exists; the config is local state
    let mut mock = MockTransport::new();
    // read_config handshake — FORBIDDEN: sends PREP_READ (0x03) and READ_CFG (0x05)
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::PrepRead, vec![vec![]; 10]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::ReadConfig, vec![vec![0u8; 4]; 13]);
    // upload handshake
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.push_unsolicited(
        gmk87_protocol::packet::Packet::new(Command::Ready, 0, &[])
            .unwrap()
            .encode()
            .to_vec(),
    );
    mock.expect(Command::FrameData, frame_data_responses());
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    let cancel = CancelToken::new();
    let mut last = UploadProgress { bytes_sent: 0, total_bytes: 0 };
    session
        .upload(&one_frame_plan(), &cancel, &mut |p| last = p)
        .unwrap();

    assert_eq!(last.total_bytes, 65536);
    assert_eq!(last.bytes_sent, 65536);
    let commands = session.transport().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "ends with COMMIT");
}

#[test]
fn cancellation_stops_streaming_and_repairs_the_display() {
    let mut mock = MockTransport::new();
    // read_config handshake — FORBIDDEN: no code path may send PREP_READ/READ_CFG
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::PrepRead, vec![vec![]; 10]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::ReadConfig, vec![vec![0u8; 4]; 12]);
    // upload handshake
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.push_unsolicited(
        gmk87_protocol::packet::Packet::new(Command::Ready, 0, &[])
            .unwrap()
            .encode()
            .to_vec(),
    );
    // repair write_config (Init, Config, Commit) — reached before any frames stream
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);

    let mut session = Session::new(mock);
    let cancel = CancelToken::new();
    cancel.cancel();
    let result = session.upload(&one_frame_plan(), &cancel, &mut |_| {});

    assert!(matches!(result, Err(DeviceError::InvalidJob(_))));
    let commands = session.transport().commands_sent();
    assert_eq!(commands.last(), Some(&0x02), "repair COMMIT was sent");
    assert!(
        !commands.contains(&0x21),
        "no frame data was streamed after cancellation"
    );
    assert!(!session.is_synced());
}

#[test]
fn a_frame_budget_violation_never_touches_the_device() {
    let plan = FramePlan {
        slot0_frames: vec![vec![0u8; (240 * 135 * 3) as usize]; 40],
        slot1_frames: vec![],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };
    let mut session = Session::new(MockTransport::new());
    let cancel = CancelToken::new();
    let err = session.upload(&plan, &cancel, &mut |_| {}).unwrap_err();
    assert!(matches!(err, DeviceError::Protocol(gmk87_protocol::error::ProtocolError::FrameBudget { .. })));
    assert!(session.transport().writes().is_empty(), "no USB traffic");
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p gmk87-device --test session_upload`
Expected: FAIL — `CancelToken` and `Session::upload` do not exist.

- [ ] **Step 3: Implement upload, cancel and the config-editing helpers**

Append to `crates/gmk87-device/src/session.rs` (add `use gmk87_protocol::frames::FramePlan;` and `use std::sync::atomic::{AtomicBool, Ordering}; use std::sync::Arc;` at the top):

```rust
/// Cooperative cancellation flag, cheap to clone.
#[derive(Clone, Default)]
pub struct CancelToken {
    flag: Arc<AtomicBool>,
}

impl CancelToken {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn cancel(&self) {
        self.flag.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UploadProgress {
    pub bytes_sent: usize,
    pub total_bytes: usize,
}

impl<T: Transport> Session<T> {
    /// Reads, applies `edit`, and writes back — never touching unknown bytes.
    /// SUPERSEDED: there is no read path. The implemented version edits the
    /// session's local configuration and writes the whole block.
    pub fn set_lighting(&mut self, edit: &dyn Fn(&mut DeviceConfig)) -> Result<()> {
        let mut config = self.read_config()?;  // FORBIDDEN (0x03/0x05)
        edit(&mut config);
        self.write_config(&config)
    }

    /// Sets the keyboard clock, preserving every other setting.
    pub fn sync_clock(&mut self, now: &chrono::DateTime<chrono::Local>) -> Result<()> {
        use chrono::{Datelike, Timelike};
        let weekday = now.weekday().num_days_from_sunday() as u8;
        let (year, month, day) = (now.year(), now.month() as u8, now.day() as u8);
        let (hour, minute, second) = (now.hour() as u8, now.minute() as u8, now.second() as u8);
        self.set_lighting(&|config: &mut DeviceConfig| {
            let _ = config.set_time(year as u16, month, day, weekday, hour, minute, second);
        })
    }

    /// Full upload: validate, patch config, stream frames, commit.
    pub fn upload(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<()> {
        plan.validate()?;

        let previous = self.read_config()?;  // FORBIDDEN: read-modify-write is impossible

        let mut config = previous.clone();
        config.set_slot0_frames(plan.slot0_frames.len().min(u8::MAX as usize) as u8);
        config.set_slot1_frames(plan.slot1_frames.len().min(u8::MAX as usize) as u8);
        config.set_frame_delay_ms(plan.delay_ms);
        config.set_show_image(plan.show);

        let memory = plan.to_memory()?;
        let total_bytes = memory.len();

        // INIT ×2 → CONFIG → COMMIT → READY
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Init, 0, &[])?;
        self.send_and_wait(Command::Config, 0, config.as_bytes())?;
        std::thread::sleep(WRITE_SETTLE);
        self.send_and_wait(Command::Commit, 0, &[])?;
        self.wait_for_ready()?;

        let mut position = 0usize;
        while position < total_bytes {
            if cancel.is_cancelled() || !self.synced {
                // Best-effort: point the display back at the clock so a torn
                // frame is never shown. Failure here does not mask the cancel.
                let _ = self.repair_display(&previous);
                self.synced = false;
                return Err(DeviceError::InvalidJob("upload cancelled".into()));
            }
            let end = (position + gmk87_protocol::packet::MAX_PAYLOAD).min(total_bytes);
            self.send_and_wait(Command::FrameData, position as u32, &memory[position..end])?;
            position = end;
            progress(UploadProgress { bytes_sent: position, total_bytes });
        }

        self.send_and_wait(Command::Commit, 0, &[])?;
        Ok(())
    }

    fn wait_for_ready(&mut self) -> Result<()> {
        let deadline = Instant::now() + COMMAND_TIMEOUT;
        while Instant::now() < deadline {
            match self.transport.read_report(Duration::from_millis(100))? {
                Some(report) if report.len() >= 4 && report[3] == Command::Ready.as_u8() => {
                    return Ok(());
                }
                _ => continue,
            }
        }
        Err(DeviceError::ProtocolTimeout { cmd: Command::Ready.as_u8() })
    }

    /// After a failed or cancelled upload, point the display back at a known slot.
    fn repair_display(&mut self, previous: &DeviceConfig) -> Result<()> {
        let mut safe = previous.clone();
        safe.set_show_image(gmk87_protocol::config::ShowSlot::Clock);
        let _ = self.write_config(&safe);
        Ok(())
    }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p gmk87-device --test session_upload`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/gmk87-device
git commit -m "feat(device): display upload with progress, cancel and display repair"
```

---

### Task 11: Retry rules under injected faults

**Files:**
- Modify: `crates/gmk87-device/src/session.rs` (only if a rule is missing)
- Test: `crates/gmk87-device/tests/retry_rules.rs`

**Interfaces:**
- Consumes: `MockTransport`, `Session`, `CancelToken`.
- Produces: no new API; this task pins the §7 recovery rules.

- [ ] **Step 1: Write the failing tests**

`crates/gmk87-device/tests/retry_rules.rs`:

```rust
use gmk87_device::error::DeviceError;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::Session;
use gmk87_protocol::config::DeviceConfig;
use gmk87_protocol::packet::{Command, Packet};

fn wrong_command_report(command: Command) -> Vec<u8> {
    Packet::new(command, 0, &[]).unwrap().encode().to_vec()
}

#[test]
fn discards_responses_for_other_commands() {
    let mut mock = MockTransport::new();
    // Noise for FrameData arrives before the Init ack.
    mock.push_unsolicited(wrong_command_report(Command::FrameData));
    mock.push_unsolicited(wrong_command_report(Command::Ready));
    mock.expect(Command::Init, vec![vec![0xAA]]);

    let mut session = Session::new(mock);
    let payload = session.send_and_wait(Command::Init, 0, &[]).unwrap();
    assert_eq!(payload, vec![0xAA]);
}

#[test]
fn a_failed_commit_marks_the_device_desynced() {
    let mut mock = MockTransport::new();
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    // No Commit response queued — the write hangs and times out.

    let config = DeviceConfig::from_bytes(&[0u8; 48]).unwrap();
    let mut session = Session::new(mock);
    let err = session.write_config(&config).unwrap_err();

    assert!(matches!(err, DeviceError::DeviceDesynced));
    assert!(!session.is_synced());
}

#[test]
fn a_write_error_propagates_without_retry() {
    let mut mock = MockTransport::new();
    mock.fail_next_write();

    let mut session = Session::new(mock);
    let err = session.send_and_wait(Command::Init, 0, &[]).unwrap_err();
    assert!(matches!(err, DeviceError::Hid(_)));
    assert_eq!(session.transport().writes().len(), 0, "nothing recorded");
}
```

- [ ] **Step 2: Run the tests to verify they fail or pass**

Run: `cargo test -p gmk87-device --test retry_rules`
Expected: if Task 9/10 are correct, `discards_responses_for_other_commands` and `a_write_error_propagates_without_retry` PASS; `a_failed_commit_marks_the_device_desynced` must PASS via the `map_err` in `write_config`. Any failure here is a real rule violation — fix `session.rs`, do not weaken the test.

- [ ] **Step 3: Commit**

```bash
git add crates/gmk87-device
git commit -m "test(device): pin response-discard and desync recovery rules"
```

---

### Task 12: CLI probe and config dump

**Files:**
- Create: `crates/gmk87-cli/src/main.rs` (replace the stub)
- Create: `crates/gmk87-cli/src/commands/mod.rs`
- Create: `crates/gmk87-cli/src/commands/probe.rs`
- Create: `crates/gmk87-cli/src/commands/config.rs`

**Interfaces:**
- Consumes: `gmk87_device::discovery::{discover, DeviceInfo, SystemEnumerator, select_devices}`, `gmk87_device::transport::HidTransport`, `gmk87_device::session::Session`.
- Produces: a binary `gmk87-cli` with subcommands `probe` and `dump-config`.

- [ ] **Step 1: Write the CLI entry point**

`crates/gmk87-cli/src/main.rs`:

```rust
mod commands;

use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "gmk87-cli", about = "GMK87 protocol debug and recovery tool")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// List detected GMK87 interfaces.
    Probe,
    /// Print the device's current configuration.
    DumpConfig,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();
    match Cli::parse().command {
        Command::Probe => commands::probe::run(),
        Command::DumpConfig => commands::config::run(),
    }
}
```

- [ ] **Step 2: Write the command modules**

`crates/gmk87-cli/src/commands/mod.rs`:

```rust
pub mod config;
pub mod probe;

use anyhow::{bail, Context};
use gmk87_device::discovery::discover;
use gmk87_device::session::Session;
use gmk87_device::transport::HidTransport;

/// Opens the first detected keyboard.
pub fn open_session() -> anyhow::Result<Session<HidTransport>> {
    let devices = discover().context("enumerating HID devices")?;
    let Some(device) = devices.first() else {
        bail!("no GMK87 found — is it plugged in?");
    };
    let transport = HidTransport::open(&device.path)?;
    Ok(Session::new(transport))
}
```

`crates/gmk87-cli/src/commands/probe.rs`:

```rust
use gmk87_device::discovery::discover;

pub fn run() -> anyhow::Result<()> {
    let devices = discover()?;
    if devices.is_empty() {
        println!("No GMK87 found.");
        return Ok(());
    }
    for device in devices {
        println!(
            "{}  path={}  pid=0x{:04x}  via={}",
            device.label(),
            device.path,
            device.product_id,
            device.has_via
        );
    }
    Ok(())
}
```

`crates/gmk87-cli/src/commands/config.rs`:

> **Superseded:** `read_config` does not exist and `dump-config` is now
> `show-config`, which prints the snapshot and performs no device I/O. Do not
> implement the read below.

```rust
use super::open_session;

pub fn run() -> anyhow::Result<()> {
    let mut session = open_session()?;
    let config = session.read_config()?;  // FORBIDDEN: no read path
    let bytes = config.as_bytes();
    println!("raw: {}", bytes.iter().map(|b| format!("{b:02x}")).collect::<String>());
    println!("underglow  effect={} brightness={} speed={} color={:?}",
        config.underglow_effect(), config.underglow_brightness(),
        config.underglow_speed(), config.underglow_color());
    println!("led        mode={} saturation={} color={}",
        config.led_mode(), config.led_saturation(), config.led_color());
    println!("display    show={:?} slot0_frames={} slot1_frames={} delay_ms={}",
        config.show_image(), config.slot0_frames(), config.slot1_frames(),
        config.frame_delay_ms());
    println!("clock      {:?}", config.time());
    Ok(())
}
```

- [ ] **Step 3: Verify it builds and lints**

Run: `cargo clippy -p gmk87-cli --all-targets -- -D warnings`
Expected: PASS, no warnings.

- [ ] **Step 4: Verify without hardware (hardware verification deferred)**

Do **not** run `probe` or `dump-config` against a keyboard as part of this plan.
There is no `dump-config` any more: the device cannot be read, so `show-config`
prints the saved snapshot and performs no device I/O. Run the hardware-free
checks instead:

```bash
cargo test --all
cargo clippy --all-targets -- -D warnings
```

If and only if a human explicitly re-authorises hardware work, use the
foreground procedure in [`hardware-testing.md`](../../hardware-testing.md) —
never a detached process, never `setsid`/`nohup`/`&`, and never `0x03`/`0x05`.

- [ ] **Step 5: Commit**

```bash
git add crates/gmk87-cli
git commit -m "feat(cli): probe and dump-config commands"
```

---

### Task 13: CLI upload, lights and clock

**Files:**
- Modify: `crates/gmk87-cli/src/main.rs`
- Create: `crates/gmk87-cli/src/commands/upload.rs`
- Create: `crates/gmk87-cli/src/commands/lights.rs`
- Create: `crates/gmk87-cli/src/commands/clock.rs`
- Modify: `crates/gmk87-cli/src/commands/mod.rs`

**Interfaces:**
- Consumes: `prepare_static`, `extract_gif_frames`, `FramePlan`, `Fit`, `CropSpec`, `CancelToken`, `Session::{upload, set_lighting, sync_clock}`.
- Produces: subcommands `upload <file> --slot <0|1> --show`, `lights`, `clock`.

- [ ] **Step 1: Add the upload command**

`crates/gmk87-cli/src/commands/upload.rs`:

```rust
use super::open_session;
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::{extract_gif_frames, FramePlan, MAX_TOTAL_FRAMES, MIN_FRAME_DELAY_MS};
use gmk87_protocol::image::{prepare_static, CropSpec};
use gmk87_device::session::CancelToken;
use std::path::Path;

pub fn run(path: &Path, slot: u8, show: bool) -> anyhow::Result<()> {
    let bytes = std::fs::read(path)?;
    let crop = CropSpec::default();

    let (frames, delay_ms) = if bytes.starts_with(b"GIF8") {
        let (frames, source_delay) = extract_gif_frames(&bytes, &crop, MAX_TOTAL_FRAMES)?;
        (frames, source_delay.max(MIN_FRAME_DELAY_MS))
    } else {
        (vec![prepare_static(&bytes, &crop)?], MIN_FRAME_DELAY_MS)
    };

    let plan = if slot == 0 {
        FramePlan { slot0_frames: frames, slot1_frames: vec![], delay_ms, show: pick(show, ShowSlot::Slot0) }
    } else {
        FramePlan { slot0_frames: vec![], slot1_frames: frames, delay_ms, show: pick(show, ShowSlot::Slot1) }
    };

    let mut session = open_session()?;
    let cancel = CancelToken::new();
    println!("Uploading {} frame(s)...", plan.slot0_frames.len() + plan.slot1_frames.len());
    session.upload(&plan, &cancel, &mut |p| {
        if p.bytes_sent % (65536 / 4) < 56 {
            println!("  {}%", p.bytes_sent * 100 / p.total_bytes.max(1));
        }
    })?;
    println!("Done.");
    Ok(())
}

fn pick(show: bool, slot: ShowSlot) -> ShowSlot {
    if show { slot } else { ShowSlot::Clock }
}
```

- [ ] **Step 2: Add the lights and clock commands**

`crates/gmk87-cli/src/commands/lights.rs`:

```rust
use super::open_session;
use gmk87_protocol::config::DeviceConfig;

#[allow(clippy::too_many_arguments)]
pub fn run(
    effect: Option<u8>,
    brightness: Option<u8>,
    speed: Option<u8>,
    rgb: Option<(u8, u8, u8)>,
    led_mode: Option<u8>,
    led_color: Option<u8>,
) -> anyhow::Result<()> {
    let mut session = open_session()?;
    session.set_lighting(&|config: &mut DeviceConfig| {
        if let Some(v) = effect { config.set_underglow_effect(v); }
        if let Some(v) = brightness { config.set_underglow_brightness(v); }
        if let Some(v) = speed { config.set_underglow_speed(v); }
        if let Some((r, g, b)) = rgb { config.set_underglow_color(r, g, b); }
        if let Some(v) = led_mode { config.set_led_mode(v); }
        if let Some(v) = led_color { config.set_led_color(v); }
    })?;
    println!("Lighting updated.");
    Ok(())
}
```

`crates/gmk87-cli/src/commands/clock.rs`:

```rust
use super::open_session;

pub fn run() -> anyhow::Result<()> {
    let mut session = open_session()?;
    session.sync_clock(&chrono::Local::now())?;
    println!("Clock synced to {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"));
    Ok(())
}
```

- [ ] **Step 3: Wire the subcommands**

Replace the `Command` enum and dispatch in `crates/gmk87-cli/src/main.rs` with:

```rust
#[derive(Subcommand)]
enum Command {
    /// List detected GMK87 interfaces.
    Probe,
    /// Print the device's current configuration.
    DumpConfig,
    /// Upload an image or GIF to a display slot.
    Upload {
        file: std::path::PathBuf,
        /// Display slot: 0 or 1.
        #[arg(long, default_value_t = 0)]
        slot: u8,
        /// Switch the display to this slot after uploading.
        #[arg(long)]
        show: bool,
    },
    /// Change underglow and LED settings.
    Lights {
        #[arg(long)] effect: Option<u8>,
        #[arg(long)] brightness: Option<u8>,
        #[arg(long)] speed: Option<u8>,
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=9))] led_mode: Option<u8>,
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=8))] led_color: Option<u8>,
        #[arg(long, value_delimiter = ',')] rgb: Option<Vec<u8>>,
    },
    /// Sync the keyboard clock to system time.
    Clock,
}

fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::new("info"))
        .init();
    match Cli::parse().command {
        Command::Probe => commands::probe::run(),
        Command::DumpConfig => commands::config::run(),
        Command::Upload { file, slot, show } => {
            anyhow::ensure!(slot <= 1, "--slot must be 0 or 1");
            commands::upload::run(&file, slot, show)
        }
        Command::Lights { effect, brightness, speed, led_mode, led_color, rgb } => {
            let rgb = match rgb {
                Some(values) => {
                    anyhow::ensure!(values.len() == 3, "--rgb needs exactly three values");
                    Some((values[0], values[1], values[2]))
                }
                None => None,
            };
            commands::lights::run(effect, brightness, speed, rgb, led_mode, led_color)
        }
        Command::Clock => commands::clock::run(),
    }
}
```

Add to `crates/gmk87-cli/src/commands/mod.rs`:

```rust
pub mod clock;
pub mod lights;
pub mod upload;
```

- [ ] **Step 4: Verify build and lint**

Run: `cargo clippy --all-targets -- -D warnings`
Expected: PASS.

- [ ] **Step 5: Verify without hardware (hardware verification deferred)**

Do **not** run the M0 spike. It was attempted and then deferred; the incident
and the safety rules are in [`hardware-testing.md`](../../hardware-testing.md).
No upload may be launched as part of this plan, and there is no `dump-config`
command (the device cannot be read; `show-config` prints the snapshot).

Run only:

```bash
cargo test --all
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
```

A future authorised run must use the results table in
`docs/hardware-testing.md` §5, in the foreground, one command at a time. Any
"read-modify-write path is proven" claim from the original spike is void: there
is no read path.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-cli
git commit -m "feat(cli): upload, lights and clock commands"
```

---

### Task 14: Protocol and hardware-testing documentation

**Files:**
- Create: `docs/protocol.md`
- Create: `docs/hardware-testing.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: documentation only.

- [ ] **Step 1: Write `docs/protocol.md`**

Document, with the exact tables from the spec §3: the four HID interfaces and their usage pages, the 64-byte report layout, the checksum rule, the command list, the full 48-byte config map (every offset used in Task 3, including which are undocumented and must be preserved), the display geometry and slot padding, the upload sequence (`INIT ×2 → CONFIG → COMMIT → READY → FRAME_DATA ×N → COMMIT`), the animation budget, and the BCD clock encoding. Add the attribution block from `NOTICE`.

- [ ] **Step 2: Write `docs/hardware-testing.md`**

Include the udev install steps, the `GMK87_HW=1` convention for opt-in tests, and the Task 13 Step 5 checklist as a results table with columns: step, expected, observed, date, transport (wired/2.4 GHz). Pre-fill the `observed` cells from the M0 run. Add a section for the unresolved risks from the spec §12 (per-slot frame limits, 2.4 GHz timing, `show_image` persistence across a power cycle) with a line each to record findings.

- [ ] **Step 3: Expand `README.md`**

Add: what the tool does, supported hardware, the crate layout, `cargo build --release`, the CLI usage examples from Task 13, the udev rule instructions, and a note that the Tauri desktop app is a follow-on plan.

- [ ] **Step 4: Commit**

```bash
git add docs README.md
git commit -m "docs: protocol reference and hardware test checklist"
```

---

## Follow-on plans (not part of this plan)

- **Plan 2 — Tauri app and UI:** `src-tauri` commands and events, the Device/Display/Lighting/Clock screens, the crop/zoom canvas, upload progress and cancel. Implements spec milestones M3–M6 against the `gmk87-device` API defined here.
- **Plan 3 — Packaging:** `.deb` and AppImage, udev rule installation, icons, clean-machine smoke test (M7).
- **Plan 4 — v2:** display system monitor and the `systemd --user` service (M8).
