//! Android screen capture via remote agent (ADB).
//!
//! OmniState controls Android devices **remotely from a desktop host**
//! using ADB (Android Debug Bridge) over USB or Wi-Fi.
//!
//! ## Primary API: ADB screencap
//!
//! ```text
//! adb exec-out screencap -p  → PNG data via stdout
//!   → decode PNG → Frame
//! Latency: ~200-500ms (USB) / ~300-800ms (Wi-Fi)
//! ```
//!
//! ## Fast Path: ADB framebuffer (requires root)
//!
//! ```text
//! adb shell cat /dev/graphics/fb0  → raw framebuffer
//!   → parse header → pixel data
//! Latency: ~50-150ms (no PNG encode/decode)
//! ```
//!
//! ## Streaming: scrcpy protocol (libusb, no root)
//!
//! ```text
//! scrcpy --no-display --record=pipe:
//!   → H.264 stream over USB → decode frames
//! Latency: ~30-70ms at 60fps
//! ```
//!
//! ## On-Device (requires AccessibilityService or root):
//!
//! ```text
//! MediaProjection API → VirtualDisplay → ImageReader
//!   → Image.getPlanes() → pixel data
//! ```
//!
//! ## Dependencies (when implemented)
//!
//! Uses `std::process::Command` to shell out to `adb`.
//! For scrcpy protocol: `usb` crate + custom H.264 decoder.

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::Frame;

use crate::WindowInfo;

pub fn capture_screen() -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Android ADB screen capture not yet implemented. \
         Requires ADB on host and USB debugging enabled on device."
            .into(),
    ))
}

pub fn capture_window(_window_id: u32) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Android does not support individual window capture via ADB".into(),
    ))
}

pub fn capture_region(_x: f64, _y: f64, _w: f64, _h: f64) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Android ADB region capture not yet implemented".into(),
    ))
}

pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    Err(OmniError::UnsupportedPlatform(
        "Android window list via dumpsys not yet implemented".into(),
    ))
}
