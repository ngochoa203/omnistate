//! iOS accessibility via XCUIElement (remote, through XCTest/WDA).
//!
//! ## Primary: WebDriverAgent /source endpoint
//! ```text
//! GET /source?format=json → full UI element tree
//!   → type, name, label, value, rect, enabled, visible
//! GET /wda/element/:id/attribute/:name → specific attribute
//! POST /element -d {using:"name", value:"Button"} → find element
//! ```
//!
//! ## Alternative: Xcode Accessibility Inspector
//! ```text
//! xcrun simctl accessibility <device> → element tree (simulator only)
//! ```
//!
//! ## Note: WDA must be running on device via XCTest bootstrap

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::UIElement;

pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    Err(OmniError::UnsupportedPlatform("iOS remote accessibility (WDA) not yet implemented".into()))
}

pub fn find_element(_query: &str) -> OmniResult<Option<UIElement>> {
    Err(OmniError::UnsupportedPlatform("iOS remote element search not yet implemented".into()))
}
