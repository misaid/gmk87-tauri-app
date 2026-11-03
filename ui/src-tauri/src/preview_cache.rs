//! A small cache for the Display screen's live preview.
//!
//! The crop editor re-renders on every pan/zoom tick and every slot switch.
//! Decoding the source is by far the most expensive step, so it happens once and
//! the [`DecodedSource`] is kept; a rendered 240×135 PNG is also kept so
//! returning to a crop (or switching back to a slot) is a lookup, not a resize.
//!
//! The cache is bounded: a handful of decoded sources and a few dozen rendered
//! crops, evicted least-recently-used first.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Arc, Mutex};

use gmk87_protocol::error::ProtocolError;
use gmk87_protocol::image::{preview_png, CropSpec, DecodedSource, Fit};

/// Decoded sources to keep: the two slots plus recent replacements.
const MAX_DECODED: usize = 6;
/// Rendered previews to keep: far more than two slots, so a crop the user
/// returns to is still a hit.
const MAX_RENDERED: usize = 32;

/// Identity of a rendered preview: the source, and the exact crop bits.
type RenderKey = (u64, u32, u32, u32, u8);

pub struct PreviewCache {
    decoded: Mutex<Lru<u64, Arc<DecodedSource>>>,
    rendered: Mutex<Lru<RenderKey, Arc<Vec<u8>>>>,
}

impl Default for PreviewCache {
    fn default() -> Self {
        Self::new()
    }
}

impl PreviewCache {
    pub fn new() -> Self {
        Self {
            decoded: Mutex::new(Lru::new(MAX_DECODED)),
            rendered: Mutex::new(Lru::new(MAX_RENDERED)),
        }
    }

    /// A cheap content key: CRC32 plus the length.
    fn source_key(bytes: &[u8]) -> u64 {
        (u64::from(crc32fast::hash(bytes)) << 32) | (bytes.len() as u64)
    }

    fn render_key(source: u64, crop: &CropSpec) -> RenderKey {
        (
            source,
            crop.offset_x.to_bits(),
            crop.offset_y.to_bits(),
            crop.zoom.to_bits(),
            match crop.fit {
                Fit::Cover => 0,
                Fit::Contain => 1,
            },
        )
    }

    /// Decodes `bytes` once and keeps the result.
    ///
    /// A CRC32 collision would reuse the wrong image, so the key is only trusted
    /// within one app run and the cache is small; the cost of a collision is a
    /// wrong preview until the source changes.
    pub fn decoded(&self, key: u64, bytes: &[u8]) -> Result<Arc<DecodedSource>, ProtocolError> {
        if let Some(source) = self.decoded.lock().expect("preview cache").get(&key) {
            return Ok(source);
        }
        let source = Arc::new(gmk87_protocol::image::decode_source(bytes)?);
        self.decoded
            .lock()
            .expect("preview cache")
            .insert(key, source.clone());
        Ok(source)
    }

    /// Renders (or returns) the preview PNG for `bytes` at `crop`.
    pub fn preview(&self, bytes: &[u8], crop: &CropSpec) -> Result<Arc<Vec<u8>>, ProtocolError> {
        let source_key = Self::source_key(bytes);
        let render_key = Self::render_key(source_key, crop);
        if let Some(png) = self
            .rendered
            .lock()
            .expect("preview cache")
            .get(&render_key)
        {
            return Ok(png);
        }
        let source = self.decoded(source_key, bytes)?;
        let png = Arc::new(preview_png(&source, crop)?);
        self.rendered
            .lock()
            .expect("preview cache")
            .insert(render_key, png.clone());
        Ok(png)
    }
}

/// A minimal least-recently-used map: enough for a handful of preview entries.
struct Lru<K, V> {
    map: HashMap<K, V>,
    order: Vec<K>,
    max: usize,
}

impl<K: Copy + Eq + Hash, V> Lru<K, V> {
    fn new(max: usize) -> Self {
        Self {
            map: HashMap::new(),
            order: Vec::new(),
            max,
        }
    }

    fn get(&mut self, key: &K) -> Option<V>
    where
        V: Clone,
    {
        if let Some(position) = self.order.iter().position(|entry| entry == key) {
            let key = self.order.remove(position);
            self.order.push(key);
            self.map.get(&key).cloned()
        } else {
            None
        }
    }

    fn insert(&mut self, key: K, value: V) {
        if let Some(position) = self.order.iter().position(|entry| *entry == key) {
            self.order.remove(position);
        } else if self.order.len() >= self.max {
            let oldest = self.order.remove(0);
            self.map.remove(&oldest);
        }
        self.order.push(key);
        self.map.insert(key, value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(width: u32, height: u32, tint: u8) -> Vec<u8> {
        let image = image::RgbImage::from_fn(width, height, |x, y| {
            image::Rgb([(x % 256) as u8, (y % 256) as u8, tint])
        });
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(image)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    #[test]
    fn caches_a_decoded_source_across_crops() {
        let cache = PreviewCache::new();
        let bytes = png(500, 400, 0);
        let key = PreviewCache::source_key(&bytes);

        let first = cache.decoded(key, &bytes).unwrap();
        let second = cache.decoded(key, &bytes).unwrap();
        assert!(Arc::ptr_eq(&first, &second), "the decode is reused");
    }

    #[test]
    fn caches_a_rendered_preview_per_crop() {
        let cache = PreviewCache::new();
        let bytes = png(500, 400, 0);
        let crop = CropSpec::default();

        let first = cache.preview(&bytes, &crop).unwrap();
        let second = cache.preview(&bytes, &crop).unwrap();
        assert!(Arc::ptr_eq(&first, &second), "the render is reused");

        let moved = CropSpec {
            offset_x: 0.5,
            ..CropSpec::default()
        };
        let third = cache.preview(&bytes, &moved).unwrap();
        assert!(!Arc::ptr_eq(&first, &third), "a new crop re-renders");
    }

    #[test]
    fn evicts_the_oldest_decoded_sources() {
        let cache = PreviewCache::new();
        for value in 0..(MAX_DECODED as u8 + 2) {
            let bytes = png(8, 8, value);
            let key = PreviewCache::source_key(&bytes);
            cache.decoded(key, &bytes).unwrap();
        }
        let decoded = cache.decoded.lock().unwrap();
        assert!(decoded.map.len() <= MAX_DECODED, "cache stays bounded");
    }
}
