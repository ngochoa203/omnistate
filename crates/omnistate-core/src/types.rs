use serde::{Deserialize, Serialize};

/// Raw screen frame captured from GPU framebuffer or screenshot API.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frame {
    pub width: u32,
    pub height: u32,
    pub bytes_per_pixel: u8,
    /// Raw pixel data in BGRA format.
    pub data: Vec<u8>,
    /// Capture timestamp in nanoseconds since epoch.
    pub timestamp_ns: u64,
    /// Which capture method was used.
    pub capture_method: CaptureMethod,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CaptureMethod {
    /// Direct GPU framebuffer read (fastest, < 5ms).
    GpuFramebuffer,
    /// OS screenshot API (50-200ms).
    Screenshot,
    /// Single window capture (30-100ms).
    WindowCapture,
}

/// A detected UI element on screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UIElement {
    pub id: String,
    pub element_type: ElementType,
    pub bounds: Rect,
    pub text: Option<String>,
    pub state: ElementState,
    pub confidence: f32,
    pub detection_method: DetectionMethod,
    pub semantic_role: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ElementType {
    Button,
    TextField,
    Menu,
    Label,
    Image,
    List,
    Tab,
    Checkbox,
    Dropdown,
    Window,
    Unknown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ElementState {
    pub visible: bool,
    pub enabled: bool,
    pub focused: bool,
    pub selected: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DetectionMethod {
    Accessibility,
    VisionModel,
    Ocr,
    TemplateMatch,
}

/// Mouse button identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
}

/// Keyboard key identifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Key {
    Return,
    Tab,
    Space,
    Backspace,
    Delete,
    Escape,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    /// Character key (a-z, 0-9, symbols).
    Char(char),
    /// Function key (F1-F12).
    Function(u8),
    /// Modifier keys.
    Shift,
    Control,
    Alt,
    Meta,
}

/// Modifier flags for keyboard shortcuts.
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Modifiers {
    pub shift: bool,
    pub control: bool,
    pub alt: bool,
    pub meta: bool,
}

/// Information about a running process.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub cpu_percent: f32,
    pub memory_bytes: u64,
}

/// System health snapshot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthSnapshot {
    pub cpu_usage_percent: f32,
    pub memory_used_bytes: u64,
    pub memory_total_bytes: u64,
    pub disk_used_bytes: u64,
    pub disk_total_bytes: u64,
    pub uptime_seconds: u64,
}

/// The platform we are running on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Platform {
    MacOS,
    Windows,
    Linux,
}

impl Platform {
    pub fn current() -> Self {
        if cfg!(target_os = "macos") {
            Platform::MacOS
        } else if cfg!(target_os = "windows") {
            Platform::Windows
        } else {
            Platform::Linux
        }
    }
}
