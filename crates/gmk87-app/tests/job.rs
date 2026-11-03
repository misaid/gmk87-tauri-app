use gmk87_app::error::ErrorKind;
use gmk87_app::job::{decode_frames, is_gif, preview_png, CropDto, DisplayJob, FitDto, SlotTarget};
use gmk87_protocol::image::CropSpec;
use gmk87_protocol::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};

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

fn gif(frames: usize, delay_centisec: u16) -> Vec<u8> {
    let mut out = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut out, 8, 8, &[]).unwrap();
        enc.set_repeat(gif::Repeat::Infinite).unwrap();
        for i in 0..frames {
            let mut f = gif::Frame::from_rgb(8, 8, &[(i % 255) as u8; 8 * 8 * 3]);
            f.delay = delay_centisec;
            enc.write_frame(&f).unwrap();
        }
    }
    out
}

#[test]
fn detects_gif_by_header() {
    assert!(is_gif(&gif(1, 5)));
    assert!(!is_gif(&png(4, 4)));
    assert!(!is_gif(b"not an image"));
}

#[test]
fn a_static_image_is_one_frame() {
    let decoded = decode_frames(&png(500, 400), &CropSpec::default(), 120, 36).unwrap();
    assert_eq!(decoded.frames.len(), 1);
    assert_eq!(decoded.delay_ms, 120);
    assert!(!decoded.is_gif);
    assert_eq!(decoded.source_frames, 1);
    assert!(decoded.dropped.is_empty());
    assert_eq!(
        decoded.frames[0].len(),
        (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize
    );
}

#[test]
fn a_gif_uses_its_own_delay_when_none_is_given() {
    let decoded = decode_frames(&gif(3, 7), &CropSpec::default(), 0, 36).unwrap();
    assert_eq!(decoded.frames.len(), 3);
    assert_eq!(decoded.delay_ms, 70, "7 centiseconds is 70 ms");
    assert!(decoded.is_gif);
    assert_eq!(decoded.source_frames, 3);
}

#[test]
fn a_gif_over_the_budget_is_compressed_to_fit() {
    let decoded = decode_frames(&gif(40, 10), &CropSpec::default(), 0, 36).unwrap();
    assert_eq!(decoded.frames.len(), 36);
    assert_eq!(decoded.source_frames, 40);
    assert_eq!(decoded.dropped.len(), 4);
    assert_eq!(
        decoded.delay_ms, 111,
        "duration preserved: 40x100ms -> 36x111ms"
    );
}

#[test]
fn a_static_image_with_no_budget_left_is_rejected() {
    let error = decode_frames(&png(4, 4), &CropSpec::default(), 120, 0).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InvalidJob);
}

#[test]
fn preview_returns_a_display_sized_png() {
    let png_bytes = preview_png(&gif(2, 5), &CropSpec::default()).unwrap();
    let decoded = image::load_from_memory(&png_bytes).unwrap();
    assert_eq!(decoded.width(), DISPLAY_WIDTH);
    assert_eq!(decoded.height(), DISPLAY_HEIGHT);
}

#[test]
fn preview_of_a_non_image_is_an_error_not_a_panic() {
    let error = preview_png(b"definitely not an image", &CropSpec::default()).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Protocol);
}

#[test]
fn a_display_job_deserializes_from_camel_case() {
    let json = r#"{
        "slot": "slot1",
        "name": "cat.gif",
        "bytes": [1, 2, 3],
        "crop": { "offsetX": 0.5, "offsetY": -0.5, "zoom": 2.0, "fit": "contain" },
        "delayMs": 80,
        "showAfter": true
    }"#;
    let job: DisplayJob = serde_json::from_str(json).unwrap();
    assert_eq!(job.slot, SlotTarget::Slot1);
    assert_eq!(job.name, "cat.gif");
    assert_eq!(job.bytes, vec![1, 2, 3]);
    assert_eq!(job.crop.to_spec().zoom, 2.0);
    assert!(job.show_after);
    let _ = CropDto {
        offset_x: 0.0,
        offset_y: 0.0,
        zoom: 1.0,
        fit: FitDto::Cover,
    };
}
