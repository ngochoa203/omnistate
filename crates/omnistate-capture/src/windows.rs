//! Windows zero-copy GPU framebuffer capture via DXGI Desktop Duplication.
//!
//! ## Architecture (planned)
//!
//! ```text
//! IDXGIOutputDuplication::AcquireNextFrame()
//!     -> DXGI_OUTDUPL_FRAME_INFO + IDXGIResource
//!     -> QueryInterface<ID3D11Texture2D>()
//!     -> ID3D11DeviceContext::Map(D3D11_MAP_READ)
//!     -> D3D11_MAPPED_SUBRESOURCE.pData  (GPU texture memory)
//!     -> copy into CapturedFrame.data
//! ```
//!
//! ## Zero-copy notes
//!
//! - **Integrated GPU (Intel/AMD APU):** Map() provides direct access
//!   to shared memory. True zero-copy path similar to Apple Silicon.
//! - **Discrete GPU (NVIDIA/AMD):** Map() triggers a GPU→CPU DMA transfer.
//!   Still faster than GDI BitBlt or PrintWindow alternatives.
//! - **GPU texture stays on GPU** until Map() is called, keeping the
//!   compositor pipeline free.
//!
//! ## Dependencies (when implemented)
//!
//! ```toml
//! [target.'cfg(target_os = "windows")'.dependencies]
//! windows = { version = "0.58", features = [
//!     "Win32_Graphics_Dxgi",
//!     "Win32_Graphics_Dxgi_Common",
//!     "Win32_Graphics_Direct3D11",
//!     "Win32_Graphics_Direct3D",
//! ]}
//! ```

use crate::{CaptureConfig, CapturedFrame};
use omnistate_core::error::{OmniError, OmniResult};

/// Capture a single frame using DXGI Desktop Duplication.
///
/// **Not yet implemented.** Will use the DXGI Desktop Duplication API
/// for zero-copy GPU framebuffer capture on Windows.
pub fn capture_frame(_config: &CaptureConfig) -> OmniResult<CapturedFrame> {
    Err(OmniError::UnsupportedPlatform(
        "Windows DXGI Desktop Duplication capture not yet implemented. \
         See crate docs for the planned zero-copy architecture."
            .into(),
    ))
}
