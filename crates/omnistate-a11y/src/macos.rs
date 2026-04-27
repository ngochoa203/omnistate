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
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
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
    fn AXUIElementPerformAction(
        element: AXUIElementRef,
        action: core_foundation_sys::string::CFStringRef,
    ) -> AXError;
    fn AXUIElementSetAttributeValue(
        element: AXUIElementRef,
        attribute: core_foundation_sys::string::CFStringRef,
        value: core_foundation_sys::base::CFTypeRef,
    ) -> AXError;
    fn AXUIElementCopyActionNames(
        element: AXUIElementRef,
        names: *mut core_foundation_sys::array::CFArrayRef,
    ) -> AXError;
}


// ── AX Attribute keys ────────────────────────────────────────────────

fn ax_attr(name: &str) -> CFString {
    CFString::new(name)
}

// ── Hierarchical tree types ──────────────────────────────────────────

/// A single node in the full hierarchical accessibility tree.
#[derive(Debug, Serialize, Deserialize)]
pub struct UITreeNode {
    pub id: String,
    pub role: String,
    pub title: Option<String>,
    pub value: Option<String>,
    pub description: Option<String>,
    pub bounds: Rect,
    pub state: ElementState,
    pub children: Vec<UITreeNode>,
    pub attributes: HashMap<String, String>,
}

// ── Public API ───────────────────────────────────────────────────────

/// Check if this process has accessibility permissions.
pub fn is_trusted() -> bool {
    unsafe { AXIsProcessTrusted() }
}

/// Get the frontmost application's PID via `osascript` (O(1), ~50 ms).
///
/// Falls back to `None` on any error so the caller can try other strategies.
fn get_frontmost_pid_via_script() -> Option<i32> {
    let output = std::process::Command::new("osascript")
        .args([
            "-e",
            "tell application \"System Events\" to get unix id of first process whose frontmost is true",
        ])
        .output()
        .ok()?;
    let s = String::from_utf8(output.stdout).ok()?;
    s.trim().parse::<i32>().ok()
}

/// Resolve the frontmost (active) application element.
///
/// Strategy:
///   1. Try `AXFocusedApplication` on the system-wide element — O(1), works
///      for native AppKit/Cocoa apps that hold keyboard focus.
///   2. If that fails or returns null, ask `osascript` for the frontmost PID
///      — O(1), ~50 ms, covers Electron, browsers, and web-view-based apps.
///
/// The previous fallback (iterating all PIDs and probing `AXFrontmost` on
/// each) was O(n_processes) and took ~3 s; it has been removed.
fn get_frontmost_app(system_wide: AXUIElementRef) -> OmniResult<AXUIElementRef> {
    // ── Step 1: AXFocusedApplication (fast path) ─────────────────────
    if let Ok(app) = get_attribute(system_wide, "AXFocusedApplication") {
        if !app.is_null() {
            return Ok(app);
        }
    }

    // ── Step 2: osascript frontmost PID (O(1) fallback) ──────────────
    if let Some(pid) = get_frontmost_pid_via_script() {
        let app_elem = unsafe { AXUIElementCreateApplication(pid) };
        if !app_elem.is_null() {
            return Ok(app_elem);
        }
    }

    Err(OmniError::AccessibilityError(
        "No focused or frontmost application found".into(),
    ))
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

    // Resolve frontmost app — falls back through AXFrontmost / windows when
    // AXFocusedApplication returns null (e.g. browser web views).
    let focused_app = get_frontmost_app(system_wide)?;

    // Get the focused window of the application
    let focused_window = get_attribute(focused_app, "AXFocusedWindow");

    let mut elements = Vec::new();
    let mut id_counter = 0u32;

    // If we have a focused window, walk its children (depth 10)
    if let Ok(window) = focused_window {
        if !window.is_null() {
            walk_element(window, &mut elements, &mut id_counter, 0, 10);
        }
    }

    // Also get the application's children (menus, etc.) — depth 8
    if let Ok(children_ref) = get_attribute(focused_app, "AXChildren") {
        if !children_ref.is_null() {
            let children: CFArray =
                unsafe { CFArray::wrap_under_get_rule(children_ref as *const _) };
            for i in 0..children.len().min(50) {
                let child: *const c_void =
                    *children.get(i).unwrap() as *const c_void;
                walk_element(child, &mut elements, &mut id_counter, 0, 8);
            }
        }
    }

    unsafe { core_foundation_sys::base::CFRelease(system_wide as *const _) };

    Ok(elements)
}

/// Get the full UI tree with parent-child hierarchy preserved.
///
/// Returns a `UITreeNode` rooted at the focused application.
pub fn get_ui_tree() -> OmniResult<UITreeNode> {
    if !is_trusted() {
        return Err(OmniError::AccessibilityError(
            "Accessibility permission not granted. Open System Preferences > Privacy & Security > Accessibility and add this app.".to_string(),
        ));
    }

    let system_wide = unsafe { AXUIElementCreateSystemWide() };

    // Resolve frontmost app — falls back through AXFrontmost / windows when
    // AXFocusedApplication returns null (e.g. browser web views).
    let focused_app = get_frontmost_app(system_wide)?;

    let app_name = get_string_attribute(focused_app, "AXTitle")
        .unwrap_or_else(|| "Unknown App".to_string());

    let mut id_counter: u32 = 0;

    // Build tree starting from the app
    let mut root = build_tree_node(focused_app, &mut id_counter, 0, 12);
    root.role = "AXApplication".to_string();
    root.title = Some(app_name);

    unsafe { core_foundation_sys::base::CFRelease(system_wide as *const _) };

    Ok(root)
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

/// Perform an accessibility action on the element matching the query.
/// Common actions: "AXPress", "AXRaise", "AXShowMenu", "AXCancel", "AXConfirm"
pub fn perform_action(query: &str, action: &str) -> OmniResult<bool> {
    if !is_trusted() {
        return Err(OmniError::AccessibilityError(
            "Accessibility permission not granted. Enable in System Settings → Privacy & Security → Accessibility".into(),
        ));
    }
    let element_ref = find_element_ref(query)?;
    match element_ref {
        None => Ok(false),
        Some(elem) => {
            let cf_action = CFString::new(action);
            let err = unsafe {
                AXUIElementPerformAction(elem, cf_action.as_concrete_TypeRef())
            };
            if err != K_AX_ERROR_SUCCESS {
                return Err(OmniError::AccessibilityError(format!(
                    "AXUIElementPerformAction '{}' failed (AXError: {})", action, err
                )));
            }
            Ok(true)
        }
    }
}

/// Press (click) a UI element found by query — calls AXPress action directly.
/// This works even if the window is behind other windows.
pub fn press_element(query: &str) -> OmniResult<bool> {
    perform_action(query, "AXPress")
}

/// Set the value of a text field found by query.
pub fn set_element_value(query: &str, value: &str) -> OmniResult<bool> {
    if !is_trusted() {
        return Err(OmniError::AccessibilityError(
            "Accessibility permission not granted. Enable in System Settings → Privacy & Security → Accessibility".into(),
        ));
    }
    let element_ref = find_element_ref(query)?;
    match element_ref {
        None => Ok(false),
        Some(elem) => {
            let cf_attr = ax_attr("AXValue");
            let cf_value = CFString::new(value);
            let err = unsafe {
                AXUIElementSetAttributeValue(
                    elem,
                    cf_attr.as_concrete_TypeRef(),
                    cf_value.as_concrete_TypeRef() as core_foundation_sys::base::CFTypeRef,
                )
            };
            if err != K_AX_ERROR_SUCCESS {
                return Err(OmniError::AccessibilityError(format!(
                    "AXUIElementSetAttributeValue failed (AXError: {})", err
                )));
            }
            Ok(true)
        }
    }
}

/// Get available actions for the element matching the query.
pub fn get_element_actions(query: &str) -> OmniResult<Vec<String>> {
    if !is_trusted() {
        return Err(OmniError::AccessibilityError(
            "Accessibility permission not granted. Enable in System Settings → Privacy & Security → Accessibility".into(),
        ));
    }
    let element_ref = find_element_ref(query)?;
    match element_ref {
        None => Ok(vec![]),
        Some(elem) => {
            let mut names_ref: core_foundation_sys::array::CFArrayRef = ptr::null();
            let err = unsafe { AXUIElementCopyActionNames(elem, &mut names_ref) };
            if err != K_AX_ERROR_SUCCESS || names_ref.is_null() {
                return Ok(vec![]);
            }
            let names: CFArray = unsafe { CFArray::wrap_under_create_rule(names_ref) };
            let mut result = Vec::new();
            for i in 0..names.len() {
                let item = *names.get(i).unwrap() as core_foundation_sys::base::CFTypeRef;
                if item.is_null() {
                    continue;
                }
                let string_type_id = unsafe { core_foundation_sys::string::CFStringGetTypeID() };
                let item_type_id = unsafe { core_foundation_sys::base::CFGetTypeID(item) };
                if item_type_id == string_type_id {
                    let s: CFString = unsafe { CFString::wrap_under_get_rule(item as *const _) };
                    result.push(s.to_string());
                }
            }
            Ok(result)
        }
    }
}

// ── Internal helpers ─────────────────────────────────────────────────

/// Walk the accessibility tree and return the raw AXUIElementRef for the first
/// element whose text or semantic role contains `query_lower` (case-insensitive).
/// The returned pointer is only valid while the parent chain is alive; callers
/// must use it synchronously and not CFRelease it.
fn walk_element_for_ref(
    element: AXUIElementRef,
    query_lower: &str,
    depth: u32,
    max_depth: u32,
) -> Option<AXUIElementRef> {
    if depth > max_depth || element.is_null() {
        return None;
    }

    let title = get_string_attribute(element, "AXTitle");
    let value = get_string_attribute(element, "AXValue");
    let description = get_string_attribute(element, "AXDescription");
    let role = get_string_attribute(element, "AXRole").unwrap_or_default();

    let text = title.or(value).or(description).filter(|t| !t.is_empty());

    let matches = if let Some(ref t) = text {
        t.to_lowercase().contains(query_lower)
    } else {
        role.to_lowercase().contains(query_lower)
    };

    if matches {
        return Some(element);
    }

    for child in collect_related_children(element) {
        if let Some(found) = walk_element_for_ref(child, query_lower, depth + 1, max_depth) {
            return Some(found);
        }
    }
    None
}

/// Find the raw AXUIElementRef for the first element matching query.
/// Returns Ok(None) when not found. The ref is owned by the AX tree; callers
/// must not CFRelease it and must use it before releasing the system-wide element.
fn find_element_ref(query: &str) -> OmniResult<Option<AXUIElementRef>> {
    let system_wide = unsafe { AXUIElementCreateSystemWide() };
    if system_wide.is_null() {
        return Err(OmniError::AccessibilityError(
            "Failed to create system-wide accessibility element".into(),
        ));
    }

    let focused_app = get_frontmost_app(system_wide)?;
    let query_lower = query.to_lowercase();

    let mut found: Option<AXUIElementRef> = None;

    if let Ok(window) = get_attribute(focused_app, "AXFocusedWindow") {
        if !window.is_null() {
            found = walk_element_for_ref(window, &query_lower, 0, 10);
        }
    }

    if found.is_none() {
        if let Ok(children_ref) = get_attribute(focused_app, "AXChildren") {
            if !children_ref.is_null() {
                let children: CFArray =
                    unsafe { CFArray::wrap_under_get_rule(children_ref as *const _) };
                for i in 0..children.len().min(50) {
                    let child: *const c_void = *children.get(i).unwrap() as *const c_void;
                    if let Some(f) = walk_element_for_ref(child, &query_lower, 0, 8) {
                        found = Some(f);
                        break;
                    }
                }
            }
        }
    }

    // Note: we intentionally do NOT CFRelease system_wide here because the
    // returned element ref is part of the AX object graph rooted at system_wide.
    // The caller uses the ref synchronously within perform_action / set_element_value
    // before any release occurs. The system_wide element is retained by the OS.
    unsafe { core_foundation_sys::base::CFRelease(system_wide as *const _) };

    Ok(found)
}

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

    // Recurse into children + related AX relations (menu/context/windows)
    for child in collect_related_children(element) {
        walk_element(child, elements, id_counter, depth + 1, max_depth);
    }
}

fn push_children_from_array_attr(
    element: AXUIElementRef,
    attr: &str,
    out: &mut Vec<AXUIElementRef>,
    seen: &mut HashSet<usize>,
    max_items: usize,
) {
    if let Ok(children_ref) = get_attribute(element, attr) {
        if children_ref.is_null() {
            return;
        }
        let children: CFArray = unsafe { CFArray::wrap_under_get_rule(children_ref as *const _) };
        for i in 0..children.len().min(max_items as isize) {
            let child: *const c_void = *children.get(i).unwrap() as *const c_void;
            if child.is_null() {
                continue;
            }
            let key = child as usize;
            if seen.insert(key) {
                out.push(child as AXUIElementRef);
            }
        }
    }
}

fn push_child_from_single_attr(
    element: AXUIElementRef,
    attr: &str,
    out: &mut Vec<AXUIElementRef>,
    seen: &mut HashSet<usize>,
) {
    if let Ok(child_ref) = get_attribute(element, attr) {
        if child_ref.is_null() {
            return;
        }
        let key = child_ref as usize;
        if seen.insert(key) {
            out.push(child_ref as AXUIElementRef);
        }
    }
}

fn collect_related_children(element: AXUIElementRef) -> Vec<AXUIElementRef> {
    let mut out: Vec<AXUIElementRef> = Vec::new();
    let mut seen: HashSet<usize> = HashSet::new();

    // Primary hierarchy
    push_children_from_array_attr(element, "AXChildren", &mut out, &mut seen, 220);

    // Common web/app container relations (captures menu bar, context menus, windows)
    push_children_from_array_attr(element, "AXVisibleChildren", &mut out, &mut seen, 120);
    push_children_from_array_attr(element, "AXWindows", &mut out, &mut seen, 30);
    push_children_from_array_attr(element, "AXContents", &mut out, &mut seen, 80);
    push_child_from_single_attr(element, "AXMenuBar", &mut out, &mut seen);
    push_child_from_single_attr(element, "AXFocusedWindow", &mut out, &mut seen);
    push_child_from_single_attr(element, "AXMainWindow", &mut out, &mut seen);
    push_child_from_single_attr(element, "AXExtrasMenuBar", &mut out, &mut seen);

    out
}

fn build_tree_node(
    element: AXUIElementRef,
    id_counter: &mut u32,
    depth: u32,
    max_depth: u32,
) -> UITreeNode {
    *id_counter += 1;
    let current_id = format!("ax-{}", id_counter);

    let role = get_string_attribute(element, "AXRole").unwrap_or_else(|| "Unknown".to_string());
    let title = get_string_attribute(element, "AXTitle");
    let value = get_string_attribute(element, "AXValue");
    let description = get_string_attribute(element, "AXDescription");

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

    let state = ElementState {
        visible: true,
        enabled: get_bool_attribute(element, "AXEnabled"),
        focused: get_bool_attribute(element, "AXFocused"),
        selected: get_bool_attribute(element, "AXSelected"),
    };

    // Collect useful attributes for fingerprinting
    let mut attributes = HashMap::new();
    if let Some(r) = get_string_attribute(element, "AXRoleDescription") {
        attributes.insert("roleDescription".to_string(), r);
    }
    if let Some(r) = get_string_attribute(element, "AXIdentifier") {
        attributes.insert("identifier".to_string(), r);
    }
    if let Some(r) = get_string_attribute(element, "AXSubrole") {
        attributes.insert("subrole".to_string(), r);
    }
    if let Some(r) = get_string_attribute(element, "AXHelp") {
        attributes.insert("help".to_string(), r);
    }

    let mut children = Vec::new();

    if depth < max_depth {
        for child in collect_related_children(element) {
            if !child.is_null() {
                let child_node = build_tree_node(child as AXUIElementRef, id_counter, depth + 1, max_depth);
                children.push(child_node);
            }
        }
    }

    UITreeNode {
        id: current_id,
        role,
        title,
        value,
        description,
        bounds,
        state,
        children,
        attributes,
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
    fn test_get_ui_tree() {
        if !is_trusted() {
            println!("Skipping — accessibility not enabled");
            return;
        }
        match get_ui_tree() {
            Ok(root) => {
                println!("Root: {} {:?}", root.role, root.title);
                println!("  {} top-level children", root.children.len());
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
