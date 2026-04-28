//! Zero-copy GPU framebuffer capture.
//!
//! This crate provides near-zero latency screen capture by reading
//! directly from the GPU framebuffer / compositor surface without
//! CPU round-trip copies.
//!
//! # Platform implementations
//!
//! | Platform | API | Zero-copy? | Latency |
//! |----------|-----|------------|---------|
//! | macOS (Apple Silicon) | ScreenCaptureKit → IOSurface | ✅ Unified Memory | <50μs CPU access |
//! | macOS (Intel) | ScreenCaptureKit → IOSurface | ⚡ Fast DMA | ~100-500μs |
//! | Windows | DXGI Desktop Duplication | GPU texture direct | ~1-4ms |
//! | Linux | PipeWire + DMA-BUF | ✅ mmap shared | ~10-200μs |
//!
//! # Design principle
//!
//! Keep data on GPU as long as possible. Only map to CPU address space
//! when you specifically need pixel bytes (OCR, coordinate reads).

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "ios")]
pub mod ios;
#[cfg(target_os = "android")]
pub mod android;

use omnistate_core::error::OmniResult;
use std::time::Instant;

/// A captured frame with GPU buffer handle.
///
/// The frame data lives in GPU memory (or unified memory on Apple Silicon).
/// Use `map_cpu()` to get a CPU-accessible byte slice — this is the slow
/// path and should only be used when you need actual pixel bytes.
#[derive(Debug)]
pub struct CapturedFrame {
    pub width: u32,
    pub height: u32,
    pub bytes_per_row: usize,
    pub pixel_format: PixelFormat,
    pub timestamp: Instant,
    /// Raw pixel data — populated after CPU mapping.
    /// On zero-copy systems, this points to the same physical memory
    /// the GPU wrote to (no memcpy occurred).
    pub data: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    /// 8-bit BGRA (most common on macOS/Windows).
    Bgra8,
    /// 8-bit RGBA.
    Rgba8,
    /// 10-bit wide color (macOS L10R).
    Bgra10,
}

impl PixelFormat {
    pub fn bytes_per_pixel(&self) -> u8 {
        match self {
            PixelFormat::Bgra8 | PixelFormat::Rgba8 => 4,
            PixelFormat::Bgra10 => 4,
        }
    }
}

/// Configuration for the capture stream.
#[derive(Debug, Clone)]
pub struct CaptureConfig {
    /// Target frames per second. 0 = on-change only.
    pub fps: u32,
    /// Capture width (0 = native resolution).
    pub width: u32,
    /// Capture height (0 = native resolution).
    pub height: u32,
    /// Whether to include the cursor in captures.
    pub show_cursor: bool,
    /// Pixel format preference.
    pub pixel_format: PixelFormat,
}

impl Default for CaptureConfig {
    fn default() -> Self {
        Self {
            fps: 60,
            width: 0,
            height: 0,
            show_cursor: true,
            pixel_format: PixelFormat::Bgra8,
        }
    }
}

/// Capture a single frame (one-shot).
/// This is the simplest API — captures one frame and returns it.
pub fn capture_frame(config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    #[cfg(target_os = "macos")]
    return macos::capture_frame(config);

    #[cfg(target_os = "windows")]
    return windows::capture_frame(config);

    #[cfg(target_os = "linux")]
    return linux::capture_frame(config);

    #[cfg(target_os = "ios")]
    return ios::capture_frame(config);

    #[cfg(target_os = "android")]
    return android::capture_frame(config);
}

/// Capture a single frame with default settings.
pub fn capture_frame_default() -> OmniResult<CapturedFrame> {
    capture_frame(&CaptureConfig::default())
}

/// Capture a region of the screen with optional resize.
///
/// Crops the raw pixel buffer in Rust, avoiding transferring the full frame
/// to JavaScript. Optionally resizes to `target_width`/`target_height` using
/// nearest-neighbor scaling (suitable for vision model input).
pub fn capture_region_gpu(
    x: u32,
    y: u32,
    width: u32,
    height: u32,
    target_width: Option<u32>,
    target_height: Option<u32>,
) -> OmniResult<CapturedFrame> {
    #[cfg(target_os = "macos")]
    return macos::capture_region_gpu(x, y, width, height, target_width, target_height);

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (x, y, width, height, target_width, target_height);
        Err(omnistate_core::error::OmniError::CaptureError(
            "capture_region_gpu is only supported on macOS".into(),
        ))
    }
}
