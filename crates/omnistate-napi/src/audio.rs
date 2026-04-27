use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::OnceLock;

static ENGINE: OnceLock<omnistate_audio::WhisperEngine> = OnceLock::new();

/// Initialize the native Whisper STT engine.
/// Must be called once before transcribe_native.
/// model_path: path to ggml .bin model file
/// language: "auto", "en", "vi", etc.
#[napi]
pub fn whisper_init(model_path: String, language: String) -> Result<()> {
    let config = omnistate_audio::WhisperConfig {
        model_path,
        language,
        n_threads: num_cpus(),
        use_gpu: cfg!(target_os = "macos"),
    };

    let engine = omnistate_audio::WhisperEngine::new(config);
    engine
        .load()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    ENGINE
        .set(engine)
        .map_err(|_| Error::from_reason("Engine already initialized"))?;
    Ok(())
}

/// Check if the native Whisper engine is loaded and ready.
#[napi]
pub fn whisper_is_ready() -> bool {
    ENGINE.get().map(|e| e.is_ready()).unwrap_or(false)
}

/// Transcribe PCM16 audio data (16kHz mono) using the native Whisper engine.
/// Returns JSON with { text, language, durationMs, segments }.
#[napi]
pub fn whisper_transcribe(pcm16_data: Buffer) -> Result<serde_json::Value> {
    let engine = ENGINE.get().ok_or_else(|| {
        Error::from_reason("Whisper engine not initialized. Call whisperInit first.")
    })?;

    let result = engine
        .transcribe_pcm16(&pcm16_data)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    serde_json::to_value(&result).map_err(|e| Error::from_reason(e.to_string()))
}

/// Transcribe a WAV file using the native Whisper engine.
#[napi]
pub fn whisper_transcribe_file(path: String) -> Result<serde_json::Value> {
    let engine = ENGINE.get().ok_or_else(|| {
        Error::from_reason("Whisper engine not initialized. Call whisperInit first.")
    })?;

    let result = engine
        .transcribe_file(&path)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    serde_json::to_value(&result).map_err(|e| Error::from_reason(e.to_string()))
}

fn num_cpus() -> i32 {
    std::thread::available_parallelism()
        .map(|n| n.get() as i32)
        .unwrap_or(4)
        .min(8) // Cap at 8 threads for whisper
}
