use napi_derive::napi;

/// Check all TCC permissions at once. Returns a JSON object with each permission status.
#[napi]
pub fn preflight_permissions() -> serde_json::Value {
    serde_json::json!({
        "accessibility": preflight_accessibility(),
        "screenCapture": preflight_screen_capture(),
        "microphone": preflight_microphone(),
    })
}

/// Check if accessibility (AX) permission is granted.
#[napi]
pub fn preflight_accessibility() -> bool {
    #[cfg(target_os = "macos")]
    {
        unsafe extern "C" {
            fn AXIsProcessTrusted() -> bool;
        }
        unsafe { AXIsProcessTrusted() }
    }
    #[cfg(not(target_os = "macos"))]
    false
}

/// Check if screen capture permission is granted (macOS 10.15+).
/// Uses CGPreflightScreenCaptureAccess which does NOT prompt the user.
#[napi]
pub fn preflight_screen_capture() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        unsafe extern "C" {
            fn CGPreflightScreenCaptureAccess() -> bool;
        }
        unsafe { CGPreflightScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// Request screen capture permission (shows the system dialog if not yet decided).
/// Returns true if permission was already granted.
#[napi]
pub fn request_screen_capture() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "CoreGraphics", kind = "framework")]
        unsafe extern "C" {
            fn CGRequestScreenCaptureAccess() -> bool;
        }
        unsafe { CGRequestScreenCaptureAccess() }
    }
    #[cfg(not(target_os = "macos"))]
    true
}

/// Check if microphone permission is granted.
/// Uses AVCaptureDevice authorization status check.
/// Returns: "authorized" | "denied" | "restricted" | "notDetermined" | "unknown"
#[napi]
pub fn preflight_microphone() -> String {
    #[cfg(target_os = "macos")]
    {
        // Use osascript to check AVFoundation auth status since direct FFI to
        // AVCaptureDevice is complex (ObjC runtime). This is a preflight check
        // so ~50ms is acceptable.
        let output = std::process::Command::new("osascript")
            .args([
                "-l",
                "JavaScript",
                "-e",
                "ObjC.import('AVFoundation'); \
                 const status = $.AVCaptureDevice.authorizationStatusForMediaType($.AVMediaTypeAudio); \
                 if (status === 0) 'notDetermined'; \
                 else if (status === 1) 'restricted'; \
                 else if (status === 2) 'denied'; \
                 else if (status === 3) 'authorized'; \
                 else 'unknown';",
            ])
            .output();
        match output {
            Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
            Err(_) => "unknown".to_string(),
        }
    }
    #[cfg(not(target_os = "macos"))]
    "authorized".to_string()
}
