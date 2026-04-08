//! iOS input synthesis via remote agent (XCUITest / idb).
//!
//! ## Primary: WebDriverAgent (WDA) HTTP API
//! ```text
//! POST /wda/tap {x, y}          → tap at coordinates
//! POST /wda/keys {value: "text"} → type text
//! POST /wda/swipe {fromX,fromY,toX,toY,duration} → swipe
//! POST /wda/pressButton {name: "home"} → hardware buttons
//! ```
//!
//! ## Alternative: idb (iOS Development Bridge by Meta)
//! ```text
//! idb tap <x> <y>
//! idb text "hello"
//! idb key_press 4  (keycodes)
//! idb swipe <x1> <y1> <x2> <y2>
//! ```
//!
//! ## Note: requires WDA or idb running on host, device connected via USB/Wi-Fi

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{Key, Modifiers, MouseButton, Point};

pub fn move_mouse(_point: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote input (WDA/idb) not yet implemented".into()))
}

pub fn click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote tap not yet implemented".into()))
}

pub fn double_click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote double-tap not yet implemented".into()))
}

pub fn scroll(_dx: i32, _dy: i32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote scroll/swipe not yet implemented".into()))
}

pub fn key_tap(_key: Key, _modifiers: Modifiers) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote key input not yet implemented".into()))
}

pub fn type_text(_text: &str) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote text input not yet implemented".into()))
}

pub fn move_mouse_smooth(_from: Point, _to: Point, _steps: u32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote smooth gesture not yet implemented".into()))
}

pub fn drag(_from: Point, _to: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("iOS remote drag/swipe not yet implemented".into()))
}
