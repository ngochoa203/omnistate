use napi::bindgen_prelude::*;
use napi_derive::napi;

const SERVICE_NAME: &str = "com.omnistate.secrets";

/// Store a secret in the macOS Keychain.
/// Uses the generic password API with service="com.omnistate.secrets".
#[napi]
pub fn keychain_set(key: String, value: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::{delete_generic_password, set_generic_password};
        // Delete existing entry first (set_generic_password fails if it exists)
        let _ = delete_generic_password(SERVICE_NAME, &key);
        set_generic_password(SERVICE_NAME, &key, value.as_bytes())
            .map_err(|e| Error::from_reason(format!("Keychain set failed: {e}")))?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    Err(Error::from_reason("Keychain is only available on macOS"))
}

/// Retrieve a secret from the macOS Keychain.
/// Returns null if the key doesn't exist.
#[napi]
pub fn keychain_get(key: String) -> Result<Option<String>> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::get_generic_password;
        match get_generic_password(SERVICE_NAME, &key) {
            Ok(bytes) => {
                let s = String::from_utf8(bytes.to_vec())
                    .map_err(|e| Error::from_reason(format!("Invalid UTF-8 in keychain: {e}")))?;
                Ok(Some(s))
            }
            Err(_) => Ok(None),
        }
    }
    #[cfg(not(target_os = "macos"))]
    Ok(None)
}

/// Delete a secret from the macOS Keychain.
/// Returns true if the key existed and was deleted.
#[napi]
pub fn keychain_delete(key: String) -> Result<bool> {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::delete_generic_password;
        match delete_generic_password(SERVICE_NAME, &key) {
            Ok(()) => Ok(true),
            Err(_) => Ok(false),
        }
    }
    #[cfg(not(target_os = "macos"))]
    Ok(false)
}

/// Check if a key exists in the Keychain (without retrieving the value).
#[napi]
pub fn keychain_has(key: String) -> bool {
    #[cfg(target_os = "macos")]
    {
        use security_framework::passwords::get_generic_password;
        get_generic_password(SERVICE_NAME, &key).is_ok()
    }
    #[cfg(not(target_os = "macos"))]
    false
}
