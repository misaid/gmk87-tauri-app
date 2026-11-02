use gmk87_app::error::ErrorKind;
use gmk87_app::job::{CropDto, DisplayJob, FitDto, SlotTarget};
use gmk87_app::manager::DeviceManager;
use gmk87_device::mock::MockTransport;
use gmk87_device::session::{CancelToken, UploadProgress};
use gmk87_protocol::packet::Command;
use gmk87_protocol::pixel::SLOT_BYTES;

fn png(width: u32, height: u32) -> Vec<u8> {
    let img = image::RgbImage::from_fn(width, height, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, 128])
    });
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgb8(img)
        .write_to(&mut out, image::ImageFormat::Png)
        .unwrap();
    out.into_inner()
}

fn job(slot: SlotTarget) -> DisplayJob {
    DisplayJob {
        slot,
        bytes: png(240, 135),
        crop: CropDto {
            offset_x: 0.0,
            offset_y: 0.0,
            zoom: 1.0,
            fit: FitDto::Cover,
        },
        delay_ms: 0,
        show_after: true,
    }
}

fn packets(bytes: usize) -> usize {
    bytes.div_ceil(56)
}

/// `INIT ×2 → CONFIG → COMMIT → UPLOAD_START (0x23)`.
fn expect_handshake(mock: &mut MockTransport) {
    mock.expect(Command::Init, vec![vec![]; 2]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::Ready, vec![vec![]]);
}

/// The repair: close the frame transaction, then rewrite the pre-upload block.
fn expect_repair(mock: &mut MockTransport) {
    mock.expect(Command::Commit, vec![vec![]]);
    mock.expect(Command::Init, vec![vec![]]);
    mock.expect(Command::Config, vec![vec![]]);
    mock.expect(Command::Commit, vec![vec![]]);
}

#[test]
fn uploads_both_slots_and_reports_progress() {
    let mut mock = MockTransport::new();
    expect_handshake(&mut mock);
    mock.expect(Command::FrameData, vec![vec![]; packets(SLOT_BYTES * 2)]);
    mock.expect(Command::Commit, vec![vec![]]);

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("snapshot");
    let mut manager = DeviceManager::new(mock, Some(path.clone()));

    let cancel = CancelToken::new();
    let mut seen: Vec<UploadProgress> = Vec::new();
    manager
        .upload(&job(SlotTarget::Slot0), &cancel, &mut |p| seen.push(p))
        .unwrap();

    assert!(!seen.is_empty());
    assert!(
        seen.windows(2).all(|w| w[0].bytes_sent <= w[1].bytes_sent),
        "progress is monotonic"
    );
    let last = seen.last().unwrap();
    assert_eq!(last.bytes_sent, last.total_bytes);
    assert_eq!(last.total_bytes, SLOT_BYTES * 2, "both slots streamed");

    let saved = gmk87_app::snapshot::load(&path).expect("snapshot written");
    assert_eq!(saved.slot0_frames(), 1);
    assert_eq!(saved.slot1_frames(), 1);
    assert_eq!(saved.show_image(), gmk87_protocol::config::ShowSlot::Slot0);
}

#[test]
fn cancelling_mid_stream_repairs_and_reports_it() {
    let mut mock = MockTransport::new();
    expect_handshake(&mut mock);
    mock.expect(Command::FrameData, vec![vec![]]); // one packet acknowledged
    expect_repair(&mut mock);

    let mut manager = DeviceManager::new(mock, None);
    let cancel = CancelToken::new();
    let cancel_in_callback = cancel.clone();
    let mut packets_seen = 0;

    let error = manager
        .upload(&job(SlotTarget::Slot1), &cancel, &mut |_| {
            packets_seen += 1;
            if packets_seen == 1 {
                cancel_in_callback.cancel();
            }
        })
        .unwrap_err();

    assert_eq!(error.kind, ErrorKind::InvalidJob);
    assert!(
        error.message.contains("display repair attempted"),
        "the message must state the display was repaired, not left unchanged: {}",
        error.message
    );
    assert!(!manager.is_synced(), "a cancelled session is not synced");
}

#[test]
fn a_plan_over_budget_fails_before_any_traffic() {
    use gmk87_app::slots::{SlotStore, BLACK_FRAME_BYTES};
    let mut store = SlotStore::default();
    let frames: Vec<Vec<u8>> = (0..36).map(|_| vec![0u8; BLACK_FRAME_BYTES]).collect();
    let error = store.set(SlotTarget::Slot1, frames).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
}
