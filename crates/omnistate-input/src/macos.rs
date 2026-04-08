use core_graphics::event::{
    CGEvent, CGEventTapLocation, CGEventType, CGMouseButton, ScrollEventUnit,
};
use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
use core_graphics::geometry::CGPoint;
use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{Key, Modifiers, MouseButton, Point};
use std::thread;
use std::time::Duration;

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

/// Move mouse along a Bezier curve for human-like motion.
/// `steps` controls smoothness (more steps = slower but more natural).
pub fn move_mouse_smooth(from: Point, to: Point, steps: u32) -> OmniResult<()> {
    let steps = steps.max(2);

    // Quadratic Bezier with a random-ish control point
    let ctrl = Point {
        x: (from.x + to.x) / 2.0 + (to.y - from.y) * 0.15,
        y: (from.y + to.y) / 2.0 + (to.x - from.x) * 0.15,
    };

    for i in 0..=steps {
        let t = i as f64 / steps as f64;
        let inv_t = 1.0 - t;

        let x = inv_t * inv_t * from.x + 2.0 * inv_t * t * ctrl.x + t * t * to.x;
        let y = inv_t * inv_t * from.y + 2.0 * inv_t * t * ctrl.y + t * t * to.y;

        move_mouse(Point { x, y })?;

        // Human-like timing: slower at start and end (ease in/out)
        if i < steps {
            let ease = (std::f64::consts::PI * t).sin(); // 0 → 1 → 0
            let delay_ms = 2.0 + 6.0 * (1.0 - ease); // 2-8ms per step
            thread::sleep(Duration::from_micros((delay_ms * 1000.0) as u64));
        }
    }
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
    // Small delay between down and up for realistic click
    thread::sleep(Duration::from_millis(30));
    up.post(CGEventTapLocation::HID);
    Ok(())
}

pub fn double_click(button: MouseButton) -> OmniResult<()> {
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

    // Double-click requires setting the click count on the events
    let down1 = CGEvent::new_mouse_event(source.clone(), down_type, pos, cg_button)
        .map_err(|_| OmniError::InputError("Failed to create mouse down event".into()))?;
    let up1 = CGEvent::new_mouse_event(source.clone(), up_type, pos, cg_button)
        .map_err(|_| OmniError::InputError("Failed to create mouse up event".into()))?;
    let down2 = CGEvent::new_mouse_event(source.clone(), down_type, pos, cg_button)
        .map_err(|_| OmniError::InputError("Failed to create mouse down event".into()))?;
    let up2 = CGEvent::new_mouse_event(source, up_type, pos, cg_button)
        .map_err(|_| OmniError::InputError("Failed to create mouse up event".into()))?;

    down1.set_integer_value_field(1, 1); // click count = 1
    up1.set_integer_value_field(1, 1);
    down2.set_integer_value_field(1, 2); // click count = 2
    up2.set_integer_value_field(1, 2);

    down1.post(CGEventTapLocation::HID);
    up1.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(50));
    down2.post(CGEventTapLocation::HID);
    up2.post(CGEventTapLocation::HID);
    Ok(())
}

/// Scroll the mouse wheel. dy > 0 scrolls up, dy < 0 scrolls down.
pub fn scroll(dx: i32, dy: i32) -> OmniResult<()> {
    let source = create_event_source()?;
    let event = CGEvent::new_scroll_event(source, ScrollEventUnit::PIXEL, 2, dy, dx, 0)
        .map_err(|_| OmniError::InputError("Failed to create scroll event".into()))?;

    event.post(CGEventTapLocation::HID);
    Ok(())
}

/// Drag from one point to another (left button held).
pub fn drag(from: Point, to: Point) -> OmniResult<()> {
    let source = create_event_source()?;

    // Move to start position
    let start_pos = CGPoint::new(from.x, from.y);
    let end_pos = CGPoint::new(to.x, to.y);

    // Mouse down at start
    let down = CGEvent::new_mouse_event(
        source.clone(),
        CGEventType::LeftMouseDown,
        start_pos,
        CGMouseButton::Left,
    )
    .map_err(|_| OmniError::InputError("Failed to create drag start event".into()))?;
    down.post(CGEventTapLocation::HID);
    thread::sleep(Duration::from_millis(50));

    // Smooth drag movement
    let steps = 20u32;
    for i in 1..=steps {
        let t = i as f64 / steps as f64;
        let x = from.x + (to.x - from.x) * t;
        let y = from.y + (to.y - from.y) * t;
        let pos = CGPoint::new(x, y);

        let drag_event = CGEvent::new_mouse_event(
            source.clone(),
            CGEventType::LeftMouseDragged,
            pos,
            CGMouseButton::Left,
        )
        .map_err(|_| OmniError::InputError("Failed to create drag move event".into()))?;
        drag_event.post(CGEventTapLocation::HID);
        thread::sleep(Duration::from_millis(5));
    }

    // Mouse up at end
    let up = CGEvent::new_mouse_event(
        source,
        CGEventType::LeftMouseUp,
        end_pos,
        CGMouseButton::Left,
    )
    .map_err(|_| OmniError::InputError("Failed to create drag end event".into()))?;
    up.post(CGEventTapLocation::HID);
    Ok(())
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
    thread::sleep(Duration::from_millis(20));
    up.post(CGEventTapLocation::HID);
    Ok(())
}

/// Type text with human-like random delays between characters.
pub fn type_text(text: &str) -> OmniResult<()> {
    let source = create_event_source()?;

    // Process text in chunks for efficiency, but add small delays
    // between chunks to appear human-like
    let chunk_size = 5;
    let chars: Vec<u16> = text.encode_utf16().collect();

    for chunk in chars.chunks(chunk_size) {
        let event = CGEvent::new_keyboard_event(source.clone(), 0, true)
            .map_err(|_| {
                OmniError::InputError("Failed to create keyboard event for typing".into())
            })?;

        event.set_string_from_utf16_unchecked(chunk);
        event.post(CGEventTapLocation::HID);

        // Human-like inter-chunk delay: 30-80ms
        let base_delay = 30 + (chunk.len() * 10).min(50);
        thread::sleep(Duration::from_millis(base_delay as u64));
    }
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
        '-' => 0x1B, '=' => 0x18, '[' => 0x21, ']' => 0x1E,
        '\\' => 0x2A, ';' => 0x29, '\'' => 0x27, ',' => 0x2B,
        '.' => 0x2F, '/' => 0x2C, '`' => 0x32,
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
