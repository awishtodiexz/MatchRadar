//! Native window dimensions, off-screen recovery, and best-effort rollback.
//!
//! Placement is a pure function over physical-pixel rectangles, so recovery is
//! deterministic and testable without a display server; the wrapper below only
//! reads monitors and applies the result.
use crate::model::{ExpandedSize, Settings};
use tauri::{PhysicalPosition, PhysicalRect, WebviewWindow};

/// A smaller overlap is not a usable grab target for a compact widget.
const MIN_VISIBLE_WIDTH: i64 = 64;
const MIN_VISIBLE_HEIGHT: i64 = 48;

/// A physical-pixel rectangle, kept wider than the native types to avoid math overflow.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Bounds {
    pub(crate) x: i64,
    pub(crate) y: i64,
    pub(crate) width: i64,
    pub(crate) height: i64,
}

impl Bounds {
    pub(crate) fn new(x: i64, y: i64, width: i64, height: i64) -> Self {
        Self {
            x,
            y,
            width: width.max(0),
            height: height.max(0),
        }
    }

    fn right(self) -> i64 {
        self.x.saturating_add(self.width)
    }

    fn bottom(self) -> i64 {
        self.y.saturating_add(self.height)
    }

    /// Overlap dimensions with another rectangle, or `None` when they do not touch.
    fn overlap(self, other: Self) -> Option<(i64, i64)> {
        let width = self
            .right()
            .min(other.right())
            .saturating_sub(self.x.max(other.x));
        let height = self
            .bottom()
            .min(other.bottom())
            .saturating_sub(self.y.max(other.y));
        (width > 0 && height > 0).then_some((width, height))
    }

    fn is_usable_on(self, monitor: Self) -> bool {
        self.overlap(monitor).is_some_and(|(width, height)| {
            width >= MIN_VISIBLE_WIDTH && height >= MIN_VISIBLE_HEIGHT
        })
    }
}

fn clamp_to_position(value: i64) -> i32 {
    value.clamp(i64::from(i32::MIN), i64::from(i32::MAX)) as i32
}

/// Returns the top-left position that brings a lost widget back onto a display,
/// or `None` when the current placement is already reachable.
///
/// The window is centered in the primary monitor's work area. If the primary
/// monitor is not attached, the monitor that still overlaps the widget wins;
/// otherwise the first available monitor is used. Oversized widgets are pinned
/// to the work area's top-left so they remain movable.
pub(crate) fn placement(
    window: Bounds,
    monitors: &[Bounds],
    primary: Option<Bounds>,
) -> Option<(i32, i32)> {
    if monitors.is_empty() || monitors.iter().any(|m| window.is_usable_on(*m)) {
        return None;
    }
    let target = primary
        .filter(|p| monitors.contains(p))
        .or_else(|| best_monitor(window, monitors))
        .or_else(|| monitors.first().copied())?;
    let x = target.x + (target.width - window.width).max(0) / 2;
    let y = target.y + (target.height - window.height).max(0) / 2;
    Some((clamp_to_position(x), clamp_to_position(y)))
}

fn best_monitor(window: Bounds, monitors: &[Bounds]) -> Option<Bounds> {
    let area = |monitor: &Bounds| {
        window
            .overlap(*monitor)
            .map_or(0, |(width, height)| width.saturating_mul(height))
    };
    let mut best = *monitors.first()?;
    let mut best_area = area(&best);
    for monitor in &monitors[1..] {
        let monitor_area = area(monitor);
        if monitor_area > best_area {
            best = *monitor;
            best_area = monitor_area;
        }
    }
    Some(best)
}

fn monitor_bounds(rect: &PhysicalRect<i32, u32>) -> Bounds {
    Bounds::new(
        i64::from(rect.position.x),
        i64::from(rect.position.y),
        i64::from(rect.size.width),
        i64::from(rect.size.height),
    )
}

/// Re-centers the widget when no monitor shows a usable part of it.
///
/// Runs after window-state restoration, on focus/scale changes, and from the
/// placement watchdog, because Windows can lose a display without a window
/// event. Hidden or minimized windows are left alone; showing them triggers a
/// focus check.
pub(crate) fn ensure_visible(window: &WebviewWindow) -> Result<bool, String> {
    if window.is_minimized().unwrap_or(false) || !window.is_visible().unwrap_or(true) {
        return Ok(false);
    }
    let position = window
        .outer_position()
        .map_err(|e| format!("Read widget position: {e}"))?;
    let size = window
        .outer_size()
        .map_err(|e| format!("Read widget size: {e}"))?;
    let current = Bounds::new(
        i64::from(position.x),
        i64::from(position.y),
        i64::from(size.width),
        i64::from(size.height),
    );
    let monitors: Vec<Bounds> = window
        .available_monitors()
        .map_err(|e| format!("List displays: {e}"))?
        .iter()
        .map(|monitor| monitor_bounds(monitor.work_area()))
        .collect();
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_bounds(monitor.work_area()));
    let Some((x, y)) = placement(current, &monitors, primary) else {
        return Ok(false);
    };
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| format!("Move widget on screen: {e}"))?;
    Ok(true)
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i64, y: i64, width: i64, height: i64) -> Bounds {
        Bounds::new(x, y, width, height)
    }

    fn widget_390x700(x: i64, y: i64) -> Bounds {
        rect(x, y, 390, 700)
    }

    fn primary() -> Bounds {
        rect(0, 0, 1920, 1040)
    }

    #[test]
    fn lost_window_is_centered_on_primary_work_area() {
        let placement = placement(widget_390x700(-4000, -500), &[primary()], Some(primary()));
        assert_eq!(placement, Some((765, 170)));
    }

    #[test]
    fn window_with_a_usable_patch_is_not_moved() {
        // 220px of the widget remains on screen: the user can still grab it.
        assert_eq!(
            placement(widget_390x700(1700, 100), &[primary()], Some(primary())),
            None
        );
        // Fully on screen, including negative-origin secondary monitors.
        let secondary = rect(-1920, 0, 1920, 1040);
        assert_eq!(
            placement(
                widget_390x700(-1000, 100),
                &[secondary, primary()],
                Some(primary())
            ),
            None
        );
    }

    #[test]
    fn a_sliver_at_the_screen_edge_is_recovered() {
        // 20px is visible but too small to be a reliable grab target.
        assert_eq!(
            placement(widget_390x700(1900, 100), &[primary()], Some(primary())),
            Some((765, 170))
        );
        // An overlap shorter than the minimum height is also lost.
        assert_eq!(
            placement(widget_390x700(300, 1020), &[primary()], Some(primary())),
            Some((765, 170))
        );
    }

    #[test]
    fn a_window_spanning_two_displays_stays_put() {
        let right = rect(1920, 0, 1920, 1040);
        assert_eq!(
            placement(
                widget_390x700(1800, 100),
                &[primary(), right],
                Some(primary())
            ),
            None
        );
    }

    #[test]
    fn detached_primary_falls_back_to_the_remaining_monitor() {
        let remaining = rect(-1600, 0, 1600, 900);
        let detached = rect(5000, 0, 1920, 1040);
        assert_eq!(
            placement(widget_390x700(4000, 300), &[remaining], Some(detached)),
            Some((-995, 100))
        );
    }

    #[test]
    fn oversized_window_is_pinned_to_the_work_area_origin() {
        assert_eq!(
            placement(rect(5000, 5000, 3000, 2000), &[primary()], Some(primary())),
            Some((0, 0))
        );
        // Taller than the work area: center horizontally, pin to the top.
        assert_eq!(
            placement(rect(3000, 0, 390, 1400), &[primary()], Some(primary())),
            Some((765, 0))
        );
    }

    #[test]
    fn offscreen_window_uses_taskbar_aware_work_area() {
        let work_area = rect(0, 0, 1920, 1000);
        assert_eq!(
            placement(widget_390x700(3000, 3000), &[work_area], Some(work_area)),
            Some((765, 150))
        );
    }

    #[test]
    fn no_monitors_never_moves_the_window() {
        assert_eq!(placement(widget_390x700(4000, 4000), &[], None), None);
    }

    #[test]
    fn recovered_placement_is_stable() {
        let monitors = [primary()];
        let Some((x, y)) = placement(widget_390x700(-4000, -500), &monitors, Some(primary()))
        else {
            panic!("expected recovery");
        };
        let moved = widget_390x700(i64::from(x), i64::from(y));
        assert_eq!(placement(moved, &monitors, Some(primary())), None);
    }
}
