use napi::bindgen_prelude::*;
use napi_derive::napi;

/// Get all UI elements from the focused window's accessibility tree.
#[napi]
pub fn get_ui_elements() -> Result<serde_json::Value> {
    let elements = omnistate_a11y::get_ui_elements()
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::to_value(&elements)
        .map_err(|e| Error::from_reason(e.to_string()))?)
}

/// Find a UI element by text content or role query.
#[napi]
pub fn find_element(query: String) -> Result<serde_json::Value> {
    let element = omnistate_a11y::find_element(&query)
        .map_err(|e| Error::from_reason(e.to_string()))?;

    Ok(serde_json::to_value(&element)
        .map_err(|e| Error::from_reason(e.to_string()))?)
}
