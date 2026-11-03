use gmk87_protocol::config::ShowSlot;
use gmk87_protocol::error::ProtocolError;
use gmk87_protocol::frames::*;
use gmk87_protocol::image::CropSpec;
use gmk87_protocol::pixel::SLOT_BYTES;

fn frame() -> Vec<u8> {
    vec![0u8; (240 * 135 * 3) as usize]
}

fn gif_with(frames: usize, delay_ms: u16) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, 8, 8, &[]).unwrap();
        enc.set_repeat(gif::Repeat::Infinite).unwrap();
        for i in 0..frames {
            let mut f = gif::Frame::from_rgb(8, 8, &[(i % 255) as u8; 8 * 8 * 3]);
            f.delay = delay_ms / 10;
            enc.write_frame(&f).unwrap();
        }
    }
    out
}

#[test]
fn slots_are_padded_and_ordered() {
    let plan = FramePlan {
        slot0_frames: vec![frame(), frame()],
        slot1_frames: vec![frame()],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };
    plan.validate().unwrap();
    assert_eq!(plan.slot0_memory().unwrap().len(), SLOT_BYTES * 2);
    assert_eq!(plan.to_memory().unwrap().len(), SLOT_BYTES * 3);
}

#[test]
fn rejects_more_than_thirty_six_frames_across_both_slots() {
    let plan = FramePlan {
        slot0_frames: vec![frame(); 30],
        slot1_frames: vec![frame(); 7],
        delay_ms: 100,
        show: ShowSlot::Slot0,
    };
    let err = plan.validate().unwrap_err();
    assert!(matches!(
        err,
        ProtocolError::FrameBudget {
            frames: 37,
            max: 36
        }
    ));
}

#[test]
fn rejects_a_delay_below_sixty_ms() {
    let plan = FramePlan {
        slot0_frames: vec![frame()],
        slot1_frames: vec![],
        delay_ms: 59,
        show: ShowSlot::Slot0,
    };
    assert!(matches!(
        plan.validate(),
        Err(ProtocolError::FrameDelayTooShort { .. })
    ));
}

#[test]
fn extracts_gif_frames_and_reads_their_delay() {
    let decoded = extract_gif_frames(&gif_with(4, 100), &CropSpec::default(), 36).unwrap();
    assert_eq!(decoded.frames.len(), 4);
    assert_eq!(decoded.delay_ms, 100);
    assert_eq!(decoded.source_frames, 4);
    assert!(decoded.dropped.is_empty());
    assert_eq!(decoded.frames[0].len(), (240 * 135 * 3) as usize);
}

#[test]
fn a_gif_at_the_budget_is_left_untouched() {
    let decoded = extract_gif_frames(&gif_with(36, 100), &CropSpec::default(), 36).unwrap();
    assert_eq!(decoded.frames.len(), 36);
    assert_eq!(decoded.delay_ms, 100);
    assert!(decoded.dropped.is_empty());
}

#[test]
fn compresses_an_over_budget_gif_by_sampling_evenly() {
    let decoded = extract_gif_frames(&gif_with(5, 100), &CropSpec::default(), 3).unwrap();
    assert_eq!(decoded.frames.len(), 3);
    assert_eq!(decoded.source_frames, 5);
    // Frames 1 and 3 are dropped, keeping 0, 2 and 4.
    assert_eq!(decoded.dropped, vec![1, 3]);
}

#[test]
fn compressed_gifs_keep_their_total_duration() {
    let decoded = extract_gif_frames(&gif_with(40, 100), &CropSpec::default(), 36).unwrap();
    assert_eq!(decoded.frames.len(), 36);
    // 40 frames at 100 ms -> 36 frames at ~111 ms:
    assert_eq!(decoded.delay_ms, 111);
    assert_eq!(decoded.dropped.len(), 4);
}

#[test]
fn the_scaled_delay_is_clamped_to_500_ms() {
    let decoded = extract_gif_frames(&gif_with(100, 100), &CropSpec::default(), 5).unwrap();
    assert_eq!(decoded.frames.len(), 5);
    assert_eq!(decoded.delay_ms, 500);
}

#[test]
fn inspecting_a_gif_matches_the_extracted_plan() {
    let bytes = gif_with(40, 100);
    let info = inspect_gif_frames(&bytes, 36).unwrap();
    let extracted = extract_gif_frames(&bytes, &CropSpec::default(), 36).unwrap();
    assert_eq!(info.frames, extracted.frames.len() as u32);
    assert_eq!(info.source_frames, extracted.source_frames);
    assert_eq!(info.delay_ms, extracted.delay_ms);
    assert_eq!(info.dropped, extracted.dropped);
}

#[test]
fn a_gif_with_no_budget_left_is_rejected() {
    let err = extract_gif_frames(&gif_with(40, 100), &CropSpec::default(), 0).unwrap_err();
    assert!(matches!(
        err,
        ProtocolError::FrameBudget { frames: 40, max: 0 }
    ));
}

#[test]
fn rejects_an_empty_gif() {
    let err = extract_gif_frames(&gif_with(0, 100), &CropSpec::default(), 36).unwrap_err();
    assert!(matches!(err, ProtocolError::InvalidJob(_)));
}
