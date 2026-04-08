#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "linux")]
pub mod linux;

use omnistate_core::error::OmniResult;
use omnistate_core::{Key, Modifiers, MouseButton, Point};

/// Move the mouse cursor to an absolute screen position.
pub fn move_mouse(point: Point) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::move_mouse(point);

    #[cfg(target_os = "windows")]
    return windows::move_mouse(point);

    #[cfg(target_os = "linux")]
    return linux::move_mouse(point);
}

/// Click a mouse button at the current cursor position.
pub fn click(button: MouseButton) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::click(button);

    #[cfg(target_os = "windows")]
    return windows::click(button);

    #[cfg(target_os = "linux")]
    return linux::click(button);
}

/// Double-click a mouse button at the current cursor position.
pub fn double_click(button: MouseButton) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::double_click(button);

    #[cfg(target_os = "windows")]
    return windows::double_click(button);

    #[cfg(target_os = "linux")]
    return linux::double_click(button);
}

/// Scroll the mouse wheel.
pub fn scroll(dx: i32, dy: i32) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::scroll(dx, dy);

    #[cfg(target_os = "windows")]
    return windows::scroll(dx, dy);

    #[cfg(target_os = "linux")]
    return linux::scroll(dx, dy);
}

/// Press and release a single key.
pub fn key_tap(key: Key, modifiers: Modifiers) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::key_tap(key, modifiers);

    #[cfg(target_os = "windows")]
    return windows::key_tap(key, modifiers);

    #[cfg(target_os = "linux")]
    return linux::key_tap(key, modifiers);
}

/// Type a string of text character by character.
pub fn type_text(text: &str) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::type_text(text);

    #[cfg(target_os = "windows")]
    return windows::type_text(text);

    #[cfg(target_os = "linux")]
    return linux::type_text(text);
}

/// Move mouse along a Bezier curve for human-like motion.
pub fn move_mouse_smooth(from: Point, to: Point, steps: u32) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::move_mouse_smooth(from, to, steps);

    #[cfg(target_os = "windows")]
    return windows::move_mouse_smooth(from, to, steps);

    #[cfg(target_os = "linux")]
    return linux::move_mouse_smooth(from, to, steps);
}

/// Drag from one point to another with left mouse button held.
pub fn drag(from: Point, to: Point) -> OmniResult<()> {
    #[cfg(target_os = "macos")]
    return macos::drag(from, to);

    #[cfg(target_os = "windows")]
    return windows::drag(from, to);

    #[cfg(target_os = "linux")]
    return linux::drag(from, to);
}
