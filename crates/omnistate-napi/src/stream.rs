//! Async frame streaming from Rust to Node.js via ThreadsafeFunction.
//!
//! Provides `startCaptureStream` / `stopCaptureStream` that run SCStream
//! on a dedicated std::thread and forward frames to JS without blocking
//! the Node.js event loop.

use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::sync::atomic::{AtomicBool, Ordering};

// ---------------------------------------------------------------------------
// Stream registry
// ---------------------------------------------------------------------------

type StopFlag = Arc<AtomicBool>;

fn registry() -> &'static Mutex<HashMap<String, StopFlag>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, StopFlag>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn register_stream(id: &str, flag: StopFlag) {
    let mut map = registry().lock().unwrap();
    map.insert(id.to_string(), flag);
}

fn remove_stream(id: &str) -> Option<StopFlag> {
    let mut map = registry().lock().unwrap();
    map.remove(id)
}

// ---------------------------------------------------------------------------
// Public JS types
// ---------------------------------------------------------------------------

/// A single captured frame delivered to the JS callback.
#[napi(object)]
pub struct FrameEvent {
    pub width: u32,
    pub height: u32,
    pub bytes_per_row: u32,
    pub pixel_format: String,
    /// Milliseconds since Unix epoch.
    pub timestamp_ms: f64,
    pub data: Buffer,
    pub frame_index: u32,
}

// ---------------------------------------------------------------------------
// Public NAPI functions
// ---------------------------------------------------------------------------

/// Start a continuous capture stream.
///
/// Spawns a background thread that calls SCStream and forwards frames to
/// `callback` as `FrameEvent` objects.  Returns an opaque `streamId` that
/// must be passed to `stopCaptureStream` to tear down the stream.
///
/// The callback receives `(err: Error | null, frame: FrameEvent)`.
#[napi]
pub fn start_capture_stream(
    fps: u32,
    width: u32,
    height: u32,
    show_cursor: bool,
    #[allow(unused_variables)]
    callback: ThreadsafeFunction<FrameEvent, ErrorStrategy::Fatal>,
) -> Result<String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err(Error::from_reason(
            "startCaptureStream is only supported on macOS",
        ));
    }

    #[cfg(target_os = "macos")]
    {
        let stream_id = uuid_v4();
        let stop_flag = Arc::new(AtomicBool::new(false));

        register_stream(&stream_id, Arc::clone(&stop_flag));

        let id_for_cleanup = stream_id.clone();
        std::thread::spawn(move || {
            run_capture_loop(fps, width, height, show_cursor, callback, stop_flag);
            // Remove registry entry when thread exits (covers both stop and error paths)
            remove_stream(&id_for_cleanup);
        });

        Ok(stream_id)
    }
}

/// Stop a previously started capture stream.
///
/// Sets the stop flag; the background thread will exit on its next
/// iteration and clean up the TSFN automatically.
#[napi]
pub fn stop_capture_stream(stream_id: String) -> Result<()> {
    match remove_stream(&stream_id) {
        Some(flag) => {
            flag.store(true, Ordering::Relaxed);
            Ok(())
        }
        None => Err(Error::from_reason(format!(
            "Unknown stream id: {stream_id}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// Capture loop (macOS only)
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn run_capture_loop(
    fps: u32,
    width: u32,
    height: u32,
    show_cursor: bool,
    tsfn: ThreadsafeFunction<FrameEvent, ErrorStrategy::Fatal>,
    stop_flag: Arc<AtomicBool>,
) {
    use omnistate_capture::{CaptureConfig, PixelFormat, capture_frame};
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    let config = CaptureConfig {
        fps,
        width,
        height,
        show_cursor,
        pixel_format: PixelFormat::Bgra8,
    };

    let frame_interval = if fps > 0 {
        Duration::from_micros(1_000_000 / fps.max(1) as u64)
    } else {
        Duration::from_millis(16) // ~60 fps default when fps == 0
    };

    let mut frame_index: u32 = 0;
    let mut prev_hash: u64 = 0;

    while !stop_flag.load(Ordering::Relaxed) {
        let capture_start = std::time::Instant::now();

        match capture_frame(&config) {
            Ok(frame) => {
                let hash = quick_hash(&frame.data);
                if hash != prev_hash {
                    prev_hash = hash;

                    let timestamp_ms = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs_f64()
                        * 1000.0;

                    let event = FrameEvent {
                        width: frame.width,
                        height: frame.height,
                        bytes_per_row: frame.bytes_per_row as u32,
                        pixel_format: format!("{:?}", frame.pixel_format),
                        timestamp_ms,
                        data: Buffer::from(frame.data),
                        frame_index,
                    };

                    // NonBlocking: drop the frame if the JS queue is full rather
                    // than stalling the capture thread.
                    tsfn.call(event, ThreadsafeFunctionCallMode::NonBlocking);
                    frame_index = frame_index.wrapping_add(1);
                }
            }
            Err(e) => {
                // Log to stderr; do not crash the thread on a transient failure.
                eprintln!("[omnistate-napi] capture error: {e}");
            }
        }

        // Sleep for the remainder of the frame interval.
        let elapsed = capture_start.elapsed();
        if elapsed < frame_interval {
            std::thread::sleep(frame_interval - elapsed);
        }
    }

    // Unref so Node.js can exit even if JS forgets to call stopCaptureStream.
    tsfn.abort().ok();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Cheap frame-change detector: CRC32 of first + last 1 KB.
///
/// Fast enough to run on every frame without measurable overhead.
fn quick_hash(data: &[u8]) -> u64 {
    const SAMPLE: usize = 1024;
    let mut h: u64 = 0xcbf29ce484222325; // FNV-1a offset basis

    let head = &data[..data.len().min(SAMPLE)];
    let tail = if data.len() > SAMPLE {
        &data[data.len() - SAMPLE..]
    } else {
        &[]
    };

    for &b in head.iter().chain(tail.iter()) {
        h ^= b as u64;
        h = h.wrapping_mul(0x00000100000001b3); // FNV prime
    }
    h
}

/// Generate a UUID v4-like string without pulling in the `uuid` crate.
fn uuid_v4() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Mix time + thread id for uniqueness within a process lifetime.
    let t = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tid = std::thread::current().id();
    format!("stream-{t:x}-{tid:?}")
}
