use super::{open_session, save_snapshot, signals};
use gmk87_device::session::CancelToken;
use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::frames::{extract_gif_frames, FramePlan, MAX_TOTAL_FRAMES, MIN_FRAME_DELAY_MS};
use gmk87_protocol::image::{prepare_static, CropSpec};
use std::path::Path;

pub fn run(path: &Path, slot: u8, show: bool) -> anyhow::Result<()> {
    let bytes = std::fs::read(path)?;
    let crop = CropSpec::default();

    let (frames, delay_ms) = if bytes.starts_with(b"GIF8") {
        let (frames, source_delay) = extract_gif_frames(&bytes, &crop, MAX_TOTAL_FRAMES)?;
        (frames, source_delay.max(MIN_FRAME_DELAY_MS))
    } else {
        (vec![prepare_static(&bytes, &crop)?], MIN_FRAME_DELAY_MS)
    };

    let plan = if slot == 0 {
        FramePlan {
            slot0_frames: frames,
            slot1_frames: vec![],
            delay_ms,
            show: pick(show, ShowSlot::Slot0),
        }
    } else {
        FramePlan {
            slot0_frames: vec![],
            slot1_frames: frames,
            delay_ms,
            show: pick(show, ShowSlot::Slot1),
        }
    };

    let mut session = open_session()?;
    let cancel = CancelToken::new();
    // `Ctrl-C` and `timeout`'s SIGTERM cancel the stream instead of killing
    // the process, so the repair path below runs on this thread.
    let _interrupts = signals::watch(cancel.clone());
    println!(
        "Uploading {} frame(s)...",
        plan.slot0_frames.len() + plan.slot1_frames.len()
    );
    session.upload(&plan, &cancel, &mut |p| {
        if p.bytes_sent % (65536 / 4) < 56 {
            println!("  {}%", p.bytes_sent * 100 / p.total_bytes.max(1));
        }
    })?;
    println!("Done.");
    save_snapshot(&session)?;
    Ok(())
}

fn pick(show: bool, slot: ShowSlot) -> ShowSlot {
    if show {
        slot
    } else {
        ShowSlot::Clock
    }
}
