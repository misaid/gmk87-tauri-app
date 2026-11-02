mod commands;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

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
    /// Print the configuration the app would write (no device access).
    ShowConfig,
    /// Upload an image or GIF to a display slot.
    Upload {
        file: PathBuf,
        /// Display slot: 0 or 1.
        #[arg(long, default_value_t = 0)]
        slot: u8,
        /// Switch the display to this slot after uploading.
        #[arg(long)]
        show: bool,
    },
    /// Change underglow and LED settings.
    Lights {
        #[arg(long)]
        effect: Option<u8>,
        #[arg(long)]
        brightness: Option<u8>,
        #[arg(long)]
        speed: Option<u8>,
        /// Underglow orientation: 0 or 1.
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=1))]
        orientation: Option<u8>,
        /// Underglow rainbow toggle: 0 or 1.
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=1))]
        underglow_rainbow: Option<u8>,
        #[arg(long, value_delimiter = ',')]
        rgb: Option<Vec<u8>>,
        /// Win-lock: pass `true` or `false`.
        #[arg(long)]
        winlock: Option<bool>,
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=9))]
        led_mode: Option<u8>,
        /// Side LED saturation: 0–9.
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=9))]
        led_saturation: Option<u8>,
        /// Side LED rainbow toggle: 0 or 1.
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=1))]
        led_rainbow: Option<u8>,
        #[arg(long, value_parser = clap::value_parser!(u8).range(0..=8))]
        led_color: Option<u8>,
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
        Command::ShowConfig => commands::config::run(),
        Command::Upload { file, slot, show } => {
            anyhow::ensure!(slot <= 1, "--slot must be 0 or 1");
            commands::upload::run(&file, slot, show)
        }
        Command::Lights {
            effect,
            brightness,
            speed,
            orientation,
            underglow_rainbow,
            rgb,
            winlock,
            led_mode,
            led_saturation,
            led_rainbow,
            led_color,
        } => {
            let rgb = match rgb {
                Some(values) => {
                    anyhow::ensure!(values.len() == 3, "--rgb needs exactly three values");
                    Some((values[0], values[1], values[2]))
                }
                None => None,
            };
            commands::lights::run(
                effect,
                brightness,
                speed,
                orientation,
                underglow_rainbow,
                rgb,
                winlock,
                led_mode,
                led_saturation,
                led_rainbow,
                led_color,
            )
        }
        Command::Clock => commands::clock::run(),
    }
}
