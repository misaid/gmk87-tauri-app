# Hardware testing

> ## Hardware verification: deferred
>
> **The write path is not verified on hardware. Do not treat any command
> exiting 0 as proof that the keyboard did what you asked.**
>
> Hardware verification is deliberately deferred until a human explicitly
> re-authorises it. An earlier run left a **detached upload process** writing to
> the keyboard. It produced spurious keystrokes and repeatedly powered the
> machine off: `systemd-logind` watches this keyboard as a system-button device,
> so a garbage input report that looked like the power key triggered a clean
> shutdown (`logind: Powering off…`, twice, with no crash). Two uploads also hung
> mid-transaction and re-enumerated the dongle.
>
> Deferring this is the safer outcome. An unverified write path is better than
> perturbing someone's keyboard and desktop. Read the safety rules below before
> touching a device.

## 1. Status at the time of writing

Everything in this document comes from the M0 investigation on 2026-11-01,
except where a later wired test is named explicitly. Discovery and the read/echo
diagnosis exercised both transports (the wired acknowledgement was observed as 8
bytes, during those read probes). The original configuration and frame writes
were over the 2.4 GHz dongle. A later wired test on `/dev/hidraw12` (interface 3,
usage page `0xFF1C`) confirmed configuration writes and exposed a protocol
defect: one 65,536-byte slot reset the keyboard after about 16 s because the
host never sent `UPLOAD_START (0x23)`. That cause and the awaiting-retry fix are
recorded below. The automated suite uses mock transports only and never opens
`/dev/hidraw*`.

| Area | Status | Evidence |
|---|---|---|
| Discovery (`probe`) | works | wired `320f:5055` and dongle `320f:5088`, `via=true` on both |
| Wired acknowledgement shape | verified | 8-byte acknowledgement seen during read/echo probes and again on configuration and frame writes |
| `show-config` | works | prints the snapshot; performs no device I/O by design |
| Configuration write (`clock`, `lights`) | acknowledged, **not visually confirmed** | dongle: `COMMIT` acks at ~1.02 s; wired: both commands complete in ~0.1 s; snapshots hold the intended bytes |
| Upload handshake | **defective, fixed** | `INIT ×2 → CONFIG → COMMIT` acked on both transports, but the host never sent the required `UPLOAD_START (0x23)`; wired streaming then reset the device after ~16 s |
| `FRAME_DATA` packets | accepted individually | one packet acked after ~1.018 s on the dongle |
| Full slot upload | **did not complete** | dongle: ~1.02 s per ack, ~20 min per frame; wired: the device reset after ~16 s of streaming |
| Wired frame stream | **failed — missing UPLOAD_START** | the official application's capture shows `0x23` sent by the host between `COMMIT` and the frames; without it the wired keyboard accepted writes for ~16 s and reset (kernel USB disconnect). The fix awaits a retry |
| Display showing an image | **unverified** | no upload has finished; the panel state was never observed |
| Wired transport write | **partly verified** | configuration writes succeed in ~0.1 s; a frame stream has not yet completed |
| Animated GIF | **never attempted** | — |
| Cancel / repair | **never attempted on hardware** | mock coverage only |
| Power-cycle persistence | **never tested** | — |

Visual confirmation was impossible even for the writes that were acknowledged:
the only camera available (`/dev/video0`, a NexiGo N60) returned a black frame or
sensor noise at maximum exposure. Every "acknowledged" result below is protocol
and snapshot evidence, not a human seeing the panel or the lighting change.

## 2. Safety rules for any future run

These are not suggestions. They exist because the previous run caused spurious
input and system poweroffs.

1. **One command at a time, in the foreground.** No concurrent `gmk87-cli`
   processes, no second host using the keyboard, no other USB traffic to it.
2. **Never detach.** No `setsid`, no `nohup`, no trailing `&`, no systemd unit,
   no "run it and check later". `Ctrl-C` must reach the process immediately.
   A detached upload is what caused the incident; one survived both the session
   and a server restart.
3. **Bound the total time.** The upload stream has a 300 s internal ceiling;
   still wrap the command in `timeout 360` so the process cannot outlive your
   attention:
   ```bash
   timeout 360 gmk87-cli upload test.png --slot 0 --show
   ```
   `timeout` sends `SIGTERM`, which the CLI catches and turns into a cancel, so
   the in-process repair runs. Only `SIGKILL` (`kill -9`) bypasses it and leaves
   the display mid-transaction; if that happens, run the recovery procedure
   below.
4. **Never a bare unattended upload.** Somebody must be watching the keyboard
   and the terminal for the whole run, ready to unplug it.
5. **Unplug the device if it misbehaves** — spurious typing, a re-enumeration
   loop, a stuck display, or a fanfare of USB connect/disconnect events. Unplug
   first, diagnose second.
6. **Prefer the wired interface** for the first real upload. The dongle's
   ~1.02 s acknowledgement cadence is the reason no upload has ever finished.
7. **Do not send `PREP_READ (0x03)` or `READ_CFG (0x05)`.** They are not a read
   path; the reference read preamble reset and re-enumerated this keyboard
   twice. No current command sends them — keep it that way.
8. **Keep the snapshot.** Copy the snapshot —
   `$XDG_DATA_HOME/gmk87/config.snapshot` when `XDG_DATA_HOME` is set, otherwise
   `~/.local/share/gmk87/config.snapshot` — before a run. It is the only record
   of what the app believes the device holds, and the device cannot be read
   back.

### Recovery after a bad run

1. Unplug the keyboard. Let enumeration settle.
2. Make sure nothing is still running: `pgrep -a gmk87` must print nothing. Kill
   any survivor; never leave it detached.
3. Replug, wait for the device to appear, then confirm with `gmk87-cli probe`.
4. Rewrite a known-good block in the foreground:
   ```bash
   gmk87-cli clock
   gmk87-cli lights --brightness 9
   ```
5. If the display is stuck on a torn slot, upload a known image again or set
   the display back to the clock. Both are single bounded foreground commands.

## 3. Prerequisites

- **Permissions.** The udev rule grants the active seat access without root:
  ```bash
  sudo cp packaging/50-gmk87.rules /etc/udev/rules.d/
  sudo udevadm control --reload-rules
  sudo udevadm trigger
  ```
  Unplug and replug the keyboard, then check `gmk87-cli probe`. See the README
  for the full explanation. A `PermissionDenied` error means the rule is not
  installed or the session is not on the seat that owns the device.
- **One keyboard.** With both the wired keyboard and the dongle plugged in,
  `probe` lists two devices and the CLI opens the **first**, which is the wired
  one. Unplug the transport you do not want to test.
- **A way to see the result.** A working camera, or a second person watching the
  panel and the underglow. Protocol acknowledgements alone do not prove that
  anything changed on the device.
- **`GMK87_HW=1`.** This is the reserved opt-in marker for hardware tests. When
  a hardware test exists it will be invoked as:
  ```bash
  GMK87_HW=1 cargo test -p gmk87-device --test hardware -- --nocapture
  ```
  No such test exists yet. The convention is recorded now so that a future
  hardware test is skipped unless the variable is set and is never enabled in
  CI. `cargo test --all` must stay hardware-free: mock transports only, no
  `/dev/hidraw*`, no device commands.

## 4. Evidence gathered so far

All from 2026-11-01, local time (CST), dongle unless stated. "Acked" means the
device returned a report whose command byte matched; it does **not** mean the
effect was seen.

| Time | Command | Transport | Observed |
|---|---|---|---|
| earlier | `probe` | wired + dongle | wired `320f:5055` and `2.4 GHz` `320f:5088` both listed, `via=true` |
| ~19:00 | `show-config` | none (no device I/O) | reference defaults printed: brightness 9, RGB `f8ff00`, delay 65535, slot 1 frames 255 |
| 19:01 | `clock` | dongle | `COMMIT` acked (~1.02 s); snapshot bytes 35–41 = `00 01 19 00 01 11 26` = 19:01:00, Sunday 2026-11-01; panel not observed |
| 19:01 | `lights --brightness 5` | dongle | `COMMIT` acked; snapshot byte 2 changed 9 → 5; underglow not observed |
| 19:01 | `upload test.png --slot 1 --show` | dongle | failed waiting for `READY (0x23)` after ~6 s; a raw read showed `CONFIG`/`COMMIT` acks but no `0x23`. The code then waited for a device-sent `0x23`; the host should have sent it (corrected later) |
| ~19:02 | one `FRAME_DATA` after `COMMIT` | dongle | acked after 1,018 ms, so the dongle accepts frames after `COMMIT` without any `0x23` exchange |
| 19:06 | `upload test.png --slot 1 --show` | dongle | handshake ok, streaming began, no exit line: the process was killed externally before any progress quarter was reached |
| 19:08 | `upload` (repeat) | dongle | killed externally (`status=9/KILL`) after ~54 s |
| 19:09 | `probe` | dongle | path had changed `/dev/hidraw10` → `/dev/hidraw6`; the interrupted upload re-enumerated the dongle |
| 19:09 | bare `COMMIT`, then `INIT → CONFIG(default) → COMMIT` | dongle | all acks ~1.026 s; display recovered to the default clock, per the rewritten block |
| 19:10 | `clock` | dongle | acked; snapshot left `… 00 51 10 19 00 01 11 26 00 ff ff 00 ff 00` |
| later | `clock`, `lights` | wired `/dev/hidraw12` | both complete in ~0.1 s; the `INIT → CONFIG → COMMIT` handshake is confirmed working on real wired hardware |
| later | `upload static.png --slot 0` | wired `/dev/hidraw12` | streamed for ~16 s and then the keyboard reset; the kernel logged a USB disconnect. The host had never sent `UPLOAD_START (0x23)`, so the upload session was never opened |
| later | diagnosis from the official capture | — | `gmk87sniffed.pcapng` (2,347 reports with valid checksums) shows `INIT → INIT → CONFIG → COMMIT → UPLOAD_START(0x23) → FRAME_DATA ×2341 → COMMIT`: `0x23` is a **host** command, one occurrence, len 0, pos 0, directly before the frames. Both community references send it. The host now sends it once and tolerates a missing ack; the hardware retry is pending |

The measured dongle cadence, repeated across commands:

```text
INIT ack after 1020.6 ms
INIT ack after 1021.0 ms
INIT ack after 1025.9 ms
three INITs written back-to-back -> one ack at +1026 ms within 5 s
FRAME_DATA ack after 1018.0 ms
final COMMIT ack after 1016.0 ms
```

A 65,536-byte frame is 1,171 packets of 56 bytes. At one acknowledged packet per
second that is about **twenty minutes per frame** if each packet is waited for,
which is why the stream falls back to the tolerant mode on the dongle. On the
wired interface each packet is answered in milliseconds, so the stream stays
paced. The wired run that exposed the missing `UPLOAD_START (0x23)` streamed for
about sixteen seconds and then reset the keyboard; the corrected handshake has
not yet been retried on hardware.

The incident itself, for the record: detached uploads launched with
`setsid nohup …` survived the session, kept writing to a keyboard left in a
confused state, produced random keystrokes, and both boots that day ended in a
clean `systemd-logind` poweroff triggered by a spurious power-key event. There
was no crash and no data loss; the machine was powered off by its own keyboard.
Containment was to kill the processes, quarantine the built CLI binary, and stop
all hardware writes.

## 5. Results table for a future run

Fill this in only from an authorised, foreground run. Leave a row blank rather
than guessing; "not run" is a valid result. Add rows as needed, and record the
exact command and any error text next to the observation.

| # | Step | Expected | Observed | Date | Transport |
|---|---|---|---|---|---|
| 1 | `gmk87-cli probe` with one keyboard connected | exactly one device, correct product ID, `via=true` | | | |
| 2 | `gmk87-cli show-config` | prints the snapshot and its path; no device I/O | | | |
| 3 | `gmk87-cli clock` | panel clock reads local time (24-hour); snapshot BCD bytes match | | | |
| 4 | `gmk87-cli lights --brightness 5` | underglow dims; other fields unchanged | | | |
| 5 | `gmk87-cli lights --effect N --speed N --rgb R,G,B` | effect, speed and colour change as requested | | | |
| 6 | `gmk87-cli lights --led-mode N --led-color N` | side LEDs change mode and colour | | | |
| 7 | `gmk87-cli upload static.png --slot 0 --show` | image appears in slot 0 within the run | | | |
| 8 | `gmk87-cli upload static.png --slot 1 --show` | slot 1 shows the image; switch back to slot 0 and it is intact | | | |
| 9 | `gmk87-cli upload anim.gif --slot 0 --show` | frames animate at the source delay, floored at 60 ms | | | |
| 10 | `gmk87-cli upload over-budget.gif --slot 0` (37 frames) | refused before any USB traffic, with the frame count in the error | | | |
| 11 | Cancel an upload mid-stream (`Ctrl-C` at ~50%) | `SIGINT`/`SIGTERM` cancels the stream and the in-process repair sends `COMMIT` and rewrites the pre-upload block; `SIGKILL` cannot be caught and leaves the display mid-transaction, so the §2 recovery procedure must be run | | | |
| 12 | Unplug the keyboard mid-upload | CLI reports a transport error; replug re-enumerates; display not torn | | | |
| 13 | Power-cycle the keyboard after a successful upload | `show_image` and the uploaded frame survive, or the behaviour is recorded | | | |
| 14 | Repeat steps 7–9 over the **wired** interface | same results, materially faster than the dongle; the stream stays in paced mode instead of reaching `UploadTimeout` | | | |
| 15 | Repeat step 7 over the **dongle** with `timeout 360` | completes inside 300 s, or fails cleanly with `UploadTimeout` and repairs | | | |
| 16 | Run with the udev rule removed | `PermissionDenied`, with the rule named in the message | | | |
| 17 | Plug in wired and dongle together | `probe` lists two; CLI opens the wired one; state not confused | | | |
| 18 | Animated GIF with partial-frame updates | composited correctly, or the rendering fault is recorded | | | |

## 6. Open risks to record against

From spec §12, plus the ones hardware testing has already exposed. Each line is
here so a future run can replace it with a finding and a date.

- **Per-slot frame limits differ from the reference.** Record the largest frame
  count and the shortest delay the device accepts in each slot. Currently only
  the host-side 36-frame / 60 ms budget is enforced.
- **2.4 GHz timing differs from wired.** Record the measured acknowledgement
  interval, the wall time for one 65,536-byte frame, and whether the 300 s
  ceiling is enough. Measured so far: ~1.02 s per acknowledgement.
- **`show_image` does not persist across a power cycle.** Record what the panel
  shows after unplugging and replugging: the last image, the clock, or the
  default. The UI copy depends on this.
- **Unknown configuration bytes.** The read-modify-write mitigation is gone
  because the device cannot be read; the app now writes the whole block from its
  snapshot. Record any field that visibly resets after a write (underglow, side
  LEDs, clock, display selection).
- **AppImage and permissions.** Not hardware, but record it with the packaging
  run: a user without the udev rule must get a usable error and the rule text.
- **Wired vendor input report is 7 bytes.** During read/echo probes,
  acknowledgements arrived truncated to 8 bytes; no wired configuration or frame
  write has been attempted. Record whether a wired write's acknowledgement has
  the same shape and whether it ever carries a payload; if one does, the
  short-ack assumption needs revisiting.
- **UPLOAD_START (0x23) is a host command.** The official application's capture
  shows one `0x23` packet (len 0, pos 0) between `COMMIT` and the first frame
  packet, and both community references send it. Our earlier builds waited for
  the device to send `0x23` instead and never sent it, which made the wired
  keyboard reset after ~16 s of streaming. Record whether the corrected
  handshake completes the upload and whether the `0x23` acknowledgement arrives.
- **HID report ID offset.** Acknowledgement matching reads `report[3]`, which
  assumes hidapi preserves the HID report ID at offset 0 of every input report.
  That has never been confirmed on this hardware. If it is wrong, every
  acknowledgement misses and the failure mode is bounded: 64 consecutive missed
  frame acknowledgements fail the upload with `ProtocolTimeout`, and the repair
  path runs. Record the raw bytes of the first acknowledgement on each transport.
- **Slot-1-only uploads.** Record whether writing slot 1 at position 0 leaves
  slot 0's image intact, or whether the frame-count split assumption is wrong.
- **Wired `UPLOAD_START` retry.** The first wired one-slot upload reset after
  ~16 s because `0x23` was never sent. The host now sends it once; record
  whether the retry completes, the wall time, and whether the display shows the
  image.
- **GIF compositing.** Frames are decoded independently, without disposal or
  offset compositing. Record how badly a partial-update GIF renders.
- **The power-key hazard.** The keyboard is watched as a system-button device.
  If a future run produces spurious input again, stop, unplug, and record the
  `journalctl` lines before retrying.

## 7. Re-authorisation

Hardware verification resumes only on an explicit human decision, with:

- one transport at a time, wired first;
- a single foreground command per step, wrapped in `timeout`;
- a person watching the device for the whole run;
- the snapshot backed up first;
- the results table above filled in as the run proceeds, not afterwards.

Until then, the honest summary is: **the protocol is understood, the write path
is implemented and unit-tested, configuration writes are acknowledged on both
transports (wired in ~0.1 s), and a first wired frame stream exposed and then
fixed a missing `UPLOAD_START (0x23)` — but no upload has ever been seen to
finish, and no display or lighting change has been confirmed by eye.**
