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
    let (frames, delay) = extract_gif_frames(&gif_with(4, 100), &CropSpec::default(), 36).unwrap();
    assert_eq!(frames.len(), 4);
    assert_eq!(delay, 100);
    assert_eq!(frames[0].len(), (240 * 135 * 3) as usize);
}

#[test]
fn refuses_a_gif_that_exceeds_the_frame_budget() {
    let err = extract_gif_frames(&gif_with(40, 100), &CropSpec::default(), 36).unwrap_err();
    assert!(matches!(
        err,
        ProtocolError::FrameBudget {
            frames: 40,
            max: 36
        }
    ));
}

#[test]
fn rejects_an_empty_gif() {
    let err = extract_gif_frames(&gif_with(0, 100), &CropSpec::default(), 36).unwrap_err();
    assert!(matches!(err, ProtocolError::InvalidJob(_)));
}
