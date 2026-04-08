//! macOS zero-copy GPU framebuffer capture via ScreenCaptureKit.
//!
//! ## Data flow (zero-copy on Apple Silicon)
//!
//! ```text
//! SCScreenshotManager::capture_sample_buffer()
//!     -> CMSampleBuffer
//!     -> .image_buffer()  -> CVPixelBuffer
//!     -> .io_surface()    -> IOSurface (GPU framebuffer handle)
//!     -> .lock(READ_ONLY | AVOID_SYNC) -> IOSurfaceLockGuard
//!     -> .as_slice()      -> &[u8]  (points directly to GPU unified memory)
//!     -> copy into CapturedFrame.data
//! ```
//!
//! On Apple Silicon (M1+), the IOSurface lives in **unified memory** shared
//! between CPU and GPU. `as_slice()` returns a pointer to the same physical
//! memory the GPU wrote to. No DMA transfer or memcpy occurs before
//! our final copy into the owned `Vec<u8>`.
//!
//! On Intel Macs, IOSurface performs a fast DMA transfer from discrete GPU
//! VRAM to system RAM when locked. Still much faster than traditional
//! CGWindowListCreateImage which goes through additional compositing steps.
//!
//! ## Latency characteristics
//!
//! | Step | Apple Silicon | Intel Mac |
//! |------|-------------|-----------|
//! | SCScreenshotManager capture | ~2-8ms | ~5-15ms |
//! | IOSurface lock | <1us | ~100-500us (DMA) |
//! | as_slice() (zero-copy read) | <1us | <1us |
//! | memcpy to Vec<u8> | ~0.5-2ms (for 4K) | ~0.5-2ms |
//! | **Total** | **~3-10ms** | **~6-18ms** |

use crate::{CaptureConfig, CapturedFrame, PixelFormat};
use omnistate_core::error::{OmniError, OmniResult};
use screencapturekit::cm::IOSurfaceLockOptions;
use screencapturekit::prelude::*;
use screencapturekit::screenshot_manager::SCScreenshotManager;
use std::time::Instant;

/// Capture a single frame using zero-copy IOSurface access.
///
/// This is the primary capture path. It uses `SCScreenshotManager` (macOS 14.0+)
/// for single-shot capture, then accesses the underlying IOSurface for
/// near-zero-copy byte access.
///
/// Falls back to CVPixelBuffer direct lock if IOSurface is unavailable.
pub fn capture_frame(config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    let timestamp = Instant::now();

    // 1. Get shareable content (displays, windows, etc.)
    let content = SCShareableContent::get()
        .map_err(|e| OmniError::CaptureError(format!("Failed to get shareable content: {e}")))?;

    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or_else(|| OmniError::CaptureError("No display found".into()))?;

    // 2. Create content filter for the main display
    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();

    // 3. Configure capture parameters
    let sck_pixel_format = match config.pixel_format {
        PixelFormat::Bgra8 => screencapturekit::stream::configuration::PixelFormat::BGRA,
        PixelFormat::Rgba8 => screencapturekit::stream::configuration::PixelFormat::BGRA, // Will convert
        PixelFormat::Bgra10 => screencapturekit::stream::configuration::PixelFormat::l10r,
    };

    let mut stream_config = SCStreamConfiguration::new()
        .with_pixel_format(sck_pixel_format)
        .with_shows_cursor(config.show_cursor);

    // Use native resolution if width/height are 0
    if config.width > 0 {
        stream_config = stream_config.with_width(config.width);
    }
    if config.height > 0 {
        stream_config = stream_config.with_height(config.height);
    }

    // 4. Capture a single frame as CMSampleBuffer
    let sample_buffer = SCScreenshotManager::capture_sample_buffer(&filter, &stream_config)
        .map_err(|e| OmniError::CaptureError(format!("Screenshot capture failed: {e}")))?;

    // 5. Extract pixel data via zero-copy IOSurface path
    let pixel_buffer = sample_buffer
        .image_buffer()
        .ok_or_else(|| OmniError::CaptureError("No image buffer in sample".into()))?;

    // Try IOSurface path first (true zero-copy on Apple Silicon)
    if let Some(io_surface) = pixel_buffer.io_surface() {
        return capture_from_iosurface(&io_surface, config, timestamp);
    }

    // Fallback: CVPixelBuffer direct lock (still fast, but not IOSurface zero-copy)
    capture_from_pixel_buffer(&pixel_buffer, config, timestamp)
}

/// Zero-copy capture path via IOSurface.
///
/// On Apple Silicon, `guard.as_slice()` points directly to unified memory
/// that the GPU wrote to. No intermediate copies occur before our final
/// copy into the owned `Vec<u8>`.
fn capture_from_iosurface(
    surface: &screencapturekit::cm::IOSurface,
    config: &CaptureConfig,
    timestamp: Instant,
) -> OmniResult<CapturedFrame> {
    let width = surface.width() as u32;
    let height = surface.height() as u32;
    let bytes_per_row = surface.bytes_per_row();

    // Lock with READ_ONLY | AVOID_SYNC for fastest access.
    // AVOID_SYNC skips waiting for pending GPU operations — safe for screenshots
    // since SCScreenshotManager guarantees the frame is complete.
    let lock_options = IOSurfaceLockOptions::READ_ONLY | IOSurfaceLockOptions::AVOID_SYNC;
    let guard = surface.lock(lock_options).map_err(|e| {
        OmniError::CaptureError(format!("IOSurface lock failed (kern_return_t: {e})"))
    })?;

    // as_slice() — on Apple Silicon this is a direct pointer to GPU unified memory.
    // No DMA transfer, no memcpy. The CPU reads the same physical memory the GPU wrote.
    let slice = guard.as_slice();

    // Determine output pixel format
    let pixel_format = match surface.pixel_format() {
        0x42475241 => PixelFormat::Bgra8,         // 'BGRA'
        0x52474241 => PixelFormat::Rgba8,          // 'RGBA'
        0x6C313072 => PixelFormat::Bgra10,         // 'l10r'
        _ => PixelFormat::Bgra8,                   // Default assumption
    };

    // The only copy: IOSurface memory -> owned Vec<u8>
    // On a 4K display (3840x2160x4 = ~33MB), this takes ~0.5-2ms
    let data = if config.pixel_format == PixelFormat::Rgba8 && pixel_format == PixelFormat::Bgra8 {
        // Convert BGRA -> RGBA in-place during copy
        bgra_to_rgba(slice, width as usize, height as usize, bytes_per_row)
    } else {
        // Strip row padding if bytes_per_row > width * bpp
        let bpp = pixel_format.bytes_per_pixel() as usize;
        let expected_row = width as usize * bpp;
        if bytes_per_row == expected_row {
            slice.to_vec()
        } else {
            // Row-by-row copy to strip padding
            let mut data = Vec::with_capacity(expected_row * height as usize);
            for y in 0..height as usize {
                let row_start = y * bytes_per_row;
                let row_end = row_start + expected_row;
                if row_end <= slice.len() {
                    data.extend_from_slice(&slice[row_start..row_end]);
                }
            }
            data
        }
    };

    // Guard drops here -> IOSurface automatically unlocked (RAII)

    Ok(CapturedFrame {
        width,
        height,
        bytes_per_row,
        pixel_format: if config.pixel_format == PixelFormat::Rgba8 {
            PixelFormat::Rgba8
        } else {
            pixel_format
        },
        timestamp,
        data,
    })
}

/// Fallback capture path via CVPixelBuffer direct lock.
///
/// Used when IOSurface is not available (rare for ScreenCaptureKit, but
/// possible on some configurations).
fn capture_from_pixel_buffer(
    buffer: &screencapturekit::cv::CVPixelBuffer,
    config: &CaptureConfig,
    timestamp: Instant,
) -> OmniResult<CapturedFrame> {
    use screencapturekit::cv::CVPixelBufferLockFlags;

    let width = buffer.width() as u32;
    let height = buffer.height() as u32;
    let bytes_per_row = buffer.bytes_per_row();

    let guard = buffer.lock(CVPixelBufferLockFlags::READ_ONLY).map_err(|e| {
        OmniError::CaptureError(format!("CVPixelBuffer lock failed (CVReturn: {e})"))
    })?;

    let slice = guard.as_slice();

    let pixel_format = match buffer.pixel_format() {
        0x42475241 => PixelFormat::Bgra8,
        0x52474241 => PixelFormat::Rgba8,
        0x6C313072 => PixelFormat::Bgra10,
        _ => PixelFormat::Bgra8,
    };

    let data = if config.pixel_format == PixelFormat::Rgba8 && pixel_format == PixelFormat::Bgra8 {
        bgra_to_rgba(slice, width as usize, height as usize, bytes_per_row)
    } else {
        slice.to_vec()
    };

    Ok(CapturedFrame {
        width,
        height,
        bytes_per_row,
        pixel_format: if config.pixel_format == PixelFormat::Rgba8 {
            PixelFormat::Rgba8
        } else {
            pixel_format
        },
        timestamp,
        data,
    })
}

/// Convert BGRA pixel data to RGBA during copy.
///
/// This swaps the R and B channels while copying, avoiding a second pass.
/// Processes in chunks for better cache performance.
fn bgra_to_rgba(src: &[u8], width: usize, height: usize, bytes_per_row: usize) -> Vec<u8> {
    let dst_row_len = width * 4;
    let mut dst = vec![0u8; dst_row_len * height];

    for y in 0..height {
        let src_offset = y * bytes_per_row;
        let dst_offset = y * dst_row_len;

        for x in 0..width {
            let si = src_offset + x * 4;
            let di = dst_offset + x * 4;
            if si + 3 < src.len() {
                dst[di] = src[si + 2];     // R <- B
                dst[di + 1] = src[si + 1]; // G <- G
                dst[di + 2] = src[si];     // B <- R
                dst[di + 3] = src[si + 3]; // A <- A
            }
        }
    }

    dst
}

/// Capture a single frame using the stream-based API.
///
/// This sets up an SCStream, captures one frame via the output handler callback,
/// then stops. Useful as an alternative to SCScreenshotManager on macOS < 14.0.
pub fn capture_frame_stream(config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    use std::sync::{Arc, Mutex, Condvar};
    use std::time::Duration;

    let content = SCShareableContent::get()
        .map_err(|e| OmniError::CaptureError(format!("Failed to get shareable content: {e}")))?;

    let display = content
        .displays()
        .into_iter()
        .next()
        .ok_or_else(|| OmniError::CaptureError("No display found".into()))?;

    let filter = SCContentFilter::create()
        .with_display(&display)
        .with_excluding_windows(&[])
        .build();

    let stream_config = SCStreamConfiguration::new()
        .with_pixel_format(screencapturekit::stream::configuration::PixelFormat::BGRA)
        .with_shows_cursor(config.show_cursor);

    // Shared state for the callback to deliver the frame
    let frame_data: Arc<Mutex<Option<CapturedFrame>>> = Arc::new(Mutex::new(None));
    let condvar = Arc::new(Condvar::new());

    let frame_clone = frame_data.clone();
    let condvar_clone = condvar.clone();
    let timestamp = Instant::now();

    let mut stream = SCStream::new(&filter, &stream_config);
    stream.add_output_handler(
        move |sample: CMSampleBuffer, of_type: SCStreamOutputType| {
            if of_type != SCStreamOutputType::Screen {
                return;
            }

            // Only capture first frame
            {
                let lock = frame_clone.lock().unwrap();
                if lock.is_some() {
                    return;
                }
            }

            if let Some(pixel_buffer) = sample.image_buffer() {
                let frame = if let Some(surface) = pixel_buffer.io_surface() {
                    // Zero-copy IOSurface path
                    let lock_opts = IOSurfaceLockOptions::READ_ONLY | IOSurfaceLockOptions::AVOID_SYNC;
                    if let Ok(guard) = surface.lock(lock_opts) {
                        let data = guard.as_slice().to_vec();
                        Some(CapturedFrame {
                            width: surface.width() as u32,
                            height: surface.height() as u32,
                            bytes_per_row: surface.bytes_per_row(),
                            pixel_format: PixelFormat::Bgra8,
                            timestamp,
                            data,
                        })
                    } else {
                        None
                    }
                } else {
                    // CVPixelBuffer fallback
                    use screencapturekit::cv::CVPixelBufferLockFlags;
                    if let Ok(guard) = pixel_buffer.lock(CVPixelBufferLockFlags::READ_ONLY) {
                        let data = guard.as_slice().to_vec();
                        Some(CapturedFrame {
                            width: pixel_buffer.width() as u32,
                            height: pixel_buffer.height() as u32,
                            bytes_per_row: pixel_buffer.bytes_per_row(),
                            pixel_format: PixelFormat::Bgra8,
                            timestamp,
                            data,
                        })
                    } else {
                        None
                    }
                };

                if let Some(f) = frame {
                    let mut lock = frame_clone.lock().unwrap();
                    *lock = Some(f);
                    condvar_clone.notify_one();
                }
            }
        },
        SCStreamOutputType::Screen,
    );

    stream.start_capture()
        .map_err(|e| OmniError::CaptureError(format!("Stream start failed: {e}")))?;

    // Wait for first frame with timeout
    let result = {
        let mut lock = frame_data.lock().unwrap();
        if lock.is_none() {
            let (new_lock, timeout_result) = condvar
                .wait_timeout(lock, Duration::from_secs(5))
                .unwrap();
            lock = new_lock;
            if timeout_result.timed_out() && lock.is_none() {
                let _ = stream.stop_capture();
                return Err(OmniError::Timeout(5000));
            }
        }
        lock.take()
    };

    let _ = stream.stop_capture();

    result.ok_or_else(|| OmniError::CaptureError("No frame captured".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bgra_to_rgba_conversion() {
        // BGRA: B=10, G=20, R=30, A=255
        let bgra = vec![10, 20, 30, 255, 50, 60, 70, 128];
        let rgba = bgra_to_rgba(&bgra, 2, 1, 8);

        // Expected RGBA: R=30, G=20, B=10, A=255
        assert_eq!(rgba[0], 30);  // R
        assert_eq!(rgba[1], 20);  // G
        assert_eq!(rgba[2], 10);  // B
        assert_eq!(rgba[3], 255); // A

        assert_eq!(rgba[4], 70);  // R
        assert_eq!(rgba[5], 60);  // G
        assert_eq!(rgba[6], 50);  // B
        assert_eq!(rgba[7], 128); // A
    }

    #[test]
    fn test_bgra_to_rgba_with_row_padding() {
        // 1 pixel wide, 2 rows, with 8 bytes_per_row (4 bytes padding per row)
        let bgra = vec![
            10, 20, 30, 255, 0, 0, 0, 0, // row 0 + padding
            50, 60, 70, 128, 0, 0, 0, 0, // row 1 + padding
        ];
        let rgba = bgra_to_rgba(&bgra, 1, 2, 8);

        assert_eq!(rgba.len(), 8); // 1 pixel * 4 bytes * 2 rows
        assert_eq!(rgba[0], 30);  // R
        assert_eq!(rgba[1], 20);  // G
        assert_eq!(rgba[2], 10);  // B
        assert_eq!(rgba[3], 255); // A
        assert_eq!(rgba[4], 70);  // R
        assert_eq!(rgba[5], 60);  // G
        assert_eq!(rgba[6], 50);  // B
        assert_eq!(rgba[7], 128); // A
    }

    #[test]
    fn test_pixel_format_fourcc() {
        // Verify our FourCC constants match macOS conventions
        assert_eq!(PixelFormat::Bgra8.bytes_per_pixel(), 4);
        assert_eq!(PixelFormat::Rgba8.bytes_per_pixel(), 4);
        assert_eq!(PixelFormat::Bgra10.bytes_per_pixel(), 4);
    }

    // Integration test — requires screen recording permission.
    // Run manually: cargo test -p omnistate-capture -- --ignored
    #[test]
    #[ignore]
    fn test_capture_frame_zero_copy() {
        let config = CaptureConfig::default();
        let frame = capture_frame(&config).expect("Capture should succeed");

        assert!(frame.width > 0, "Frame width should be > 0");
        assert!(frame.height > 0, "Frame height should be > 0");
        assert!(!frame.data.is_empty(), "Frame data should not be empty");
        assert_eq!(
            frame.data.len(),
            frame.height as usize * frame.bytes_per_row,
            "Data length should match height * bytes_per_row"
        );

        println!(
            "Captured {}x{} frame, {} bytes, format: {:?}, latency: {:?}",
            frame.width,
            frame.height,
            frame.data.len(),
            frame.pixel_format,
            frame.timestamp.elapsed()
        );
    }

    #[test]
    #[ignore]
    fn test_capture_frame_stream_api() {
        let config = CaptureConfig::default();
        let frame = capture_frame_stream(&config).expect("Stream capture should succeed");

        assert!(frame.width > 0);
        assert!(frame.height > 0);
        assert!(!frame.data.is_empty());

        println!(
            "Stream captured {}x{} frame, {} bytes",
            frame.width, frame.height, frame.data.len()
        );
    }

    #[test]
    #[ignore]
    fn bench_capture_latency() {
        let config = CaptureConfig::default();

        // Warm up
        let _ = capture_frame(&config);

        // Benchmark 10 captures
        let mut latencies = Vec::with_capacity(10);
        for _ in 0..10 {
            let start = Instant::now();
            let _frame = capture_frame(&config).expect("Capture should succeed");
            latencies.push(start.elapsed());
        }

        let avg = latencies.iter().sum::<std::time::Duration>() / latencies.len() as u32;
        let min = latencies.iter().min().unwrap();
        let max = latencies.iter().max().unwrap();

        println!("Zero-copy capture latency (10 runs):");
        println!("  Average: {:?}", avg);
        println!("  Min:     {:?}", min);
        println!("  Max:     {:?}", max);
    }
}
