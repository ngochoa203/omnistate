use core_foundation::base::{CFType, TCFType};
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::CFString;
use core_graphics::display::{
    kCGNullWindowID, kCGWindowImageBestResolution, kCGWindowImageDefault,
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionIncludingWindow,
    kCGWindowListOptionOnScreenOnly, CGDisplay, CGRectNull, CGWindowID,
};
use core_graphics::geometry::CGRect;
use core_graphics::image::CGImage;
use omnistate_core::error::{OmniError, OmniResult};
use omnistate_core::{CaptureMethod, Frame, Rect};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use crate::WindowInfo;

// CoreGraphics window info dictionary keys
const K_CG_WINDOW_NUMBER: &str = "kCGWindowNumber";
const K_CG_WINDOW_NAME: &str = "kCGWindowName";
const K_CG_WINDOW_OWNER_NAME: &str = "kCGWindowOwnerName";
const K_CG_WINDOW_BOUNDS: &str = "kCGWindowBounds";
const K_CG_WINDOW_IS_ON_SCREEN: &str = "kCGWindowIsOnScreen";

/// Capture the entire main display using CGDisplay.
///
/// Uses `CGDisplayCreateImage` — typically 50-200ms.
/// For sub-10ms capture, a future implementation will use
/// IOSurface for direct GPU framebuffer access.
pub fn capture_screen() -> OmniResult<Frame> {
    let display = CGDisplay::main();
    let cg_image = display
        .image()
        .ok_or_else(|| OmniError::CaptureError("Failed to capture main display".into()))?;

    cg_image_to_frame(cg_image, CaptureMethod::Screenshot)
}

/// Capture a specific window by its CGWindowID.
///
/// Uses `CGWindowListCreateImage` with the window's ID to capture
/// only that window, including offscreen portions.
pub fn capture_window(window_id: u32) -> OmniResult<Frame> {
    let bounds = unsafe { CGRectNull };
    let cg_image = CGDisplay::screenshot(
        bounds,
        kCGWindowListOptionIncludingWindow,
        window_id as CGWindowID,
        kCGWindowImageBestResolution | kCGWindowImageDefault,
    )
    .ok_or_else(|| {
        OmniError::CaptureError(format!("Failed to capture window {window_id}"))
    })?;

    cg_image_to_frame(cg_image, CaptureMethod::WindowCapture)
}

/// Capture a rectangular region of the screen.
///
/// This is significantly faster than full screen capture because
/// fewer pixels need to be composited and copied.
pub fn capture_region(x: f64, y: f64, width: f64, height: f64) -> OmniResult<Frame> {
    let bounds = CGRect::new(
        &core_graphics::geometry::CGPoint::new(x, y),
        &core_graphics::geometry::CGSize::new(width, height),
    );

    let cg_image = CGDisplay::screenshot(
        bounds,
        kCGWindowListOptionOnScreenOnly,
        kCGNullWindowID,
        kCGWindowImageDefault,
    )
    .ok_or_else(|| OmniError::CaptureError("Failed to capture screen region".into()))?;

    cg_image_to_frame(cg_image, CaptureMethod::Screenshot)
}

/// List all on-screen windows with their metadata.
///
/// Uses `CGWindowListCopyWindowInfo` to query the window server,
/// then parses each CFDictionary entry into a WindowInfo struct.
pub fn list_windows() -> OmniResult<Vec<WindowInfo>> {
    let option = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;
    let cf_array = CGDisplay::window_list_info(option, None)
        .ok_or_else(|| OmniError::CaptureError("Failed to get window list".into()))?;

    let mut windows = Vec::new();

    for i in 0..cf_array.len() {
        // Each element is a CFDictionary with window properties
        let dict_ref: CFType = unsafe { CFType::wrap_under_get_rule(*cf_array.get(i).unwrap()) };

        // Safe downcast to CFDictionary
        let dict: CFDictionary = unsafe {
            CFDictionary::wrap_under_get_rule(dict_ref.as_CFTypeRef() as *const _)
        };

        let info = parse_window_dict(&dict);
        if let Some(info) = info {
            // Filter out windows with empty names/owners (system windows)
            if !info.owner.is_empty() {
                windows.push(info);
            }
        }
    }

    Ok(windows)
}

/// Benchmark screen capture latency.
/// Returns (full_screen_ms, region_ms) averaged over `iterations`.
pub fn benchmark_capture(iterations: u32) -> (f64, f64) {
    // Full screen benchmark
    let mut full_total = 0.0;
    for _ in 0..iterations {
        let start = Instant::now();
        let _ = capture_screen();
        full_total += start.elapsed().as_secs_f64() * 1000.0;
    }
    let full_avg = full_total / iterations as f64;

    // Region benchmark (center 400x300 region)
    let mut region_total = 0.0;
    for _ in 0..iterations {
        let start = Instant::now();
        let _ = capture_region(500.0, 300.0, 400.0, 300.0);
        region_total += start.elapsed().as_secs_f64() * 1000.0;
    }
    let region_avg = region_total / iterations as f64;

    (full_avg, region_avg)
}

fn parse_window_dict(dict: &CFDictionary) -> Option<WindowInfo> {
    let id = get_number(dict, K_CG_WINDOW_NUMBER)? as u32;
    let title = get_string(dict, K_CG_WINDOW_NAME).unwrap_or_default();
    let owner = get_string(dict, K_CG_WINDOW_OWNER_NAME).unwrap_or_default();
    let is_on_screen = get_number(dict, K_CG_WINDOW_IS_ON_SCREEN).unwrap_or(0) != 0;
    let bounds = get_bounds(dict, K_CG_WINDOW_BOUNDS).unwrap_or(Rect {
        x: 0.0,
        y: 0.0,
        width: 0.0,
        height: 0.0,
    });

    Some(WindowInfo {
        id,
        title,
        owner,
        bounds,
        is_on_screen,
    })
}

fn get_string(dict: &CFDictionary, key: &str) -> Option<String> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_CFType().as_CFTypeRef())?;
    let cf_str: CFString = unsafe { CFString::wrap_under_get_rule(*value as *const _) };
    Some(cf_str.to_string())
}

fn get_number(dict: &CFDictionary, key: &str) -> Option<i64> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_CFType().as_CFTypeRef())?;
    let cf_num: CFNumber = unsafe { CFNumber::wrap_under_get_rule(*value as *const _) };
    cf_num.to_i64()
}

fn get_bounds(dict: &CFDictionary, key: &str) -> Option<Rect> {
    let cf_key = CFString::new(key);
    let value = dict.find(cf_key.as_CFType().as_CFTypeRef())?;
    let bounds_dict: CFDictionary = unsafe {
        CFDictionary::wrap_under_get_rule(*value as *const _)
    };

    let x = get_number(&bounds_dict, "X").unwrap_or(0) as f64;
    let y = get_number(&bounds_dict, "Y").unwrap_or(0) as f64;
    let width = get_number(&bounds_dict, "Width").unwrap_or(0) as f64;
    let height = get_number(&bounds_dict, "Height").unwrap_or(0) as f64;

    Some(Rect {
        x,
        y,
        width,
        height,
    })
}

fn cg_image_to_frame(image: CGImage, method: CaptureMethod) -> OmniResult<Frame> {
    let width = image.width() as u32;
    let height = image.height() as u32;
    let bytes_per_row = image.bytes_per_row();
    let raw_data = image.data();
    let bytes: &[u8] = raw_data.bytes();

    // CGImage may have padding per row — copy only the pixel data.
    let bytes_per_pixel = 4u8; // BGRA
    let expected_row_bytes = (width as usize) * (bytes_per_pixel as usize);
    let mut data = Vec::with_capacity((width * height * bytes_per_pixel as u32) as usize);

    for row in 0..height as usize {
        let start = row * bytes_per_row;
        let end = start + expected_row_bytes;
        if end <= bytes.len() {
            data.extend_from_slice(&bytes[start..end]);
        }
    }

    let timestamp_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;

    Ok(Frame {
        width,
        height,
        bytes_per_pixel,
        data,
        timestamp_ns,
        capture_method: method,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_capture_screen() {
        let frame = capture_screen().expect("Screen capture should succeed");
        assert!(frame.width > 0);
        assert!(frame.height > 0);
        assert_eq!(frame.bytes_per_pixel, 4);
        assert!(!frame.data.is_empty());
        assert_eq!(
            frame.data.len(),
            (frame.width * frame.height * 4) as usize
        );
    }

    #[test]
    fn test_list_windows() {
        let windows = list_windows().expect("Window listing should succeed");
        // There should be at least one window on a running macOS system
        println!("Found {} windows", windows.len());
        for w in &windows {
            println!("  [{}] {} — {}", w.id, w.owner, w.title);
        }
    }

    #[test]
    fn test_capture_region() {
        let frame = capture_region(0.0, 0.0, 100.0, 100.0)
            .expect("Region capture should succeed");
        assert!(frame.width > 0);
        assert!(frame.height > 0);
    }

    #[test]
    fn test_benchmark() {
        let (full_ms, region_ms) = benchmark_capture(5);
        println!("Full screen: {full_ms:.1}ms, Region: {region_ms:.1}ms");
        // Region should generally be faster
        assert!(full_ms > 0.0);
        assert!(region_ms > 0.0);
    }
}
