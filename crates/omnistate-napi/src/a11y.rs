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
