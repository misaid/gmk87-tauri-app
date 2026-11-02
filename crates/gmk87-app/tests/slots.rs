use gmk87_app::error::ErrorKind;
use gmk87_app::job::SlotTarget;
use gmk87_app::slots::{SlotStore, BLACK_FRAME_BYTES};

fn frame(color: u8) -> Vec<u8> {
    vec![color; BLACK_FRAME_BYTES]
}

#[test]
fn starts_with_one_black_frame_in_each_slot() {
    let store = SlotStore::default();
    assert_eq!(store.frames(SlotTarget::Slot0).len(), 1);
    assert_eq!(store.frames(SlotTarget::Slot1).len(), 1);
    assert!(store.frames(SlotTarget::Slot0)[0].iter().all(|b| *b == 0));
}

#[test]
fn replacing_one_slot_keeps_the_other() {
    let mut store = SlotStore::default();
    store
        .set(SlotTarget::Slot0, vec![frame(1), frame(2), frame(3)])
        .unwrap();
    assert_eq!(store.frames(SlotTarget::Slot0).len(), 3);
    assert_eq!(
        store.frames(SlotTarget::Slot1).len(),
        1,
        "slot 1 is untouched"
    );
}

#[test]
fn rejects_a_combined_frame_count_over_thirty_six() {
    // The budget is inclusive: 36 in slot 0 plus slot 1's retained frame is 37.
    let mut store = SlotStore::default();
    let error = store
        .set(SlotTarget::Slot0, vec![frame(0); 36])
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(
        error.message.contains("36"),
        "names the budget: {}",
        error.message
    );
    assert!(
        error.message.contains("37"),
        "names the combined count: {}",
        error.message
    );
}

#[test]
fn builds_a_plan_with_both_slots() {
    let mut store = SlotStore::default();
    store
        .set(SlotTarget::Slot0, vec![frame(0), frame(0)])
        .unwrap();
    let plan = store.build_plan(80, gmk87_protocol::config::ShowSlot::Slot0);
    assert_eq!(plan.slot0_frames.len(), 2);
    assert_eq!(plan.slot1_frames.len(), 1);
    assert_eq!(plan.delay_ms, 80);
    plan.validate().unwrap();
}
