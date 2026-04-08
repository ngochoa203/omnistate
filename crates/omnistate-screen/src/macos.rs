use core_graphics::display::CGDisplay;
use core_graphics::image::CGImage;
use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{CaptureMethod, Frame};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::WindowInfo;

/// Capture the entire main display using CGDisplay.
///
/// This uses `CGDisplayCreateImage` which composites the screen — typically
/// 50-200ms. For sub-10ms capture, a future implementation will use
/// IOSurface for direct GPU framebuffer access.
pub fn capture_screen() -> OmniResult<Frame> {
    let display = CGDisplay::main();
    let cg_image = display
        .image()
        .ok_or_else(|| OmniError::CaptureError("Failed to capture main display".into()))?;

    cg_image_to_frame(cg_image, CaptureMethod::Screenshot)
}

/// Capture a specific window by its CGWindowID.
///
/// TODO: Use CGWindowListCreateImage with proper CGRect::null() when
/// core-graphics crate exposes it. For now, returns an error.
pub fn capture_window(_window_id: u32) -> OmniResult<Frame> {
    Err(OmniError::CaptureError(
        "Window capture not yet implemented — requires CGWindowListCreateImage with CGRect::null()".into(),
    ))
}

/// List all on-screen windows.
///
/// TODO: Implement using CGWindowListCopyWindowInfo + CFDictionary parsing.
pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    // Placeholder — full implementation will parse CGWindowListCopyWindowInfo
    Ok(vec![])
}

fn cg_image_to_frame(image: CGImage, method: CaptureMethod) -> OmniResult<Frame> {
    let width = image.width() as u32;
    let height = image.height() as u32;
    let bytes_per_row = image.bytes_per_row();
    let raw_data = image.data();
    let bytes: &[u8] = raw_data.bytes();

    // CGImage may have padding per row — copy only the pixel data.
    let bytes_per_pixel = 4u8; // BGRA
    let expected_row_bytes = (width as usize) * (bytes_per_pixel as usize);
    let mut data = Vec::with_capacity((width * height * bytes_per_pixel as u32) as usize);

    for row in 0..height as usize {
        let start = row * bytes_per_row;
        let end = start + expected_row_bytes;
        if end <= bytes.len() {
            data.extend_from_slice(&bytes[start..end]);
        }
    }

    let timestamp_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;

    Ok(Frame {
        width,
        height,
        bytes_per_pixel,
        data,
        timestamp_ns,
        capture_method: method,
    })
}
