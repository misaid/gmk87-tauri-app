use gmk87_app::display_store::{self, CropRecord, DisplayStore, SlotRecord};
use gmk87_app::job::SlotTarget;
use gmk87_protocol::image::{CropSpec, Fit};

fn record(name: &str) -> SlotRecord {
    SlotRecord {
        name: name.to_string(),
        is_gif: true,
        frames: 12,
        source_frames: 40,
        dropped: vec![1, 2, 3],
        delay_ms: 111,
        crop: CropRecord {
            offset_x: 0.25,
            offset_y: -0.5,
            zoom: 1.5,
            fit: "contain".into(),
        },
        has_bytes: true,
    }
}

#[test]
fn round_trips_a_slot_record_and_its_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = DisplayStore::default();
    store.set(SlotTarget::Slot0, record("cat.gif"));
    display_store::save(dir.path(), &store).unwrap();
    assert!(display_store::save_source(dir.path(), SlotTarget::Slot0, b"gif-bytes").unwrap());

    let loaded = display_store::load(dir.path());
    let saved = loaded.store.get(SlotTarget::Slot0).expect("slot 0 record");
    assert_eq!(saved.name, "cat.gif");
    assert_eq!(saved.dropped, vec![1, 2, 3]);
    assert_eq!(
        saved.crop.to_spec(),
        CropSpec {
            offset_x: 0.25,
            offset_y: -0.5,
            zoom: 1.5,
            fit: Fit::Contain,
        }
    );
    assert_eq!(loaded.sources[0].as_deref(), Some(&b"gif-bytes"[..]));
    assert!(loaded.store.get(SlotTarget::Slot1).is_none());
}

#[test]
fn a_missing_directory_loads_empty() {
    let dir = tempfile::tempdir().unwrap();
    let loaded = display_store::load(dir.path());
    assert!(loaded.store.get(SlotTarget::Slot0).is_none());
    assert!(loaded.sources[0].is_none());
}

#[test]
fn an_oversized_source_keeps_the_record_but_not_the_bytes() {
    let dir = tempfile::tempdir().unwrap();
    let big = vec![0u8; display_store::MAX_SOURCE_BYTES + 1];
    assert!(
        !display_store::save_source(dir.path(), SlotTarget::Slot0, &big).unwrap(),
        "an oversized source is not written"
    );
    let loaded = display_store::load(dir.path());
    assert!(loaded.sources[0].is_none());
}

#[test]
fn crop_records_convert_to_and_from_the_protocol_spec() {
    let spec = CropSpec {
        offset_x: 0.1,
        offset_y: 0.2,
        zoom: 2.0,
        fit: Fit::Cover,
    };
    assert_eq!(CropRecord::from_spec(&spec).to_spec(), spec);
}
