//! Native window dimensions and best-effort rollback; no snapshot or polling ownership.
use crate::model::{ExpandedSize, Settings};

pub(crate) fn logical_size(window: &tauri::WebviewWindow) -> Result<ExpandedSize, String> {
    let size = window
        .inner_size()
        .map_err(|e| format!("Read widget dimensions: {e}"))?;
    let scale = window
        .scale_factor()
        .map_err(|e| format!("Read widget display scale: {e}"))?;
    ExpandedSize::from_physical(size.width, size.height, scale)
        .ok_or_else(|| "Invalid widget dimensions or display scale".into())
}
pub(crate) fn resize(window: &tauri::WebviewWindow, size: ExpandedSize) -> Result<(), String> {
    let size = size.bounded();
    window
        .set_size(tauri::LogicalSize::new(size.width, size.height))
        .map_err(|e| format!("Resize widget: {e}"))
}
pub(crate) fn rollback_window(
    window: &tauri::WebviewWindow,
    settings: &Settings,
    pin_changed: bool,
    size: Option<ExpandedSize>,
    mut error: String,
) -> String {
    if pin_changed {
        if let Err(e) = window.set_always_on_top(settings.always_on_top) {
            error.push_str(&format!("; restore always on top: {e}"));
        }
    }
    if let Some(size) = size {
        if let Err(e) = resize(window, size) {
            error.push_str(&format!("; restore dimensions: {e}"));
        }
    }
    error
}
