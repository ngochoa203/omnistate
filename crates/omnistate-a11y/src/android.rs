//! Android accessibility via UIAutomator2 / ADB.
//!
//! ## Primary: UIAutomator2 dump
//! ```text
//! adb shell uiautomator dump /dev/tty
//!   → XML hierarchy: node{resource-id, text, class, bounds, ...}
//!   → parse XML → UIElement[]
//! ```
//!
//! ## Alternative: AccessibilityService (on-device, requires APK)
//! ```text
//! AccessibilityService.onAccessibilityEvent → AccessibilityNodeInfo
//!   → getText, getClassName, getBoundsInScreen, isEnabled, isClickable
//! ```
//!
//! ## Fast path: adb shell dumpsys activity top (current Activity info)
//!
//! ## Alt: appium/atx-agent JSON RPC for real-time element queries

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::UIElement;

pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Android UIAutomator2 accessibility not yet implemented".into()))
}

pub fn find_element(_query: &str) -> OmniResult<Option<UIElement>> {
    Err(OmniError::UnsupportedPlatform("Android element search not yet implemented".into()))
}
