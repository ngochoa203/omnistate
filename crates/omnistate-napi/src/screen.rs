use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Capture the entire screen and return raw frame data as a Buffer.
///
/// Returns a JSON object with { width, height, bytesPerPixel, timestampNs, captureMethod }
/// plus the raw pixel data as a separate Buffer.
#[napi]
pub fn capture_screen() -> Result<serde_json::Value> {
    let frame = omnistate_screen::capture_screen()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::json!({
        "width": frame.width,
        "height": frame.height,
        "bytesPerPixel": frame.bytes_per_pixel,
        "timestampNs": frame.timestamp_ns.to_string(),
        "captureMethod": frame.capture_method,
        "dataLength": frame.data.len(),
    }))
}

/// Capture a specific window by its platform window ID.
#[napi]
pub fn capture_window(window_id: u32) -> Result<serde_json::Value> {
    let frame = omnistate_screen::capture_window(window_id)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::json!({
        "width": frame.width,
        "height": frame.height,
        "bytesPerPixel": frame.bytes_per_pixel,
        "timestampNs": frame.timestamp_ns.to_string(),
        "captureMethod": frame.capture_method,
        "dataLength": frame.data.len(),
    }))
}

/// Capture screen and return the raw pixel data as a Buffer.
#[napi]
pub fn capture_screen_buffer() -> Result<Buffer> {
    let frame = omnistate_screen::capture_screen()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(Buffer::from(frame.data))
}
