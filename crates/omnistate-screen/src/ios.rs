//! iOS screen capture via remote agent (libimobiledevice / xcrun).
//!
//! OmniState controls iOS devices **remotely from a desktop host**.
//! iOS sandboxing prevents on-device screen capture from regular apps.
//!
//! ## Primary API: libimobiledevice (USB)
//!
//! ```text
//! idevicescreenshot → PNG data over USB
//!   → decode PNG → Frame
//! Latency: ~100-300ms (USB transfer + PNG decode)
//! ```
//!
//! ## Alternative: Xcode xcrun (requires Xcode)
//!
//! ```text
//! xcrun simctl io booted screenshot /tmp/shot.png  (simulator)
//! xcrun devicectl device capture screenshot --device <udid>  (physical)
//! ```
//!
//! ## Wi-Fi Alternative: WebDriverAgent + MJPEG stream
//!
//! ```text
//! WebDriverAgent (WDA) runs on device via XCTest
//!   → /screenshot endpoint → TIFF/PNG data
//!   → /mjpeg endpoint → continuous MJPEG stream (~15-30fps)
//! ```
//!
//! ## Dependencies (when implemented)
//!
//! Uses `std::process::Command` to shell out to `idevicescreenshot` or `xcrun`.
//! No native Rust deps needed — purely remote.

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::Frame;

use crate::WindowInfo;

pub fn capture_screen() -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "iOS remote screen capture not yet implemented. \
         Requires libimobiledevice or Xcode xcrun on host."
            .into(),
    ))
}

pub fn capture_window(_window_id: u32) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "iOS does not support individual window capture".into(),
    ))
}

pub fn capture_region(_x: f64, _y: f64, _w: f64, _h: f64) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "iOS remote region capture not yet implemented".into(),
    ))
}

pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    Err(OmniError::UnsupportedPlatform(
        "iOS does not expose a window list to external agents".into(),
    ))
}
