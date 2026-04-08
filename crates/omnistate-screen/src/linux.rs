use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::Frame;

use crate::WindowInfo;

pub fn capture_screen() -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Linux screen capture not yet implemented — XCB + wlr-screencopy planned".into(),
    ))
}

pub fn capture_window(_window_id: u32) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Linux window capture not yet implemented".into(),
    ))
}

pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    Err(OmniError::UnsupportedPlatform(
        "Linux window listing not yet implemented".into(),
    ))
}
