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

#[cfg(target_os = "macos")]
pub use macos::UITreeNode;

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

/// Get the full hierarchical UI tree from the focused application.
///
/// Unlike `get_ui_elements` (flat Vec), this preserves parent→child structure.
pub fn get_ui_tree() -> OmniResult<UITreeNode> {
    #[cfg(target_os = "macos")]
    return macos::get_ui_tree();
    #[cfg(not(target_os = "macos"))]
    return Err(omnistate_core::error::OmniError::AccessibilityError(
        "get_ui_tree is only supported on macOS".to_string(),
    ));
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
