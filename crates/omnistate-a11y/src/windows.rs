use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::UIElement;

pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Windows accessibility not yet implemented — UIAutomation planned".into()))
}

pub fn find_element(_query: &str) -> OmniResult<Option<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Windows element search not yet implemented".into()))
}
