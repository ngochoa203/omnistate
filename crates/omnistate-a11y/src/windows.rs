//! Windows accessibility via UI Automation (UIA).
//!
//! ## Primary: IUIAutomation (COM, Win7+)
//! ```text
//! CoCreateInstance(CUIAutomation) → IUIAutomation
//!   → GetRootElement → FindAll(TreeScope_Subtree, condition)
//!   → IUIAutomationElement: Name, ControlType, BoundingRectangle
//! ```
//!
//! ## Legacy: MSAA (IAccessible) for older apps
//!
//! ## Deps: `windows = "0.58"` features: Win32_UI_Accessibility
//! ## Alt: `uiautomation` crate (safe wrapper)

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::UIElement;

pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Windows accessibility not yet implemented — UIAutomation planned".into()))
}

pub fn find_element(_query: &str) -> OmniResult<Option<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Windows element search not yet implemented".into()))
}
