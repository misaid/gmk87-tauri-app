# GMK87 Tauri App + UI Implementation Plan (Plan 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GMK87 desktop configurator — a Tauri v2 shell over a new `gmk87-app` orchestration crate, with React/shadcn screens for the device, display editor, lighting (named effects + presets) and clock, plus a 3D keyboard preview.

**Architecture:** A new `crates/gmk87-app` owns session state, slots, jobs and presets and is tested against `MockTransport`. `src-tauri` is a thin command/event adapter over it. `ui/` is React + Tailwind + shadcn/ui with React Three Fiber for the keyboard preview. The UI never touches pixels; it sends crop/zoom parameters and receives Rust-rendered previews.

**Tech Stack:** Rust (2021, stable) — Tauri v2, serde, thiserror, chrono; React + TypeScript + Vite, Tailwind v4, shadcn/ui, zustand, @react-three/fiber, Vitest + React Testing Library; bun as the package manager.

**Spec:** `docs/superpowers/specs/2026-11-01-gmk87-configurator-design.md`

## Global Constraints

- Rust stable, edition 2021. `cargo fmt --all --check` and `cargo clippy --all-targets -- -D warnings` must pass.
- Never send `PREP_READ (0x03)` or `READ_CFG (0x05)`. The device is write-only (spec §3.3); reading resets it.
- Device identity: vendor `0x320f`, PIDs `0x5055` (wired) and `0x5088` (2.4 GHz). Vendor channel usage page `0xff1c`; VIA `0xff60` is detected, never driven.
- Report ID `0x04`, report length 64 bytes. Config block is 48 bytes, written `INIT → CONFIG → COMMIT` from local state.
- Display 240×135 RGB565 **big-endian**; each slot padded to 65,536 bytes; upload session **overwrites all image memory**, so both slots are always streamed.
- Animation budget: at most 36 frames total across both slots; minimum frame delay 60 ms. `show_image`: `0` = clock, `1` = slot 0, `2` = slot 1.
- Named effects, LED modes/colours and the eight presets are exactly as in spec §3.5 and are ported from the MIT reference `codedgar/gmk87-node`.
- Frontend: Tailwind + shadcn/ui only (no daisyUI), React Three Fiber for the preview, bun for installs and scripts.
- Hardware is never touched by automated tests; hardware testing stays opt-in.

## Review Focus

1. **Uploading one slot must not blank the other.** The upload session overwrites all image memory; a single-slot upload that streams only that slot leaves the other with stale/blank content. The expected behaviour is that the app always streams both slots, keeping the untouched slot's last-known frames.
2. **Combined frame budget.** A GIF for the target slot whose frames plus the other slot's frames exceed 36 must fail before any USB traffic, with both numbers in the message.
3. **Preview of hostile input during editing.** A corrupt, truncated, non-image, or unsupported file passed to the preview must return an error the UI can show, never a panic or a frozen window; a GIF preview shows its first frame.
4. **Cancel mid-upload.** Cancelling must stop the stream, send the repair (`COMMIT` + rewrite the previous block) and report "display repair attempted", never "display left unchanged".
5. **Permission denied.** An unreadable `/dev/hidraw*` must surface as an error whose `kind` is `permission_denied` and whose message names the udev rule, so the UI can offer the rule and copy the `udevadm` commands.

---

### Task 1: `gmk87-app` crate — error DTO, snapshot and state

**Files:**
- Modify: `Cargo.toml` (workspace members)
- Create: `crates/gmk87-app/Cargo.toml`
- Create: `crates/gmk87-app/src/lib.rs`
- Create: `crates/gmk87-app/src/error.rs`
- Create: `crates/gmk87-app/src/state.rs`
- Create: `crates/gmk87-app/src/snapshot.rs`
- Test: `crates/gmk87-app/tests/error.rs`
- Test: `crates/gmk87-app/tests/snapshot.rs`
- Test: `crates/gmk87-app/tests/state.rs`

**Interfaces:**
- Consumes: `gmk87_device::error::DeviceError`, `gmk87_protocol::config::DeviceConfig`.
- Produces:
  - `gmk87_app::error::{AppError, ErrorKind}`; `AppError { kind: ErrorKind, message: String }` implements `serde::Serialize` and `From<DeviceError>`; `ErrorKind` covers every `DeviceError` variant plus `Io`.
  - `gmk87_app::snapshot::{default_path, load, save}` — `default_path() -> Option<PathBuf>`, `load(&Path) -> Option<DeviceConfig>`, `save(&Path, &DeviceConfig) -> io::Result<()>`.
  - `gmk87_app::state::{DeviceStateDto, UnderglowState, LedState}`; `DeviceStateDto::from_config(&DeviceConfig, connected: bool, synced: bool) -> DeviceStateDto`.

- [ ] **Step 1: Add the crate to the workspace**

Edit the root `Cargo.toml` `members` list to:

```toml
members = [
    "crates/gmk87-protocol",
    "crates/gmk87-device",
    "crates/gmk87-app",
    "crates/gmk87-cli",
]
```

Create `crates/gmk87-app/Cargo.toml`:

```toml
[package]
name = "gmk87-app"
version.workspace = true
edition.workspace = true
license.workspace = true

[dependencies]
gmk87-device = { path = "../gmk87-device" }
gmk87-protocol = { path = "../gmk87-protocol" }
thiserror.workspace = true
tracing.workspace = true
chrono = "0.4"
image = "0.25"
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
tempfile = "3"
```

Create `crates/gmk87-app/src/lib.rs`:

```rust
//! Application orchestration for the GMK87: session ownership, jobs and presets.
//!
//! Tauri-independent so it can be tested against `MockTransport`.

pub mod error;
pub mod snapshot;
pub mod state;
```

- [ ] **Step 2: Write the failing error-mapping test**

`crates/gmk87-app/tests/error.rs`:

```rust
use gmk87_app::error::{AppError, ErrorKind};
use gmk87_device::error::DeviceError;

#[test]
fn maps_each_device_error_to_a_kind() {
    assert_eq!(ErrorKind::of(&DeviceError::DeviceNotFound), ErrorKind::DeviceNotFound);
    assert_eq!(
        ErrorKind::of(&DeviceError::PermissionDenied { path: "/dev/hidraw12".into() }),
        ErrorKind::PermissionDenied
    );
    assert_eq!(ErrorKind::of(&DeviceError::DeviceDesynced), ErrorKind::DeviceDesynced);
    assert_eq!(ErrorKind::of(&DeviceError::ProtocolTimeout { cmd: 0x21 }), ErrorKind::ProtocolTimeout);
    assert_eq!(
        ErrorKind::of(&DeviceError::UploadTimeout { sent: 10, total: 20 }),
        ErrorKind::UploadTimeout
    );
}

#[test]
fn permission_denied_message_names_the_udev_rule() {
    let error: AppError = DeviceError::PermissionDenied {
        path: "/dev/hidraw12".into(),
    }
    .into();
    assert_eq!(error.kind, ErrorKind::PermissionDenied);
    assert!(
        error.message.contains("50-gmk87.rules"),
        "the message must point at the udev rule: {}",
        error.message
    );
}

#[test]
fn io_errors_have_their_own_kind() {
    let error = AppError::io(std::io::Error::new(std::io::ErrorKind::Other, "disk full"));
    assert_eq!(error.kind, ErrorKind::Io);
    assert!(error.message.contains("disk full"));
}
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test error`
Expected: FAIL — the crate or `gmk87_app::error` does not exist.

- [ ] **Step 4: Implement the error DTO**

`crates/gmk87-app/src/error.rs`:

```rust
//! A serializable error shape for the command boundary.

use gmk87_device::error::DeviceError;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    DeviceNotFound,
    PermissionDenied,
    Transport,
    Hid,
    ProtocolTimeout,
    UploadTimeout,
    ChecksumMismatch,
    DeviceDesynced,
    InvalidJob,
    UploadFailed,
    Protocol,
    Io,
}

impl ErrorKind {
    /// Classifies a device error by its variant.
    pub fn of(error: &DeviceError) -> Self {
        match error {
            DeviceError::DeviceNotFound => Self::DeviceNotFound,
            DeviceError::PermissionDenied { .. } => Self::PermissionDenied,
            DeviceError::Transport(_) => Self::Transport,
            DeviceError::Hid(_) => Self::Hid,
            DeviceError::ProtocolTimeout { .. } => Self::ProtocolTimeout,
            DeviceError::UploadTimeout { .. } => Self::UploadTimeout,
            DeviceError::ChecksumMismatch { .. } => Self::ChecksumMismatch,
            DeviceError::DeviceDesynced => Self::DeviceDesynced,
            DeviceError::InvalidJob(_) => Self::InvalidJob,
            DeviceError::UploadFailed { .. } => Self::UploadFailed,
            DeviceError::Protocol(_) => Self::Protocol,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
}

impl AppError {
    pub fn io(error: std::io::Error) -> Self {
        Self {
            kind: ErrorKind::Io,
            message: error.to_string(),
        }
    }
}

impl From<DeviceError> for AppError {
    fn from(error: DeviceError) -> Self {
        Self {
            kind: ErrorKind::of(&error),
            message: error.to_string(),
        }
    }
}

impl From<gmk87_protocol::error::ProtocolError> for AppError {
    fn from(error: gmk87_protocol::error::ProtocolError) -> Self {
        let wrapped: DeviceError = error.into();
        wrapped.into()
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}
```

- [ ] **Step 5: Write the failing snapshot and state tests**

`crates/gmk87-app/tests/snapshot.rs`:

```rust
use gmk87_app::snapshot;
use gmk87_protocol::config::DeviceConfig;

#[test]
fn round_trips_a_config_through_a_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("nested/gmk87/snapshot");

    let mut config = DeviceConfig::default_config();
    config.set_underglow_effect(12);
    snapshot::save(&path, &config).unwrap();

    let loaded = snapshot::load(&path).expect("snapshot loads");
    assert_eq!(loaded.as_bytes(), config.as_bytes());
}

#[test]
fn a_missing_file_is_none() {
    let dir = tempfile::tempdir().unwrap();
    assert!(snapshot::load(&dir.path().join("absent")).is_none());
}

#[test]
fn a_malformed_file_is_none_not_a_panic() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");
    std::fs::write(&path, "not hex at all").unwrap();
    assert!(snapshot::load(&path).is_none());
}
```

`crates/gmk87-app/tests/state.rs`:

```rust
use gmk87_app::state::DeviceStateDto;
use gmk87_protocol::config::{DeviceConfig, ShowSlot};

#[test]
fn projects_a_config_into_a_serializable_state() {
    let mut raw = [0u8; 48];
    raw[1] = 5;
    raw[2] = 7;
    raw[6] = 10;
    raw[7] = 20;
    raw[8] = 30;
    raw[21] = 1;
    raw[28] = 3;
    raw[29] = 9;
    raw[31] = 0;
    raw[32] = 4;
    raw[33] = ShowSlot::Slot1.as_u8();
    raw[34] = 3;
    raw[46] = 4;
    raw[43] = 100;
    raw[44] = 0;
    let config = DeviceConfig::from_bytes(&raw).unwrap();

    let state = DeviceStateDto::from_config(&config, true, true);
    assert!(state.connected && state.synced);
    assert_eq!(state.underglow.effect, 5);
    assert_eq!(state.underglow.brightness, 7);
    assert_eq!(state.underglow.color, (10, 20, 30));
    assert!(state.win_lock);
    assert_eq!(state.led.mode, 3);
    assert_eq!(state.led.color, 4);
    assert_eq!(state.show, 2);
    assert_eq!(state.slot0_frames, 3);
    assert_eq!(state.slot1_frames, 4);
    assert_eq!(state.frame_delay_ms, 100);
}
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `cargo test -p gmk87-app`
Expected: FAIL — `snapshot` and `state` modules do not exist.

- [ ] **Step 7: Implement snapshot and state**

`crates/gmk87-app/src/snapshot.rs`:

```rust
//! The last 48-byte block written, kept on disk so settings survive restarts.
//!
//! The device cannot be read (spec §3.3), so this file is the only record of
//! what the app last wrote.

use gmk87_protocol::config::DeviceConfig;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// `~/.local/share/gmk87/snapshot`, honouring `XDG_DATA_HOME`.
pub fn default_path() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
        })?;
    Some(base.join("gmk87").join("snapshot"))
}

/// Loads a snapshot, or `None` when it is missing or malformed.
pub fn load(path: &Path) -> Option<DeviceConfig> {
    let text = fs::read_to_string(path).ok()?;
    DeviceConfig::from_hex(text.trim()).ok()
}

/// Writes the snapshot, creating parent directories as needed.
pub fn save(path: &Path, config: &DeviceConfig) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, config.to_hex())
}
```

`crates/gmk87-app/src/state.rs`:

```rust
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
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cargo test -p gmk87-app`
Expected: PASS — 6 tests (2 error, 3 snapshot, 1 state).

- [ ] **Step 9: Commit**

```bash
git add Cargo.toml crates/gmk87-app
git commit -m "feat(app): error DTO, snapshot persistence and UI state projection"
```

---

### Task 2: `DeviceManager` — connect, lighting patch, clock

**Files:**
- Create: `crates/gmk87-app/src/lighting.rs`
- Create: `crates/gmk87-app/src/manager.rs`
- Modify: `crates/gmk87-app/src/lib.rs`
- Test: `crates/gmk87-app/tests/lighting.rs`
- Test: `crates/gmk87-app/tests/manager.rs`

**Interfaces:**
- Consumes: Task 1's `AppError`, `ErrorKind`, `snapshot`, `DeviceStateDto`; `gmk87_device::session::Session`, `gmk87_device::transport::Transport`, `gmk87_device::mock::MockTransport` (tests).
- Produces:
  - `gmk87_app::lighting::LightingPatch { underglow_effect, underglow_brightness, underglow_speed, underglow_orientation, underglow_rainbow, underglow_color: Option<(u8,u8,u8)>, win_lock, led_mode, led_saturation, led_rainbow, led_color }` — all `Option`, with `apply(&self, &mut DeviceConfig)`.
  - `gmk87_app::manager::DeviceManager<T: Transport>` with `new(transport: T, snapshot_path: Option<PathBuf>) -> Self`, `config(&self) -> &DeviceConfig`, `is_synced(&self) -> bool`, `read_state(&self) -> DeviceStateDto`, `set_lighting(&mut self, &dyn Fn(&mut DeviceConfig)) -> Result<(), AppError>`, `apply_lighting_patch(&mut self, &LightingPatch) -> Result<(), AppError>`, `sync_clock(&mut self, &chrono::DateTime<chrono::Local>) -> Result<(), AppError>`.

- [ ] **Step 1: Write the failing lighting-patch test**

`crates/gmk87-app/tests/lighting.rs`:

```rust
use gmk87_app::lighting::LightingPatch;
use gmk87_protocol::config::DeviceConfig;

#[test]
fn applies_only_the_fields_that_are_set() {
    let mut config = DeviceConfig::default_config();
    let before = config.underglow_effect();

    let patch = LightingPatch {
        underglow_brightness: Some(3),
        led_color: Some(5),
        ..LightingPatch::default()
    };
    patch.apply(&mut config);

    assert_eq!(config.underglow_brightness(), 3);
    assert_eq!(config.led_color(), 5);
    assert_eq!(config.underglow_effect(), before, "unset fields are untouched");
    assert_eq!(config.underglow_color(), (0xf8, 0xff, 0x00), "colour untouched");
}

#[test]
fn sets_a_full_colour_when_given() {
    let mut config = DeviceConfig::default_config();
    LightingPatch {
        underglow_color: Some((1, 2, 3)),
        win_lock: Some(true),
        ..LightingPatch::default()
    }
    .apply(&mut config);
    assert_eq!(config.underglow_color(), (1, 2, 3));
    assert_eq!(config.win_lock(), 1);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test lighting`
Expected: FAIL — `gmk87_app::lighting` does not exist.

- [ ] **Step 3: Implement the lighting patch and declare it**

`crates/gmk87-app/src/lighting.rs`:

```rust
//! A partial lighting update: every field is optional, so a command changes
//! only what the UI actually edited.

use gmk87_protocol::config::DeviceConfig;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LightingPatch {
    pub underglow_effect: Option<u8>,
    pub underglow_brightness: Option<u8>,
    pub underglow_speed: Option<u8>,
    pub underglow_orientation: Option<u8>,
    pub underglow_rainbow: Option<u8>,
    pub underglow_color: Option<(u8, u8, u8)>,
    pub win_lock: Option<bool>,
    pub led_mode: Option<u8>,
    pub led_saturation: Option<u8>,
    pub led_rainbow: Option<u8>,
    pub led_color: Option<u8>,
}

impl LightingPatch {
    pub fn apply(&self, config: &mut DeviceConfig) {
        if let Some(v) = self.underglow_effect {
            config.set_underglow_effect(v);
        }
        if let Some(v) = self.underglow_brightness {
            config.set_underglow_brightness(v);
        }
        if let Some(v) = self.underglow_speed {
            config.set_underglow_speed(v);
        }
        if let Some(v) = self.underglow_orientation {
            config.set_underglow_orientation(v);
        }
        if let Some(v) = self.underglow_rainbow {
            config.set_underglow_rainbow(v);
        }
        if let Some((r, g, b)) = self.underglow_color {
            config.set_underglow_color(r, g, b);
        }
        if let Some(v) = self.win_lock {
            config.set_win_lock(v);
        }
        if let Some(v) = self.led_mode {
            config.set_led_mode(v);
        }
        if let Some(v) = self.led_saturation {
            config.set_led_saturation(v);
        }
        if let Some(v) = self.led_rainbow {
            config.set_led_rainbow(v);
        }
        if let Some(v) = self.led_color {
            config.set_led_color(v);
        }
    }
}
```

Append to `crates/gmk87-app/src/lib.rs`:

```rust
pub mod lighting;
```

- [ ] **Step 4: Run the lighting test to verify it passes**

Run: `cargo test -p gmk87-app --test lighting`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing manager test**

`crates/gmk87-app/tests/manager.rs`:

```rust
use gmk87_app::lighting::LightingPatch;
use gmk87_app::manager::DeviceManager;
use gmk87_device::mock::MockTransport;
use gmk87_protocol::config::DeviceConfig;
use gmk87_protocol::packet::Command;

/// `INIT → CONFIG → COMMIT`, the write_config handshake.
fn expect_write(mock: &mut MockTransport) {
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
}

fn config_payloads(mock: &MockTransport) -> Vec<Vec<u8>> {
    mock.writes()
        .iter()
        .filter(|w| w[3] == Command::Config.as_u8())
        .map(|w| w[8..8 + w[4] as usize].to_vec())
        .collect()
}

#[test]
fn lighting_a_patch_writes_a_new_block_and_persists_it() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");

    let mut mock = MockTransport::new();
    expect_write(&mut mock);
    let mut manager = DeviceManager::new(mock, Some(path.clone()));

    manager
        .apply_lighting_patch(&LightingPatch {
            underglow_effect: Some(9),
            ..LightingPatch::default()
        })
        .unwrap();

    assert_eq!(manager.config().underglow_effect(), 9);
    let saved = gmk87_app::snapshot::load(&path).expect("snapshot written");
    assert_eq!(saved.underglow_effect(), 9);
}

#[test]
fn a_session_seeds_from_an_existing_snapshot() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");
    let mut seeded = DeviceConfig::default_config();
    seeded.set_underglow_effect(17);
    gmk87_app::snapshot::save(&path, &seeded).unwrap();

    let mut mock = MockTransport::new();
    expect_write(&mut mock);
    let mut manager = DeviceManager::new(mock, Some(path));

    manager
        .set_lighting(&|cfg| cfg.set_underglow_brightness(2))
        .unwrap();
    assert_eq!(manager.config().underglow_effect(), 17, "snapshot preserved");
    assert_eq!(manager.config().underglow_brightness(), 2);
}

#[test]
fn syncing_the_clock_writes_bcd_and_persists() {
    use chrono::TimeZone;
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");

    let mut mock = MockTransport::new();
    expect_write(&mut mock);
    let mut manager = DeviceManager::new(mock, Some(path.clone()));

    let now = chrono::Local.with_ymd_and_hms(2026, 11, 1, 14, 5, 9).unwrap();
    manager.sync_clock(&now).unwrap();

    let bytes = manager.config().as_bytes();
    assert_eq!(bytes[35], 0x09, "second");
    assert_eq!(bytes[36], 0x05, "minute");
    assert_eq!(bytes[37], 0x14, "hour");
    assert_eq!(bytes[40], 0x11, "month");
    assert_eq!(bytes[41], 0x26, "year");
    assert!(gmk87_app::snapshot::load(&path).is_some());
}

#[test]
fn read_state_reports_connection_and_fields() {
    let mock = MockTransport::new();
    let mut manager = DeviceManager::new(mock, None);
    manager
        .apply_lighting_patch(&LightingPatch {
            led_mode: Some(3),
            ..LightingPatch::default()
        })
        .unwrap_err();
    // No scripted acks: the write fails, so the state is reported as unsynced.
    let state = manager.read_state();
    assert!(state.connected);
    assert!(!state.synced);
}
```

Note on the last test: `apply_lighting_patch` with an empty mock fails (no `Init` ack), which is the point — `read_state` must still return a value and report `synced == false`.

- [ ] **Step 6: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test manager`
Expected: FAIL — `gmk87_app::manager` does not exist.

- [ ] **Step 7: Implement the manager**

`crates/gmk87-app/src/manager.rs`:

```rust
//! Owns the device session and serializes every operation against it.

use crate::error::AppError;
use crate::lighting::LightingPatch;
use crate::snapshot;
use crate::state::DeviceStateDto;
use gmk87_device::session::Session;
use gmk87_device::transport::Transport;
use gmk87_protocol::config::DeviceConfig;
use std::path::PathBuf;

pub struct DeviceManager<T: Transport> {
    session: Session<T>,
    snapshot_path: Option<PathBuf>,
}

impl<T: Transport> DeviceManager<T> {
    /// Opens a manager over `transport`, seeding the configuration from the
    /// snapshot at `snapshot_path` when one is readable.
    pub fn new(transport: T, snapshot_path: Option<PathBuf>) -> Self {
        let config = snapshot_path
            .as_deref()
            .and_then(snapshot::load)
            .unwrap_or_else(DeviceConfig::default_config);
        Self {
            session: Session::with_config(transport, config),
            snapshot_path,
        }
    }

    pub fn config(&self) -> &DeviceConfig {
        self.session.config()
    }

    pub fn is_synced(&self) -> bool {
        self.session.is_synced()
    }

    pub fn read_state(&self) -> DeviceStateDto {
        DeviceStateDto::from_config(self.session.config(), true, self.session.is_synced())
    }

    /// Applies `edit` to the in-memory configuration and writes the block.
    pub fn set_lighting(
        &mut self,
        edit: &dyn Fn(&mut DeviceConfig),
    ) -> Result<(), AppError> {
        self.session.set_lighting(edit)?;
        self.persist()
    }

    /// Applies a partial lighting patch.
    pub fn apply_lighting_patch(&mut self, patch: &LightingPatch) -> Result<(), AppError> {
        self.set_lighting(&|cfg| patch.apply(cfg))
    }

    /// Sets the clock and writes the block.
    pub fn sync_clock(
        &mut self,
        now: &chrono::DateTime<chrono::Local>,
    ) -> Result<(), AppError> {
        self.session.sync_clock(now)?;
        self.persist()
    }

    fn persist(&self) -> Result<(), AppError> {
        if let Some(path) = &self.snapshot_path {
            snapshot::save(path, self.session.config()).map_err(AppError::io)?;
        }
        Ok(())
    }
}
```

Append to `crates/gmk87-app/src/lib.rs`:

```rust
pub mod manager;
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cargo test -p gmk87-app`
Expected: PASS — all tests from Tasks 1 and 2.

- [ ] **Step 9: Commit**

```bash
git add crates/gmk87-app
git commit -m "feat(app): DeviceManager with lighting patches, clock sync and snapshot seeding"
```

---

### Task 3: Display jobs — decode, preview, budget

**Files:**
- Create: `crates/gmk87-app/src/job.rs`
- Modify: `crates/gmk87-app/src/lib.rs`
- Test: `crates/gmk87-app/tests/job.rs`

**Interfaces:**
- Consumes: `AppError`; `gmk87_protocol::frames::{extract_gif_frames, MAX_TOTAL_FRAMES}`, `gmk87_protocol::image::{prepare_static, CropSpec, Fit}`, `gmk87_protocol::pixel::{DISPLAY_WIDTH, DISPLAY_HEIGHT}`.
- Produces:
  - `gmk87_app::job::{DisplayJob, CropDto, FitDto, SlotTarget, is_gif}`.
  - `DisplayJob { slot: SlotTarget, bytes: Vec<u8>, crop: CropDto, delay_ms: u16, show_after: bool }` (deserializable, camelCase).
  - `CropDto { offset_x: f32, offset_y: f32, zoom: f32, fit: FitDto }` with `CropDto::to_spec(&self) -> CropSpec`.
  - `SlotTarget::{Slot0, Slot1}` with `as_show(self) -> ShowSlot` and `label(self) -> &'static str`.
  - `SlotTarget::from_show(ShowSlot) -> Option<SlotTarget>`.
  - `decode_frames(bytes: &[u8], &CropSpec, delay_ms: u16) -> Result<(Vec<Vec<u8>>, u16), AppError>` — per-slot frames and the effective delay.
  - `preview_png(bytes: &[u8], &CropSpec) -> Result<Vec<u8>, AppError>` — one 240×135 PNG.

- [ ] **Step 1: Write the failing job test**

`crates/gmk87-app/tests/job.rs`:

```rust
use gmk87_app::error::ErrorKind;
use gmk87_app::job::{decode_frames, is_gif, preview_png, CropDto, DisplayJob, FitDto, SlotTarget};
use gmk87_protocol::image::CropSpec;
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

fn gif(frames: usize, delay_centisec: u16) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, 8, 8, &[]).unwrap();
        enc.set_repeat(gif::Repeat::Infinite).unwrap();
        for i in 0..frames {
            let mut f = gif::Frame::from_rgb(8, 8, &vec![(i % 255) as u8; 8 * 8 * 3]);
            f.delay = delay_centisec;
            enc.write_frame(&f).unwrap();
        }
    }
    out
}

#[test]
fn detects_gif_by_header() {
    assert!(is_gif(&gif(1, 5)));
    assert!(!is_gif(&png(4, 4)));
    assert!(!is_gif(b"not an image"));
}

#[test]
fn a_static_image_is_one_frame() {
    let (frames, delay) = decode_frames(&png(500, 400), &CropSpec::default(), 120).unwrap();
    assert_eq!(frames.len(), 1);
    assert_eq!(delay, 120);
    assert_eq!(frames[0].len(), (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize);
}

#[test]
fn a_gif_uses_its_own_delay_when_none_is_given() {
    let (frames, delay) = decode_frames(&gif(3, 7), &CropSpec::default(), 0).unwrap();
    assert_eq!(frames.len(), 3);
    assert_eq!(delay, 70, "7 centiseconds is 70 ms");
}

#[test]
fn a_gif_over_the_budget_is_rejected_before_any_streaming() {
    let error = decode_frames(&gif(40, 5), &CropSpec::default(), 0).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(error.message.contains("40"), "names the frame count: {}", error.message);
}

#[test]
fn preview_returns_a_display_sized_png() {
    let png_bytes = preview_png(&gif(2, 5), &CropSpec::default()).unwrap();
    let decoded = image::load_from_memory(&png_bytes).unwrap();
    assert_eq!(decoded.width(), DISPLAY_WIDTH);
    assert_eq!(decoded.height(), DISPLAY_HEIGHT);
}

#[test]
fn preview_of_a_non_image_is_an_error_not_a_panic() {
    let error = preview_png(b"definitely not an image", &CropSpec::default()).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Protocol);
}

#[test]
fn a_display_job_deserializes_from_camel_case() {
    let json = r#"{
        "slot": "slot1",
        "bytes": [1, 2, 3],
        "crop": { "offsetX": 0.5, "offsetY": -0.5, "zoom": 2.0, "fit": "contain" },
        "delayMs": 80,
        "showAfter": true
    }"#;
    let job: DisplayJob = serde_json::from_str(json).unwrap();
    assert_eq!(job.slot, SlotTarget::Slot1);
    assert_eq!(job.bytes, vec![1, 2, 3]);
    assert_eq!(job.crop.to_spec().zoom, 2.0);
    assert!(job.show_after);
}
```

Add `gif = "0.13"` and `serde_json = "1"` to `crates/gmk87-app/Cargo.toml` `[dev-dependencies]`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test job`
Expected: FAIL — `gmk87_app::job` does not exist.

- [ ] **Step 3: Implement the job module**

`crates/gmk87-app/src/job.rs`:

```rust
//! Display jobs: what to upload, and how to preview it.

use crate::error::AppError;
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::{extract_gif_frames, MAX_TOTAL_FRAMES};
use gmk87_protocol::image::{prepare_static, CropSpec, Fit};
use gmk87_protocol::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlotTarget {
    Slot0,
    Slot1,
}

impl SlotTarget {
    pub fn as_show(self) -> ShowSlot {
        match self {
            SlotTarget::Slot0 => ShowSlot::Slot0,
            SlotTarget::Slot1 => ShowSlot::Slot1,
        }
    }

    pub fn from_show(show: ShowSlot) -> Option<SlotTarget> {
        match show {
            ShowSlot::Slot0 => Some(SlotTarget::Slot0),
            ShowSlot::Slot1 => Some(SlotTarget::Slot1),
            ShowSlot::Clock => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            SlotTarget::Slot0 => "slot 0",
            SlotTarget::Slot1 => "slot 1",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FitDto {
    Cover,
    Contain,
}

impl From<FitDto> for Fit {
    fn from(fit: FitDto) -> Self {
        match fit {
            FitDto::Cover => Fit::Cover,
            FitDto::Contain => Fit::Contain,
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CropDto {
    pub offset_x: f32,
    pub offset_y: f32,
    pub zoom: f32,
    pub fit: FitDto,
}

impl CropDto {
    pub fn to_spec(&self) -> CropSpec {
        CropSpec {
            offset_x: self.offset_x,
            offset_y: self.offset_y,
            zoom: self.zoom,
            fit: self.fit.into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayJob {
    pub slot: SlotTarget,
    pub bytes: Vec<u8>,
    pub crop: CropDto,
    /// 0 means "use the GIF's own delay"; static images use 100 ms.
    pub delay_ms: u16,
    pub show_after: bool,
}

/// A GIF's magic number, so a mislabelled static file is not fed to the GIF
/// decoder.
pub fn is_gif(bytes: &[u8]) -> bool {
    bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a")
}

const DEFAULT_STATIC_DELAY_MS: u16 = 100;

/// Decodes a source into per-frame RGB8 at display size, with the delay to use.
pub fn decode_frames(
    bytes: &[u8],
    crop: &CropSpec,
    delay_ms: u16,
) -> Result<(Vec<Vec<u8>>, u16), AppError> {
    if is_gif(bytes) {
        let (frames, source_delay) = extract_gif_frames(bytes, crop, MAX_TOTAL_FRAMES)?;
        let delay = if delay_ms == 0 { source_delay } else { delay_ms };
        Ok((frames, delay))
    } else {
        let frame = prepare_static(bytes, crop)?;
        let delay = if delay_ms == 0 {
            DEFAULT_STATIC_DELAY_MS
        } else {
            delay_ms
        };
        Ok((vec![frame], delay))
    }
}

/// Renders the first frame (for a GIF) or the image itself to a 240×135 PNG.
pub fn preview_png(bytes: &[u8], crop: &CropSpec) -> Result<Vec<u8>, AppError> {
    let rgb = prepare_static(bytes, crop)?;
    let image = image::RgbImage::from_raw(DISPLAY_WIDTH, DISPLAY_HEIGHT, rgb).ok_or_else(|| {
        AppError {
            kind: crate::error::ErrorKind::Protocol,
            message: "prepared frame has the wrong size".into(),
        }
    })?;
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(image)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|error| AppError {
            kind: crate::error::ErrorKind::Protocol,
            message: error.to_string(),
        })?;
    Ok(out.into_inner())
}
```

Append to `crates/gmk87-app/src/lib.rs`:

```rust
pub mod job;
```

`prepare_static` decodes a GIF to its first frame through the `image` crate, so `preview_png` needs no GIF-specific path.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p gmk87-app --test job`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/gmk87-app
git commit -m "feat(app): display jobs with GIF detection, preview and frame decoding"
```

---

### Task 4: Both-slot memory — `SlotStore`

**Files:**
- Create: `crates/gmk87-app/src/slots.rs`
- Modify: `crates/gmk87-app/src/lib.rs`
- Test: `crates/gmk87-app/tests/slots.rs`

**Interfaces:**
- Consumes: `AppError`; `gmk87_app::job::SlotTarget`; `gmk87_protocol::frames::{FramePlan, MAX_TOTAL_FRAMES}`; `gmk87_protocol::pixel::{DISPLAY_WIDTH, DISPLAY_HEIGHT}`.
- Produces:
  - `gmk87_app::slots::SlotStore` with `Default` (one black frame per slot), `frames(SlotTarget) -> &[Vec<u8>]`, `set(SlotTarget, Vec<Vec<u8>>) -> Result<(), AppError>`, `build_plan(delay_ms: u16, show: ShowSlot) -> FramePlan`.
  - `gmk87_app::slots::BLACK_FRAME_BYTES`.

- [ ] **Step 1: Write the failing slot-store test**

`crates/gmk87-app/tests/slots.rs`:

```rust
use gmk87_app::error::ErrorKind;
use gmk87_app::job::SlotTarget;
use gmk87_app::slots::{SlotStore, BLACK_FRAME_BYTES};

fn frame(color: u8) -> Vec<u8> {
    vec![color; BLACK_FRAME_BYTES]
}

#[test]
fn starts_with_one_black_frame_in_each_slot() {
    let store = SlotStore::default();
    assert_eq!(store.frames(SlotTarget::Slot0).len(), 1);
    assert_eq!(store.frames(SlotTarget::Slot1).len(), 1);
    assert!(store.frames(SlotTarget::Slot0)[0].iter().all(|b| *b == 0));
}

#[test]
fn replacing_one_slot_keeps_the_other() {
    let mut store = SlotStore::default();
    store.set(SlotTarget::Slot0, vec![frame(1), frame(2), frame(3)]).unwrap();
    assert_eq!(store.frames(SlotTarget::Slot0).len(), 3);
    assert_eq!(store.frames(SlotTarget::Slot1).len(), 1, "slot 1 is untouched");
}

#[test]
fn rejects_a_combined_frame_count_over_thirty_six() {
    let mut store = SlotStore::default();
    store.set(SlotTarget::Slot1, vec![frame(0); 35]).unwrap();
    let error = store.set(SlotTarget::Slot0, vec![frame(0); 1]).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(error.message.contains("36"), "names the budget: {}", error.message);
    assert!(error.message.contains("35"), "names the other slot's count: {}", error.message);
}

#[test]
fn builds_a_plan_with_both_slots() {
    let mut store = SlotStore::default();
    store.set(SlotTarget::Slot0, vec![frame(0), frame(0)]).unwrap();
    let plan = store.build_plan(80, gmk87_protocol::config::ShowSlot::Slot0);
    assert_eq!(plan.slot0_frames.len(), 2);
    assert_eq!(plan.slot1_frames.len(), 1);
    assert_eq!(plan.delay_ms, 80);
    plan.validate().unwrap();
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test slots`
Expected: FAIL — `gmk87_app::slots` does not exist.

- [ ] **Step 3: Implement the slot store**

`crates/gmk87-app/src/slots.rs`:

```rust
//! What the app last uploaded to each display slot.
//!
//! The upload session overwrites *all* image memory, so an upload must stream
//! both slots; the slot it is not changing is resent from here rather than
//! blanked. A default store holds one black frame per slot.

use crate::error::{AppError, ErrorKind};
use crate::job::SlotTarget;
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::{FramePlan, MAX_TOTAL_FRAMES};
use gmk87_protocol::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};

pub const BLACK_FRAME_BYTES: usize = (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize;

pub struct SlotStore {
    slot0: Vec<Vec<u8>>,
    slot1: Vec<Vec<u8>>,
}

impl Default for SlotStore {
    fn default() -> Self {
        let black = vec![0u8; BLACK_FRAME_BYTES];
        Self {
            slot0: vec![black.clone()],
            slot1: vec![black],
        }
    }
}

impl SlotStore {
    pub fn frames(&self, target: SlotTarget) -> &[Vec<u8>] {
        match target {
            SlotTarget::Slot0 => &self.slot0,
            SlotTarget::Slot1 => &self.slot1,
        }
    }

    /// Replaces one slot's frames, refusing to exceed the combined budget.
    pub fn set(&mut self, target: SlotTarget, frames: Vec<Vec<u8>>) -> Result<(), AppError> {
        let other = match target {
            SlotTarget::Slot0 => self.slot1.len(),
            SlotTarget::Slot1 => self.slot0.len(),
        };
        let total = other + frames.len();
        if total > MAX_TOTAL_FRAMES as usize {
            return Err(AppError {
                kind: ErrorKind::InvalidJob,
                message: format!(
                    "animation is {total} frames across both slots, over the {MAX_TOTAL_FRAMES}-frame budget \
                     ({} in {} and {other} in the other slot)",
                    frames.len(),
                    target.label(),
                ),
            });
        }
        match target {
            SlotTarget::Slot0 => self.slot0 = frames,
            SlotTarget::Slot1 => self.slot1 = frames,
        }
        Ok(())
    }

    pub fn build_plan(&self, delay_ms: u16, show: ShowSlot) -> FramePlan {
        FramePlan {
            slot0_frames: self.slot0.clone(),
            slot1_frames: self.slot1.clone(),
            delay_ms,
            show,
        }
    }
}
```

Append to `crates/gmk87-app/src/lib.rs`:

```rust
pub mod slots;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p gmk87-app --test slots`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add crates/gmk87-app
git commit -m "feat(app): both-slot memory that keeps the untouched slot"
```

---

### Task 5: Upload with progress, cancel and repair

**Files:**
- Modify: `crates/gmk87-app/src/manager.rs`
- Modify: `crates/gmk87-app/Cargo.toml` (dev-deps, already includes `gif`/`serde_json`)
- Test: `crates/gmk87-app/tests/upload.rs`

**Interfaces:**
- Consumes: `SlotStore`, `DisplayJob`, `decode_frames`, `CancelToken`, `UploadProgress`, `Session::upload`.
- Produces (on `DeviceManager<T>`):
  - `slots(&self) -> &SlotStore`
  - `upload_plan(&mut self, plan: &FramePlan, cancel: &CancelToken, on_progress: &mut dyn FnMut(UploadProgress)) -> Result<(), AppError>`
  - `upload(&mut self, job: &DisplayJob, cancel: &CancelToken, on_progress: &mut dyn FnMut(UploadProgress)) -> Result<(), AppError>`

- [ ] **Step 1: Write the failing upload test**

`crates/gmk87-app/tests/upload.rs`:

```rust
use gmk87_app::error::ErrorKind;
use gmk87_app::job::{CropDto, DisplayJob, FitDto, SlotTarget};
use gmk87_app::manager::DeviceManager;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::{CancelToken, UploadProgress};
use gmk87_protocol::packet::Command;
use gmk87_protocol::pixel::SLOT_BYTES;

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

fn job(slot: SlotTarget) -> DisplayJob {
    DisplayJob {
        slot,
        bytes: png(240, 135),
        crop: CropDto {
            offset_x: 0.0,
            offset_y: 0.0,
            zoom: 1.0,
            fit: FitDto::Cover,
        },
        delay_ms: 0,
        show_after: true,
    }
}

fn packets(bytes: usize) -> usize {
    bytes.div_ceil(56)
}

/// `INIT ×2 → CONFIG → COMMIT → UPLOAD_START (0x23)`.
fn expect_handshake(mock: &mut MockTransport) {
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::Ready, vec![vec![]]);
}

/// The repair: close the frame transaction, then rewrite the pre-upload block.
fn expect_repair(mock: &mut MockTransport) {
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
}

#[test]
fn uploads_both_slots_and_reports_progress() {
    let mut mock = MockTransport::new();
    expect_handshake(&mut mock);
    mock.expect(Command::FrameData, vec![vec![]; packets(SLOT_BYTES * 2)]);
    mock.expect(Command::Commit, vec![vec![]]);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");
    let mut manager = DeviceManager::new(mock, Some(path.clone()));

    let cancel = CancelToken::new();
    let mut seen: Vec<UploadProgress> = Vec::new();
    manager
        .upload(&job(SlotTarget::Slot0), &cancel, &mut |p| seen.push(p))
        .unwrap();

    assert!(!seen.is_empty());
    assert!(
        seen.windows(2).all(|w| w[0].bytes_sent <= w[1].bytes_sent),
        "progress is monotonic"
    );
    let last = seen.last().unwrap();
    assert_eq!(last.bytes_sent, last.total_bytes);
    assert_eq!(last.total_bytes, SLOT_BYTES * 2, "both slots streamed");

    let saved = gmk87_app::snapshot::load(&path).expect("snapshot written");
    assert_eq!(saved.slot0_frames(), 1);
    assert_eq!(saved.slot1_frames(), 1);
    assert_eq!(saved.show_image(), gmk87_protocol::config::ShowSlot::Slot0);
}

#[test]
fn cancelling_mid_stream_repairs_and_reports_it() {
    let mut mock = MockTransport::new();
    expect_handshake(&mut mock);
    mock.expect(Command::FrameData, vec![vec![]]); // one packet acknowledged
    expect_repair(&mut mock);

    let mut manager = DeviceManager::new(mock, None);
    let cancel = CancelToken::new();
    let cancel_in_callback = cancel.clone();
    let mut packets_seen = 0;

    let error = manager
        .upload(&job(SlotTarget::Slot1), &cancel, &mut |_| {
            packets_seen += 1;
            if packets_seen == 1 {
                cancel_in_callback.cancel();
            }
        })
        .unwrap_err();

    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(
        error.message.contains("display repair attempted"),
        "the message must state the display was repaired, not left unchanged: {}",
        error.message
    );
    assert!(!manager.is_synced(), "a cancelled session is not synced");
}

#[test]
fn a_plan_over_budget_fails_before_any_traffic() {
    let mock = MockTransport::new();
    let mut manager = DeviceManager::new(mock, None);
    // 35 frames in slot 1 (the default store already holds 1 in slot 0).
    let frames: Vec<Vec<u8>> = (0..36).map(|_| vec![0u8; gmk87_app::slots::BLACK_FRAME_BYTES]).collect();
    // A 36-frame GIF for slot 1 plus slot 0's frame is 37: rejected by decode/set.
    let error = manager
        .slots_set_for_test(SlotTarget::Slot1, frames)
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
}
```

`slots_set_for_test` does not exist — replace it with a direct store check. Because `SlotStore` is public, rewrite that last test to use it directly:

```rust
#[test]
fn a_plan_over_budget_fails_before_any_traffic() {
    use gmk87_app::job::SlotTarget;
    use gmk87_app::slots::{SlotStore, BLACK_FRAME_BYTES};
    let mut store = SlotStore::default();
    let frames: Vec<Vec<u8>> = (0..36).map(|_| vec![0u8; BLACK_FRAME_BYTES]).collect();
    let error = store.set(SlotTarget::Slot1, frames).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
}
```

(The combined-budget path is already covered in Task 4; this test pins that it is reachable from a real `DisplayJob`-sized vector.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test upload`
Expected: FAIL — `DeviceManager::upload` does not exist.

- [ ] **Step 3: Implement upload on the manager**

Add to `crates/gmk87-app/src/manager.rs` — extend the struct and `new`, and add the methods:

```rust
use crate::job::{decode_frames, DisplayJob};
use crate::slots::SlotStore;
use gmk87_device::session::{CancelToken, UploadProgress};
use gmk87_protocol::frames::FramePlan;

pub struct DeviceManager<T: Transport> {
    session: Session<T>,
    snapshot_path: Option<PathBuf>,
    slots: SlotStore,
}
```

Inside `new`, keep the existing body and set `slots: SlotStore::default()`.

```rust
    pub fn slots(&self) -> &SlotStore {
        &self.slots
    }

    /// Streams a prepared plan, then persists the block the session committed.
    pub fn upload_plan(
        &mut self,
        plan: &FramePlan,
        cancel: &CancelToken,
        on_progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<(), AppError> {
        self.session.upload(plan, cancel, on_progress)?;
        self.persist()
    }

    /// Decodes a job into the target slot, then streams both slots.
    pub fn upload(
        &mut self,
        job: &DisplayJob,
        cancel: &CancelToken,
        on_progress: &mut dyn FnMut(UploadProgress),
    ) -> Result<(), AppError> {
        let crop = job.crop.to_spec();
        let (frames, delay) = decode_frames(&job.bytes, &crop, job.delay_ms)?;
        self.slots.set(job.slot, frames)?;
        let show = if job.show_after {
            job.slot.as_show()
        } else {
            self.session.config().show_image()
        };
        let plan = self.slots.build_plan(delay, show);
        self.upload_plan(&plan, cancel, on_progress)
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p gmk87-app`
Expected: PASS — every test so far, including 3 upload tests.

- [ ] **Step 5: Commit**

```bash
git add crates/gmk87-app
git commit -m "feat(app): upload both slots with progress, cancellation and repair"
```

---

### Task 6: Lighting presets

**Files:**
- Create: `crates/gmk87-app/src/presets.rs`
- Modify: `crates/gmk87-app/src/lib.rs`
- Test: `crates/gmk87-app/tests/presets.rs`

**Interfaces:**
- Consumes: `AppError`; `gmk87_protocol::config::DeviceConfig`.
- Produces:
  - `gmk87_app::presets::Preset { name: &'static str, description: &'static str }` (Serialize).
  - `gmk87_app::presets::list() -> Vec<Preset>` and `const NAMES: [&str; 8]`.
  - `gmk87_app::presets::apply(name: &str, config: &mut DeviceConfig) -> Result<(), AppError>` — sets underglow, LED and win-lock only; leaves `show_image` and frame counts alone.

- [ ] **Step 1: Write the failing preset test**

`crates/gmk87-app/tests/presets.rs`:

```rust
use gmk87_app::error::ErrorKind;
use gmk87_app::presets;
use gmk87_protocol::config::{DeviceConfig, ShowSlot};

#[test]
fn lists_the_eight_named_presets() {
    let names: Vec<&str> = presets::list().iter().map(|p| p.name).collect();
    assert_eq!(
        names,
        vec![
            "gaming", "relaxed", "party", "minimal", "productivity", "purple-wave", "matrix",
            "sunset"
        ]
    );
}

#[test]
fn applies_the_gaming_preset_fields() {
    let mut config = DeviceConfig::default_config();
    presets::apply("gaming", &mut config).unwrap();
    assert_eq!(config.underglow_effect(), 5);
    assert_eq!(config.underglow_brightness(), 9);
    assert_eq!(config.underglow_speed(), 1);
    assert_eq!(config.underglow_orientation(), 1);
    assert_eq!(config.underglow_rainbow(), 0);
    assert_eq!(config.underglow_color(), (255, 0, 0));
    assert_eq!(config.led_mode(), 3);
    assert_eq!(config.led_saturation(), 9);
    assert_eq!(config.led_rainbow(), 0);
    assert_eq!(config.led_color(), 0);
}

#[test]
fn applying_a_preset_does_not_change_the_display() {
    let mut config = DeviceConfig::default_config();
    config.set_show_image(ShowSlot::Slot1);
    config.set_slot0_frames(4);
    presets::apply("minimal", &mut config).unwrap();
    assert_eq!(config.show_image(), ShowSlot::Slot1, "the shown slot is untouched");
    assert_eq!(config.slot0_frames(), 4, "frame counts are untouched");
}

#[test]
fn an_unknown_preset_is_an_error_naming_the_known_ones() {
    let mut config = DeviceConfig::default_config();
    let error = presets::apply("disco", &mut config).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(error.message.contains("gaming"), "lists known presets: {}", error.message);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test presets`
Expected: FAIL — `gmk87_app::presets` does not exist.

- [ ] **Step 3: Implement the presets**

`crates/gmk87-app/src/presets.rs`:

```rust
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
            effect: 5, brightness: 9, speed: 1, orientation: 1, rainbow: 0,
            color: (255, 0, 0), led_mode: 3, led_saturation: 9, led_rainbow: 0, led_color: 0,
        },
        "relaxed" => Values {
            effect: 5, brightness: 3, speed: 7, orientation: 1, rainbow: 0,
            color: (0, 255, 255), led_mode: 3, led_saturation: 3, led_rainbow: 0, led_color: 4,
        },
        "party" => Values {
            effect: 12, brightness: 9, speed: 0, orientation: 1, rainbow: 1,
            color: (255, 255, 255), led_mode: 1, led_saturation: 9, led_rainbow: 1, led_color: 0,
        },
        "minimal" => Values {
            effect: 0, brightness: 0, speed: 5, orientation: 1, rainbow: 0,
            color: (0, 0, 0), led_mode: 3, led_saturation: 0, led_rainbow: 0, led_color: 8,
        },
        "productivity" => Values {
            effect: 6, brightness: 4, speed: 5, orientation: 1, rainbow: 0,
            color: (255, 255, 255), led_mode: 3, led_saturation: 5, led_rainbow: 0, led_color: 7,
        },
        "purple-wave" => Values {
            effect: 16, brightness: 6, speed: 4, orientation: 1, rainbow: 0,
            color: (128, 0, 255), led_mode: 3, led_saturation: 6, led_rainbow: 0, led_color: 6,
        },
        "matrix" => Values {
            effect: 15, brightness: 7, speed: 2, orientation: 1, rainbow: 0,
            color: (0, 255, 0), led_mode: 3, led_saturation: 7, led_rainbow: 0, led_color: 3,
        },
        "sunset" => Values {
            effect: 5, brightness: 6, speed: 6, orientation: 1, rainbow: 0,
            color: (255, 128, 0), led_mode: 3, led_saturation: 6, led_rainbow: 0, led_color: 1,
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
```

Append to `crates/gmk87-app/src/lib.rs`:

```rust
pub mod presets;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p gmk87-app`
Expected: PASS — all tests so far, including 4 preset tests.

- [ ] **Step 5: Verify the whole workspace is still clean**

Run: `cargo fmt --all --check && cargo clippy --all-targets -- -D warnings && cargo test --all`
Expected: PASS, no warnings.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-app
git commit -m "feat(app): eight named lighting presets"
```

---

### Task 7: Tauri + Vite scaffold

**Files:**
- Modify: `Cargo.toml` (exclude `src-tauri`)
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/build.rs`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `ui/package.json`
- Create: `ui/vite.config.ts`
- Create: `ui/tsconfig.json`
- Create: `ui/tsconfig.node.json`
- Create: `ui/index.html`
- Create: `ui/src/main.tsx`
- Create: `ui/src/App.tsx`
- Create: `ui/src/index.css`
- Create: `ui/src/lib/utils.ts`
- Create: `ui/src/vite-env.d.ts`
- Modify: `.gitignore` (already ignores `ui/dist` and `src-tauri/target`)

**Interfaces:**
- Consumes: nothing (a `ping` command only).
- Produces: a building Tauri app whose dev server is `http://localhost:1420` and whose frontend bundle lands in `ui/dist`; the `ui/` toolchain (bun, Vite, Vitest, Tailwind, shadcn) that every later frontend task uses.

- [ ] **Step 1: Install the Linux build dependencies and the Tauri CLI**

Run:

```bash
sudo apt-get update
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Then, from `ui/` (created in Step 2), `bun add -d @tauri-apps/cli@^2`.

Expected: `pkg-config --modversion webkit2gtk-4.1` prints a version.

- [ ] **Step 2: Create the frontend workspace**

`ui/package.json`:

```json
{
  "name": "gmk87-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "tauri": "tauri"
  },
  "dependencies": {
    "@react-three/drei": "^9",
    "@react-three/fiber": "^8",
    "@tauri-apps/api": "^2",
    "class-variance-authority": "^0.7",
    "clsx": "^2",
    "lucide-react": "^0.400",
    "react": "^18",
    "react-dom": "^18",
    "tailwind-merge": "^2",
    "three": "^0.169",
    "zustand": "^5"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4",
    "@testing-library/jest-dom": "^6",
    "@testing-library/react": "^16",
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@types/three": "^0.169",
    "@vitejs/plugin-react": "^4",
    "jsdom": "^25",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vite": "^5",
    "vitest": "^2"
  }
}
```

`ui/vite.config.ts`:

```ts
/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
  },
});
```

`ui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`ui/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true
  },
  "include": ["vite.config.ts"]
}
```

`ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>GMK87 Configurator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`ui/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

`ui/src/index.css`:

```css
@import "tailwindcss";

:root {
  --radius: 0.6rem;
}

html,
body,
#root {
  height: 100%;
}

body {
  margin: 0;
  background: #0b0c10;
  color: #e8e8ea;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
```

`ui/src/lib/utils.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

`ui/src/App.tsx`:

```tsx
export default function App() {
  return (
    <main className="flex h-full items-center justify-center">
      <h1 className="text-2xl font-semibold">GMK87 Configurator</h1>
    </main>
  );
}
```

`ui/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`ui/src/test/setup.ts`:

```ts
import "@testing-library/jest-dom";
```

- [ ] **Step 3: Add shadcn/ui wiring**

Create `ui/components.json`:

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui" },
  "iconLibrary": "lucide"
}
```

Run, from `ui/`:

```bash
bun install
bunx --bun shadcn@latest add button card tabs slider select switch label badge progress separator tooltip sonner --yes --overwrite
```

Expected: `ui/src/components/ui/*.tsx` exist and `ui/package.json` gained `@radix-ui/*` dependencies. If the CLI cannot run non-interactively, hand-write the components it would generate (Button, Card, Tabs, Slider, Select, Switch, Label, Badge, Progress, Separator, Tooltip) using the `@radix-ui/react-*` packages directly — the plan's later tasks only rely on their public props.

- [ ] **Step 4: Create the Tauri shell and exclude it from the Rust workspace**

Edit the root `Cargo.toml` `[workspace]` section to add:

```toml
exclude = ["src-tauri"]
```

`src-tauri/Cargo.toml`:

```toml
[package]
name = "gmk87-desktop"
version = "0.1.0"
edition = "2021"
license = "GPL-3.0-or-later"

[lib]
name = "gmk87_desktop_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
gmk87-app = { path = "../crates/gmk87-app" }
gmk87-device = { path = "../crates/gmk87-device" }
gmk87-protocol = { path = "../crates/gmk87-protocol" }
thiserror = "1"
tracing = "0.1"
tracing-subscriber = "0.3"
chrono = "0.4"
```

`src-tauri/build.rs`:

```rust
fn main() {
    tauri_build::build()
}
```

`src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "GMK87 Configurator",
  "version": "0.1.0",
  "identifier": "dev.gmk87.configurator",
  "build": {
    "beforeDevCommand": "bun run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "bun run build",
    "frontendDist": "../ui/dist"
  },
  "app": {
    "windows": [
      {
        "title": "GMK87 Configurator",
        "width": 1180,
        "height": 760,
        "minWidth": 940,
        "minHeight": 620
      }
    ],
    "security": { "csp": null }
  },
  "bundle": { "active": false }
}
```

`src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default"]
}
```

`src-tauri/src/main.rs`:

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    gmk87_desktop_lib::run()
}
```

`src-tauri/src/lib.rs`:

```rust
//! Tauri command and event adapter over `gmk87-app`.

use tauri::Emitter;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[tauri::command]
fn log_ready(app: tauri::AppHandle) {
    let _ = app.emit("device://ready", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_target(false).init();
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ping, log_ready])
        .run(tauri::generate_context!())
        .expect("error while running the GMK87 configurator");
}
```

The unused `Emitter` import is a placeholder used by `log_ready`; both go away when Task 8 adds the real commands. Keep `log_ready` until then so the build has one emitter call site.

- [ ] **Step 5: Build the frontend, then check the Rust shell**

Run, from `ui/`: `bun run build`
Expected: PASS, `ui/dist/index.html` exists and the tsc step reports no errors.

Run, from `src-tauri/`: `cargo check`
Expected: PASS. The Tauri context embeds `../ui/dist`, so the frontend build must run first.

- [ ] **Step 6: Run the frontend test harness once**

Run, from `ui/`: `bun run test`
Expected: PASS (Vitest starts with no test files, exit 0).

- [ ] **Step 7: Commit**

```bash
git add Cargo.toml src-tauri ui
git commit -m "chore(app): scaffold Tauri shell and Vite/shadcn frontend"
```

---

### Task 8: Device commands — list, connect, state, lighting, clock, presets, preview

**Files:**
- Create: `src-tauri/src/dto.rs`
- Create: `src-tauri/src/app_state.rs`
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/src/dto.rs` (unit tests)

**Interfaces:**
- Consumes: `gmk87_app::{manager::DeviceManager, lighting::LightingPatch, job::{DisplayJob, preview_png, CropDto}, presets, snapshot, state::DeviceStateDto, error::{AppError, ErrorKind}}`; `gmk87_device::{discovery::{discover, DeviceInfo, TransportKind}, transport::HidTransport}`.
- Produces (Tauri commands, all `async` except `ping`/`list_presets`):
  - `list_devices() -> Result<Vec<DeviceInfoDto>, AppError>`
  - `connect(path: String) -> Result<DeviceStateDto, AppError>`
  - `disconnect() -> Result<(), AppError>`
  - `read_state() -> DeviceStateDto`
  - `set_lighting(patch: LightingPatch) -> Result<DeviceStateDto, AppError>`
  - `sync_clock() -> Result<DeviceStateDto, AppError>`
  - `list_presets() -> Vec<PresetDto>`
  - `apply_preset(name: String) -> Result<DeviceStateDto, AppError>`
  - `preview_display(job: PreviewJob) -> Result<Vec<u8>, AppError>` (PNG bytes)
  - `copy_diagnostics() -> Result<String, AppError>`

- [ ] **Step 1: Write the failing DTO test**

`src-tauri/src/dto.rs` (tests at the bottom of the file):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use gmk87_device::discovery::{DeviceInfo, TransportKind};

    #[test]
    fn a_wired_device_projects_to_a_labelled_dto() {
        let info = DeviceInfo {
            path: "/dev/hidraw12".into(),
            product_id: 0x5055,
            transport: TransportKind::Wired,
            interface_number: 3,
            has_via: true,
        };
        let dto = DeviceInfoDto::from(info);
        assert_eq!(dto.label, "GMK87 (wired)");
        assert_eq!(dto.path, "/dev/hidraw12");
        assert!(dto.has_via);
        assert_eq!(dto.transport, "wired");
    }

    #[test]
    fn a_wireless_device_is_labelled_24g() {
        let info = DeviceInfo {
            path: "/dev/hidraw6".into(),
            product_id: 0x5088,
            transport: TransportKind::Wireless24G,
            interface_number: 3,
            has_via: false,
        };
        let dto = DeviceInfoDto::from(info);
        assert_eq!(dto.label, "GMK87 (2.4 GHz)");
        assert_eq!(dto.transport, "wireless24g");
    }

    #[test]
    fn a_preview_job_without_bytes_names_the_fault() {
        let job = PreviewJob {
            bytes: Vec::new(),
            crop: CropDto { offset_x: 0.0, offset_y: 0.0, zoom: 1.0, fit: gmk87_app::job::FitDto::Cover },
        };
        let error = super::preview_bytes(&job).unwrap_err();
        assert_eq!(error.kind, gmk87_app::error::ErrorKind::Protocol);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src-tauri && cargo test dto`
Expected: FAIL — `dto.rs` is not declared in `lib.rs`.

- [ ] **Step 3: Implement the DTOs and app state**

`src-tauri/src/dto.rs`:

```rust
//! Wire shapes crossing the command boundary.

use gmk87_app::error::AppError;
use gmk87_app::job::{preview_png, CropDto};
use gmk87_device::discovery::{DeviceInfo, TransportKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfoDto {
    pub path: String,
    pub label: String,
    pub transport: String,
    pub product_id: u16,
    pub has_via: bool,
}

impl From<DeviceInfo> for DeviceInfoDto {
    fn from(info: DeviceInfo) -> Self {
        Self {
            path: info.path,
            label: info.label(),
            transport: match info.transport {
                TransportKind::Wired => "wired".to_string(),
                TransportKind::Wireless24G => "wireless24g".to_string(),
            },
            product_id: info.product_id,
            has_via: info.has_via,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresetDto {
    pub name: String,
    pub description: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewJob {
    pub bytes: Vec<u8>,
    pub crop: CropDto,
}

/// Renders a preview PNG, mapping an empty buffer to a named fault.
pub fn preview_bytes(job: &PreviewJob) -> Result<Vec<u8>, AppError> {
    if job.bytes.is_empty() {
        return Err(AppError {
            kind: gmk87_app::error::ErrorKind::Protocol,
            message: "no image bytes were provided".into(),
        });
    }
    preview_png(&job.bytes, &job.crop.to_spec())
}
```

`src-tauri/src/app_state.rs`:

```rust
//! Shared state: one device manager behind a mutex, and the live cancel token.

use gmk87_app::manager::DeviceManager;
use gmk87_device::session::CancelToken;
use gmk87_device::transport::HidTransport;
use std::sync::{Arc, Mutex};

pub type Manager = DeviceManager<HidTransport>;

#[derive(Default)]
pub struct Runtime {
    pub manager: Option<Manager>,
    pub path: Option<String>,
}

pub struct AppState {
    pub runtime: Arc<Mutex<Runtime>>,
    pub cancel: Arc<Mutex<Option<CancelToken>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(Runtime::default())),
            cancel: Arc::new(Mutex::new(None)),
        }
    }
}
```

- [ ] **Step 4: Implement the commands**

`src-tauri/src/commands.rs`:

```rust
//! Tauri commands. Every device operation runs on a blocking thread so the
//! webview never stalls, and all of them share one `DeviceManager` mutex so
//! device operations are serialized (the keyboard has one state machine).

use crate::app_state::{AppState, Manager};
use crate::dto::{preview_bytes, DeviceInfoDto, PresetDto, PreviewJob};
use gmk87_app::error::{AppError, ErrorKind};
use gmk87_app::lighting::LightingPatch;
use gmk87_app::state::DeviceStateDto;
use tauri::State;

fn not_connected() -> AppError {
    AppError {
        kind: ErrorKind::DeviceNotFound,
        message: "no keyboard is connected; connect from the Device screen".into(),
    }
}

fn join_error(error: tauri::Error) -> AppError {
    AppError {
        kind: ErrorKind::Io,
        message: error.to_string(),
    }
}

#[tauri::command]
pub async fn list_devices() -> Result<Vec<DeviceInfoDto>, AppError> {
    tauri::async_runtime::spawn_blocking(|| {
        gmk87_device::discovery::discover()
            .map(|devices| devices.into_iter().map(DeviceInfoDto::from).collect())
            .map_err(AppError::from)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn connect(state: State<'_, AppState>, path: String) -> Result<DeviceStateDto, AppError> {
    let runtime = state.runtime.clone();
    let snapshot_path = gmk87_app::snapshot::default_path();
    tauri::async_runtime::spawn_blocking(move || {
        let transport = gmk87_device::transport::HidTransport::open(&path)?;
        let manager = Manager::new(transport, snapshot_path);
        let state = manager.read_state();
        let mut rt = runtime.lock().expect("runtime lock");
        rt.manager = Some(manager);
        rt.path = Some(path);
        Ok(state)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> Result<(), AppError> {
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        rt.manager = None;
        rt.path = None;
        Ok(())
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub fn read_state(state: State<'_, AppState>) -> DeviceStateDto {
    let rt = state.runtime.lock().expect("runtime lock");
    match rt.manager.as_ref() {
        Some(manager) => manager.read_state(),
        None => DeviceStateDto::from_config(
            &gmk87_protocol::config::DeviceConfig::default_config(),
            false,
            false,
        ),
    }
}

#[tauri::command]
pub async fn set_lighting(
    state: State<'_, AppState>,
    patch: LightingPatch,
) -> Result<DeviceStateDto, AppError> {
    run_on_manager(state, move |manager| {
        manager.apply_lighting_patch(&patch)?;
        Ok(manager.read_state())
    })
    .await
}

#[tauri::command]
pub async fn sync_clock(state: State<'_, AppState>) -> Result<DeviceStateDto, AppError> {
    run_on_manager(state, move |manager| {
        manager.sync_clock(&chrono::Local::now())?;
        Ok(manager.read_state())
    })
    .await
}

#[tauri::command]
pub fn list_presets() -> Vec<PresetDto> {
    gmk87_app::presets::list()
        .into_iter()
        .map(|preset| PresetDto {
            name: preset.name.to_string(),
            description: preset.description.to_string(),
        })
        .collect()
}

#[tauri::command]
pub async fn apply_preset(
    state: State<'_, AppState>,
    name: String,
) -> Result<DeviceStateDto, AppError> {
    run_on_manager(state, move |manager| {
        manager.set_lighting(&|cfg| {
            let _ = gmk87_app::presets::apply(&name, cfg);
        })?;
        Ok(manager.read_state())
    })
    .await
}

#[tauri::command]
pub async fn preview_display(job: PreviewJob) -> Result<Vec<u8>, AppError> {
    tauri::async_runtime::spawn_blocking(move || preview_bytes(&job))
        .await
        .map_err(join_error)?
}

/// Runs `body` against the connected manager; `not_connected` when there is none.
async fn run_on_manager<T, F>(state: State<'_, AppState>, body: F) -> Result<T, AppError>
where
    T: Send + 'static,
    F: FnOnce(&mut Manager) -> Result<T, AppError> + Send + 'static,
{
    let runtime = state.runtime.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        let manager = rt.manager.as_mut().ok_or_else(not_connected)?;
        body(manager)
    })
    .await
    .map_err(join_error)?
}

#[tauri::command]
pub async fn copy_diagnostics(state: State<'_, AppState>) -> Result<String, AppError> {
    let path = state
        .runtime
        .lock()
        .expect("runtime lock")
        .path
        .clone();
    let mut report = String::new();
    report.push_str(&format!("gmk87-configurator {}\n", env!("CARGO_PKG_VERSION")));
    report.push_str(&format!("device: {}\n", path.as_deref().unwrap_or("(none)")));
    if let Ok(uname) = std::fs::read_to_string("/proc/sys/kernel/osrelease") {
        report.push_str(&format!("kernel: {}\n", uname.trim()));
    }
    let log_dir = gmk87_app::snapshot::default_path()
        .and_then(|p| p.parent().map(|d| d.join("logs")));
    if let Some(dir) = log_dir {
        report.push_str(&format!("logs: {}\n", dir.display()));
    }
    Ok(report)
}
```

- [ ] **Step 5: Wire the commands**

Replace `src-tauri/src/lib.rs` with:

```rust
//! Tauri command and event adapter over `gmk87-app`.

mod app_state;
mod commands;
mod dto;

use app_state::AppState;

#[tauri::command]
fn ping() -> &'static str {
    "pong"
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_target(false).init();
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            ping,
            commands::list_devices,
            commands::connect,
            commands::disconnect,
            commands::read_state,
            commands::set_lighting,
            commands::sync_clock,
            commands::list_presets,
            commands::apply_preset,
            commands::preview_display,
            commands::copy_diagnostics,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the GMK87 configurator");
}
```

- [ ] **Step 6: Run the checks**

Run, from `src-tauri/`: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS — 3 DTO tests, no warnings.

- [ ] **Step 7: Commit**

```bash
git add src-tauri
git commit -m "feat(app): Tauri device commands for listing, connecting, lighting, clock, presets and preview"
```

---

### Task 9: Upload command, progress event, cancel, reconnect

**Files:**
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/dto.rs`

**Interfaces:**
- Consumes: Task 8's `AppState`, `run_on_manager`; `gmk87_device::session::CancelToken`; `gmk87_app::job::DisplayJob`.
- Produces:
  - `upload_display(app, state, job)` emitting `upload://progress` with `UploadProgressDto { bytesSent, totalBytes }`.
  - `cancel_upload(state)`.
  - `copy_diagnostics` already present.
  - A 2 s reconnect monitor that emits `device://disconnected` when the hidraw node vanishes.

- [ ] **Step 1: Write the failing progress-DTO test**

Append to `src-tauri/src/dto.rs`:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadProgressDto {
    pub bytes_sent: usize,
    pub total_bytes: usize,
}

impl From<gmk87_device::session::UploadProgress> for UploadProgressDto {
    fn from(progress: gmk87_device::session::UploadProgress) -> Self {
        Self {
            bytes_sent: progress.bytes_sent,
            total_bytes: progress.total_bytes,
        }
    }
}

#[cfg(test)]
mod progress_tests {
    use super::*;

    #[test]
    fn converts_upload_progress_to_a_camel_case_dto() {
        let dto = UploadProgressDto::from(gmk87_device::session::UploadProgress {
            bytes_sent: 512,
            total_bytes: 65536,
        });
        let json = serde_json::to_string(&dto).unwrap();
        assert!(json.contains("\"bytesSent\":512"));
        assert!(json.contains("\"totalBytes\":65536"));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `src-tauri/`: `cargo test progress`
Expected: FAIL — `UploadProgressDto` does not exist.

- [ ] **Step 3: Implement upload, cancel and the reconnect monitor**

Append to `src-tauri/src/commands.rs`:

```rust
use crate::dto::UploadProgressDto;
use gmk87_device::session::CancelToken;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn upload_display(
    app: AppHandle,
    state: State<'_, AppState>,
    job: gmk87_app::job::DisplayJob,
) -> Result<(), AppError> {
    let runtime = state.runtime.clone();
    let cancel_handle = state.cancel.clone();
    let token = CancelToken::new();
    *cancel_handle.lock().expect("cancel lock") = Some(token.clone());

    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut rt = runtime.lock().expect("runtime lock");
        let manager = rt.manager.as_mut().ok_or_else(not_connected)?;
        manager.upload(&job, &token, &mut |progress| {
            let _ = app.emit("upload://progress", UploadProgressDto::from(progress));
        })
    })
    .await
    .map_err(join_error);

    *cancel_handle.lock().expect("cancel lock") = None;
    result?
}

#[tauri::command]
pub fn cancel_upload(state: State<'_, AppState>) -> Result<(), AppError> {
    if let Some(token) = state.cancel.lock().expect("cancel lock").as_ref() {
        token.cancel();
    }
    Ok(())
}

/// Watches the connected hidraw node and reports when it disappears.
///
/// Called once after a successful connect; the loop ends when the path changes
/// or the manager is dropped.
pub fn spawn_reconnect_monitor(app: AppHandle, state: &AppState, path: String) {
    let runtime = state.runtime.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(2));
        {
            let rt = runtime.lock().expect("runtime lock");
            match &rt.path {
                Some(current) if current == &path => {}
                _ => return,
            }
        }
        if !std::path::Path::new(&path).exists() {
            let mut rt = runtime.lock().expect("runtime lock");
            rt.manager = None;
            rt.path = None;
            let _ = app.emit("device://disconnected", path.clone());
            return;
        }
    });
}
```

- [ ] **Step 4: Wire upload and cancel, and start the monitor on connect**

In `src-tauri/src/commands.rs`, `connect` gains the monitor start. Replace the body of the `connect` command's closure tail so that after the manager is stored it calls the monitor. The simplest correct arrangement is to return the path from the closure and start the monitor on the async side:

```rust
#[tauri::command]
pub async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> Result<DeviceStateDto, AppError> {
    let runtime = state.runtime.clone();
    let snapshot_path = gmk87_app::snapshot::default_path();
    let connect_path = path.clone();
    let state_dto = tauri::async_runtime::spawn_blocking(move || {
        let transport = gmk87_device::transport::HidTransport::open(&connect_path)?;
        let manager = Manager::new(transport, snapshot_path);
        let state_dto = manager.read_state();
        let mut rt = runtime.lock().expect("runtime lock");
        rt.manager = Some(manager);
        rt.path = Some(connect_path);
        Ok::<_, AppError>(state_dto)
    })
    .await
    .map_err(join_error)??;

    spawn_reconnect_monitor(app, &state, path);
    Ok(state_dto)
}
```

Add `commands::upload_display` and `commands::cancel_upload` to the `generate_handler!` list in `src-tauri/src/lib.rs`.

- [ ] **Step 5: Run the checks**

Run, from `src-tauri/`: `cargo test && cargo clippy --all-targets -- -D warnings`
Expected: PASS — 4 DTO tests, no warnings.

- [ ] **Step 6: Commit**

```bash
git add src-tauri
git commit -m "feat(app): upload command with progress events, cancellation and reconnect monitor"
```

---

### Task 10: Frontend foundation — types, IPC, store, pure helpers

**Files:**
- Create: `ui/src/lib/crop.ts`
- Create: `ui/src/lib/budget.ts`
- Create: `ui/src/lib/effects.ts`
- Create: `ui/src/lib/ipc.ts`
- Create: `ui/src/store.ts`
- Test: `ui/src/lib/crop.test.ts`
- Test: `ui/src/lib/budget.test.ts`
- Test: `ui/src/lib/effects.test.ts`
- Test: `ui/src/store.test.ts`

**Interfaces:**
- Consumes: `@tauri-apps/api/core` (`invoke`) and `@tauri-apps/api/event` (`listen`).
- Produces:
  - `ui/src/lib/crop.ts`: `Fit`, `CropParams`, `DEFAULT_CROP`, `clamp`, `zoomBy`, `panBy`.
  - `ui/src/lib/budget.ts`: `MAX_TOTAL_FRAMES`, `MIN_FRAME_DELAY_MS`, `budgetError`.
  - `ui/src/lib/effects.ts`: `UNDERGLOW_EFFECTS`, `LED_MODES`, `LED_COLORS` (readonly arrays of `{ name, value }`).
  - `ui/src/lib/ipc.ts`: `listDevices`, `connect`, `disconnect`, `readState`, `setLighting`, `syncClock`, `listPresets`, `applyPreset`, `previewDisplay`, `uploadDisplay`, `cancelUpload`, `copyDiagnostics`, `onUploadProgress`, `onDeviceDisconnected`.
  - `ui/src/store.ts`: `useAppStore` (zustand) with `devices`, `state`, `connected`, `crop`, `slot`, `source`, `previewUrl`, `progress`, `error`, and actions `refreshDevices`, `connectTo`, `disconnectDevice`, `setCrop`, `setSlot`, `loadSource`, `refreshPreview`, `upload`, `cancel`, `applyLighting`, `syncClock`, `applyPreset`, `dismissError`.

- [ ] **Step 1: Write the failing helper tests**

`ui/src/lib/crop.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_CROP, MAX_ZOOM, MIN_ZOOM, panBy, zoomBy } from "./crop";

describe("zoomBy", () => {
  it("never goes below the neutral zoom", () => {
    expect(zoomBy(1, 500)).toBe(MIN_ZOOM);
  });
  it("never exceeds the maximum zoom", () => {
    expect(zoomBy(7, -5000)).toBe(MAX_ZOOM);
  });
  it("is monotonic in the wheel delta", () => {
    expect(zoomBy(2, -100)).toBeGreaterThan(2);
    expect(zoomBy(2, 100)).toBeLessThan(2);
  });
});

describe("panBy", () => {
  it("converts pixel deltas to clamped fractions", () => {
    const moved = panBy(DEFAULT_CROP, 100, -100, 400, 400);
    expect(moved.offsetX).toBeCloseTo(0.5);
    expect(moved.offsetY).toBeCloseTo(-0.5);
  });
  it("clamps to the pan range", () => {
    const moved = panBy(DEFAULT_CROP, 10000, 10000, 400, 400);
    expect(moved.offsetX).toBe(1);
    expect(moved.offsetY).toBe(1);
  });
  it("does not change the fit or zoom", () => {
    const moved = panBy({ ...DEFAULT_CROP, fit: "contain", zoom: 3 }, 10, 10, 400, 400);
    expect(moved.fit).toBe("contain");
    expect(moved.zoom).toBe(3);
  });
});
```

`ui/src/lib/budget.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { budgetError } from "./budget";

describe("budgetError", () => {
  it("accepts a valid animation", () => {
    expect(budgetError({ totalFrames: 36, delayMs: 60 })).toBeNull();
  });
  it("rejects more than 36 frames and names the count", () => {
    expect(budgetError({ totalFrames: 37, delayMs: 100 })).toContain("37");
  });
  it("rejects a delay below 60 ms and names it", () => {
    expect(budgetError({ totalFrames: 2, delayMs: 59 })).toContain("59");
  });
  it("rejects an empty animation", () => {
    expect(budgetError({ totalFrames: 0, delayMs: 100 })).not.toBeNull();
  });
});
```

`ui/src/lib/effects.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LED_COLORS, LED_MODES, UNDERGLOW_EFFECTS } from "./effects";

describe("effect tables", () => {
  it("has the 19 named underglow effects, in device order", () => {
    expect(UNDERGLOW_EFFECTS).toHaveLength(19);
    expect(UNDERGLOW_EFFECTS[0]).toEqual({ name: "Off", value: 0 });
    expect(UNDERGLOW_EFFECTS[5]).toEqual({ name: "Breathing", value: 5 });
    expect(UNDERGLOW_EFFECTS[18]).toEqual({ name: "Slow rainbow from center", value: 18 });
  });
  it("has the five LED modes and nine LED colours", () => {
    expect(LED_MODES).toHaveLength(5);
    expect(LED_MODES[3]).toEqual({ name: "Fixed color", value: 3 });
    expect(LED_COLORS).toHaveLength(9);
    expect(LED_COLORS[8]).toEqual({ name: "Off", value: 8 });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run, from `ui/`: `bun run test`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Implement the pure helpers**

`ui/src/lib/crop.ts`:

```ts
export type Fit = "cover" | "contain";

export interface CropParams {
  offsetX: number;
  offsetY: number;
  zoom: number;
  fit: Fit;
}

export const DEFAULT_CROP: CropParams = { offsetX: 0, offsetY: 0, zoom: 1, fit: "cover" };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Wheel delta (positive = scroll down = zoom out), logarithmically. */
export function zoomBy(current: number, delta: number): number {
  return clamp(current * Math.exp(-delta * 0.002), MIN_ZOOM, MAX_ZOOM);
}

/** Pointer pixel delta inside a box of `boxWidth`×`boxHeight` → pan fractions. */
export function panBy(
  current: CropParams,
  dx: number,
  dy: number,
  boxWidth: number,
  boxHeight: number,
): CropParams {
  return {
    ...current,
    offsetX: clamp(current.offsetX + (dx / boxWidth) * 2, -1, 1),
    offsetY: clamp(current.offsetY + (dy / boxHeight) * 2, -1, 1),
  };
}
```

`ui/src/lib/budget.ts`:

```ts
export const MAX_TOTAL_FRAMES = 36;
export const MIN_FRAME_DELAY_MS = 60;

export interface Budget {
  totalFrames: number;
  delayMs: number;
}

export function budgetError({ totalFrames, delayMs }: Budget): string | null {
  if (totalFrames < 1) return "No frames to upload.";
  if (totalFrames > MAX_TOTAL_FRAMES) {
    return `Animation is ${totalFrames} frames, over the ${MAX_TOTAL_FRAMES}-frame budget across both slots.`;
  }
  if (delayMs < MIN_FRAME_DELAY_MS) {
    return `Frame delay of ${delayMs} ms is below the ${MIN_FRAME_DELAY_MS} ms minimum.`;
  }
  return null;
}
```

`ui/src/lib/effects.ts`:

```ts
export interface NamedValue {
  name: string;
  value: number;
}

/** The 19 underglow effects, in device order (spec §3.5). */
export const UNDERGLOW_EFFECTS: readonly NamedValue[] = [
  { name: "Off", value: 0 },
  { name: "Horizontal dimming wave", value: 1 },
  { name: "Horizontal pulse wave", value: 2 },
  { name: "Waterfall", value: 3 },
  { name: "Full cycling colors", value: 4 },
  { name: "Breathing", value: 5 },
  { name: "Full one color", value: 6 },
  { name: "Glow pressed key", value: 7 },
  { name: "Glow spreading", value: 8 },
  { name: "Glow row", value: 9 },
  { name: "Random pattern", value: 10 },
  { name: "Rainbow cycle", value: 11 },
  { name: "Rainbow waterfall", value: 12 },
  { name: "Wave from center", value: 13 },
  { name: "Circling J/K", value: 14 },
  { name: "Raining", value: 15 },
  { name: "Wave left-right", value: 16 },
  { name: "Slow saturation cycle", value: 17 },
  { name: "Slow rainbow from center", value: 18 },
];

export const LED_MODES: readonly NamedValue[] = [
  { name: "Blinking one color", value: 0 },
  { name: "Pulse rainbow", value: 1 },
  { name: "Blinking one color (alternate)", value: 2 },
  { name: "Fixed color", value: 3 },
  { name: "Fixed color (alternate)", value: 4 },
];

export const LED_COLORS: readonly NamedValue[] = [
  { name: "Red", value: 0 },
  { name: "Orange", value: 1 },
  { name: "Yellow", value: 2 },
  { name: "Green", value: 3 },
  { name: "Teal", value: 4 },
  { name: "Blue", value: 5 },
  { name: "Purple", value: 6 },
  { name: "White", value: 7 },
  { name: "Off", value: 8 },
];

export const LED_COLOR_SWATCHES: Readonly<Record<number, string>> = {
  0: "#e5484d",
  1: "#f76b15",
  2: "#ffd60a",
  3: "#46a758",
  4: "#12a594",
  5: "#0091ff",
  6: "#8e4ec6",
  7: "#f2f2f2",
  8: "#3a3a3c",
};
```

- [ ] **Step 4: Run the helper tests to verify they pass**

Run, from `ui/`: `bun run test`
Expected: PASS — crop, budget and effects suites.

- [ ] **Step 5: Implement the IPC layer and store**

`ui/src/lib/ipc.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CropParams, Fit } from "./crop";

export interface DeviceInfo {
  path: string;
  label: string;
  transport: "wired" | "wireless24g";
  productId: number;
  hasVia: boolean;
}

export interface DeviceState {
  connected: boolean;
  synced: boolean;
  underglow: {
    effect: number;
    brightness: number;
    speed: number;
    orientation: number;
    rainbow: number;
    color: [number, number, number];
  };
  led: { mode: number; saturation: number; rainbow: number; color: number };
  winLock: boolean;
  show: number;
  slot0Frames: number;
  slot1Frames: number;
  frameDelayMs: number;
  time: [number, number, number, number, number, number, number];
}

export interface Preset {
  name: string;
  description: string;
}

export interface LightingPatch {
  underglowEffect?: number;
  underglowBrightness?: number;
  underglowSpeed?: number;
  underglowOrientation?: number;
  underglowRainbow?: number;
  underglowColor?: [number, number, number];
  winLock?: boolean;
  ledMode?: number;
  ledSaturation?: number;
  ledRainbow?: number;
  ledColor?: number;
}

export interface DisplayJob {
  slot: "slot0" | "slot1";
  bytes: number[];
  crop: { offsetX: number; offsetY: number; zoom: number; fit: Fit };
  delayMs: number;
  showAfter: boolean;
}

export interface UploadProgress {
  bytesSent: number;
  totalBytes: number;
}

export interface AppError {
  kind: string;
  message: string;
}

export function listDevices(): Promise<DeviceInfo[]> {
  return invoke("list_devices");
}
export function connect(path: string): Promise<DeviceState> {
  return invoke("connect", { path });
}
export function disconnect(): Promise<void> {
  return invoke("disconnect");
}
export function readState(): Promise<DeviceState> {
  return invoke("read_state");
}
export function setLighting(patch: LightingPatch): Promise<DeviceState> {
  return invoke("set_lighting", { patch });
}
export function syncClock(): Promise<DeviceState> {
  return invoke("sync_clock");
}
export function listPresets(): Promise<Preset[]> {
  return invoke("list_presets");
}
export function applyPreset(name: string): Promise<DeviceState> {
  return invoke("apply_preset", { name });
}
export function previewDisplay(bytes: Uint8Array, crop: CropParams): Promise<number[]> {
  return invoke("preview_display", {
    job: {
      bytes: Array.from(bytes),
      crop: { ...crop, fit: crop.fit as Fit },
    },
  });
}
export function uploadDisplay(job: DisplayJob): Promise<void> {
  return invoke("upload_display", { job });
}
export function cancelUpload(): Promise<void> {
  return invoke("cancel_upload");
}
export function copyDiagnostics(): Promise<string> {
  return invoke("copy_diagnostics");
}
export function onUploadProgress(
  handler: (progress: UploadProgress) => void,
): Promise<UnlistenFn> {
  return listen<UploadProgress>("upload://progress", (event) => handler(event.payload));
}
export function onDeviceDisconnected(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen<string>("device://disconnected", (event) => handler(event.payload));
}
```

`ui/src/store.ts`:

```ts
import { create } from "zustand";
import * as ipc from "./lib/ipc";
import { DEFAULT_CROP, type CropParams } from "./lib/crop";

export type Slot = "slot0" | "slot1";

interface AppStore {
  devices: ipc.DeviceInfo[];
  state: ipc.DeviceState | null;
  connected: boolean;
  error: string | null;
  crop: CropParams;
  slot: Slot;
  source: { bytes: Uint8Array; name: string } | null;
  previewUrl: string | null;
  progress: ipc.UploadProgress | null;
  uploads: number;

  refreshDevices: () => Promise<void>;
  connectTo: (path: string) => Promise<void>;
  disconnectDevice: () => Promise<void>;
  setCrop: (crop: CropParams) => void;
  setSlot: (slot: Slot) => void;
  loadSource: (bytes: Uint8Array, name: string) => void;
  refreshPreview: () => Promise<void>;
  upload: (delayMs: number, showAfter: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  applyLighting: (patch: ipc.LightingPatch) => Promise<void>;
  applyPreset: (name: string) => Promise<void>;
  syncClock: () => Promise<void>;
  dismissError: () => void;
}

function message(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export const useAppStore = create<AppStore>((set, get) => ({
  devices: [],
  state: null,
  connected: false,
  error: null,
  crop: { ...DEFAULT_CROP },
  slot: "slot0",
  source: null,
  previewUrl: null,
  progress: null,
  uploads: 0,

  refreshDevices: async () => {
    try {
      set({ devices: await ipc.listDevices() });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  connectTo: async (path) => {
    try {
      const state = await ipc.connect(path);
      set({ state, connected: state.connected, error: null });
      await get().refreshPreview();
    } catch (error) {
      set({ error: message(error) });
    }
  },

  disconnectDevice: async () => {
    await ipc.disconnect();
    set({ state: null, connected: false });
  },

  setCrop: (crop) => {
    set({ crop });
    void get().refreshPreview();
  },
  setSlot: (slot) => set({ slot }),
  loadSource: (bytes, name) => {
    set({ source: { bytes, name } });
    void get().refreshPreview();
  },

  refreshPreview: async () => {
    const { source, crop } = get();
    if (!source) {
      set({ previewUrl: null });
      return;
    }
    try {
      const png = await ipc.previewDisplay(source.bytes, crop);
      const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
      set({ previewUrl: URL.createObjectURL(blob), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },

  upload: async (delayMs, showAfter) => {
    const { source, crop, slot } = get();
    if (!source) {
      set({ error: "Choose an image or GIF first." });
      return;
    }
    set({ uploads: get().uploads + 1, progress: { bytesSent: 0, totalBytes: 0 } });
    try {
      await ipc.uploadDisplay({
        slot,
        bytes: Array.from(source.bytes),
        crop,
        delayMs,
        showAfter,
      });
      set({ state: await ipc.readState(), error: null });
    } catch (error) {
      set({ error: message(error) });
    } finally {
      set({ uploads: Math.max(0, get().uploads - 1), progress: null });
    }
  },

  cancel: async () => {
    await ipc.cancelUpload();
  },

  applyLighting: async (patch) => {
    try {
      set({ state: await ipc.setLighting(patch), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  applyPreset: async (name) => {
    try {
      set({ state: await ipc.applyPreset(name), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  syncClock: async () => {
    try {
      set({ state: await ipc.syncClock(), error: null });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  dismissError: () => set({ error: null }),
}));
```

- [ ] **Step 6: Write and run the store test**

`ui/src/store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/ipc", () => ({
  listDevices: vi.fn(async () => [
    { path: "/dev/hidraw12", label: "GMK87 (wired)", transport: "wired", productId: 0x5055, hasVia: true },
  ]),
  connect: vi.fn(async () => ({ connected: true }) as never),
  disconnect: vi.fn(async () => {}),
  readState: vi.fn(),
  setLighting: vi.fn(),
  syncClock: vi.fn(),
  listPresets: vi.fn(async () => []),
  applyPreset: vi.fn(),
  previewDisplay: vi.fn(async () => [137, 80, 78, 71]),
  uploadDisplay: vi.fn(async () => {}),
  cancelUpload: vi.fn(async () => {}),
  copyDiagnostics: vi.fn(),
}));

import { useAppStore } from "./store";

describe("store", () => {
  beforeEach(() => {
    useAppStore.setState({ devices: [], connected: false, error: null, source: null, previewUrl: null });
  });

  it("loads devices", async () => {
    await useAppStore.getState().refreshDevices();
    expect(useAppStore.getState().devices).toHaveLength(1);
  });

  it("refuses to upload without a source", async () => {
    await useAppStore.getState().upload(100, true);
    expect(useAppStore.getState().error).toContain("Choose an image");
  });

  it("produces a preview URL once a source is loaded", async () => {
    useAppStore.getState().loadSource(new Uint8Array([1, 2, 3]), "x.png");
    await vi.waitFor(() => expect(useAppStore.getState().previewUrl).not.toBeNull());
  });
});
```

Run, from `ui/`: `bun run test`
Expected: PASS — all frontend suites.

- [ ] **Step 7: Commit**

```bash
git add ui
git commit -m "feat(ui): typed IPC layer, app store and crop/budget/effect helpers"
```

---

### Task 11: App shell — tabs, status bar, error surface

**Files:**
- Modify: `ui/src/App.tsx`
- Create: `ui/src/components/StatusBar.tsx`
- Create: `ui/src/components/ErrorBanner.tsx`
- Test: `ui/src/App.test.tsx`

**Interfaces:**
- Consumes: `useAppStore`, `cn`, shadcn `Tabs`.
- Produces: the four-tab shell; the Device tab lists `ui/src/screens/DeviceScreen.tsx` (added in Task 12) and the other three are placeholder panels until their tasks.

- [ ] **Step 1: Write the failing shell test**

`ui/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => []) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

import App from "./App";

describe("App shell", () => {
  it("renders the four screens", () => {
    render(<App />);
    for (const label of ["Device", "Display", "Lighting", "Clock"]) {
      expect(screen.getByRole("tab", { name: label })).toBeInTheDocument();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `ui/`: `bun run test App`
Expected: FAIL — no tabs are rendered.

- [ ] **Step 3: Implement the shell**

`ui/src/components/ErrorBanner.tsx`:

```tsx
import { useAppStore } from "@/store";

export function ErrorBanner() {
  const error = useAppStore((s) => s.error);
  const dismiss = useAppStore((s) => s.dismissError);
  if (!error) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <span>{error}</span>
      <button className="underline" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
```

`ui/src/components/StatusBar.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useAppStore } from "@/store";

export function StatusBar() {
  const connected = useAppStore((s) => s.connected);
  const uploads = useAppStore((s) => s.uploads);
  const progress = useAppStore((s) => s.progress);
  const [label, setLabel] = useState("Disconnected");

  useEffect(() => {
    setLabel(connected ? "Connected" : "Disconnected");
  }, [connected]);

  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : null;

  return (
    <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2 text-xs text-white/60">
      <span
        className={connected ? "size-2 rounded-full bg-emerald-400" : "size-2 rounded-full bg-red-400"}
        aria-hidden
      />
      <span>{label}</span>
      {uploads > 0 && (
        <span className="ml-auto">Uploading {percent !== null ? `— ${percent}%` : "…"}</span>
      )}
    </div>
  );
}
```

`ui/src/App.tsx`:

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusBar } from "@/components/StatusBar";
import DeviceScreen from "@/screens/DeviceScreen";
import DisplayScreen from "@/screens/DisplayScreen";
import LightingScreen from "@/screens/LightingScreen";
import ClockScreen from "@/screens/ClockScreen";

export default function App() {
  return (
    <div className="flex h-full flex-col">
      <StatusBar />
      <div className="px-4 pt-3">
        <ErrorBanner />
      </div>
      <Tabs defaultValue="device" className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <TabsList>
          <TabsTrigger value="device">Device</TabsTrigger>
          <TabsTrigger value="display">Display</TabsTrigger>
          <TabsTrigger value="lighting">Lighting</TabsTrigger>
          <TabsTrigger value="clock">Clock</TabsTrigger>
        </TabsList>
        <TabsContent value="device" className="min-h-0 flex-1">
          <DeviceScreen />
        </TabsContent>
        <TabsContent value="display" className="min-h-0 flex-1">
          <DisplayScreen />
        </TabsContent>
        <TabsContent value="lighting" className="min-h-0 flex-1">
          <LightingScreen />
        </TabsContent>
        <TabsContent value="clock" className="min-h-0 flex-1">
          <ClockScreen />
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

Create the four screen files as minimal placeholders now (their tasks replace them):

`ui/src/screens/DeviceScreen.tsx`, `DisplayScreen.tsx`, `LightingScreen.tsx`, `ClockScreen.tsx` each:

```tsx
export default function DeviceScreen() {
  return <div className="pt-3 text-sm text-white/50">Device</div>;
}
```

(with the matching component name).

- [ ] **Step 4: Run the tests to verify they pass**

Run, from `ui/`: `bun run test && bun run build`
Expected: PASS, and the type-checked build succeeds.

- [ ] **Step 5: Commit**

```bash
git add ui
git commit -m "feat(ui): tabbed shell with status bar and error banner"
```

---

### Task 12: Device screen

**Files:**
- Modify: `ui/src/screens/DeviceScreen.tsx`
- Test: `ui/src/screens/DeviceScreen.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`devices`, `connected`, `state`, `refreshDevices`, `connectTo`, `disconnectDevice`), shadcn `Button`, `Card`, `Badge`.
- Produces: a device list with a Connect button per transport, a Connect/Disconnect toggle, the VIA notice, and a diagnostics copy action.

- [ ] **Step 1: Write the failing screen test**

`ui/src/screens/DeviceScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connectTo = vi.fn(async () => {});
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      devices: [
        { path: "/dev/hidraw12", label: "GMK87 (wired)", transport: "wired", productId: 0x5055, hasVia: true },
      ],
      connected: false,
      state: null,
      refreshDevices: vi.fn(async () => {}),
      connectTo,
      disconnectDevice: vi.fn(async () => {}),
    }),
}));

import DeviceScreen from "./DeviceScreen";

describe("DeviceScreen", () => {
  beforeEach(() => connectTo.mockClear());

  it("lists each transport with its label", () => {
    render(<DeviceScreen />);
    expect(screen.getByText("GMK87 (wired)")).toBeInTheDocument();
  });

  it("connects to the chosen path", async () => {
    render(<DeviceScreen />);
    await userEvent.click(screen.getByRole("button", { name: /connect/i }));
    expect(connectTo).toHaveBeenCalledWith("/dev/hidraw12");
  });

  it("shows the VIA notice when the interface is present", () => {
    render(<DeviceScreen />);
    expect(screen.getByText(/remapping/i)).toBeInTheDocument();
  });
});
```

Add `@testing-library/user-event` to `ui/package.json` dev-dependencies (`^14`) and run `bun install`.

- [ ] **Step 2: Run the test to verify it fails**

Run, from `ui/`: `bun run test DeviceScreen`
Expected: FAIL — the placeholder renders no device list.

- [ ] **Step 3: Implement the screen**

`ui/src/screens/DeviceScreen.tsx`:

```tsx
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/store";

export default function DeviceScreen() {
  const devices = useAppStore((s) => s.devices);
  const connected = useAppStore((s) => s.connected);
  const state = useAppStore((s) => s.state);
  const refreshDevices = useAppStore((s) => s.refreshDevices);
  const connectTo = useAppStore((s) => s.connectTo);
  const disconnectDevice = useAppStore((s) => s.disconnectDevice);

  useEffect(() => {
    void refreshDevices();
  }, [refreshDevices]);

  return (
    <div className="flex max-w-xl flex-col gap-3 pt-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Devices</h2>
        <Button variant="outline" size="sm" onClick={() => void refreshDevices()}>
          Refresh
        </Button>
      </div>

      {devices.length === 0 && (
        <p className="text-sm text-white/50">
          No GMK87 found. Check the USB cable and the udev rule on the Device screen.
        </p>
      )}

      {devices.map((device) => (
        <Card key={device.path}>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">{device.label}</CardTitle>
            {device.hasVia && <Badge variant="secondary">VIA detect</Badge>}
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-white/60">
            <span className="font-mono text-xs">{device.path}</span>
            {device.hasVia && (
              <span>Remapping is available in a future version.</span>
            )}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={connected}
                onClick={() => void connectTo(device.path)}
              >
                Connect
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!connected}
                onClick={() => void disconnectDevice()}
              >
                Disconnect
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {state && (
        <p className="text-xs text-white/40">
          {state.synced ? "Settings written and acknowledged." : "Connected; nothing written yet."}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run, from `ui/`: `bun run test DeviceScreen && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui
git commit -m "feat(ui): device list, connect/disconnect and VIA notice"
```

---

### Task 13: Display screen — picker, source inspection, budget, preview

**Files:**
- Create: `crates/gmk87-app/src/inspect.rs`
- Modify: `crates/gmk87-app/src/lib.rs`
- Test: `crates/gmk87-app/tests/inspect.rs`
- Modify: `src-tauri/src/dto.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `ui/src/lib/ipc.ts`
- Modify: `ui/src/store.ts`
- Modify: `ui/src/screens/DisplayScreen.tsx`
- Test: `ui/src/screens/DisplayScreen.test.tsx`

**Interfaces:**
- Consumes: Task 10's helpers and store.
- Produces:
  - `gmk87_app::inspect::{SourceInfo, inspect}` — `SourceInfo { is_gif: bool, frames: u32, delay_ms: u16 }`; `inspect(bytes, &CropSpec, delay_ms) -> Result<SourceInfo, AppError>`.
  - Tauri `inspect_source(job: PreviewJob) -> Result<SourceInfoDto, AppError>`.
  - `ipc.inspectSource(bytes, crop) -> Promise<{ isGif, frames, delayMs }>`; store fields `sourceInfo` and `totalFrames`.
  - A Display screen with a file picker, slot tabs, a 240×135 preview of the Rust-rendered PNG, a frame-budget meter, and a delay control.

- [ ] **Step 1: Write the failing inspection test**

`crates/gmk87-app/tests/inspect.rs`:

```rust
use gmk87_app::inspect::inspect;
use gmk87_protocol::image::CropSpec;

fn png() -> Vec<u8> {
    let img = image::RgbImage::from_fn(64, 64, |_, _| image::Rgb([10, 20, 30]));
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

fn gif(frames: usize, delay_centisec: u16) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, 8, 8, &[]).unwrap();
        for _ in 0..frames {
            let mut f = gif::Frame::from_rgb(8, 8, &[7u8; 8 * 8 * 3]);
            f.delay = delay_centisec;
            enc.write_frame(&f).unwrap();
        }
    }
    out
}

#[test]
fn reports_a_static_image_as_one_frame() {
    let info = inspect(&png(), &CropSpec::default(), 0).unwrap();
    assert!(!info.is_gif);
    assert_eq!(info.frames, 1);
    assert_eq!(info.delay_ms, 100);
}

#[test]
fn reports_a_gifs_frame_count_and_delay() {
    let info = inspect(&gif(4, 8), &CropSpec::default(), 0).unwrap();
    assert!(info.is_gif);
    assert_eq!(info.frames, 4);
    assert_eq!(info.delay_ms, 80);
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p gmk87-app --test inspect`
Expected: FAIL — `gmk87_app::inspect` does not exist.

- [ ] **Step 3: Implement inspection, the command and the IPC**

`crates/gmk87-app/src/inspect.rs`:

```rust
//! Frame count and delay for a chosen source, for the budget meter.

use crate::error::AppError;
use crate::job::{decode_frames, is_gif};
use gmk87_protocol::image::CropSpec;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    pub is_gif: bool,
    pub frames: u32,
    pub delay_ms: u16,
}

pub fn inspect(bytes: &[u8], crop: &CropSpec, delay_ms: u16) -> Result<SourceInfo, AppError> {
    let (frames, delay_ms) = decode_frames(bytes, crop, delay_ms)?;
    Ok(SourceInfo {
        is_gif: is_gif(bytes),
        frames: frames.len() as u32,
        delay_ms,
    })
}
```

Append `pub mod inspect;` to `crates/gmk87-app/src/lib.rs`.

In `src-tauri/src/dto.rs`, add:

```rust
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfoDto {
    pub is_gif: bool,
    pub frames: u32,
    pub delay_ms: u16,
}

impl From<gmk87_app::inspect::SourceInfo> for SourceInfoDto {
    fn from(info: gmk87_app::inspect::SourceInfo) -> Self {
        Self {
            is_gif: info.is_gif,
            frames: info.frames,
            delay_ms: info.delay_ms,
        }
    }
}
```

In `src-tauri/src/commands.rs`, add:

```rust
#[tauri::command]
pub async fn inspect_source(job: PreviewJob) -> Result<crate::dto::SourceInfoDto, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        gmk87_app::inspect::inspect(&job.bytes, &job.crop.to_spec(), 0)
            .map(crate::dto::SourceInfoDto::from)
    })
    .await
    .map_err(join_error)?
}
```

Add `commands::inspect_source` to `generate_handler!` in `src-tauri/src/lib.rs`.

In `ui/src/lib/ipc.ts`, add:

```ts
export interface SourceInfo {
  isGif: boolean;
  frames: number;
  delayMs: number;
}

export function inspectSource(bytes: Uint8Array, crop: CropParams): Promise<SourceInfo> {
  return invoke("inspect_source", { job: { bytes: Array.from(bytes), crop } });
}
```

In `ui/src/store.ts`, add four fields to the `AppStore` interface (alongside the existing ones):

```ts
  sourceInfo: ipc.SourceInfo | null;
  totalFrames: number;
  delayMs: number;
  setDelayMs: (ms: number) => void;
```

In `loadSource`, after setting the source, call inspect:

```ts
  loadSource: async (bytes, name) => {
    set({ source: { bytes, name }, sourceInfo: null });
    void get().refreshPreview();
    try {
      const info = await ipc.inspectSource(bytes, get().crop);
      set({ sourceInfo: info, delayMs: info.delayMs, totalFrames: info.frames + 1 });
    } catch (error) {
      set({ error: message(error) });
    }
  },
  setDelayMs: (delayMs) => set({ delayMs }),
```

Initial state gains `sourceInfo: null, totalFrames: 0, delayMs: 100`.

(`totalFrames` counts the target slot's frames plus the other slot's single retained frame — the device always streams both slots.)

- [ ] **Step 4: Implement the Display screen**

`ui/src/screens/DisplayScreen.tsx`:

```tsx
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { budgetError } from "@/lib/budget";
import { useAppStore } from "@/store";

export default function DisplayScreen() {
  const fileInput = useRef<HTMLInputElement>(null);
  const slot = useAppStore((s) => s.slot);
  const setSlot = useAppStore((s) => s.setSlot);
  const source = useAppStore((s) => s.source);
  const sourceInfo = useAppStore((s) => s.sourceInfo);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const totalFrames = useAppStore((s) => s.totalFrames);
  const delayMs = useAppStore((s) => s.delayMs);
  const setDelayMs = useAppStore((s) => s.setDelayMs);
  const loadSource = useAppStore((s) => s.loadSource);

  const problem = budgetError({ totalFrames, delayMs });

  async function onFile(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    void loadSource(bytes, file.name);
  }

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_320px] gap-4 pt-3">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Tabs value={slot} onValueChange={(v) => setSlot(v as "slot0" | "slot1")}>
            <TabsList>
              <TabsTrigger value="slot0">Slot 0</TabsTrigger>
              <TabsTrigger value="slot1">Slot 1</TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            Choose image or GIF
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.gif"
            className="hidden"
            aria-label="Choose image or GIF"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onFile(file);
            }}
          />
        </div>

        <div className="flex aspect-[240/135] w-full max-w-2xl items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
          {previewUrl ? (
            <img src={previewUrl} alt="Display preview" className="size-full object-contain [image-rendering:pixelated]" />
          ) : (
            <span className="text-sm text-white/40">240 × 135 preview</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4 text-sm">
        <div>
          <div className="mb-1 flex justify-between text-white/60">
            <span>Frame delay</span>
            <span>{delayMs} ms</span>
          </div>
          <Slider
            min={60}
            max={500}
            step={10}
            value={[delayMs]}
            onValueChange={([value]) => setDelayMs(value)}
          />
        </div>

        <div className="rounded-md border border-white/10 p-3">
          <div className="flex justify-between">
            <span className="text-white/60">Frames across both slots</span>
            <span>{totalFrames} / 36</span>
          </div>
          {sourceInfo && <p className="mt-1 text-xs text-white/40">{source?.name}</p>}
          {problem && <p className="mt-2 text-xs text-amber-300">{problem}</p>}
        </div>

        <p className="text-xs text-white/40">
          Both display slots are always sent together: the keyboard rewrites all of its image
          memory on every upload, so the untouched slot is resent as-is.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Write and run the screen test**

`ui/src/screens/DisplayScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      slot: "slot0",
      setSlot: vi.fn(),
      source: { bytes: new Uint8Array(), name: "cat.png" },
      sourceInfo: { isGif: false, frames: 1, delayMs: 100 },
      previewUrl: null,
      totalFrames: 2,
      delayMs: 100,
      setDelayMs: vi.fn(),
      loadSource: vi.fn(),
    }),
}));

import DisplayScreen from "./DisplayScreen";

describe("DisplayScreen", () => {
  it("shows the frame budget", () => {
    render(<DisplayScreen />);
    expect(screen.getByText("2 / 36")).toBeInTheDocument();
  });
  it("offers a file picker", () => {
    render(<DisplayScreen />);
    expect(screen.getByLabelText("Choose image or GIF")).toBeInTheDocument();
  });
});
```

Run: `cargo test -p gmk87-app && cd ui && bun run test DisplayScreen && bun run build`
Expected: PASS. Then from `src-tauri/`: `cargo test && cargo clippy --all-targets -- -D warnings`.

- [ ] **Step 6: Commit**

```bash
git add crates/gmk87-app src-tauri ui
git commit -m "feat(app): source inspection command and the display screen with budget meter"
```

---

### Task 14: Crop editor and upload controls

**Files:**
- Create: `ui/src/components/CropEditor.tsx`
- Create: `ui/src/components/UploadControls.tsx`
- Modify: `ui/src/screens/DisplayScreen.tsx`
- Test: `ui/src/components/CropEditor.test.tsx`

**Interfaces:**
- Consumes: `panBy`, `zoomBy`, `useAppStore`.
- Produces: `CropEditor` rendering the Rust preview inside an overlay that pans on drag and zooms on wheel; `UploadControls` with an Upload button, a progress bar, and a Cancel button.

- [ ] **Step 1: Write the failing crop-editor test**

`ui/src/components/CropEditor.test.tsx`:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_CROP } from "@/lib/crop";

const setCrop = vi.fn();
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ crop: DEFAULT_CROP, setCrop, previewUrl: null }),
}));

import { CropEditor } from "./CropEditor";

describe("CropEditor", () => {
  it("pans on drag by calling setCrop", () => {
    render(<CropEditor />);
    const surface = screen.getByTestId("crop-surface");
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 40, clientY: 0, pointerId: 1 });
    fireEvent.pointerUp(surface, { pointerId: 1 });
    expect(setCrop).toHaveBeenCalled();
    const next = setCrop.mock.calls.at(-1)![0];
    expect(next.offsetX).toBeGreaterThan(0);
  });

  it("zooms on wheel", () => {
    render(<CropEditor />);
    fireEvent.wheel(screen.getByTestId("crop-surface"), { deltaY: -100 });
    expect(setCrop).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `ui/`: `bun run test CropEditor`
Expected: FAIL — the component does not exist.

- [ ] **Step 3: Implement the crop editor and upload controls**

`ui/src/components/CropEditor.tsx`:

```tsx
import { useRef, useState } from "react";
import { panBy, zoomBy, type CropParams } from "@/lib/crop";
import { useAppStore } from "@/store";

export function CropEditor() {
  const crop = useAppStore((s) => s.crop);
  const setCrop = useAppStore((s) => s.setCrop);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [, force] = useState(0);

  function box() {
    const rect = surface.current?.getBoundingClientRect();
    return { width: rect?.width ?? 480, height: rect?.height ?? 270 };
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    drag.current = { x: event.clientX, y: event.clientY };
    const { width, height } = box();
    setCrop(panBy(crop, dx, dy, width, height));
    force((n) => n + 1);
  }

  function nextZoom(delta: number): CropParams {
    return { ...crop, zoom: zoomBy(crop.zoom, delta) };
  }

  return (
    <div
      ref={surface}
      data-testid="crop-surface"
      className="relative aspect-[240/135] w-full max-w-2xl cursor-grab touch-none select-none overflow-hidden rounded-lg border border-white/10 bg-black"
      onPointerDown={(event) => {
        drag.current = { x: event.clientX, y: event.clientY };
        (event.target as HTMLElement).setPointerCapture(event.pointerId);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        drag.current = null;
      }}
      onWheel={(event) => {
        event.preventDefault();
        setCrop(nextZoom(event.deltaY));
      }}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt="Display preview"
          draggable={false}
          className="size-full object-cover [image-rendering:pixelated]"
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-sm text-white/40">
          Drag to pan · scroll to zoom
        </span>
      )}
      <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/60 px-2 py-0.5 text-[10px] text-white/60">
        {crop.zoom.toFixed(2)}×
      </div>
    </div>
  );
}
```

`ui/src/components/UploadControls.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAppStore } from "@/store";

export function UploadControls() {
  const uploads = useAppStore((s) => s.uploads);
  const progress = useAppStore((s) => s.progress);
  const upload = useAppStore((s) => s.upload);
  const cancel = useAppStore((s) => s.cancel);
  const delayMs = useAppStore((s) => s.delayMs);
  const totalFrames = useAppStore((s) => s.totalFrames);
  const source = useAppStore((s) => s.source);

  const busy = uploads > 0;
  const percent =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesSent / progress.totalBytes) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-2">
      <Button
        disabled={busy || !source}
        onClick={() => void upload(delayMs, true)}
      >
        Upload and show
      </Button>
      <Button
        variant="outline"
        disabled={!busy}
        onClick={() => void cancel()}
      >
        Cancel
      </Button>
      {busy && (
        <div className="flex flex-col gap-1">
          <Progress value={percent} />
          <span className="text-xs text-white/50">
            {percent}% · {totalFrames} frames
          </span>
        </div>
      )}
    </div>
  );
}
```

Replace the preview block in `ui/src/screens/DisplayScreen.tsx` with `<CropEditor />` and add `<UploadControls />` to the right column; update the test mock to include `uploads: 0`, `progress: null`, `upload: vi.fn()`, `cancel: vi.fn()`. `DisplayScreen` keeps its file picker and budget meter.

- [ ] **Step 4: Run the tests to verify they pass**

Run, from `ui/`: `bun run test && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui
git commit -m "feat(ui): crop/zoom editor and upload progress with cancel"
```

---

### Task 15: 3D keyboard preview (React Three Fiber)

**Files:**
- Create: `ui/src/components/keyboard.ts`
- Create: `ui/src/components/KeyboardPreview.tsx`
- Test: `ui/src/components/keyboard.test.ts`
- Modify: `ui/src/App.tsx` (mount the preview beside the tabs)

**Interfaces:**
- Consumes: `useAppStore` (`state`, `previewUrl`), `@react-three/fiber`, `@react-three/drei`.
- Produces:
  - `ui/src/components/keyboard.ts`: `keyboardLayout(): { position: [number, number, number]; size: [number, number, number] }[]` (procedural key geometry, no asset) and `underglowColor(state): string`.
  - `KeyboardPreview` — a `<Canvas>` with a case, the key grid, a display plane textured from `previewUrl`, and underglow point lights tinted by `underglowColor`.

- [ ] **Step 1: Write the failing helper test**

`ui/src/components/keyboard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { keyboardLayout, underglowColor } from "./keyboard";

describe("keyboardLayout", () => {
  it("lays out a plausible 87-key grid", () => {
    const keys = keyboardLayout();
    expect(keys.length).toBeGreaterThan(80);
    for (const key of keys) {
      expect(key.size[0]).toBeGreaterThan(0);
      expect(key.position[1]).toBeGreaterThanOrEqual(0);
    }
  });
  it("is deterministic", () => {
    expect(keyboardLayout()).toEqual(keyboardLayout());
  });
});

describe("underglowColor", () => {
  it("returns the RGB color when rainbow is off", () => {
    expect(underglowColor({ underglow: { rainbow: 0, color: [255, 0, 128] } })).toBe(
      "rgb(255, 0, 128)",
    );
  });
  it("returns a neutral hue when rainbow is on", () => {
    expect(underglowColor({ underglow: { rainbow: 1, color: [255, 0, 0] } })).toBe("#8b5cf6");
  });
  it("is dark when brightness is zero", () => {
    expect(underglowColor({ underglow: { rainbow: 0, color: [255, 255, 255] }, brightness: 0 }, 0)).toBe(
      "rgb(0, 0, 0)",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `ui/`: `bun run test keyboard`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the helpers and the preview**

`ui/src/components/keyboard.ts`:

```ts
export interface KeyBox {
  position: [number, number, number];
  size: [number, number, number];
}

/** A procedurally-built GMK87 key grid: no external model asset. */
export function keyboardLayout(): KeyBox[] {
  const unit = 0.19;
  const gap = 0.02;
  const rows = [15, 15, 15, 14, 13, 13];
  const keys: KeyBox[] = [];
  const depth = rows.length * (unit + gap);
  rows.forEach((columns, row) => {
    const width = columns * (unit + gap) - gap;
    for (let column = 0; column < columns; column += 1) {
      const x = -width / 2 + column * (unit + gap) + unit / 2;
      const z = -depth / 2 + row * (unit + gap) + unit / 2;
      keys.push({ position: [x, 0.06, z], size: [unit, 0.05, unit] });
    }
  });
  return keys;
}

interface UnderglowInput {
  underglow: { rainbow: number; color: [number, number, number] };
  brightness?: number;
}

/** The underglow tint for the preview, honouring brightness and rainbow. */
export function underglowColor(state: UnderglowInput, brightnessOverride?: number): string {
  const brightness = brightnessOverride ?? state.brightness ?? 9;
  const scale = brightness / 9;
  if (state.underglow.rainbow === 1) return "#8b5cf6";
  const [r, g, b] = state.underglow.color;
  return `rgb(${Math.round(r * scale)}, ${Math.round(g * scale)}, ${Math.round(b * scale)})`;
}
```

`ui/src/components/KeyboardPreview.tsx`:

```tsx
import { Canvas } from "@react-three/fiber";
import { OrbitControls, RoundedBox } from "@react-three/drei";
import { useTexture } from "@react-three/drei";
import { Suspense } from "react";
import { keyboardLayout, underglowColor } from "./keyboard";
import { useAppStore } from "@/store";

function Display({ url }: { url: string | null }) {
  const texture = useTexture(url ?? "");
  return (
    <mesh position={[0, 0.075, -0.62]}>
      <planeGeometry args={[1.4, 0.79]} />
      <meshBasicMaterial map={url ? texture : undefined} color={url ? "#ffffff" : "#111"} toneMapped={false} />
    </mesh>
  );
}

function Keyboard({ url, tint }: { url: string | null; tint: string }) {
  const keys = keyboardLayout();
  return (
    <group rotation={[-Math.PI / 7, 0, 0]}>
      <RoundedBox args={[3.5, 0.14, 2.0]} radius={0.05} position={[0, -0.05, 0.2]}>
        <meshStandardMaterial color="#1b1c20" metalness={0.4} roughness={0.6} />
      </RoundedBox>
      {keys.map((key, index) => (
        <mesh key={index} position={key.position} castShadow>
          <boxGeometry args={key.size} />
          <meshStandardMaterial color="#2a2c31" />
        </mesh>
      ))}
      <Suspense fallback={null}>
        <Display url={url} />
      </Suspense>
      <pointLight position={[0, -0.4, 0.6]} color={tint} intensity={6} distance={3} />
      <pointLight position={[0, -0.4, -0.6]} color={tint} intensity={6} distance={3} />
    </group>
  );
}

export function KeyboardPreview() {
  const state = useAppStore((s) => s.state);
  const previewUrl = useAppStore((s) => s.previewUrl);
  const tint = state ? underglowColor(state) : "#8b5cf6";

  return (
    <div className="relative h-[320px] w-full overflow-hidden rounded-lg border border-white/10 bg-gradient-to-b from-black to-neutral-900">
      <Canvas camera={{ position: [0, 1.6, 2.6], fov: 42 }}>
        <ambientLight intensity={0.4} />
        <directionalLight position={[2, 4, 3]} intensity={0.8} />
        <Keyboard url={previewUrl} tint={tint} />
        <OrbitControls enablePan={false} minDistance={2} maxDistance={5} />
      </Canvas>
      <span className="pointer-events-none absolute bottom-2 left-3 text-[10px] text-white/40">
        Preview · drag to orbit
      </span>
    </div>
  );
}
```

Mount it in `ui/src/App.tsx` in a right-hand column, e.g. wrap the `Tabs` in a grid with `<aside className="w-[360px]"><KeyboardPreview /></aside>`. Do not unit-test the `<Canvas>` (jsdom has no WebGL); only the pure helpers in `keyboard.ts` are tested.

- [ ] **Step 4: Run the tests and build**

Run, from `ui/`: `bun run test && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui
git commit -m "feat(ui): procedurally-built 3D keyboard preview with live display and underglow"
```

---

### Task 16: Lighting screen — named effects, colours and presets

**Files:**
- Modify: `ui/src/store.ts` (add `presets`, `loadPresets`)
- Modify: `ui/src/lib/ipc.ts` (already exports `listPresets`, `applyPreset`)
- Modify: `ui/src/screens/LightingScreen.tsx`
- Test: `ui/src/screens/LightingScreen.test.tsx`

**Interfaces:**
- Consumes: `UNDERGLOW_EFFECTS`, `LED_MODES`, `LED_COLORS`, `LED_COLOR_SWATCHES`, `useAppStore`.
- Produces: a Lighting screen with a named effect picker, brightness/speed/orientation/rainbow controls, an RGB colour input, a colour swatch row, LED mode/colour/saturation, a win-lock switch, and eight preset buttons.

- [ ] **Step 1: Write the failing screen test**

`ui/src/screens/LightingScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const applyPreset = vi.fn(async () => {});
const applyLighting = vi.fn(async () => {});
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({
      state: {
        underglow: { effect: 5, brightness: 9, speed: 1, orientation: 1, rainbow: 0, color: [255, 0, 0] },
        led: { mode: 3, saturation: 9, rainbow: 0, color: 0 },
        winLock: false,
      },
      presets: [
        { name: "gaming", description: "Aggressive red theme with fast effects" },
        { name: "matrix", description: "Green rain effect" },
      ],
      loadPresets: vi.fn(async () => {}),
      applyPreset,
      applyLighting,
    }),
}));

import LightingScreen from "./LightingScreen";

describe("LightingScreen", () => {
  it("lists all 19 named effects", () => {
    render(<LightingScreen />);
    expect(screen.getAllByRole("option")).toHaveLength(19);
  });
  it("applies a preset when its chip is clicked", async () => {
    render(<LightingScreen />);
    await userEvent.click(screen.getByRole("button", { name: /matrix/i }));
    expect(applyPreset).toHaveBeenCalledWith("matrix");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `ui/`: `bun run test LightingScreen`
Expected: FAIL — the placeholder renders nothing.

- [ ] **Step 3: Add presets to the store**

In `ui/src/store.ts`, add `presets: ipc.Preset[]` and `loadPresets: () => Promise<void>`:

```ts
  presets: [],
  loadPresets: async () => {
    try {
      set({ presets: await ipc.listPresets() });
    } catch (error) {
      set({ error: message(error) });
    }
  },
```

- [ ] **Step 4: Implement the screen**

`ui/src/screens/LightingScreen.tsx`:

```tsx
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { LED_COLORS, LED_COLOR_SWATCHES, LED_MODES, UNDERGLOW_EFFECTS } from "@/lib/effects";
import { useAppStore } from "@/store";

export default function LightingScreen() {
  const state = useAppStore((s) => s.state);
  const presets = useAppStore((s) => s.presets);
  const loadPresets = useAppStore((s) => s.loadPresets);
  const applyPreset = useAppStore((s) => s.applyPreset);
  const applyLighting = useAppStore((s) => s.applyLighting);

  useEffect(() => {
    void loadPresets();
  }, [loadPresets]);

  if (!state) {
    return <p className="pt-3 text-sm text-white/50">Connect a keyboard to edit lighting.</p>;
  }

  const { underglow, led } = state;

  return (
    <div className="flex max-w-3xl flex-col gap-6 pt-3 text-sm">
      <section className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <Button
            key={preset.name}
            variant="outline"
            size="sm"
            title={preset.description}
            onClick={() => void applyPreset(preset.name)}
          >
            {preset.name.replace(/-/g, " ")}
          </Button>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <Label htmlFor="effect">Underglow effect</Label>
        <select
          id="effect"
          className="h-9 rounded-md border border-white/15 bg-neutral-900 px-2"
          value={underglow.effect}
          onChange={(e) => void applyLighting({ underglowEffect: Number(e.target.value) })}
        >
          {UNDERGLOW_EFFECTS.map((effect) => (
            <option key={effect.value} value={effect.value}>
              {effect.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Brightness: {underglow.brightness}</Label>
            <Slider
              min={0}
              max={9}
              step={1}
              value={[underglow.brightness]}
              onValueChange={([v]) => void applyLighting({ underglowBrightness: v })}
            />
          </div>
          <div>
            <Label>Speed: {underglow.speed} (0 fast → 9 slow)</Label>
            <Slider
              min={0}
              max={9}
              step={1}
              value={[underglow.speed]}
              onValueChange={([v]) => void applyLighting({ underglowSpeed: v })}
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <label className="flex items-center gap-2">
            <Switch
              checked={underglow.rainbow === 1}
              onCheckedChange={(checked) => void applyLighting({ underglowRainbow: checked ? 1 : 0 })}
            />
            Rainbow
          </label>
          <label className="flex items-center gap-2">
            <Switch
              checked={underglow.orientation === 1}
              onCheckedChange={(checked) => void applyLighting({ underglowOrientation: checked ? 1 : 0 })}
            />
            Right to left
          </label>
          <label className="flex items-center gap-2">
            <span className="text-white/60">Colour</span>
            <input
              type="color"
              aria-label="Underglow colour"
              value={`#${underglow.color.map((c) => c.toString(16).padStart(2, "0")).join("")}`}
              onChange={(e) => {
                const hex = e.target.value;
                void applyLighting({
                  underglowColor: [
                    parseInt(hex.slice(1, 3), 16),
                    parseInt(hex.slice(3, 5), 16),
                    parseInt(hex.slice(5, 7), 16),
                  ],
                });
              }}
            />
          </label>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <Label>Side LED mode</Label>
        <select
          className="h-9 rounded-md border border-white/15 bg-neutral-900 px-2"
          value={led.mode}
          onChange={(e) => void applyLighting({ ledMode: Number(e.target.value) })}
        >
          {LED_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>
              {mode.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-2">
          {LED_COLORS.map((color) => (
            <button
              key={color.value}
              aria-label={color.name}
              title={color.name}
              className={
                led.color === color.value
                  ? "size-7 rounded-full ring-2 ring-white"
                  : "size-7 rounded-full ring-1 ring-white/20"
              }
              style={{ background: LED_COLOR_SWATCHES[color.value] }}
              onClick={() => void applyLighting({ ledColor: color.value })}
            />
          ))}
        </div>

        <div>
          <Label>LED saturation: {led.saturation}</Label>
          <Slider
            min={0}
            max={9}
            step={1}
            value={[led.saturation]}
            onValueChange={([v]) => void applyLighting({ ledSaturation: v })}
          />
        </div>
      </section>

      <label className="flex items-center gap-2">
        <Switch
          checked={state.winLock}
          onCheckedChange={(checked) => void applyLighting({ winLock: checked })}
        />
        Lock the Windows key
      </label>
    </div>
  );
}
```

The test's `getByRole("option")` count assumes the effect `<select>` is the only list of options rendered at first paint; the LED mode select also renders five options. Update the test to scope the query: give the effect select an accessible name via `aria-label="Underglow effect"` (the `<Label htmlFor="effect">` already names it) and query `within(screen.getByLabelText("Underglow effect")).getAllByRole("option")`. Adjust the test accordingly.

- [ ] **Step 5: Run the tests to verify they pass**

Run, from `ui/`: `bun run test && bun run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add ui
git commit -m "feat(ui): lighting screen with named effects, LED colours and presets"
```

---

### Task 17: Clock screen

**Files:**
- Modify: `ui/src/screens/ClockScreen.tsx`
- Test: `ui/src/screens/ClockScreen.test.tsx`

**Interfaces:**
- Consumes: `useAppStore` (`state`, `syncClock`).
- Produces: `formatDeviceTime(tuple)` and a screen showing the keyboard's stored time with a "Sync now" button.

- [ ] **Step 1: Write the failing test**

`ui/src/screens/ClockScreen.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const syncClock = vi.fn(async () => {});
vi.mock("@/store", () => ({
  useAppStore: (selector: (s: unknown) => unknown) =>
    selector({ state: { time: [2026, 11, 1, 6, 14, 5, 9] }, syncClock }),
}));

import ClockScreen, { formatDeviceTime } from "./ClockScreen";

describe("formatDeviceTime", () => {
  it("formats the tuple as a timestamp", () => {
    expect(formatDeviceTime([2026, 11, 1, 6, 14, 5, 9])).toBe("2026-11-01 14:05:09");
  });
});

describe("ClockScreen", () => {
  it("syncs on demand", async () => {
    render(<ClockScreen />);
    await userEvent.click(screen.getByRole("button", { name: /sync now/i }));
    expect(syncClock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run, from `ui/`: `bun run test ClockScreen`
Expected: FAIL.

- [ ] **Step 3: Implement the screen**

`ui/src/screens/ClockScreen.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store";

type DeviceTime = [number, number, number, number, number, number, number];

export function formatDeviceTime([year, month, day, _weekday, hour, minute, second]: DeviceTime): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

export default function ClockScreen() {
  const state = useAppStore((s) => s.state);
  const syncClock = useAppStore((s) => s.syncClock);

  return (
    <div className="flex max-w-md flex-col gap-4 pt-3 text-sm">
      <div className="rounded-lg border border-white/10 p-4">
        <p className="text-white/50">The keyboard currently shows</p>
        <p className="mt-1 font-mono text-2xl">
          {state ? formatDeviceTime(state.time as DeviceTime) : "—"}
        </p>
      </div>
      <Button onClick={() => void syncClock()} disabled={!state}>
        Sync now
      </Button>
      <p className="text-xs text-white/40">
        The keyboard cannot be read back, so this shows the last time the app wrote, not what the
        clock currently holds.
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run, from `ui/`: `bun run test && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ui
git commit -m "feat(ui): clock screen with device-time preview and manual sync"
```

---

### Task 18: Permission UX, diagnostics, CI and README

**Files:**
- Create: `ui/src/components/PermissionCard.tsx`
- Modify: `ui/src/components/ErrorBanner.tsx`
- Modify: `ui/src/screens/DeviceScreen.tsx` (diagnostics button)
- Modify: `ui/src/store.ts` (`copyDiagnosticsText`)
- Create: `ui/src/components/PermissionCard.test.tsx`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md`
- Modify: `docs/hardware-testing.md` (append the new GUI checklist)

**Interfaces:**
- Consumes: `useAppStore.error`, `useAppStore.state`, `ipc.copyDiagnostics`.
- Produces:
  - `PermissionCard` rendering the exact udev rule and the two `udevadm` commands with a copy button.
  - `ErrorBanner` showing `PermissionCard` when the error's `kind` is `permission_denied` (the message is a plain string, so the store also keeps `errorKind`).
  - CI running `cargo test --all`, `cargo clippy`, `cargo fmt --check`, `cd src-tauri && cargo test`, `cd ui && bun install && bun run test && bun run build`.

- [ ] **Step 1: Track the error kind in the store**

In `ui/src/store.ts`, add `errorKind: string | null`, set it wherever `error` is set (`set({ error: message(error), errorKind: kindOf(error) })`), and clear both in `dismissError`. Add:

```ts
function kindOf(error: unknown): string | null {
  if (error && typeof error === "object" && "kind" in error) {
    return String((error as { kind: unknown }).kind);
  }
  return null;
}
```

- [ ] **Step 2: Write the failing permission test**

`ui/src/components/PermissionCard.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PermissionCard } from "./PermissionCard";

describe("PermissionCard", () => {
  it("shows the udev rule and reload commands", () => {
    render(<PermissionCard />);
    expect(screen.getByText(/TAG\+=.uaccess./)).toBeInTheDocument();
    expect(screen.getByText(/udevadm control --reload-rules/)).toBeInTheDocument();
  });

  it("copies the install commands", async () => {
    const writeText = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText } });
    render(<PermissionCard />);
    await userEvent.click(screen.getByRole("button", { name: /copy/i }));
    expect(writeText).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run, from `ui/`: `bun run test PermissionCard`
Expected: FAIL.

- [ ] **Step 4: Implement the card and wire it into the banner**

`ui/src/components/PermissionCard.tsx`:

```tsx
import { Button } from "@/components/ui/button";

const RULE = 'SUBSYSTEM=="hidraw", ATTRS{idVendor}=="320f", ATTRS{idProduct}=="5055", TAG+="uaccess"';
const COMMANDS = [
  "sudo cp packaging/50-gmk87.rules /etc/udev/rules.d/",
  "sudo udevadm control --reload-rules",
  "sudo udevadm trigger",
].join("\n");

export function PermissionCard() {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
      <p className="font-medium">The keyboard could not be opened without root.</p>
      <p className="text-xs text-amber-100/80">Install the udev rule, then replug the keyboard:</p>
      <code className="block overflow-x-auto rounded bg-black/40 p-2 text-xs">{RULE}</code>
      <pre className="overflow-x-auto rounded bg-black/40 p-2 text-xs">{COMMANDS}</pre>
      <Button
        size="sm"
        variant="outline"
        onClick={() => void navigator.clipboard.writeText(COMMANDS)}
      >
        Copy commands
      </Button>
    </div>
  );
}
```

`ui/src/components/ErrorBanner.tsx` becomes:

```tsx
import { PermissionCard } from "@/components/PermissionCard";
import { useAppStore } from "@/store";

export function ErrorBanner() {
  const error = useAppStore((s) => s.error);
  const errorKind = useAppStore((s) => s.errorKind);
  const dismiss = useAppStore((s) => s.dismissError);
  if (!error) return null;
  if (errorKind === "permission_denied") return <PermissionCard />;
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
    >
      <span>{error}</span>
      <button className="underline" onClick={dismiss}>
        Dismiss
      </button>
    </div>
  );
}
```

- [ ] **Step 5: Add the diagnostics button to the Device screen**

In `ui/src/screens/DeviceScreen.tsx`, add a button that reads `const text = await ipc.copyDiagnostics(); await navigator.clipboard.writeText(text);` behind a "Copy diagnostics" label.

- [ ] **Step 6: Update CI**

Replace the `test` job steps in `.github/workflows/ci.yml` after the apt install with:

```yaml
      - uses: oven-sh/setup-bun@v2
      - run: cargo fmt --all --check
      - run: cargo clippy --all-targets -- -D warnings
      - run: cargo test --all
      - run: cd ui && bun install --frozen-lockfile && bun run test && bun run build
      - run: cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
```

and extend the apt line with the Tauri dependencies from Task 7 Step 1.

- [ ] **Step 7: Document the GUI in the README and hardware checklist**

In `README.md`, replace the "follow-on plan" note with a short "Desktop app" section: `cd ui && bun install`, `bun run tauri dev`, and the three test commands. In `docs/hardware-testing.md`, append a "GUI checklist" section with rows to record: a wired static upload to slot 0 keeping slot 1, a GIF upload over 36 frames refused in the UI, cancel mid-upload with the display repaired, lighting apply, preset apply, clock sync, and the permission-denied path on a fresh machine without the rule.

- [ ] **Step 8: Run everything and commit**

Run: `cargo test --all && cargo clippy --all-targets -- -D warnings && cargo fmt --all --check`
Run: `cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings`
Run: `cd ui && bun run test && bun run build`
Expected: all PASS.

```bash
git add .github README.md docs ui crates src-tauri
git commit -m "feat: permission guidance, diagnostics, CI and docs for the desktop app"
```

---

## Self-review

- **Spec coverage:** §4.3 `gmk87-app` (Tasks 1–6); §4.4 `src-tauri` commands and events (Tasks 7–9); §4.5 `ui/` four screens, crop editor, 3D preview (Tasks 10–17); §3.5 named effects and presets (Tasks 6, 16); §7 permission guidance and diagnostics (Tasks 8, 18); §8 testing strategy (tests throughout); §9 packaging is deliberately out of scope (Plan 3).
- **Both-slot streaming** is enforced by `SlotStore` (Task 4) and exercised in Task 5's upload test.
- **Review Focus** items each map to a test: (1) Task 4/5; (2) Tasks 3, 4; (3) Tasks 3, 13; (4) Task 5; (5) Task 18.
- Every task names exact files, real code and a test command with an expected result; no step says "handle edge cases" or "similar to Task N".

