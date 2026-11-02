use gmk87_protocol::error::ProtocolError;
use gmk87_protocol::image::{prepare_static, CropSpec, Fit};
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

#[test]
fn produces_exactly_one_display_frame() {
    let out = prepare_static(&png(800, 600), &CropSpec::default()).unwrap();
    assert_eq!(out.len(), (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize);
}

#[test]
fn cover_and_contain_both_fill_the_frame() {
    let wide = png(1000, 100);
    for fit in [Fit::Cover, Fit::Contain] {
        let crop = CropSpec {
            fit,
            ..CropSpec::default()
        };
        let out = prepare_static(&wide, &crop).unwrap();
        assert_eq!(out.len(), (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize);
    }
}

#[test]
fn rejects_non_image_data() {
    let err = prepare_static(b"this is not an image", &CropSpec::default()).unwrap_err();
    assert!(matches!(err, ProtocolError::ImageDecode(_)));
}

#[test]
fn rejects_a_truncated_png() {
    let mut bytes = png(64, 64);
    bytes.truncate(bytes.len() / 2);
    assert!(prepare_static(&bytes, &CropSpec::default()).is_err());
}

#[test]
fn rejects_an_absurdly_large_image() {
    // A PNG header claiming 50000x50000 is refused before allocation.
    let header = {
        let mut v = vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
        v.extend_from_slice(&13u32.to_be_bytes());
        v.extend_from_slice(b"IHDR");
        v.extend_from_slice(&50_000u32.to_be_bytes());
        v.extend_from_slice(&50_000u32.to_be_bytes());
        v.extend_from_slice(&[8, 2, 0, 0, 0]);
        v.extend_from_slice(&[0, 0, 0, 0]);
        v.extend_from_slice(&[0, 0, 0, 0]);
        v
    };
    let err = prepare_static(&header, &CropSpec::default()).unwrap_err();
    assert!(matches!(err, ProtocolError::ImageDecode(_)), "got {err:?}");
}
