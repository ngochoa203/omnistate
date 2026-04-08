use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{Key, Modifiers, MouseButton, Point};

pub fn move_mouse(_point: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows input control not yet implemented — SendInput planned".into()))
}

pub fn click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows click not yet implemented".into()))
}

pub fn double_click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows double click not yet implemented".into()))
}

pub fn scroll(_dx: i32, _dy: i32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows scroll not yet implemented".into()))
}

pub fn key_tap(_key: Key, _modifiers: Modifiers) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows key tap not yet implemented".into()))
}

pub fn type_text(_text: &str) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows type text not yet implemented".into()))
}

pub fn move_mouse_smooth(_from: Point, _to: Point, _steps: u32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows smooth mouse not yet implemented".into()))
}

pub fn drag(_from: Point, _to: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Windows drag not yet implemented".into()))
}
