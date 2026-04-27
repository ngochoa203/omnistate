use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Check if the process has accessibility permissions.
#[napi]
pub fn is_accessibility_trusted() -> bool {
    #[cfg(target_os = "macos")]
    return omnistate_a11y::macos::is_trusted();

    #[cfg(not(target_os = "macos"))]
    return false;
}

/// Get all UI elements from the focused window's accessibility tree.
/// Returns a JSON array of UI elements.
#[napi]
pub fn get_ui_elements() -> Result<serde_json::Value> {
    let elements = omnistate_a11y::get_ui_elements()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::to_value(&elements)
        .map_err(|e| Error::from_reason(e.to_string()))?)
}

/// Find a UI element by text content or role query.
/// Returns a JSON object or null if not found.
#[napi]
pub fn find_element(query: String) -> Result<serde_json::Value> {
    let element = omnistate_a11y::find_element(&query)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::to_value(&element)
        .map_err(|e| Error::from_reason(e.to_string()))?)
}

/// Get the full hierarchical UI tree from the focused application.
/// Returns a JSON object with parent→children structure preserved.
#[napi]
pub fn get_ui_tree() -> Result<serde_json::Value> {
    let tree = omnistate_a11y::get_ui_tree()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::to_value(&tree)
        .map_err(|e| Error::from_reason(e.to_string()))?)
}

/// Perform an accessibility action on the element matching the query.
/// Common actions: "AXPress", "AXRaise", "AXShowMenu", "AXCancel", "AXConfirm"
#[napi]
pub fn perform_action(query: String, action: String) -> Result<bool> {
    omnistate_a11y::perform_action(&query, &action)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Press (click) a UI element found by query — calls AXPress action directly.
#[napi]
pub fn press_element(query: String) -> Result<bool> {
    omnistate_a11y::press_element(&query)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Set the value of a text field found by query.
#[napi]
pub fn set_element_value(query: String, value: String) -> Result<bool> {
    omnistate_a11y::set_element_value(&query, &value)
        .map_err(|e| Error::from_reason(e.to_string()))
}

/// Get available actions for the element matching the query.
#[napi]
pub fn get_element_actions(query: String) -> Result<Vec<String>> {
    omnistate_a11y::get_element_actions(&query)
        .map_err(|e| Error::from_reason(e.to_string()))
}
