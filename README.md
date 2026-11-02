# GMK87 Configurator

A Linux configurator for the ZUOYA GMK87 mechanical keyboard: upload images and
GIFs to its 240×135 TFT display, control the RGB lighting, and sync the
keyboard's real-time clock over USB `hidraw`. The workspace has three crates:
`gmk87-protocol` (pure encoding, configuration and image math, no I/O),
`gmk87-device` (device discovery, transport and session state machine) and
`gmk87-cli` (the command-line tool). Build everything with
`cargo build --release`.
