# GMK87 Configurator

A Linux tool for the ZUOYA GMK87 mechanical keyboard: upload images and animated
GIFs to its 240×135 TFT display, control the RGB lighting, and sync the
keyboard's real-time clock — directly over USB `hidraw`, with no vendor software
and no root once the udev rule is installed.

This repository currently contains the **Rust core and a command-line tool**.
The Tauri desktop application is a follow-on plan; the protocol, device layer and
CLI are complete enough to build on.

> **The wired write path is verified end to end.** On 2026-11-01 the wired
> keyboard accepted a clock write (the panel shows it), a lighting write, and a
> single-frame display upload that put its image on the panel. The 2.4 GHz
> upload, animation, and power-cycle persistence are still unverified. Read
> [`docs/hardware-testing.md`](docs/hardware-testing.md) before writing to a real
> keyboard — it records what was seen and the safety rules any run must follow.

## Supported hardware

| Device | USB ID | Notes |
|---|---|---|
| ZUOYA GMK87, wired | `320f:5055` | vendor channel on usage page `0xFF1C`, report ID `0x04` |
| ZUOYA GMK87, 2.4 GHz dongle | `320f:5088` | vendor channel on `0xFF1C`; slower acknowledgements |

Both transports are detected. With both plugged in, discovery returns two
devices: the wired keyboard first, then the dongle. The CLI opens the **first**
one, so unplug the transport you do not want to use. Only one session is open at
a time; the keyboard has a single state machine.

The keyboard also exposes a VIA raw-HID interface (`0xFF60`). It is detected and
reported (`via=true` in `probe`) but never driven — keymap remapping is out of
scope.

## What it does

- **Display:** two slots; a static image or animated GIF is cropped, scaled,
  converted to big-endian RGB565 and uploaded to either slot. Choose whether the
  display shows the clock, slot 0 or slot 1.
- **Lighting:** underglow effect, brightness, speed, orientation, rainbow toggle
  and RGB colour; side LED mode, colour and saturation; win-lock.
- **Clock:** writes the system time to the keyboard in the device's packed-BCD
  format.

Not in scope: keymap remapping, firmware updates, Windows/macOS, and reading the
device's current settings — the hardware cannot be read at all (see below).

## Crate layout

```text
crates/
  gmk87-protocol/   pure, no I/O: packet codec, checksum, 48-byte configuration
                    block, RGB565 conversion, image crop/scale, GIF frames and
                    the upload frame budget
  gmk87-device/     discovery, the hidapi Transport, and the Session state
                    machine: configuration writes, upload streaming, repair
  gmk87-cli/        the gmk87-cli debug and recovery tool
docs/
  protocol.md               corrected protocol reference
  hardware-testing.md       verified results, safety rules, results table
packaging/
  50-gmk87.rules            udev rule granting seat access without root
```

The protocol crate is deliberately free of I/O so a future background service
can link it unchanged.

## Building

Rust stable (see `rust-toolchain.toml`), plus `hidapi`'s system dependencies:

```bash
# Debian / Ubuntu
sudo apt install libudev-dev pkg-config
# Fedora
sudo dnf install systemd-devel
# Arch
sudo pacman -S systemd-libs
```

Then:

```bash
cargo build --release          # target/release/gmk87-cli
cargo test --all               # mock transports only; never touches a keyboard
cargo fmt --all --check
cargo clippy --all-targets -- -D warnings
```

## Command-line usage

```bash
gmk87-cli probe
gmk87-cli show-config
gmk87-cli clock
gmk87-cli lights --brightness 5
gmk87-cli lights --effect 5 --brightness 9 --speed 3 --rgb 248,255,0
gmk87-cli lights --orientation 1 --underglow-rainbow 1 --winlock true
gmk87-cli lights --led-mode 2 --led-color 5 --led-saturation 7 --led-rainbow 1
gmk87-cli upload picture.png --slot 0 --show
gmk87-cli upload animation.gif --slot 1
```

Run from the source tree with `cargo run -p gmk87-cli -- <args>` instead.

| Command | What it does |
|---|---|
| `probe` | lists detected keyboards: label, `/dev/hidraw*` path, product ID, whether VIA is present. Read-only. |
| `show-config` | prints the configuration the app would write, from the saved snapshot. Performs **no device I/O**. |
| `clock` | syncs the keyboard clock to local time. |
| `lights` | patches underglow and side-LED fields and writes the block. Options: `--effect`, `--brightness`, `--speed`, `--orientation` (0–1), `--underglow-rainbow` (0–1), `--rgb R,G,B`, `--winlock true\|false`, `--led-mode`, `--led-saturation` (0–9), `--led-rainbow` (0–1), `--led-color`. |
| `upload <file>` | uploads an image or animated GIF to `--slot 0` or `--slot 1` (default 0). `--show` switches the display to that slot; without it the upload still happens but the display is switched to the **clock**. |

Notes that surprise people:

- Every successful write sends the **whole 48-byte configuration block**,
  including fields this command does not change. There is no read-modify-write,
  because the device cannot be read.
- Every command starts from the saved snapshot
  (`$XDG_DATA_HOME/gmk87/config.snapshot`, falling back to
  `~/.local/share/gmk87/config.snapshot`) and updates it after a successful
  write. Delete that file to fall back to the reference defaults.
- Each frame is 65,536 bytes on the wire — 1,171 packets. Over the 2.4 GHz
  dongle, which acknowledges about one packet per second, an upload is very slow
  and bounded by a 300 s ceiling. Prefer the wired transport.

## Permissions: the udev rule

Without a rule, opening `/dev/hidraw*` needs root. `packaging/50-gmk87.rules`
grants the active seat access via `TAG+="uaccess"`:

```bash
sudo cp packaging/50-gmk87.rules /etc/udev/rules.d/
sudo udevadm control --reload-rules
sudo udevadm trigger
# unplug and replug the keyboard
gmk87-cli probe
```

Packages install the rule to `/usr/lib/udev/rules.d/`. Do not run the CLI with
`sudo`: the rule already gives the logged-in user access, and root-run commands
would leave a root-owned snapshot in `~/.local/share/gmk87/` that later
unprivileged runs could not update.

If `probe` or any write reports `PermissionDenied`, the rule is missing or the
session is not on the seat that owns the device.

## The write-only limitation

The GMK87 cannot be read. `READ_CFG (0x05)` merely echoes the request payload;
the reference "read mode" preamble resets and re-enumerates the keyboard. This
was verified on both transports and matches a capture of the official
application, which also never reads — it keeps state in its UI.

So this project owns the configuration: it keeps the 48-byte block in memory,
seeds it from the snapshot it last wrote, and writes the complete block each
time. The first write replaces anything configured with the official
application. `docs/protocol.md` §6 has the full evidence and consequences.

## Hardware verification

The wired transport is verified end to end: clock, lighting, and a single-frame
display upload. The 2.4 GHz dongle upload, multi-frame/GIF animation, the wired
acknowledgement's payload shape, and `show_image` across a power cycle remain
unverified. See [`docs/hardware-testing.md`](docs/hardware-testing.md) for the
results, the incident that shapes the safety rules (a detached upload produced
spurious keystrokes and triggered system poweroffs), and the empty rows left for
a future run.

## Desktop application

The Tauri + React application — device picker, crop/zoom display editor, upload
progress and cancel, lighting and clock screens — is a follow-on plan and is not
in this workspace. It will sit on the same `gmk87-device` API.

## License and attribution

GPL-3.0-or-later; see `LICENSE`.

The USB protocol was documented by the community and this project ports the
packet format and command sequence from MIT-licensed work
(`codedgar/gmk87-node`, `ikkentim/gmk87-usb-reverse`). Attribution is recorded in
`NOTICE` and in [`docs/protocol.md`](docs/protocol.md) §1.
