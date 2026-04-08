use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType, CGMouseButton};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;
use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{Key, Modifiers, MouseButton, Point};

fn create_event_source() -> OmniResult<CGEventSource> {
    CGEventSource::new(CGEventSourceStateID::HIDSystemState)
        .map_err(|_| OmniError::InputError("Failed to create CGEventSource".into()))
}

pub fn move_mouse(point: Point) -> OmniResult<()> {
    let source = create_event_source()?;
    let cg_point = CGPoint::new(point.x, point.y);
    let event = CGEvent::new_mouse_event(
        source,
        CGEventType::MouseMoved,
        cg_point,
        CGMouseButton::Left,
    )
    .map_err(|_| OmniError::InputError("Failed to create mouse move event".into()))?;

    event.post(CGEventTapLocation::HID);
    Ok(())
}

pub fn click(button: MouseButton) -> OmniResult<()> {
    let source = create_event_source()?;
    let pos = get_cursor_position();
    let (cg_button, down_type, up_type) = match button {
        MouseButton::Left => (
            CGMouseButton::Left,
            CGEventType::LeftMouseDown,
            CGEventType::LeftMouseUp,
        ),
        MouseButton::Right => (
            CGMouseButton::Right,
            CGEventType::RightMouseDown,
            CGEventType::RightMouseUp,
        ),
        MouseButton::Middle => (
            CGMouseButton::Center,
            CGEventType::OtherMouseDown,
            CGEventType::OtherMouseUp,
        ),
    };

    let down = CGEvent::new_mouse_event(source.clone(), down_type, pos, cg_button)
        .map_err(|_| OmniError::InputError("Failed to create mouse down event".into()))?;
    let up = CGEvent::new_mouse_event(source, up_type, pos, cg_button)
        .map_err(|_| OmniError::InputError("Failed to create mouse up event".into()))?;

    down.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

pub fn double_click(button: MouseButton) -> OmniResult<()> {
    click(button)?;
    click(button)
}

pub fn scroll(_dx: i32, _dy: i32) -> OmniResult<()> {
    // CGEvent::new_scroll_event is not available in core-graphics 0.24.
    // TODO: Use CGEventCreateScrollWheelEvent2 via raw FFI or upgrade crate.
    Err(OmniError::InputError(
        "Scroll not yet implemented — requires raw CGEventCreateScrollWheelEvent2 FFI".into(),
    ))
}

pub fn key_tap(key: Key, modifiers: Modifiers) -> OmniResult<()> {
    let source = create_event_source()?;
    let keycode = key_to_keycode(key);

    let down = CGEvent::new_keyboard_event(source.clone(), keycode, true)
        .map_err(|_| OmniError::InputError("Failed to create key down event".into()))?;
    let up = CGEvent::new_keyboard_event(source, keycode, false)
        .map_err(|_| OmniError::InputError("Failed to create key up event".into()))?;

    apply_modifiers(&down, modifiers);
    apply_modifiers(&up, modifiers);

    down.post(CGEventTapLocation::HID);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

pub fn type_text(text: &str) -> OmniResult<()> {
    let source = create_event_source()?;
    let event = CGEvent::new_keyboard_event(source, 0, true)
        .map_err(|_| OmniError::InputError("Failed to create keyboard event for typing".into()))?;

    let chars: Vec<u16> = text.encode_utf16().collect();
    event.set_string_from_utf16_unchecked(&chars);
    event.post(CGEventTapLocation::HID);
    Ok(())
}

fn get_cursor_position() -> CGPoint {
    let source =
        CGEventSource::new(CGEventSourceStateID::HIDSystemState).expect("event source");
    let event = CGEvent::new(source).expect("new event");
    event.location()
}

fn apply_modifiers(event: &CGEvent, modifiers: Modifiers) {
    use core_graphics::event::CGEventFlags;
    let mut flags = CGEventFlags::empty();
    if modifiers.shift {
        flags |= CGEventFlags::CGEventFlagShift;
    }
    if modifiers.control {
        flags |= CGEventFlags::CGEventFlagControl;
    }
    if modifiers.alt {
        flags |= CGEventFlags::CGEventFlagAlternate;
    }
    if modifiers.meta {
        flags |= CGEventFlags::CGEventFlagCommand;
    }
    event.set_flags(flags);
}

fn key_to_keycode(key: Key) -> u16 {
    match key {
        Key::Return => 0x24,
        Key::Tab => 0x30,
        Key::Space => 0x31,
        Key::Backspace => 0x33,
        Key::Delete => 0x75,
        Key::Escape => 0x35,
        Key::Up => 0x7E,
        Key::Down => 0x7D,
        Key::Left => 0x7B,
        Key::Right => 0x7C,
        Key::Home => 0x73,
        Key::End => 0x77,
        Key::PageUp => 0x74,
        Key::PageDown => 0x79,
        Key::Char(c) => char_to_keycode(c),
        Key::Function(n) => function_to_keycode(n),
        Key::Shift => 0x38,
        Key::Control => 0x3B,
        Key::Alt => 0x3A,
        Key::Meta => 0x37,
    }
}

fn char_to_keycode(c: char) -> u16 {
    match c.to_ascii_lowercase() {
        'a' => 0x00, 'b' => 0x0B, 'c' => 0x08, 'd' => 0x02,
        'e' => 0x0E, 'f' => 0x03, 'g' => 0x05, 'h' => 0x04,
        'i' => 0x22, 'j' => 0x26, 'k' => 0x28, 'l' => 0x25,
        'm' => 0x2E, 'n' => 0x2D, 'o' => 0x1F, 'p' => 0x23,
        'q' => 0x0C, 'r' => 0x0F, 's' => 0x01, 't' => 0x11,
        'u' => 0x20, 'v' => 0x09, 'w' => 0x0D, 'x' => 0x07,
        'y' => 0x10, 'z' => 0x06,
        '0' => 0x1D, '1' => 0x12, '2' => 0x13, '3' => 0x14,
        '4' => 0x15, '5' => 0x17, '6' => 0x16, '7' => 0x1A,
        '8' => 0x1C, '9' => 0x19,
        _ => 0x00,
    }
}

fn function_to_keycode(n: u8) -> u16 {
    match n {
        1 => 0x7A, 2 => 0x78, 3 => 0x63, 4 => 0x76,
        5 => 0x60, 6 => 0x61, 7 => 0x62, 8 => 0x64,
        9 => 0x65, 10 => 0x6D, 11 => 0x67, 12 => 0x6F,
        _ => 0x7A,
    }
}
