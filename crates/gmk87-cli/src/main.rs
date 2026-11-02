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
