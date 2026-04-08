use napi::bindgen_prelude::*;
use napi_derive::napi;
use omnistate_core::{Key, Modifiers, MouseButton, Point};

/// Move the mouse cursor to absolute screen coordinates.
#[napi]
pub fn move_mouse(x: f64, y: f64) -> Result<()> {
    omnistate_input::move_mouse(Point { x, y })
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Click a mouse button. button: "left" | "right" | "middle"
#[napi]
pub fn click(button: String) -> Result<()> {
    let btn = parse_mouse_button(&button)?;
    omnistate_input::click(btn)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Double-click a mouse button.
#[napi]
pub fn double_click(button: String) -> Result<()> {
    let btn = parse_mouse_button(&button)?;
    omnistate_input::double_click(btn)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Scroll the mouse wheel.
#[napi]
pub fn scroll(dx: i32, dy: i32) -> Result<()> {
    omnistate_input::scroll(dx, dy)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Press and release a key with optional modifiers.
#[napi]
pub fn key_tap(key: String, shift: bool, control: bool, alt: bool, meta: bool) -> Result<()> {
    let k = parse_key(&key)?;
    let modifiers = Modifiers { shift, control, alt, meta };
    omnistate_input::key_tap(k, modifiers)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Type a string of text.
#[napi]
pub fn type_text(text: String) -> Result<()> {
    omnistate_input::type_text(&text)
        .map_err(|e| Error::from_reason(e.to_string()))
}

fn parse_mouse_button(s: &str) -> Result<MouseButton> {
    match s {
        "left" => Ok(MouseButton::Left),
        "right" => Ok(MouseButton::Right),
        "middle" => Ok(MouseButton::Middle),
        _ => Err(Error::from_reason(format!("Unknown mouse button: {s}"))),
    }
}

fn parse_key(s: &str) -> Result<Key> {
    match s {
        "return" | "enter" => Ok(Key::Return),
        "tab" => Ok(Key::Tab),
        "space" => Ok(Key::Space),
        "backspace" => Ok(Key::Backspace),
        "delete" => Ok(Key::Delete),
        "escape" | "esc" => Ok(Key::Escape),
        "up" => Ok(Key::Up),
        "down" => Ok(Key::Down),
        "left" => Ok(Key::Left),
        "right" => Ok(Key::Right),
        s if s.len() == 1 => Ok(Key::Char(s.chars().next().unwrap())),
        s if s.starts_with('f') || s.starts_with('F') => {
            let n: u8 = s[1..].parse()
                .map_err(|_| Error::from_reason(format!("Invalid function key: {s}")))?;
            Ok(Key::Function(n))
        }
        _ => Err(Error::from_reason(format!("Unknown key: {s}"))),
    }
}
