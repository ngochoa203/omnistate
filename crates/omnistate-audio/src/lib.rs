//! Native audio processing using whisper.cpp via whisper-rs.
//!
//! Provides fast, GPU-accelerated speech-to-text on Apple Silicon
//! via Metal, replacing the Python faster-whisper subprocess.

pub mod whisper;

pub use whisper::{WhisperConfig, WhisperEngine, TranscriptionResult};
