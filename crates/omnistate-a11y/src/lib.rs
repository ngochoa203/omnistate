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

/// Perform an accessibility action on the element matching the query.
/// Common actions: "AXPress", "AXRaise", "AXShowMenu", "AXCancel", "AXConfirm"
pub fn perform_action(query: &str, action: &str) -> OmniResult<bool> {
    #[cfg(target_os = "macos")]
    return macos::perform_action(query, action);
    #[cfg(not(target_os = "macos"))]
    return Err(omnistate_core::error::OmniError::AccessibilityError(
        "perform_action is only supported on macOS".to_string(),
    ));
}

/// Press (click) a UI element found by query — calls AXPress action directly.
pub fn press_element(query: &str) -> OmniResult<bool> {
    #[cfg(target_os = "macos")]
    return macos::press_element(query);
    #[cfg(not(target_os = "macos"))]
    return Err(omnistate_core::error::OmniError::AccessibilityError(
        "press_element is only supported on macOS".to_string(),
    ));
}

/// Set the value of a text field found by query.
pub fn set_element_value(query: &str, value: &str) -> OmniResult<bool> {
    #[cfg(target_os = "macos")]
    return macos::set_element_value(query, value);
    #[cfg(not(target_os = "macos"))]
    return Err(omnistate_core::error::OmniError::AccessibilityError(
        "set_element_value is only supported on macOS".to_string(),
    ));
}

/// Get available actions for the element matching the query.
pub fn get_element_actions(query: &str) -> OmniResult<Vec<String>> {
    #[cfg(target_os = "macos")]
    return macos::get_element_actions(query);
    #[cfg(not(target_os = "macos"))]
    return Err(omnistate_core::error::OmniError::AccessibilityError(
        "get_element_actions is only supported on macOS".to_string(),
    ));
}
