//! Linux zero-copy GPU framebuffer capture via PipeWire + DMA-BUF.
//!
//! ## Architecture (planned)
//!
//! ```text
//! PipeWire screen capture portal
//!     -> pw_stream → SPA_DATA_DmaBuf fd
//!     -> mmap(fd)  (zero-copy: maps GPU buffer into process address space)
//!     -> read pixels directly from mmap'd region
//!     -> copy into CapturedFrame.data
//! ```
//!
//! ## Zero-copy notes
//!
//! - **DMA-BUF:** The kernel exports GPU buffers as file descriptors.
//!   `mmap()` maps this directly into user space without any CPU copies.
//! - **PipeWire:** Wayland's screen capture protocol. Works with both
//!   GNOME (Mutter) and KDE (KWin) compositors.
//! - **Fallback:** If DMA-BUF is not available, PipeWire can deliver
//!   SPA_DATA_MemPtr buffers (CPU-allocated, slightly slower).
//!
//! ## Dependencies (when implemented)
//!
//! ```toml
//! [target.'cfg(target_os = "linux")'.dependencies]
//! pipewire = "0.8"
//! ```

use crate::{CaptureConfig, CapturedFrame};
use omnistate_core::error::{OmniError, OmniResult};

/// Capture a single frame using PipeWire + DMA-BUF.
///
/// **Not yet implemented.** Will use PipeWire's screen capture portal
/// with DMA-BUF for zero-copy GPU framebuffer capture on Linux.
pub fn capture_frame(_config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    Err(OmniError::UnsupportedPlatform(
        "Linux PipeWire + DMA-BUF capture not yet implemented. \
         See crate docs for the planned zero-copy architecture."
            .into(),
    ))
}
