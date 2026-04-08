use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Capture the entire screen and return metadata as JSON.
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

/// Capture a rectangular region of the screen.
#[napi]
pub fn capture_region(x: f64, y: f64, width: f64, height: f64) -> Result<serde_json::Value> {
    let frame = omnistate_screen::capture_region(x, y, width, height)
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

/// List all visible windows on screen.
/// Returns a JSON array of { id, title, owner, bounds, isOnScreen }.
#[napi]
pub fn list_windows() -> Result<serde_json::Value> {
    let windows = omnistate_screen::list_windows()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    let result: Vec<serde_json::Value> = windows
        .iter()
        .map(|w| {
            serde_json::json!({
                "id": w.id,
                "title": w.title,
                "owner": w.owner,
                "bounds": {
                    "x": w.bounds.x,
                    "y": w.bounds.y,
                    "width": w.bounds.width,
                    "height": w.bounds.height,
                },
                "isOnScreen": w.is_on_screen,
            })
        })
        .collect();

    Ok(serde_json::json!(result))
}
