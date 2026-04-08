//! iOS zero-copy capture — remote via libimobiledevice.
//!
//! iOS sandboxing prevents on-device GPU framebuffer access.
//! Capture is done remotely from desktop host.
//!
//! ## API: libimobiledevice (USB) or WDA /screenshot (Wi-Fi)
//!
//! ```text
//! idevicescreenshot → PNG via USB → decode → CapturedFrame
//! WDA: GET /screenshot → base64 PNG → decode → CapturedFrame
//! ```
//!
//! ## Latency: ~100-300ms (not zero-copy, but acceptable for mobile)

use crate::{CaptureConfig, CapturedFrame};
use omnistate_core::error::{OmniError, OmniResult};

pub fn capture_frame(_config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    Err(OmniError::UnsupportedPlatform(
        "iOS remote capture not yet implemented. \
         Requires libimobiledevice or WDA on host."
            .into(),
    ))
}
