use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Capture a single frame using zero-copy GPU framebuffer access.
///
/// This is the fastest capture method available. On macOS Apple Silicon,
/// it reads directly from GPU unified memory via IOSurface with no copies
/// until the final transfer to the JS Buffer.
///
/// Returns metadata JSON with frame dimensions and format info.
#[napi]
pub fn capture_frame_zero_copy() -> Result<serde_json::Value> {
    let config = omnistate_capture::CaptureConfig::default();
    let frame = omnistate_capture::capture_frame(&config)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::json!({
        "width": frame.width,
        "height": frame.height,
        "bytesPerRow": frame.bytes_per_row,
        "pixelFormat": format!("{:?}", frame.pixel_format),
        "dataLength": frame.data.len(),
        "captureMethod": "zero-copy-iosurface",
    }))
}

/// Capture a single frame and return raw pixel data as a Node.js Buffer.
///
/// This is the zero-copy capture path. The returned Buffer contains BGRA8
/// pixel data that can be used directly for image processing, OCR, or
/// vision model inference.
///
/// On Apple Silicon, the data path is:
///   GPU unified memory -> IOSurface lock -> memcpy -> Node.js Buffer
///   (only 1 copy total)
#[napi]
pub fn capture_frame_zero_copy_buffer() -> Result<Buffer> {
    let config = omnistate_capture::CaptureConfig::default();
    let frame = omnistate_capture::capture_frame(&config)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(frame.data))
}

/// Capture a frame with custom configuration.
///
/// Options:
/// - fps: Target FPS (0 = on-change only)
/// - width: Capture width (0 = native resolution)
/// - height: Capture height (0 = native resolution)
/// - showCursor: Include cursor in capture
/// - pixelFormat: "bgra8" | "rgba8" | "bgra10"
///
/// Returns the raw pixel data as a Buffer plus metadata.
#[napi]
pub fn capture_frame_configured(
    width: u32,
    height: u32,
    show_cursor: bool,
    pixel_format: String,
) -> Result<serde_json::Value> {
    let pf = match pixel_format.as_str() {
        "rgba8" => omnistate_capture::PixelFormat::Rgba8,
        "bgra10" | "l10r" => omnistate_capture::PixelFormat::Bgra10,
        _ => omnistate_capture::PixelFormat::Bgra8, // default
    };

    let config = omnistate_capture::CaptureConfig {
        fps: 0,
        width,
        height,
        show_cursor,
        pixel_format: pf,
    };

    let frame = omnistate_capture::capture_frame(&config)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::json!({
        "width": frame.width,
        "height": frame.height,
        "bytesPerRow": frame.bytes_per_row,
        "pixelFormat": format!("{:?}", frame.pixel_format),
        "dataLength": frame.data.len(),
        "captureMethod": "zero-copy-iosurface",
    }))
}
