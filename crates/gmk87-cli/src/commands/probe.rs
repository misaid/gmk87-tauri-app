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
