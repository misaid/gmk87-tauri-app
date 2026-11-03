//! Decode, crop and scale a source image down to one display frame.

use crate::error::ProtocolError;
use crate::pixel::{DISPLAY_HEIGHT, DISPLAY_WIDTH};
use fast_image_resize::{FilterType, ResizeAlg, ResizeOptions, Resizer};
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

/// A decoded source prepared for previewing, kept so a crop change does not
/// read and decompress the file again.
///
/// Only the preview-resolution image is retained. Uploads decode the source
/// afresh at full resolution, so the cache cannot pin a multi-megapixel buffer.
#[derive(Debug, Clone)]
pub struct DecodedSource {
    /// The image previews render from: a downscaled proxy when the source is
    /// large, otherwise the source itself.
    preview: DynamicImage,
    dimensions: (u32, u32),
}

/// Longest edge of the proxy used for interactive previews.
///
/// The preview is only 240×135, so a 960 px proxy still has more detail than
/// the display can show for zooms up to 4×, while keeping each pan/zoom render
/// cheap regardless of how large the original is.
const PREVIEW_PROXY_EDGE: u32 = 960;

impl DecodedSource {
    /// The source's dimensions before any preview downscaling.
    pub fn dimensions(&self) -> (u32, u32) {
        self.dimensions
    }
}

/// Decodes `bytes` once into a reusable preview source.
pub fn decode_source(bytes: &[u8]) -> Result<DecodedSource, ProtocolError> {
    let image = decode(bytes)?;
    let dimensions = image.dimensions();
    let preview = build_proxy(&image).unwrap_or(image);
    Ok(DecodedSource {
        preview,
        dimensions,
    })
}

/// Downscales a large source once, so pan/zoom never resizes megapixels.
fn build_proxy(image: &DynamicImage) -> Option<DynamicImage> {
    let (width, height) = image.dimensions();
    let longest = width.max(height);
    if longest <= PREVIEW_PROXY_EDGE {
        return None;
    }
    let scale = f64::from(PREVIEW_PROXY_EDGE) / f64::from(longest);
    let dst_w = ((f64::from(width) * scale).round() as u32).max(1);
    let dst_h = ((f64::from(height) * scale).round() as u32).max(1);
    Some(resize_to(image, dst_w, dst_h, FilterType::Lanczos3))
}

/// Resizes with the SIMD-accelerated resizer.
///
/// Falls back to the `image` crate if the SIMD path rejects the buffer (for
/// example an unusual pixel type), so a frame is never dropped over resampling.
fn resize_to(image: &DynamicImage, width: u32, height: u32, filter: FilterType) -> DynamicImage {
    let mut out = DynamicImage::new(width.max(1), height.max(1), image.color());
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(filter));
    match Resizer::new().resize(image, &mut out, &options) {
        Ok(()) => out,
        Err(_) => image.resize_exact(
            width.max(1),
            height.max(1),
            image::imageops::FilterType::Lanczos3,
        ),
    }
}

/// Decodes `bytes` and returns `DISPLAY_WIDTH * DISPLAY_HEIGHT * 3` RGB8 bytes.
///
/// Uploads decode at full resolution every time: they are one-off, and keeping
/// megapixel buffers alive between previews would dominate memory use.
pub fn prepare_static(bytes: &[u8], crop: &CropSpec) -> Result<Vec<u8>, ProtocolError> {
    let image = decode(bytes)?;
    Ok(render(&image, crop, FilterType::Lanczos3))
}

/// Renders a decoded source for a live preview.
///
/// Previews are re-rendered on every pan/zoom tick, so they render from the
/// downscaled proxy with the cheaper bilinear filter; the upload path keeps the
/// full-resolution, sharper result.
pub fn render_preview(source: &DecodedSource, crop: &CropSpec) -> Vec<u8> {
    render(&source.preview, crop, FilterType::Bilinear)
}

/// Renders and PNG-encodes a preview from an already-decoded source.
pub fn preview_png(source: &DecodedSource, crop: &CropSpec) -> Result<Vec<u8>, ProtocolError> {
    encode_rgb_png(render_preview(source, crop))
}

/// Renders an already-decoded RGBA buffer (such as a GIF frame) without a
/// re-encode/decode round trip through PNG.
pub fn prepare_rgba(
    width: u16,
    height: u16,
    rgba: Vec<u8>,
    crop: &CropSpec,
) -> Result<Vec<u8>, ProtocolError> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_SOURCE_PIXELS {
        return Err(too_large(u32::from(width), u32::from(height)));
    }
    let expected = pixels as usize * 4;
    if rgba.len() != expected {
        return Err(ProtocolError::ImageDecode(format!(
            "frame buffer has {} bytes, expected {expected}",
            rgba.len()
        )));
    }
    let image = image::RgbaImage::from_raw(u32::from(width), u32::from(height), rgba)
        .ok_or_else(|| ProtocolError::ImageDecode("frame buffer size mismatch".into()))?;
    Ok(render(
        &DynamicImage::ImageRgba8(image),
        crop,
        FilterType::Lanczos3,
    ))
}

/// PNG-encodes an RGB8 buffer already at display size.
pub fn encode_rgb_png(rgb: Vec<u8>) -> Result<Vec<u8>, ProtocolError> {
    let expected = (DISPLAY_WIDTH * DISPLAY_HEIGHT * 3) as usize;
    if rgb.len() != expected {
        return Err(ProtocolError::InvalidJob(format!(
            "expected {expected} RGB bytes, received {}",
            rgb.len()
        )));
    }
    let image = image::RgbImage::from_raw(DISPLAY_WIDTH, DISPLAY_HEIGHT, rgb)
        .ok_or_else(|| ProtocolError::ImageDecode("frame buffer size mismatch".into()))?;
    let mut out = std::io::Cursor::new(Vec::new());
    DynamicImage::ImageRgb8(image)
        .write_to(&mut out, image::ImageFormat::Png)
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;
    Ok(out.into_inner())
}

/// Validates that `bytes` is a decodable image within the source budget,
/// without decoding its pixels.
pub fn probe(bytes: &[u8]) -> Result<(u32, u32), ProtocolError> {
    let (w, h) = open_reader(bytes)?
        .into_dimensions()
        .map_err(|e| ProtocolError::ImageDecode(e.to_string()))?;
    if u64::from(w) * u64::from(h) > MAX_SOURCE_PIXELS {
        return Err(too_large(w, h));
    }
    Ok((w, h))
}

fn decode(bytes: &[u8]) -> Result<DynamicImage, ProtocolError> {
    // Read only the header first so oversized sources are refused before any
    // pixel buffer is allocated.
    probe(bytes)?;

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

fn render(image: &DynamicImage, crop: &CropSpec, filter: FilterType) -> Vec<u8> {
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
        Fit::Cover => resize_to(&visible, DISPLAY_WIDTH, DISPLAY_HEIGHT, filter),
        Fit::Contain => {
            let (width, height) = visible.dimensions();
            let scale = (f64::from(DISPLAY_WIDTH) / f64::from(width.max(1)))
                .min(f64::from(DISPLAY_HEIGHT) / f64::from(height.max(1)));
            let dst_w = ((f64::from(width) * scale).round() as u32).clamp(1, DISPLAY_WIDTH);
            let dst_h = ((f64::from(height) * scale).round() as u32).clamp(1, DISPLAY_HEIGHT);
            resize_to(&visible, dst_w, dst_h, filter)
        }
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
