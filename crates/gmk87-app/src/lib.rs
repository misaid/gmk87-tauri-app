//! Application orchestration for the GMK87: session ownership, jobs and presets.
//!
//! Tauri-independent so it can be tested against `MockTransport`.

pub mod error;
pub mod inspect;
pub mod job;
pub mod lighting;
pub mod manager;
pub mod presets;
pub mod slots;
pub mod snapshot;
pub mod state;
