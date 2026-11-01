# GMK87 Linux Configurator — Design

Date: 2026-11-01
Status: Approved design, pending spec review
Hardware: ZUOYA GMK87 (wired `320f:5055`, 2.4 GHz dongle `320f:5088`)

## 1. Summary

A Linux desktop application to customize the ZUOYA GMK87 mechanical keyboard:
upload images and animated GIFs to its 240×135 TFT display, control the RGB
lighting, and sync the keyboard's real-time clock. Built in Rust with a Tauri
shell and a React/TypeScript frontend, talking directly to the keyboard over
Linux `hidraw`.

## 2. Goals and non-goals

**Goals (v1)**

- Upload a static image or an animated GIF to either of the display's two slots,
  with an interactive crop/zoom/pan editor and a live preview.
- Choose what the display shows: the clock, slot 0, or slot 1.
- Configure underglow lighting (effect, brightness, speed, orientation, rainbow
  toggle, RGB color) and the side LED modes, plus win-lock.
- Sync the keyboard's clock to system time on demand.
- Work over both the wired connection and the 2.4 GHz dongle.
- Install as a `.deb` or AppImage, with no root and no manual udev setup on
  `.deb` installs.

**Non-goals (v1)**

- Keymap remapping. The keyboard does expose a VIA raw-HID interface and it will
  be detected and reported, but remapping is not in scope.
- Firmware updates.
- A live system monitor on the display (v2, see §11).
- Windows and macOS support. The protocol is platform-agnostic, but only Linux
  is tested and packaged.

## 3. Verified hardware and protocol facts

These were confirmed against the physical keyboard with `hidraw` probes and
cross-checked against two MIT-licensed reference implementations
(`codedgar/gmk87-node`, `ikkentim/gmk87-usb-reverse`).

### 3.1 USB interfaces

| Interface | Purpose | HID usage | Report |
|---|---|---|---|
| 0 | Boot keyboard | `0x01/0x06` | 8-byte input |
| 1 | VIA raw HID | `0xFF60/0x61` | 32-byte in/out |
| 2 | Keyboard + consumer + vendor | `0xFFEF` | report ID 5, 63-byte in/out |
| 3 | Vendor channel (display, lighting, clock) | `0xFF1C/0x92` | report ID 4, 63-byte payload |

v1 uses **interface 3**. Interface 1 (VIA, protocol version 9, 4 layers, 16
macros, 512-byte macro buffer, 8×15 matrix) is detected and surfaced in the UI as
"remapping available in a future version", but not driven.

### 3.2 Vendor packet format

Every transfer is a 64-byte HID report on report ID `0x04`:

| Offset | Size | Meaning |
|---|---|---|
| 0 | 1 | Report ID, `0x04` |
| 1 | 2 | Checksum, little-endian, sum of bytes 3..63 mod 65536 |
| 3 | 1 | Command |
| 4 | 1 | Payload length (≤ 56) |
| 5 | 3 | 24-bit little-endian stream position |
| 8 | 56 | Payload |

Commands: `INIT 0x01`, `COMMIT 0x02`, `PREP_READ 0x03`, `READ_CFG 0x05`,
`CONFIG 0x06`, `READY 0x23`, `FRAME_DATA 0x21`. A response is matched by
comparing byte 3 (the command) with the command sent; non-matching reports are
discarded until the timeout expires.

### 3.3 Configuration buffer

A 64-byte configuration block holding display settings (frame counts, frame
delay, which slot is shown), underglow settings, LED settings and clock fields.
Read with `INIT → PREP_READ ×10 → COMMIT → READ_CFG ×13`; written with
`INIT → CONFIG → COMMIT`.

Because several bytes in the block are undocumented, **all writes are
read-modify-write against the raw buffer**. Only the fields the app understands
are changed; every other byte is written back exactly as read.

### 3.4 Display

- Resolution 240×135, RGB565, **big-endian** (high byte first).
- Pixel data per slot is padded to a 32 KB boundary: `64800 → 65536` bytes.
- Sent as `FRAME_DATA` packets of ≤56 payload bytes with a monotonically
  increasing 24-bit position: 1,171 packets per slot.
- Two slots. `show_image` selects `0 = clock`, `1 = slot 0`, `2 = slot 1`.
- Animation budget: at most 36 frames total across both slots, minimum frame
  delay 60 ms.

### 3.5 Lighting

- Underglow: 19 effects, brightness 0–9, speed 0–9, orientation, rainbow toggle,
  RGB color.
- Side LEDs: mode 0–4, color 0–8 (red, orange, yellow, green, teal, blue, purple,
  white, off), saturation 0–9, rainbow toggle.
- Win-lock on/off.

## 4. Architecture

Cargo workspace with the USB protocol isolated from both the UI and the
transport, so the future background service can reuse it unchanged.

```
┌──────────────── ui/ (React + TS + Vite) ────────────────┐
│ Device · Display (crop editor) · Lighting · Clock       │
└───────────────▲─────────────────────────┬───────────────┘
        events  │ (progress, disconnect)  │ invoke
┌───────────────┴─────────────────────────▼───────────────┐
│ src-tauri: commands, device state, op serialization     │
└───────────────▲─────────────────────────┬───────────────┘
                │                         │
┌───────────────┴──────────┐   ┌──────────▼───────────────┐
│ gmk87-device             │   │ gmk87-protocol           │
│ discovery, Transport     │──▶│ packets, config buffer,  │
│ trait, hidapi impl,      │   │ RGB565, frame planning   │
│ session state machine    │   │ (pure, no I/O)           │
└──────────────────────────┘   └──────────────────────────┘
```

### 4.1 `crates/gmk87-protocol`

Pure, no I/O, fully unit-testable.

- Packet encoding/decoding, checksum, position tracking.
- `DeviceConfig`: a fixed 64-byte buffer with typed accessors for the known
  fields, guaranteeing byte-preserving round-trips.
- Image preparation: decode, crop/zoom, resize, RGB565 conversion, slot padding.
- `FramePlan`: validates and lays out frames across slots against the device
  budget before any USB traffic occurs.

### 4.2 `crates/gmk87-device`

- `DeviceInfo` discovery over `hidapi`: VID `0x320f`, PIDs `0x5055` and `0x5088`;
  interface chosen by usage page `0xFF1C`, with `0xFF60` recorded separately.
- `Transport` trait (`write_report`, `read_report`) with a `HidTransport`
  implementation and a `MockTransport` for tests.
- `Session`: owns the handshake, config read-modify-write, upload streaming,
  retry policy and progress reporting. All device state lives here, not in the UI
  layer.
- If both the wired keyboard and the 2.4 GHz dongle are present, discovery
  returns two devices. The UI lists both and the user selects one; the app never
  switches transports on its own, and only one session is open at a time.

### 4.3 `src-tauri`

Thin command surface over `gmk87-device`:

`list_devices`, `connect`, `read_state`, `set_lighting`, `sync_clock`,
`upload_display`, `cancel_upload`.

Emits `upload://progress` and `device://disconnected`. A single mutex serializes
all device operations, because the keyboard has one state machine and concurrent
writes desynchronize it.

### 4.4 `ui/`

React + TypeScript + Vite, custom styling, four screens: Device, Display,
Lighting, Clock. The UI never manipulates pixels; it derives crop/zoom
parameters and sends them to Rust.

- **Device:** transport list, connect/disconnect, firmware-reported state
  (VIA interface present, current `show_image`), diagnostics.
- **Display:** slot tabs (0/1), file picker, crop/zoom/pan canvas with a
  240×135 preview, GIF frame strip and delay control, frame-budget meter,
  upload progress with cancel, "show this slot" toggle.
- **Lighting:** underglow effect picker with brightness, speed, orientation,
  rainbow and color; side LED mode/color/saturation; win-lock.
- **Clock:** preview of the current time as the keyboard will show it, and a
  "Sync now" action.

### 4.5 `crates/gmk87-cli`

Debug and recovery tool: `probe`, `dump-config`, `upload`, `lights`, `clock`.
Used to validate protocol work against real hardware before the UI exists, and
kept afterwards as a scripting and recovery path.

## 5. Display upload pipeline

1. UI emits a `DisplayJob`: target slot(s), source bytes, crop rect, zoom, pan,
   fit mode (`cover` or `contain`), frame delay, and which slot to show.
2. Rust decodes (`image`; `gif` for animation), applies crop/zoom, resizes to
   240×135, converts to big-endian RGB565, pads each slot to 65,536 bytes.
3. Budget check before touching the device: ≤36 frames total, delay ≥60 ms. On
   violation, fail with a specific message.
4. Read the current config, patch only frame counts, frame delay and
   `show_image`, leave every other byte intact.
5. `INIT ×2 → CONFIG → COMMIT (100 ms) → wait READY(0x23) → FRAME_DATA ×N →
   COMMIT`, waiting for a matching response per packet with a timeout, emitting
   progress roughly every 1%.
6. On cancel or transport failure mid-upload, send `COMMIT` and rewrite the
   previous `show_image` so a torn frame is never displayed.

## 6. Lighting and clock

Both are config read-modify-write operations: read the 64-byte block, patch the
relevant fields, write it back. No frame streaming. Clock sync patches the
date/time fields from the system clock and writes the block back.

## 7. Failure handling and lifecycle

**Errors** (one `thiserror` enum): `DeviceNotFound`, `PermissionDenied`,
`Transport(io)`, `ProtocolTimeout{cmd}`, `ChecksumMismatch`, `DeviceDesynced`,
`InvalidJob(reason)`, `Unsupported(transport)`.

**State machine:** `Disconnected → Connected(Idle) → Busy(op) → Connected(Idle)`.
Operations are serialized; the UI disables controls during an upload. A transport
error or a vanished hidraw node transitions to `Disconnected`, emits an event,
and a 2 s poll reconnects while the window is open.

**Recovery rules:**

- Packet timeout → reopen the handle once, drain stale reports, retry that
  packet only.
- Timeout during `CONFIG`/`COMMIT` (device state unknown) → never blind-retry;
  re-run the config read handshake to resync, then report what landed.
- Response checksum mismatch → discard and continue reading until the matching
  command arrives or the timeout expires.
- Failed upload → restore the previous `show_image` and state that the display
  was left unchanged.

**Permissions:** `50-gmk87.rules` uses `TAG+="uaccess"` for `320f:5055` and
`320f:5088`, so the logged-in seat gets access without root. The `.deb` installs
it to `/usr/lib/udev/rules.d/`. The AppImage cannot install files; on
`PermissionDenied` the app displays the rule with a copy button and the exact
`udevadm` commands.

**Diagnostics:** `tracing` to `~/.local/share/gmk87/logs/`, plus a "Copy
diagnostics" action (app version, kernel, device paths, recent log lines).

## 8. Testing strategy

1. **Protocol unit tests** — golden 64-byte vectors for encode/decode, checksum,
   24-bit position, 56-byte chunking; config round-trip preserving unknown bytes
   (including `proptest`); RGB565 endianness; frame planning and budget limits;
   crop/zoom geometry (cover vs contain, pan clamping, no out-of-bounds).
2. **Device tests** — `MockTransport` replaying a recorded session and injecting
   dropped responses, wrong-command responses, checksum corruption and
   mid-upload disconnects; asserts the retry rules in §7.
3. **Frontend tests** — Vitest for crop-parameter derivation, job
   serialization and state transitions.
4. **Hardware tests** — documented manual checklist plus the `gmk87-cli`,
   opt-in via `GMK87_HW=1`; never run in CI.

The first implementation step is a hardware validation spike: read the config,
upload a test pattern to **slot 1** (leaving slot 0 untouched), show slot 1, then
restore the original `show_image` and settings.

## 9. Packaging

- `.deb` and AppImage, built with Tauri's bundler; `.deb` carries the udev rule,
  desktop entry and icon.
- Workspace license and third-party attribution for the MIT reference
  implementations in `NOTICE`.
- README covers install, the udev rule, and the hardware test checklist.

## 10. Milestones

| Milestone | Content | Exit criterion |
|---|---|---|
| M0 | Workspace scaffold, CI, `gmk87-cli probe/dump-config` | Config read→write→read is byte-identical; slot-1 test image shows and restores |
| M1 | Protocol core | Codec, config, RGB565, frame planning; unit tests green |
| M2 | Device layer | Discovery (wired + 2.4 GHz), session, retry rules, mock tests |
| M3 | Tauri shell | Commands, events, device screen, connect/reconnect |
| M4 | Display screen | Crop/zoom editor, GIF frames, progress, cancel-and-restore |
| M5 | Lighting | Underglow, side LEDs, win-lock |
| M6 | Clock | Preview and manual sync |
| M7 | Packaging | `.deb` + AppImage, udev, icon, README, clean-machine smoke test |
| M8 | v2 | System monitor on display, `systemd --user` service |

**Definition of done (v1):** `cargo test`, `clippy` and `vitest` clean; on the
physical keyboard, static and animated uploads work to either slot with
crop/zoom; lighting changes apply; clock sync sets the correct time; cancelling
an upload leaves the display usable; the `.deb` installs with no manual udev
step; wired and 2.4 GHz both work.

## 11. Future work (v2)

- Live system monitor rendered to the display (CPU, memory, clock, custom
  widgets), refreshed from a background process.
- A `systemd --user` service for periodic clock sync and monitor updates that
  runs with the app closed. It links `gmk87-protocol` and `gmk87-device`
  directly; no UI rewrite required.
- Keymap remapping over the already-detected VIA interface.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Frame-count or delay limits differ from the reference implementation | M0 validates on hardware before UI work |
| 2.4 GHz upload timing differs from wired | Retry policy plus M0/M2 testing on both transports |
| `show_image` does not persist across power cycles | Verified in M0; UI explains the behaviour |
| Unknown config bytes corrupted by writes | Read-modify-write plus byte-preserving round-trip tests |
| AppImage users hit permission errors | In-app rule display and copy action |

## 13. Attribution

The USB protocol was documented by the community. This project ports the packet
format and command sequence from MIT-licensed work
(`codedgar/gmk87-node`, `ikkentim/gmk87-usb-reverse`); attribution is recorded
in `NOTICE` and `docs/protocol.md`.
