use super::{open_session, save_snapshot};

pub fn run() -> anyhow::Result<()> {
    let mut session = open_session()?;
    session.sync_clock(&chrono::Local::now())?;
    println!(
        "Clock synced to {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );
    save_snapshot(&session)?;
    Ok(())
}
