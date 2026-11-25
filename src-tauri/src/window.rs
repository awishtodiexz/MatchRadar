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
/// The widget is frameless and can only be moved by dragging its 48px header,
/// so a rectangle whose top edge is above the display is not recoverable by the
/// user even when plenty of the body remains visible. A small tolerance keeps an
/// almost-flush window (and normal DWM frame/monitor differences) untouched.
const HEADER_TOLERANCE: i64 = 24;

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
        // The header (drag region) runs along the top edge. If that edge is above
        // the monitor, the visible part of the widget cannot be dragged back.
        let header_reachable = self.y >= monitor.y.saturating_sub(HEADER_TOLERANCE);
        header_reachable
            && self.overlap(monitor).is_some_and(|(width, height)| {
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

fn maximum_size(area: Bounds, scale: f64, frame_width: u32, frame_height: u32) -> (u32, u32) {
    let width = ((600.0 * scale) as u32).min((area.width as u32).saturating_sub(frame_width));
    let height = ((1100.0 * scale) as u32).min((area.height as u32).saturating_sub(frame_height));
    (width.max(1), height.max(1))
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
    if let Some(monitor) = window.current_monitor().ok().flatten() {
        let inner = window
            .inner_size()
            .map_err(|e| format!("Read widget content size: {e}"))?;
        let area = monitor_bounds(monitor.work_area());
        let maximum = maximum_size(
            area,
            monitor.scale_factor(),
            size.width.saturating_sub(inner.width),
            size.height.saturating_sub(inner.height),
        );
        window
            .set_max_size(Some(tauri::PhysicalSize::new(maximum.0, maximum.1)))
            .map_err(|e| format!("Limit widget to display work area: {e}"))?;
    }
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
pub(crate) fn logical_size_unbounded(window: &tauri::WebviewWindow) -> Result<ExpandedSize, String> {
    let size = window
        .inner_size()
        .map_err(|e| format!("Read widget dimensions: {e}"))?;
    let scale = window
        .scale_factor()
        .map_err(|e| format!("Read widget display scale: {e}"))?;
    ExpandedSize::from_physical_unbounded(size.width, size.height, scale)
        .ok_or_else(|| "Invalid widget dimensions or display scale".into())
}
// The window-state plugin can restore a size the app would never choose, such
// as ticker mode's 112px strip. `current` is the unbounded logical size, so a
// value outside ExpandedSize's bounds marks an out-of-range restore; the
// persisted expanded size is the preferred target. When the floor had to raise
// either axis, the restore is another mode's dimensions: its other axis is not
// the user's expanded dimension either, so fall back to the default. An
// over-ceiling restore still carries real expanded dimensions and is only
// clamped.
pub(crate) fn restore_target(
    current: ExpandedSize,
    persisted: Option<ExpandedSize>,
) -> Option<ExpandedSize> {
    let bounded = current.bounded();
    if current == bounded {
        return None;
    }
    let fallback = if current.width < bounded.width || current.height < bounded.height {
        ExpandedSize::default()
    } else {
        current
    };
    Some(persisted.unwrap_or(fallback).bounded())
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
    fn restore_target_only_fires_for_out_of_bounds_restores() {
        let ticker = ExpandedSize {
            width: 390.0,
            height: 112.0,
        };
        // A ticker strip's dimensions are not expanded dimensions: with no
        // persisted expanded size the target is the default, not the strip's
        // width under the expanded floor.
        assert_eq!(restore_target(ticker, None), Some(ExpandedSize::default()));
        assert_eq!(
            restore_target(
                ExpandedSize {
                    width: 420.0,
                    height: 112.0
                },
                None
            ),
            Some(ExpandedSize::default())
        );
        // A DPI squeeze below the 320px width floor is foreign geometry too:
        // keeping the 320px clamp would invent a width the user never set.
        assert_eq!(
            restore_target(
                ExpandedSize {
                    width: 260.0,
                    height: 466.7
                },
                None
            ),
            Some(ExpandedSize::default())
        );
        assert_eq!(
            restore_target(
                ticker,
                Some(ExpandedSize {
                    width: 390.0,
                    height: 700.0
                })
            ),
            Some(ExpandedSize {
                width: 390.0,
                height: 700.0
            })
        );
        assert_eq!(
            restore_target(
                ExpandedSize {
                    width: 390.0,
                    height: 700.0
                },
                Some(ExpandedSize {
                    width: 390.0,
                    height: 460.0
                })
            ),
            None
        );
        assert_eq!(
            restore_target(
                ExpandedSize {
                    width: 390.0,
                    height: 1300.0
                },
                None
            ),
            Some(ExpandedSize {
                width: 390.0,
                height: 1100.0
            })
        );
    }

    #[test]
    fn maximum_dimensions_fit_the_work_area_and_frame() {
        assert_eq!(maximum_size(primary(), 1.0, 16, 9), (600, 1031));
        assert_eq!(
            maximum_size(rect(0, 0, 1920, 1040), 1.5, 24, 14),
            (900, 1026)
        );
        assert_eq!(
            maximum_size(rect(0, 0, 3840, 2100), 2.0, 32, 18),
            (1200, 2082)
        );
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
    fn a_visible_body_with_an_offscreen_drag_header_is_recovered() {
        // 400px of the widget is still visible, but the frameless drag header is
        // above the work area, so the user could not move it back themselves.
        assert_eq!(
            placement(widget_390x700(500, -300), &[primary()], Some(primary())),
            Some((765, 170))
        );
    }

    #[test]
    fn a_header_clipped_within_the_tolerance_is_left_alone() {
        // A few clipped pixels still leave the drag header grabbable.
        assert_eq!(
            placement(
                widget_390x700(500, -HEADER_TOLERANCE),
                &[primary()],
                Some(primary())
            ),
            None
        );
        assert_eq!(
            placement(
                widget_390x700(500, -HEADER_TOLERANCE - 1),
                &[primary()],
                Some(primary())
            ),
            Some((765, 170))
        );
    }

    #[test]
    fn a_header_on_a_stacked_monitor_is_reachable() {
        // Above the primary monitor is a valid placement when the top edge is
        // inside that monitor; the header rule must not recenter it.
        let upper = rect(0, -1080, 1920, 1080);
        let lower = primary();
        assert_eq!(
            placement(widget_390x700(500, -100), &[upper, lower], Some(lower)),
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
