//! Windows screen capture via DXGI Output Duplication.
//!
//! ## Primary: DXGI Desktop Duplication (Win 8+)
//! ```text
//! IDXGIOutput1::DuplicateOutput → IDXGIOutputDuplication
//!   → AcquireNextFrame → ID3D11Texture2D → Map → pixels
//! ```
//!
//! ## Fallback: GDI BitBlt (WinXP+)
//! ```text
//! GetDC(NULL) → BitBlt(SRCCOPY) → GetDIBits → pixels
//! ```
//!
//! ## Window: PrintWindow(hwnd, hdc, PW_RENDERFULLCONTENT)
//!
//! ## Deps: `windows = "0.58"` features: Dxgi, Direct3D11, Gdi, Foundation

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
