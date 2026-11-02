# GMK87 USB protocol reference

Corrected 2026-11-01 after testing on the physical keyboard. This document
supersedes the interface table and the read-modify-write description in §3.1 of
the design spec; spec §3.3, §3.3a, §5, §6 and §7 are the authority, and this
file follows them.

Every claim below is marked with how it is known:

- **Verified** — observed on the physical GMK87, wired or over the 2.4 GHz
  dongle, or in a capture of the official application's own traffic.
- **Reference** — taken from the MIT-licensed community implementations named in
  the attribution section, and consistent with that capture.
- **Unverified** — plausible from the references but never confirmed on this
  hardware.

## 1. Attribution

The USB protocol was documented by the community. This project ports the packet
format and command sequence from MIT-licensed work. The `NOTICE` file reads:

```text
This project implements the ZUOYA GMK87 USB protocol, which was documented by
the community. The packet format and command sequence were derived from the
following MIT-licensed projects:

  - codedgar/gmk87-node (MIT)
  - ikkentim/gmk87-usb-reverse (MIT)

Each project is the work of its own authors. This NOTICE records the
attribution; it does not reproduce their copyright notices or license text.
The MIT license terms are available in each project's repository.
```

The command list, report layout, display geometry and configuration offsets in
this document are derived from those projects and from the capture described in
§6. The mistakes corrected here are this project's own.

## 2. Device identity and interfaces

Both transports identify as vendor `0x320f`:

| Product ID | Transport |
|---|---|
| `0x5055` | wired keyboard |
| `0x5088` | 2.4 GHz dongle |

Discovery enumerates HID collections, keeps those whose usage page is
`0xFF1C`, and records whether the same keyboard also exposes usage page
`0xFF60` (VIA). Interface numbers are not stable — they differ between the wired
keyboard and the dongle, and the `/dev/hidraw*` path changes when the device
re-enumerates — so the usage page, not the interface number, is what selects the
vendor channel. **Verified.**

The wired keyboard presents four interfaces:

| Interface (wired) | Purpose | Usage page / usage | Reports | Used by this project |
|---|---|---|---|---|
| 0 | Boot keyboard | `0x01` / `0x06` | 8-byte input | no |
| 1 | VIA raw HID | `0xFF60` / `0x61` | 32-byte in/out | detected only (`has_via`) |
| 2 | Keyboard + consumer + vendor | `0xFFEF` | report ID 5, 63-byte in/out | no |
| 3 | Vendor channel: display, lighting, clock | `0xFF1C` / `0x92` | report ID 4, 63-byte **output**, 7-byte **input** | yes |

**Verified** for the usage pages and report IDs. The 7-byte input report and the
resulting 8-byte acknowledgements were established with read/echo probes on the
wired interface, and later confirmed on wired configuration and frame writes.
That asymmetry is the single most surprising fact about this device: the input
report is declared seven bytes long, so every acknowledgement read from the
wired keyboard is truncated to **8 bytes** and the payload at offset 8 is lost.
The write path is unaffected; there is no read path anyway (§6).

Wired writes now have hardware evidence: `clock` and `lights` complete in about
0.1 s, and a wired frame upload was attempted (it failed on a backlog of
unacknowledged frames, not on the handshake — see §11 and
[`hardware-testing.md`](hardware-testing.md)).

The 2.4 GHz dongle exposes a vendor collection on usage page `0xFF1C` with a
63-byte input *and* a 63-byte output report. It therefore returns full 64-byte
acknowledgements, but frames them differently (§4). **Verified.**

Interface 2 (`0xFFEF`, report ID 5) also accepts the same vendor frames and
returns full-length 64-byte responses; that was observed while diagnosing the
truncated reads on interface 3. **Verified in a probe, unused.** The project
drives `0xFF1C` with report ID `0x04` because that is what the official
application and the working community Linux tool use.

> **Hazard.** The keyboard's input collections include consumer and
> system-control usages, including a power key. Linux `systemd-logind` watches
> the keyboard as a system-button device, so a garbage input report can power
> the machine off. This is why hardware runs have safety rules — see
> [`hardware-testing.md`](hardware-testing.md).

## 3. Report format

Every write is a **64-byte HID report on report ID `0x04`**, on either
transport. **Verified** on both: the dongle acknowledges configuration and
frame writes, and the wired interface accepts configuration writes and frame
packets (its first full frame stream timed out; see §11).

| Offset | Size | Meaning |
|---|---|---|
| 0 | 1 | Report ID, always `0x04` |
| 1 | 2 | Checksum, little-endian (`[1]` low byte, `[2]` high byte) |
| 3 | 1 | Command |
| 4 | 1 | Payload length, 0–56 |
| 5 | 3 | 24-bit little-endian stream position |
| 8 | 56 | Payload |

### Checksum

The checksum is the sum of **bytes 3 through 63** — that is, `report[3..64]`,
the 61 bytes after the checksum field — accumulated into a `u16` with wrapping
addition, i.e. modulo 65,536. It covers the command, the length, the 24-bit
position and all 56 payload bytes, including the unused tail of a short
payload. It is stored little-endian at offsets 1 and 2.

```text
checksum = sum(report[3..64]) mod 65536
report[1] = checksum & 0xff
report[2] = checksum >> 8
```

**Reference**: this is the rule the codec implements; a report framed as `0x04`
whose stored checksum does not match is discarded and the reader keeps waiting.

### Position

For `FRAME_DATA`, the position is the absolute byte offset of this packet's
payload in the frame memory being streamed, starting at 0 and advancing by the
payload length of each packet. For `INIT`, `CONFIG` and `COMMIT` it is 0.
**Reference**.

### Payload length

At most 56 bytes. A 64-byte report therefore carries 56 payload bytes plus the
8-byte header. The length byte is the authority; the unused tail is zero.

## 4. Acknowledgements

Acknowledgements are matched on the **command byte at offset 3**, nothing else.
This assumes hidapi preserves the HID report ID at offset 0 of the input report;
that assumption has not been confirmed on hardware (see §13). The two transports
answer with different shapes:

| Transport | Report length | Shape | Usable checksum |
|---|---|---|---|
| Wired | 8 bytes | `04 cs cs cmd 00 00 00 00` | not validated — the report is truncated |
| 2.4 GHz dongle | 64 bytes | `01 cmd 09 cmd 00 … 00` | no — report ID `0x01`, bytes 1–2 are not a checksum |

The wired 8-byte shape was observed during read/echo probes and again on wired
configuration and frame writes; the dongle's 64-byte shape was observed on
configuration and frame writes. The dongle literally echoes the command at
offsets 1 and 3, with `0x09` between them and zeros after.

The read path therefore:

- reads with a timeout (100 ms slices inside a 1.5 s command deadline);
- discards any report shorter than 8 bytes, or whose byte 3 is not the command
  it is waiting for;
- accepts a matching command with an **empty payload** — the wired ack has no
  payload, and no acknowledgement on this device carries one;
- validates the checksum **only** for reports of at least 12 bytes that begin
  with report ID `0x04`, and discards a mismatch rather than accepting it;
- gives up after the command deadline with `ProtocolTimeout { cmd }`.

The working community Linux tool reads exactly 8 bytes and checks only the
command byte. This project is stricter where it can be (app-framed reports) and
equally tolerant where it must be (the dongle's framing).

## 5. Commands

| Command | Value | Direction | Payload | Notes |
|---|---|---|---|---|
| `INIT` | `0x01` | host → device | none | opens a configuration or frame transaction; sent twice before `CONFIG` |
| `COMMIT` | `0x02` | host → device | none | closes the transaction; its acknowledgement is the confirmation |
| `PREP_READ` | `0x03` | — | — | **never send**: the reference read preamble reset and re-enumerated this keyboard twice |
| `READ_CFG` | `0x05` | — | — | **never send**: it echoes the request payload and never returns device memory (§6) |
| `CONFIG` | `0x06` | host → device | 48 bytes | the complete configuration block (§7) |
| `FRAME_DATA` | `0x21` | host → device | ≤ 56 bytes | frame memory at a 24-bit position; acknowledged per packet when the transport is prompt, otherwise paced adaptively (§11) |
| `READY` | `0x23` | device → host | none | sent by the wired interface, **not** by the dongle; optional |

`PREP_READ` and `READ_CFG` remain in the codec only so that the full command set
can be decoded; no production path constructs them, and tests assert that
`lights`, `clock` and `upload` never send them.

## 6. The device is write-only

This is the correction that matters most, and it is **verified with read/echo
probes on both transports** (no wired write was involved):

- `READ_CFG (0x05)` echoes the request payload. `deadbeef` in, `deadbeef` out.
  It never returns device memory.
- The reference `PREP_READ ×10 → COMMIT` "read mode" preamble reset and
  re-enumerated the keyboard twice. It is not a usable read path, and it is
  dangerous to try.
- The official application's own `0x05` responses also carry zero payloads,
  while the configuration it *writes* contains values it could not have read
  back: brightness 9, RGB `f8 ff 00`, and a correct BCD timestamp. The official
  app keeps configuration state in its UI and never truly reads; its read phase
  is vestigial preamble.

Consequences, which shape the whole design:

1. **There is no read-modify-write.** The host cannot discover what the device
   currently holds, so it cannot preserve settings it does not know about.
2. **The application owns the configuration.** It keeps the 48-byte block in
   memory, seeds it from the last block it wrote (a snapshot file), edits that,
   and writes the **complete block** every time.
3. **The snapshot is the only history.** The CLI keeps its last written block in
   `$XDG_DATA_HOME/gmk87/config.snapshot`, falling back to
   `$HOME/.local/share/gmk87/config.snapshot`, as one line of 48 bytes of
   lowercase hex. A missing or malformed snapshot falls back to the reference
   defaults; it is never a hard error.
4. **The first write wins.** Anything the user configured with the official
   application is replaced by the app's values the first time this project
   writes a block. Every documented field is therefore exposed in the CLI and
   the future UI, so the loss is recoverable by setting them again. In
   `gmk87-cli lights` that is `--effect`, `--brightness`, `--speed`,
   `--orientation`, `--underglow-rainbow`, `--rgb`, `--winlock`, `--led-mode`,
   `--led-saturation`, `--led-rainbow` and `--led-color`.

There is no `dump-config`. `show-config` prints the snapshot, not the device.

## 7. Configuration block

The configuration is **48 bytes**, written as the payload of one `CONFIG`
packet. **Verified.** Offsets 1–8, 21, 28–32, 33–41 and 43–46 come from the
reference implementations; the official application's capture also confirms 1, 2,
6–8, 33, 35–41, 43–44 and 46. The opaque ranges have no known meaning.

| Offset | Size | Field | Values |
|---|---|---|---|
| 0 | 1 | opaque | zero in the reference capture; carried verbatim |
| 1 | 1 | underglow effect | 0–18 (19 effects); not enforced by this implementation |
| 2 | 1 | underglow brightness | 0–9; reference 9 |
| 3 | 1 | underglow speed | 0–9 |
| 4 | 1 | underglow orientation | values not characterised |
| 5 | 1 | underglow rainbow | toggle, 0 or 1 |
| 6–8 | 3 | underglow RGB | reference `f8 ff 00` |
| 9–20 | 12 | opaque | carried verbatim |
| 21 | 1 | win-lock | 0 or 1 |
| 22–27 | 6 | opaque | carried verbatim |
| 28 | 1 | side LED mode | 0–4 |
| 29 | 1 | side LED saturation | 0–9 |
| 30 | 1 | opaque | carried verbatim |
| 31 | 1 | side LED rainbow | toggle, 0 or 1 |
| 32 | 1 | side LED colour | 0–8: red, orange, yellow, green, teal, blue, purple, white, off |
| 33 | 1 | `show_image` | 0 = clock, 1 = slot 0, 2 = slot 1; reference 0 |
| 34 | 1 | slot 0 frame count | number of frames in slot 0 |
| 35 | 1 | seconds | packed BCD, 00–59 |
| 36 | 1 | minutes | packed BCD, 00–59 |
| 37 | 1 | hours | packed BCD, 00–23 (24-hour) |
| 38 | 1 | weekday | **raw**, 0 = Sunday … 6 = Saturday |
| 39 | 1 | day of month | packed BCD, 01–31 |
| 40 | 1 | month | packed BCD, 01–12 |
| 41 | 1 | year | packed BCD, last two digits; 20xx reconstructed |
| 42 | 1 | opaque | carried verbatim |
| 43–44 | 2 | frame delay | milliseconds, little-endian; reference sentinel `ff ff` |
| 45 | 1 | opaque | carried verbatim |
| 46 | 1 | slot 1 frame count | reference sentinel `ff` |
| 47 | 1 | opaque | reference sentinel `ff` |

The reference block written by the official application is **Verified**. Its
documented values are:

| Offset | Value | Meaning |
|---|---|---|
| 1 | 0 | underglow effect |
| 2 | 9 | brightness (max) |
| 6–8 | `f8 ff 00` | underglow RGB |
| 33 | 0 | show clock |
| 35–41 | `57 24 14 02 28 10 25` | BCD `2025-10-28 20:24:57`, weekday 2 (Tuesday) |
| 43–44 | `ff ff` | frame interval sentinel |
| 46 | `ff` | sentinel |

One capture also had `0x07` at offset 9 and `0xff` at offset 47. This project
does not assign a meaning to either; they are opaque and survive in the snapshot
byte for byte.

### Defaults this project writes

With no usable snapshot, the CLI seeds its configuration with all zeroes except
the reference brightness, RGB colour and frame-interval sentinels. The clock is
left at zero until `clock` is run. **Verified** by test and by the snapshot
written on hardware:

```text
offset  0  1  2  3  4  5  6  7
   0:  00 00 09 00 00 00 f8 ff
   8:  00 00 00 00 00 00 00 00
  16:  00 00 00 00 00 00 00 00
  24:  00 00 00 00 00 00 00 00
  32:  00 00 00 00 00 00 00 00
  40:  00 00 00 ff ff 00 ff 00
```

As hex: `000009000000f8ff00` + 68 hex zeroes + `ffff00ff00`.

### Writing the block

```text
INIT (empty)
CONFIG (the 48 bytes)
COMMIT (empty)
```

A plain configuration write sends the three packets back to back: there is **no
settle** between `CONFIG` and `COMMIT`. `COMMIT`'s acknowledgement is what
confirms the write; a `COMMIT` timeout leaves the device in an unknown state
(`DeviceDesynced`) and must not be blind-retried. On success the session stores
the block it wrote and marks itself synchronised.

Lighting and clock changes use exactly this sequence — no settle, no frame
streaming, no read beforehand. The upload handshake writes the same block but
does add a 100 ms settle between `CONFIG` and `COMMIT` (see §11); that pause is
specific to the upload path. **Acknowledged on both transports**: the dongle's
clock and brightness writes were confirmed at the protocol level (the effect was
never seen), and the wired `clock` and `lights` writes complete in about 0.1 s
(see `hardware-testing.md`).

## 8. Display

| Property | Value |
|---|---|
| Resolution | 240 × 135 |
| Pixel format | RGB565, **big-endian** (high byte first) |
| Bytes per frame | 240 × 135 × 2 = 64,800 |
| Slot padding | each frame padded to 65,536 bytes (64 KB): 64,800 → 65,536 |
| Packets per frame | 65,536 / 56 = 1,171 (1,170 full, one 16-byte tail) |
| Slots | 2 |
| `show_image` | 0 = clock, 1 = slot 0, 2 = slot 1 |

**Reference** for resolution, endianness, padding and the packet count. The panel
has never been seen displaying an uploaded frame, so nothing about the image
path is confirmed by eye (see `hardware-testing.md`).

RGB565 packing (big-endian on the wire):

```text
value = ((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3)
byte0 = value >> 8      byte1 = value & 0xff
```

The padding is zeroes. It is part of the stream: each frame occupies 65,536
bytes, even though only the first 64,800 are pixels.

## 9. Animation budget

| Limit | Value |
|---|---|
| Total frames across both slots | 36 |
| Minimum frame delay | 60 ms |

**Reference**, and enforced before any USB traffic: `FramePlan::validate`
rejects more than 36 frames total, zero frames, or a delay below 60 ms. A
36-frame animation is 36 × 65,536 = 2,359,296 bytes, or 42,131 `FRAME_DATA`
packets, before any timing overhead.

Known limitation: GIF frames are decoded independently — disposal methods and
frame offsets are not composited — so GIFs that rely on partial-frame updates
render incorrectly. This has not been characterised on hardware; see
[`hardware-testing.md`](hardware-testing.md).

## 10. Clock encoding

The clock occupies offsets 35–41, in this order: **seconds, minutes, hours,
weekday, day, month, year**. All time and date fields except the weekday are
packed BCD: the high nibble is the tens digit and the low nibble the units, so
`0x24` is 24 and `0x07` is 7. Only 0–99 can be encoded; the implementation
rejects anything larger, and also rejects hour > 23, minute/second > 59,
month > 12, day > 31 and weekday > 6.

The weekday is **not** BCD. It is a raw byte, 0 = Sunday through 6 = Saturday,
matching `chrono`'s `num_days_from_sunday`. The year is the last two digits of a
four-digit year; the reader reconstructs 20xx.

Worked example — Sunday 2026-11-01 at 19:01:00, the exact bytes this project
wrote to the keyboard:

| Offset | Field | Value | Hex |
|---|---|---|---|
| 35 | seconds | 0 | `00` |
| 36 | minutes | 1 | `01` |
| 37 | hours | 19 | `19` |
| 38 | weekday | Sunday | `00` |
| 39 | day | 1 | `01` |
| 40 | month | 11 | `11` |
| 41 | year | 2026 | `26` |

The tail of the snapshot after that write was
`… 00 01 19 00 01 11 26 00 ff ff 00 ff 00`. **Verified**: the write was
acknowledged and the bytes are in the snapshot, but no human saw the panel
advance (see `hardware-testing.md`).

## 11. Upload sequence

Pre-flight, before any device traffic:

1. Decode the source, apply crop/zoom, resize to 240 × 135, convert to
   big-endian RGB565, pad each frame to 65,536 bytes.
2. Validate the plan: 1–36 frames total and delay ≥ 60 ms. The delay is a `u16`
   by type, so 65,535 ms is its ceiling.
3. Patch the in-memory block: slot 0 frame count, slot 1 frame count, frame
   delay, and `show_image`.

Then:

```text
INIT
INIT
CONFIG      48-byte block
            100 ms settle
COMMIT
READY       optional — wired only; the dongle never sends it
FRAME_DATA  position 0 … (slot 0 frames, then slot 1 frames)
COMMIT
```

**Verified** up to and including individual `FRAME_DATA` acknowledgements on
the dongle, and the wired handshake plus the start of a frame stream. A first
wired one-slot upload failed after about 17 s with
`hidapi error: Connection timed out`: the host had written frames without
reading their acknowledgements, the device's buffer filled, and its OUT
endpoint stopped accepting writes. That is the defect the adaptive pacing below
fixes; the retry is pending (see `hardware-testing.md`).

`READY (0x23)` is awaited for up to 1.5 s but is not required. The wired
interface sends it; the dongle does not, yet accepts `FRAME_DATA` immediately
after the `COMMIT` acknowledgement. **Verified** on the dongle (10 s of reads
produced no `0x23`).

### Frame acknowledgement pacing adapts to the transport

Frame packets **are** acknowledged individually when the transport is prompt.
The wired interface answers each packet in milliseconds, so the stream waits for
that packet's acknowledgement: the cost is the real round-trip and no backlog of
unread acknowledgements can build up. Waiting per packet on the dongle is not
possible — it acknowledges roughly **one packet per second** (measured
repeatedly at ~1.02 s), which made a single 1,171-packet frame take about
**twenty minutes** — so the stream falls back to a tolerant fire-and-forget mode
when acknowledgements are sparse.

| Constant | Value | Role |
|---|---|---|
| `COMMAND_TIMEOUT` | 1.5 s | deadline for a handshake acknowledgement |
| `WRITE_SETTLE` | 100 ms | pause between `CONFIG` and `COMMIT` |
| `FRAME_PACED_ACK_WINDOW` | 200 ms | how long paced mode waits for one packet's acknowledgement |
| `FRAME_PACED_MISS_LIMIT` | 3 | consecutive paced misses before falling back to the tolerant mode |
| `FRAME_ACK_WINDOW` | 25 ms | how long each packet's acknowledgement is probed for in the tolerant mode |
| `FRAME_ACK_PACING_THRESHOLD` | 8 | tolerant-mode misses after which the stream waits instead of queueing more |
| `FRAME_ACK_MISS_LIMIT` | 64 | consecutive silent packets before the device is declared dead |
| `CANCEL_POLL_SLICE` | 200 ms | longest single read inside a wait, so cancellation is noticed |
| `UPLOAD_TOTAL_TIMEOUT` | 300 s | hard ceiling on the whole stream, independent of packet count |

The stream starts **paced**: after writing a packet it waits up to
`FRAME_PACED_ACK_WINDOW` for that packet's acknowledgement, clamped by what is
left of the 300 s budget. If acknowledgements keep arriving it stays paced; each
packet then costs only its round-trip (milliseconds on wired). After
`FRAME_PACED_MISS_LIMIT` consecutive misses it switches, **once and for the rest
of the upload**, to the tolerant mode: write the next packet without waiting,
probe `FRAME_ACK_WINDOW`, and only wait for an acknowledgement after
`FRAME_ACK_PACING_THRESHOLD` consecutive misses. That is the dongle's mode. A
device that never answers at all is still diagnosed by `FRAME_ACK_MISS_LIMIT`
consecutive misses (`ProtocolTimeout { cmd: 0x21 }`), and a spent budget fails
with `UploadTimeout { sent, total }`. On success, the final `COMMIT`'s
acknowledgement is the authority that the transaction finished.

The switch is one-way so a single slow packet cannot make the mode flap. Both
modes check cancellation between packets and at least every `CANCEL_POLL_SLICE`
inside a wait. Whether a full 65,536-byte frame finishes in 300 s over the
dongle is still **unverified**.

### Failure and repair

Any failure after the configuration was written — cancellation, transport
error, timeout — means the device holds a partially written slot. The session
then:

1. sends a bare `COMMIT` to close the interrupted frame transaction;
2. rewrites the **complete pre-upload block** (frame counts, delay and every
   opaque byte) with `show_image` set to the previously shown slot;
3. if the previously shown slot is one this upload was writing, points the
   display at the clock instead, because that slot's memory is torn;
4. marks itself unsynchronised.

Both steps are attempted independently; a failed repair never masks the
original error. **Reference** plus mock coverage. **Unverified on hardware.**

### Slot handling

Frame memory for both slots is streamed as one sequence: slot 0's frames, then
slot 1's frames, with the position running from 0 across the whole sequence.
When only slot 1 is written, its frames start at position 0 and `slot 0 frames`
is 0, so the device splits the stream using the configuration's frame counts.
**Reference**, **unverified** on hardware: whether a slot-1-only upload leaves
slot 0 intact has not been observed.

## 12. Lighting

| Setting | Offset | Range |
|---|---|---|
| Underglow effect | 1 | 0–18 (19 effects) |
| Underglow brightness | 2 | 0–9 |
| Underglow speed | 3 | 0–9 |
| Underglow orientation | 4 | uncharacterised |
| Underglow rainbow | 5 | 0/1 |
| Underglow colour | 6–8 | RGB bytes |
| Side LED mode | 28 | 0–4 |
| Side LED saturation | 29 | 0–9 |
| Side LED rainbow | 31 | 0/1 |
| Side LED colour | 32 | 0–8 (red, orange, yellow, green, teal, blue, purple, white, off) |
| Win-lock | 21 | 0/1 |

All of these are written by patching the in-memory block and sending the whole
48-byte block with `INIT → CONFIG → COMMIT`. Nothing is read first, and no frame
streaming is involved. **Reference** for the ranges; on both transports the
write path is confirmed only to the level of an acknowledged `COMMIT` (the
underglow was never seen to change — see `hardware-testing.md`). The wired
`clock` and `lights` commands complete in about 0.1 s.

## 13. Open questions

These are the parts a future hardware run must settle. None of them changes the
write path's shape.

| Question | Why it is open |
|---|---|
| Does a full 65,536-byte frame complete within the 300 s ceiling over the dongle? | At ~1.02 s per acknowledgement the stream is heavily paced; no upload has completed |
| Does a slot-1-only upload at position 0 leave slot 0 intact? | Assumed from the reference implementation's frame-count split |
| What do offsets 0, 9–20, 22–27, 30, 42, 45 and 47 mean? | Opaque; carried verbatim from the reference/default block |
| Does `show_image` survive a power cycle? | Never observed |
| Are the frame-count and delay limits really 36 and 60 ms? | Taken from the references; never tested at the boundary |
| Does the wired transport finish an upload now that frames are acknowledged per packet? | The first wired attempt failed after ~17 s with an OUT-transfer timeout; the adaptive-pacing retry is pending |
| Does hidapi preserve the report ID at offset 0 of input reports? | Matching reads `report[3]`, which assumes it does. Unconfirmed on hardware; if it does not, every acknowledgement misses and the upload fails after 64 misses with `ProtocolTimeout` |
| Is interface 2 (`0xFFEF`, report ID 5) a safe alternate transport? | It answers with full-length reports, but is unused and untested for writes |
| Do GIFs with partial-frame updates render correctly? | Frames are decoded independently, without compositing |
