use thiserror::Error;

#[derive(Error, Debug)]
pub enum OmniError {
    #[error("Screen capture failed: {0}")]
    CaptureError(String),

    #[error("Input control failed: {0}")]
    InputError(String),

    #[error("Accessibility query failed: {0}")]
    AccessibilityError(String),

    #[error("Platform not supported: {0}")]
    UnsupportedPlatform(String),

    #[error("Timeout after {0}ms")]
    Timeout(u64),

    #[error("Element not found: {0}")]
    ElementNotFound(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type OmniResult<T> = Result<T, OmniError>;
