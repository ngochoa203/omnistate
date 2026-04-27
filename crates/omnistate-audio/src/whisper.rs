//! Whisper STT engine using whisper.cpp via whisper-rs.

use omnistate_core::error::{OmniError, OmniResult};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Configuration for the Whisper engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhisperConfig {
    /// Path to the .bin model file (e.g., ggml-small.bin)
    pub model_path: String,
    /// Language code (e.g., "vi", "en", "auto")
    pub language: String,
    /// Number of threads for CPU inference
    pub n_threads: i32,
    /// Whether to use GPU acceleration (Metal on macOS)
    pub use_gpu: bool,
}

impl Default for WhisperConfig {
    fn default() -> Self {
        Self {
            model_path: default_model_path(),
            language: "auto".to_string(),
            n_threads: 4,
            use_gpu: cfg!(target_os = "macos"),
        }
    }
}

/// Result of a transcription.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionResult {
    pub text: String,
    pub language: String,
    pub duration_ms: u64,
    pub segments: Vec<TranscriptionSegment>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

/// Whisper STT engine — wraps whisper.cpp context.
/// Thread-safe via Mutex (whisper.cpp context is not Send).
pub struct WhisperEngine {
    ctx: Mutex<Option<whisper_rs::WhisperContext>>,
    config: WhisperConfig,
}

// whisper_rs::WhisperContext is !Send, but we protect it with Mutex
// and only access from one thread at a time.
unsafe impl Send for WhisperEngine {}
unsafe impl Sync for WhisperEngine {}

impl WhisperEngine {
    /// Create a new engine. Does NOT load the model yet — call `load()` first.
    pub fn new(config: WhisperConfig) -> Self {
        Self {
            ctx: Mutex::new(None),
            config,
        }
    }

    /// Load the whisper model from disk. This is slow (~1-3s) and should be
    /// done once at startup.
    pub fn load(&self) -> OmniResult<()> {
        let params = whisper_rs::WhisperContextParameters::default();

        let ctx = whisper_rs::WhisperContext::new_with_params(
            &self.config.model_path,
            params,
        )
        .map_err(|e| OmniError::AudioError(format!("Failed to load whisper model: {e}")))?;

        let mut guard = self
            .ctx
            .lock()
            .map_err(|e| OmniError::AudioError(format!("Lock poisoned: {e}")))?;
        *guard = Some(ctx);
        Ok(())
    }

    /// Check if the model is loaded and ready.
    pub fn is_ready(&self) -> bool {
        self.ctx.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// Transcribe PCM16 audio data (16kHz mono).
    /// Input: raw PCM16 bytes (i16 samples, little-endian)
    pub fn transcribe_pcm16(&self, pcm16_data: &[u8]) -> OmniResult<TranscriptionResult> {
        let start = std::time::Instant::now();

        // Convert PCM16 bytes to f32 samples (whisper.cpp expects f32)
        let samples: Vec<f32> = pcm16_data
            .chunks_exact(2)
            .map(|chunk| {
                let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
                sample as f32 / 32768.0
            })
            .collect();

        let guard = self
            .ctx
            .lock()
            .map_err(|e| OmniError::AudioError(format!("Lock poisoned: {e}")))?;
        let ctx = guard
            .as_ref()
            .ok_or_else(|| OmniError::AudioError("Model not loaded. Call load() first.".into()))?;

        // Create inference state
        let mut state = ctx
            .create_state()
            .map_err(|e| OmniError::AudioError(format!("Failed to create state: {e}")))?;

        // Configure parameters
        let mut params =
            whisper_rs::FullParams::new(whisper_rs::SamplingStrategy::Greedy { best_of: 1 });
        params.set_n_threads(self.config.n_threads);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        params.set_suppress_blank(true);
        params.set_suppress_non_speech_tokens(true);

        if self.config.language != "auto" {
            params.set_language(Some(&self.config.language));
        }

        // Run inference
        state
            .full(params, &samples)
            .map_err(|e| OmniError::AudioError(format!("Transcription failed: {e}")))?;

        // Collect results
        let n_segments = state
            .full_n_segments()
            .map_err(|e| OmniError::AudioError(format!("Failed to get segments: {e}")))?;

        let mut full_text = String::new();
        let mut segments = Vec::new();

        for i in 0..n_segments {
            let text = state
                .full_get_segment_text(i)
                .map_err(|e| OmniError::AudioError(format!("Failed to get segment text: {e}")))?;
            let start_ts = state
                .full_get_segment_t0(i)
                .map_err(|e| OmniError::AudioError(format!("Failed to get segment t0: {e}")))?;
            let end_ts = state
                .full_get_segment_t1(i)
                .map_err(|e| OmniError::AudioError(format!("Failed to get segment t1: {e}")))?;

            full_text.push_str(&text);
            segments.push(TranscriptionSegment {
                start_ms: start_ts as i64 * 10, // whisper timestamps are in centiseconds
                end_ms: end_ts as i64 * 10,
                text,
            });
        }

        let detected_lang = self.config.language.clone();

        Ok(TranscriptionResult {
            text: full_text.trim().to_string(),
            language: detected_lang,
            duration_ms: start.elapsed().as_millis() as u64,
            segments,
        })
    }

    /// Transcribe from a WAV file path.
    pub fn transcribe_file(&self, path: &str) -> OmniResult<TranscriptionResult> {
        let data = std::fs::read(path)
            .map_err(|e| OmniError::AudioError(format!("Failed to read file: {e}")))?;

        // Skip WAV header (44 bytes) if present
        let pcm_data = if data.len() > 44 && &data[0..4] == b"RIFF" {
            &data[44..]
        } else {
            &data
        };

        self.transcribe_pcm16(pcm_data)
    }
}

/// Default model path: ~/.omnistate/models/ggml-small.bin
fn default_model_path() -> String {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    format!("{home}/.omnistate/models/ggml-small.bin")
}
