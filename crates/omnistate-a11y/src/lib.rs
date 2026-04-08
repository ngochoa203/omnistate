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

use omnistate_core::error::OmniResult;
use omnistate_core::UIElement;

/// Get all UI elements visible on the focused window.
pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    #[cfg(target_os = "macos")]
    return macos::get_ui_elements();
    #[cfg(target_os = "windows")]
    return windows::get_ui_elements();
    #[cfg(target_os = "linux")]
    return linux::get_ui_elements();
    #[cfg(target_os = "ios")]
    return ios::get_ui_elements();
    #[cfg(target_os = "android")]
    return android::get_ui_elements();
}

/// Find a specific UI element by its text content or role.
pub fn find_element(query: &str) -> OmniResult<Option<UIElement>> {
    #[cfg(target_os = "macos")]
    return macos::find_element(query);
    #[cfg(target_os = "windows")]
    return windows::find_element(query);
    #[cfg(target_os = "linux")]
    return linux::find_element(query);
    #[cfg(target_os = "ios")]
    return ios::find_element(query);
    #[cfg(target_os = "android")]
    return android::find_element(query);
}
