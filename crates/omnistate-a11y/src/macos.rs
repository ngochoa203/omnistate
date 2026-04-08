use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::UIElement;

/// macOS accessibility via AXUIElement API.
///
/// Requires the app to have accessibility permissions
/// (System Preferences → Security & Privacy → Accessibility).
///
/// TODO: Implement using core-foundation + objc2 crates to call:
/// - AXUIElementCreateSystemWide()
/// - AXUIElementCopyAttributeValue()
/// - AXUIElementCopyElementAtPosition()
pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    // Stub — will be implemented with AXUIElement bindings
    Err(OmniError::AccessibilityError(
        "macOS accessibility not yet implemented — AXUIElement planned".into(),
    ))
}

pub fn find_element(_query: &str) -> OmniResult<Option<UIElement>> {
    Err(OmniError::AccessibilityError(
        "macOS element search not yet implemented".into(),
    ))
}
