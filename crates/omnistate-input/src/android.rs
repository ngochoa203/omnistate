//! Android input synthesis via ADB shell.
//!
//! ## Primary: ADB input commands
//! ```text
//! adb shell input tap <x> <y>           → tap
//! adb shell input text "hello"          → type text
//! adb shell input keyevent <keycode>    → key press
//! adb shell input swipe <x1> <y1> <x2> <y2> <duration_ms>
//! adb shell input draganddrop <x1> <y1> <x2> <y2> <duration_ms>
//! ```
//!
//! ## Fast path: ADB sendevent (raw input events, no delay)
//! ```text
//! adb shell sendevent /dev/input/event0 <type> <code> <value>
//!   EV_ABS ABS_MT_POSITION_X <x>
//!   EV_ABS ABS_MT_POSITION_Y <y>
//!   EV_SYN SYN_REPORT 0
//! ```
//!
//! ## Alt: UIAutomator2 JSON RPC (via appium/atx-agent)

use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{Key, Modifiers, MouseButton, Point};

pub fn move_mouse(_point: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB input not yet implemented".into()))
}

pub fn click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB tap not yet implemented".into()))
}

pub fn double_click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB double-tap not yet implemented".into()))
}

pub fn scroll(_dx: i32, _dy: i32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB swipe not yet implemented".into()))
}

pub fn key_tap(_key: Key, _modifiers: Modifiers) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB keyevent not yet implemented".into()))
}

pub fn type_text(_text: &str) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB text input not yet implemented".into()))
}

pub fn move_mouse_smooth(_from: Point, _to: Point, _steps: u32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB smooth gesture not yet implemented".into()))
}

pub fn drag(_from: Point, _to: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Android ADB drag not yet implemented".into()))
}
