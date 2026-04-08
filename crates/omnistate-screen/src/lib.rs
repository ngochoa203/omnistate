#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "ios")]
pub mod ios;
#[cfg(target_os = "android")]
pub mod android;

use omnistate_core::{error::OmniResult, Frame};

/// Capture the entire screen.
pub fn capture_screen() -> OmniResult<Frame> {
    #[cfg(target_os = "macos")]
    return macos::capture_screen();

    #[cfg(target_os = "windows")]
    return windows::capture_screen();

    #[cfg(target_os = "linux")]
    return linux::capture_screen();

    #[cfg(target_os = "ios")]
    return ios::capture_screen();

    #[cfg(target_os = "android")]
    return android::capture_screen();
}

/// Capture a specific window by its platform window ID.
pub fn capture_window(window_id: u32) -> OmniResult<Frame> {
    #[cfg(target_os = "macos")]
    return macos::capture_window(window_id);

    #[cfg(target_os = "windows")]
    return windows::capture_window(window_id);

    #[cfg(target_os = "linux")]
    return linux::capture_window(window_id);

    #[cfg(target_os = "ios")]
    return ios::capture_window(window_id);

    #[cfg(target_os = "android")]
    return android::capture_window(window_id);
}

/// Capture a rectangular region of the screen.
/// Faster than full screen capture — fewer pixels to composite.
pub fn capture_region(x: f64, y: f64, width: f64, height: f64) -> OmniResult<Frame> {
    #[cfg(target_os = "macos")]
    return macos::capture_region(x, y, width, height);

    #[cfg(target_os = "windows")]
    return windows::capture_region(x, y, width, height);

    #[cfg(target_os = "linux")]
    return linux::capture_region(x, y, width, height);

    #[cfg(target_os = "ios")]
    return ios::capture_region(x, y, width, height);

    #[cfg(target_os = "android")]
    return android::capture_region(x, y, width, height);
}

/// List visible windows with their IDs and titles.
pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    #[cfg(target_os = "macos")]
    return macos::list_windows();

    #[cfg(target_os = "windows")]
    return windows::list_windows();

    #[cfg(target_os = "linux")]
    return linux::list_windows();

    #[cfg(target_os = "ios")]
    return ios::list_windows();

    #[cfg(target_os = "android")]
    return android::list_windows();
}

#[derive(Debug, Clone)]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    pub owner: String,
    pub bounds: omnistate_core::Rect,
    pub is_on_screen: bool,
}
