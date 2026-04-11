//! macOS accessibility via AXUIElement API.
//!
//! Requires the app to have accessibility permissions
//! (System Settings → Privacy & Security → Accessibility).
//!
//! Uses raw FFI bindings to the ApplicationServices framework
//! since there is no mature Rust crate for AXUIElement.

use core_foundation::array::CFArray;
use core_foundation::base::TCFType;
use core_foundation::string::CFString;
use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{DetectionMethod, ElementState, ElementType, Rect, UIElement};
use std::ffi::c_void;
use std::ptr;

// ── Raw FFI bindings to AXUIElement ──────────────────────────────────

type AXUIElementRef = *const c_void;
type AXValueRef = *const c_void;
type AXError = i32;

const K_AX_ERROR_SUCCESS: AXError = 0;

#[allow(non_upper_case_globals)]
const kAXValueTypeCGPoint: u32 = 1;
#[allow(non_upper_case_globals)]
const kAXValueTypeCGSize: u32 = 2;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
struct CGSize {
    width: f64,
    height: f64,
}

#[link(name = "ApplicationServices", kind = "framework")]
#[allow(dead_code)]
unsafe extern "C" {
    fn AXUIElementCreateSystemWide() -> AXUIElementRef;
    fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
    fn AXUIElementCopyAttributeValue(
        element: AXUIElementRef,
        attribute: core_foundation_sys::string::CFStringRef,
        value: *mut core_foundation_sys::base::CFTypeRef,
    ) -> AXError;
    fn AXUIElementCopyAttributeNames(
        element: AXUIElementRef,
        names: *mut core_foundation_sys::array::CFArrayRef,
    ) -> AXError;
    fn AXIsProcessTrusted() -> bool;
    fn AXValueGetValue(
        value: AXValueRef,
        value_type: u32,
        value_ptr: *mut c_void,
    ) -> bool;
}

// ── AX Attribute keys ────────────────────────────────────────────────

fn ax_attr(name: &str) -> CFString {
    CFString::new(name)
}

// ── Public API ───────────────────────────────────────────────────────

/// Check if this process has accessibility permissions.
pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Get all UI elements from the focused application.
///
/// Walks the accessibility tree of the frontmost application
/// and collects all interactive elements.
pub fn get_ui_elements() -> OmniResult<Vec<UIElement>> {
    if !is_trusted() {
        return Err(OmniError::AccessibilityError(
            "Accessibility permission not granted. Enable in System Settings → Privacy & Security → Accessibility".into(),
        ));
    }

    let system_wide = unsafe { AXUIElementCreateSystemWide() };
    if system_wide.is_null() {
        return Err(OmniError::AccessibilityError(
            "Failed to create system-wide accessibility element".into(),
        ));
    }

    // Get the focused application
    let focused_app = get_attribute(system_wide, "AXFocusedApplication")?;
    if focused_app.is_null() {
        return Err(OmniError::AccessibilityError(
            "No focused application found".into(),
        ));
    }

    // Get the focused window of the application
    let focused_window = get_attribute(focused_app, "AXFocusedWindow");

    let mut elements = Vec::new();
    let mut id_counter = 0u32;

    // If we have a focused window, walk its children
    if let Ok(window) = focused_window {
        if !window.is_null() {
            walk_element(window, &mut elements, &mut id_counter, 0, 5);
        }
    }

    // Also get the application's children (menus, etc.)
    if let Ok(children_ref) = get_attribute(focused_app, "AXChildren") {
        if !children_ref.is_null() {
            let children: CFArray =
                unsafe { CFArray::wrap_under_get_rule(children_ref as *const _) };
            for i in 0..children.len().min(20) {
                let child: *const c_void =
                    *children.get(i).unwrap() as *const c_void;
                walk_element(child, &mut elements, &mut id_counter, 0, 3);
            }
        }
    }

    unsafe { core_foundation_sys::base::CFRelease(system_wide as *const _) };

    Ok(elements)
}

/// Find a UI element by text content or role.
pub fn find_element(query: &str) -> OmniResult<Option<UIElement>> {
    let elements = get_ui_elements()?;
    let query_lower = query.to_lowercase();

    // Search by text content first
    let found = elements.into_iter().find(|e| {
        if let Some(ref text) = e.text {
            text.to_lowercase().contains(&query_lower)
        } else if let Some(ref role) = e.semantic_role {
            role.to_lowercase().contains(&query_lower)
        } else {
            false
        }
    });

    Ok(found)
}

// ── Internal helpers ─────────────────────────────────────────────────

fn get_attribute(
    element: AXUIElementRef,
    attr: &str,
) -> OmniResult<core_foundation_sys::base::CFTypeRef> {
    let cf_attr = ax_attr(attr);
    let mut value: core_foundation_sys::base::CFTypeRef = ptr::null();

    let err = unsafe {
        AXUIElementCopyAttributeValue(
            element,
            cf_attr.as_concrete_TypeRef(),
            &mut value,
        )
    };

    if err != K_AX_ERROR_SUCCESS {
        return Err(OmniError::AccessibilityError(format!(
            "Failed to get attribute '{attr}' (AXError: {err})"
        )));
    }
    Ok(value)
}

fn get_string_attribute(element: AXUIElementRef, attr: &str) -> Option<String> {
    let value = get_attribute(element, attr).ok()?;
    if value.is_null() {
        return None;
    }

    let string_type_id = unsafe { core_foundation_sys::string::CFStringGetTypeID() };
    let value_type_id = unsafe { core_foundation_sys::base::CFGetTypeID(value) };
    if value_type_id != string_type_id {
        unsafe { core_foundation_sys::base::CFRelease(value as *const _) };
        return None;
    }

    let cf_str: CFString = unsafe { CFString::wrap_under_get_rule(value as *const _) };
    Some(cf_str.to_string())
}

fn get_bool_attribute(element: AXUIElementRef, attr: &str) -> bool {
    let value = get_attribute(element, attr).ok();
    if let Some(v) = value {
        if v.is_null() {
            return false;
        }

        let bool_type_id = unsafe { core_foundation_sys::number::CFBooleanGetTypeID() };
        let value_type_id = unsafe { core_foundation_sys::base::CFGetTypeID(v) };
        if value_type_id != bool_type_id {
            unsafe { core_foundation_sys::base::CFRelease(v as *const _) };
            return false;
        }

        // CFBoolean: true = CFBooleanTrue (non-zero)
        let cf_bool = unsafe { core_foundation_sys::number::CFBooleanGetValue(v as *const _) };
        unsafe { core_foundation_sys::base::CFRelease(v as *const _) };
        return cf_bool;
    }
    false
}

fn get_position(element: AXUIElementRef) -> Option<(f64, f64)> {
    let value = get_attribute(element, "AXPosition").ok()?;
    if value.is_null() {
        return None;
    }
    let mut point = CGPoint::default();
    let ok = unsafe {
        AXValueGetValue(
            value as AXValueRef,
            kAXValueTypeCGPoint,
            &mut point as *mut CGPoint as *mut c_void,
        )
    };
    if ok {
        Some((point.x, point.y))
    } else {
        None
    }
}

fn get_size(element: AXUIElementRef) -> Option<(f64, f64)> {
    let value = get_attribute(element, "AXSize").ok()?;
    if value.is_null() {
        return None;
    }
    let mut size = CGSize::default();
    let ok = unsafe {
        AXValueGetValue(
            value as AXValueRef,
            kAXValueTypeCGSize,
            &mut size as *mut CGSize as *mut c_void,
        )
    };
    if ok {
        Some((size.width, size.height))
    } else {
        None
    }
}

fn role_to_element_type(role: &str) -> ElementType {
    match role {
        "AXButton" => ElementType::Button,
        "AXTextField" | "AXTextArea" | "AXSearchField" | "AXComboBox" => {
            ElementType::TextField
        }
        "AXMenu" | "AXMenuBar" | "AXMenuBarItem" | "AXMenuItem" => {
            ElementType::Menu
        }
        "AXStaticText" => ElementType::Label,
        "AXImage" => ElementType::Image,
        "AXList" | "AXTable" | "AXOutline" => ElementType::List,
        "AXTabGroup" | "AXTab" => ElementType::Tab,
        "AXCheckBox" | "AXRadioButton" => ElementType::Checkbox,
        "AXPopUpButton" => ElementType::Dropdown,
        "AXWindow" => ElementType::Window,
        _ => ElementType::Unknown,
    }
}

fn walk_element(
    element: AXUIElementRef,
    elements: &mut Vec<UIElement>,
    id_counter: &mut u32,
    depth: u32,
    max_depth: u32,
) {
    if depth > max_depth || element.is_null() {
        return;
    }

    let role = get_string_attribute(element, "AXRole").unwrap_or_default();
    let title = get_string_attribute(element, "AXTitle");
    let value = get_string_attribute(element, "AXValue");
    let description = get_string_attribute(element, "AXDescription");

    let text = title
        .or(value)
        .or(description)
        .filter(|t| !t.is_empty());

    let position = get_position(element);
    let size = get_size(element);

    let bounds = match (position, size) {
        (Some((x, y)), Some((w, h))) => Rect {
            x,
            y,
            width: w,
            height: h,
        },
        _ => Rect {
            x: 0.0,
            y: 0.0,
            width: 0.0,
            height: 0.0,
        },
    };

    let element_type = role_to_element_type(&role);

    // Only add interactive or visible elements
    if element_type != ElementType::Unknown || text.is_some() {
        *id_counter += 1;
        elements.push(UIElement {
            id: format!("ax-{}", id_counter),
            element_type,
            bounds,
            text,
            state: ElementState {
                visible: true,
                enabled: get_bool_attribute(element, "AXEnabled"),
                focused: get_bool_attribute(element, "AXFocused"),
                selected: get_bool_attribute(element, "AXSelected"),
            },
            confidence: 1.0,
            detection_method: DetectionMethod::Accessibility,
            semantic_role: Some(role),
        });
    }

    // Recurse into children
    if let Ok(children_ref) = get_attribute(element, "AXChildren") {
        if !children_ref.is_null() {
            let children: CFArray =
                unsafe { CFArray::wrap_under_get_rule(children_ref as *const _) };
            for i in 0..children.len().min(50) {
                let child: *const c_void =
                    *children.get(i).unwrap() as *const c_void;
                walk_element(child, elements, id_counter, depth + 1, max_depth);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_trusted() {
        let trusted = is_trusted();
        println!("Accessibility trusted: {trusted}");
        // This test will pass regardless — it's just checking the API works
    }

    #[test]
    fn test_get_ui_elements() {
        if !is_trusted() {
            println!("Skipping — accessibility not enabled");
            return;
        }
        match get_ui_elements() {
            Ok(elements) => {
                println!("Found {} UI elements:", elements.len());
                for el in &elements {
                    println!(
                        "  [{:?}] {:?} @ ({:.0},{:.0} {:.0}x{:.0}) text={:?}",
                        el.element_type,
                        el.semantic_role,
                        el.bounds.x,
                        el.bounds.y,
                        el.bounds.width,
                        el.bounds.height,
                        el.text,
                    );
                }
            }
            Err(e) => println!("Error: {e}"),
        }
    }

    #[test]
    fn test_find_element() {
        if !is_trusted() {
            println!("Skipping — accessibility not enabled");
            return;
        }
        match find_element("button") {
            Ok(Some(el)) => println!("Found: {:?}", el),
            Ok(None) => println!("No element matching 'button' found"),
            Err(e) => println!("Error: {e}"),
        }
    }
}
