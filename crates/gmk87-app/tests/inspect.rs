use gmk87_app::inspect::inspect;
use gmk87_protocol::image::CropSpec;

fn png() -> Vec<u8> {
    let img = image::RgbImage::from_fn(64, 64, |_, _| image::Rgb([10, 20, 30]));
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
        for _ in 0..frames {
            let mut f = gif::Frame::from_rgb(8, 8, &[7u8; 8 * 8 * 3]);
            f.delay = delay_centisec;
            enc.write_frame(&f).unwrap();
        }
    }
    out
}

#[test]
fn reports_a_static_image_as_one_frame() {
    let info = inspect(&png(), &CropSpec::default(), 0).unwrap();
    assert!(!info.is_gif);
    assert_eq!(info.frames, 1);
    assert_eq!(info.delay_ms, 100);
}

#[test]
fn reports_a_gifs_frame_count_and_delay() {
    let info = inspect(&gif(4, 8), &CropSpec::default(), 0).unwrap();
    assert!(info.is_gif);
    assert_eq!(info.frames, 4);
    assert_eq!(info.delay_ms, 80);
}
