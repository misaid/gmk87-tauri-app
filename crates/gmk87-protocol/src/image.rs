//! Decode, crop and scale a source image down to one display frame.

use crate::error::ProtocolError;
use crate::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};
use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, ImageReader, Limits};

/// Refuse sources larger than this before decoding.
pub const MAX_SOURCE_PIXELS: u64 = 64_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fit {
    /// Fill the frame, cropping overflow (default).
    Cover,
    /// Fit inside the frame, letterboxing with black.
    Contain,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CropSpec {
    /// Pan in source-image fractions, -1.0..=1.0.
    pub offset_x: f32,
    pub offset_y: f32,
    /// Zoom multiplier, 1.0 is neutral.
    pub zoom: f32,
    pub fit: Fit,
}

impl Default for CropSpec {
    fn default() -> Self {
        Self {
            offset_x: 0.0,
            offset_y: 0.0,
            zoom: 1.0,
            fit: Fit::Cover,
        }
    }
}

/// Decodes `bytes` and returns `DISPLAY_WIDTH * DISPLAY_HEIGHT * 3` RGB8 bytes.
pub fn prepare_static(bytes: &[u8], crop: &CropSpec) -> Result<Vec<u8>, ProtocolError> {
    let image = decode(bytes)?;
    Ok(render(&image, crop))
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, ProtocolError> {
    // Read only the header first so oversized sources are refused before any
    // pixel buffer is allocated. `into_dimensions` consumes its reader, so a
    // second reader is built from the same bytes for the actual decode.
    let (w, h) = open_reader(bytes)?
        .into_dimensions()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;
    if u64::from(w) * u64::from(h) > MAX_SOURCE_PIXELS {
        return Err(too_large(w, h));
    }

    let image = open_reader(bytes)?
        .decode()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;

    // Belt and braces: the decoder's limits can drift, the budget must not.
    let (w, h) = image.dimensions();
    if u64::from(w) * u64::from(h) > MAX_SOURCE_PIXELS {
        return Err(too_large(w, h));
    }
    Ok(image)
}

fn open_reader(bytes: &[u8]) -> Result<ImageReader<std::io::Cursor<&[u8]>>, ProtocolError> {
    let mut reader = ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;

    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_SOURCE_PIXELS.min(u32::MAX as u64) as u32);
    limits.max_image_height = Some(MAX_SOURCE_PIXELS.min(u32::MAX as u64) as u32);
    // The decoder reserves this before allocating decoded pixels, so an
    // oversized source fails here rather than after a full-size allocation.
    limits.max_alloc = Some(MAX_SOURCE_PIXELS * 3);
    reader.limits(limits);
    Ok(reader)
}

fn too_large(width: u32, height: u32) -> ProtocolError {
    ProtocolError::ImageDecode(format!(
        "source {width}x{height} exceeds the {MAX_SOURCE_PIXELS}-pixel budget"
    ))
}

fn render(image: &DynamicImage, crop: &CropSpec) -> Vec<u8> {
    let (src_w, src_h) = image.dimensions();
    let target_ratio = DISPLAY_WIDTH as f32 / DISPLAY_HEIGHT as f32;
    let src_ratio = src_w as f32 / src_h.max(1) as f32;

    // Determine the visible source rectangle for the requested fit.
    let (mut vis_w, mut vis_h) = match crop.fit {
        Fit::Cover => {
            if src_ratio > target_ratio {
                (src_h as f32 * target_ratio, src_h as f32)
            } else {
                (src_w as f32, src_w as f32 / target_ratio)
            }
        }
        Fit::Contain => {
            if src_ratio > target_ratio {
                (src_w as f32, src_w as f32 / target_ratio)
            } else {
                (src_h as f32 * target_ratio, src_h as f32)
            }
        }
    };

    let zoom = crop.zoom.clamp(1.0, 8.0);
    vis_w /= zoom;
    vis_h /= zoom;

    let max_x = (src_w as f32 - vis_w).max(0.0);
    let max_y = (src_h as f32 - vis_h).max(0.0);
    let x0 = (max_x / 2.0) * (1.0 + crop.offset_x.clamp(-1.0, 1.0));
    let y0 = (max_y / 2.0) * (1.0 + crop.offset_y.clamp(-1.0, 1.0));

    let visible = image.crop_imm(
        x0.round() as u32,
        y0.round() as u32,
        vis_w.round().max(1.0) as u32,
        vis_h.round().max(1.0) as u32,
    );

    let resized = match crop.fit {
        Fit::Cover => visible.resize_exact(DISPLAY_WIDTH, DISPLAY_HEIGHT, FilterType::Lanczos3),
        Fit::Contain => visible.resize(DISPLAY_WIDTH, DISPLAY_HEIGHT, FilterType::Lanczos3),
    };

    let mut canvas =
        image::RgbImage::from_pixel(DISPLAY_WIDTH, DISPLAY_HEIGHT, image::Rgb([0, 0, 0]));
    let (rw, rh) = resized.dimensions();
    let ox = (DISPLAY_WIDTH - rw.min(DISPLAY_WIDTH)) / 2;
    let oy = (DISPLAY_HEIGHT - rh.min(DISPLAY_HEIGHT)) / 2;
    let rgb = resized.to_rgb8();
    image::imageops::replace(&mut canvas, &rgb, i64::from(ox), i64::from(oy));
    canvas.into_raw()
}
