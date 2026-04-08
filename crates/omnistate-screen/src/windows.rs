use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::Frame;

use crate::WindowInfo;

pub fn capture_screen() -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Windows screen capture not yet implemented — DXGI Desktop Duplication planned".into(),
    ))
}

pub fn capture_window(_window_id: u32) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Windows window capture not yet implemented".into(),
    ))
}

pub fn capture_region(_x: f64, _y: f64, _width: f64, _height: f64) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Windows region capture not yet implemented".into(),
    ))
}

pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    Err(OmniError::UnsupportedPlatform(
        "Windows window listing not yet implemented".into(),
    ))
}
