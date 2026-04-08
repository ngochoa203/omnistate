//! Linux screen capture via PipeWire / X11 / Wayland.
//!
//! ## Primary: PipeWire + xdg-desktop-portal (Wayland-native)
//! ```text
//! ScreenCast portal → pw_stream → SPA_DATA_DmaBuf → mmap → pixels
//! ```
//!
//! ## Fallback: X11 XShm (X.org only)
//! ```text
//! XShmGetImage → shared memory → pixels
//! ```
//!
//! ## Wayland alt: wlr-screencopy (wlroots: Sway, Hyprland)
//!
//! ## Deps: `pipewire = "0.8"`, `x11rb = "0.13"`, `wayland-client = "0.31"`

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

pub fn capture_region(_x: f64, _y: f64, _width: f64, _height: f64) -> OmniResult<Frame> {
    Err(OmniError::UnsupportedPlatform(
        "Linux region capture not yet implemented".into(),
    ))
}

pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    Err(OmniError::UnsupportedPlatform(
        "Linux window listing not yet implemented".into(),
    ))
}
