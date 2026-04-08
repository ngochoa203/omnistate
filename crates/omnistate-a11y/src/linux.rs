//! Linux accessibility via AT-SPI2 over D-Bus.
//!
//! ## API: Assistive Technology Service Provider Interface
//! ```text
//! org.a11y.Bus → /org/a11y/atspi/accessible/root
//!   → GetChildren → Accessible objects
//!   → GetName, GetRole, GetExtents, GetState
//! ```
//!
//! ## Deps: `atspi = "0.22"` (async D-Bus bindings)
//! ## Alt: `zbus = "4"` + manual D-Bus calls

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::UIElement;

pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Linux accessibility not yet implemented — AT-SPI2 planned".into()))
}

pub fn find_element(_query: &str) -> OmniResult<Option<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Linux element search not yet implemented".into()))
}
