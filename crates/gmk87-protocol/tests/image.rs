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

fn png_with_declared_size(width: u32, height: u32) -> Vec<u8> {
    // Start from a valid 8x8 PNG, rewrite the IHDR dimensions, then fix the
    // IHDR CRC so the only thing wrong with the header is its size.
    let mut bytes = png(8, 8);
    bytes[16..20].copy_from_slice(&width.to_be_bytes());
    bytes[20..24].copy_from_slice(&height.to_be_bytes());
    let crc = crc32fast::hash(&bytes[12..29]);
    bytes[29..33].copy_from_slice(&crc.to_be_bytes());
    bytes
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
    // A real PNG whose IHDR is patched to claim 50000x50000 (with a valid
    // CRC32), so this asserts on the pixel-budget size guard, not on a decode
    // failure: the guard must fire from the header alone, before any
    // full-size pixel buffer is allocated.
    let bytes = png_with_declared_size(50_000, 50_000);
    let err = prepare_static(&bytes, &CropSpec::default()).unwrap_err();
    assert!(matches!(err, ProtocolError::ImageDecode(_)), "got {err:?}");
    assert!(
        err.to_string().contains("pixel budget"),
        "expected the size guard to reject the header, got {err:?}"
    );
}
