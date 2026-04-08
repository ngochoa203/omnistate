//! Android zero-copy capture — remote via ADB / scrcpy.
//!
//! ## Primary: ADB screencap
//! ```text
//! adb exec-out screencap -p → PNG stdout → decode → CapturedFrame
//! Latency: ~200-500ms
//! ```
//!
//! ## Fast path: scrcpy protocol (H.264 stream, ~30-70ms at 60fps)
//! ```text
//! scrcpy server → H.264 over USB → decode frame → CapturedFrame
//! ```
//!
//! ## On-device: MediaProjection → VirtualDisplay → ImageReader (requires APK)

use crate::{CaptureConfig, CapturedFrame};
use omnistate_core::error::{OmniError, OmniResult};

pub fn capture_frame(_config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    Err(OmniError::UnsupportedPlatform(
        "Android ADB/scrcpy capture not yet implemented. \
         Requires ADB on host and USB debugging on device."
            .into(),
    ))
}
