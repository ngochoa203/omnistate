use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{Key, Modifiers, MouseButton, Point};

pub fn move_mouse(_point: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux input control not yet implemented — XTest planned".into()))
}

pub fn click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux click not yet implemented".into()))
}

pub fn double_click(_button: MouseButton) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux double click not yet implemented".into()))
}

pub fn scroll(_dx: i32, _dy: i32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux scroll not yet implemented".into()))
}

pub fn key_tap(_key: Key, _modifiers: Modifiers) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux key tap not yet implemented".into()))
}

pub fn type_text(_text: &str) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux type text not yet implemented".into()))
}

pub fn move_mouse_smooth(_from: Point, _to: Point, _steps: u32) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux smooth mouse not yet implemented".into()))
}

pub fn drag(_from: Point, _to: Point) -> OmniResult<()> {
    Err(OmniError::UnsupportedPlatform("Linux drag not yet implemented".into()))
}
