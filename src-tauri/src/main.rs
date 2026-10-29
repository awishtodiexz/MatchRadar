#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod alerts;
mod delivery;
mod model;
mod persistence;
mod provider;
mod refresh;
use chrono::{DateTime, Utc};
use model::{
    apply_feed, apply_settings, feed_is_current, ExpandedSize, Settings, SettingsEffects, Snapshot,
};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

struct State {
    snapshot: Mutex<Snapshot>,
    path: PathBuf,
    wake: tokio::sync::Notify,
    notification_wake: tokio::sync::Notify,
    force_fixtures: AtomicBool,
    mode_generation: AtomicU64,
    settings_lock: Mutex<()>,
    refresh_lock: tokio::sync::Mutex<()>,
}
fn write_snapshot(state: &State, snapshot: &Snapshot) -> Result<(), String> {
    persistence::save(&state.path, snapshot)
}
fn persist(state: &State) -> Result<(), String> {
    let snapshot = state
        .snapshot
        .lock()
        .map_err(|e| format!("Lock MatchRadar state: {e}"))?;
    write_snapshot(state, &snapshot)
}
fn logical_size(window: &tauri::WebviewWindow) -> Result<ExpandedSize, String> {
    let size = window
        .inner_size()
        .map_err(|e| format!("Read widget dimensions: {e}"))?;
    let scale = window
        .scale_factor()
        .map_err(|e| format!("Read widget display scale: {e}"))?;
    ExpandedSize::from_physical(size.width, size.height, scale)
        .ok_or_else(|| "Invalid widget dimensions or display scale".into())
}
fn resize(window: &tauri::WebviewWindow, size: ExpandedSize) -> Result<(), String> {
    let size = size.bounded();
    window
        .set_size(tauri::LogicalSize::new(size.width, size.height))
        .map_err(|e| format!("Resize widget: {e}"))
}
#[tauri::command]
fn get_snapshot(state: tauri::State<'_, State>) -> Result<Snapshot, String> {
    state
        .snapshot
        .lock()
        .map(|s| s.clone())
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn save_settings(
    settings: Settings,
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
) -> Result<Settings, String> {
    let _settings_guard = state
        .settings_lock
        .lock()
        .map_err(|e| format!("Lock settings update: {e}"))?;
    let old = state.snapshot.lock().map_err(|e| e.to_string())?.clone();
    let effects = SettingsEffects::between(&old.settings, &settings);
    let window = app.get_webview_window("main");
    let mut previous_size = None;
    let mut expanded_size = old.expanded_size;
    if effects.pin_changed || effects.compact_changed {
        let window = window.as_ref().ok_or("Widget window is unavailable")?;
        if effects.compact_changed {
            let current = logical_size(window)?;
            previous_size = Some(current);
            if settings.compact {
                expanded_size = Some(current);
            }
        }
        if effects.pin_changed {
            window
                .set_always_on_top(settings.always_on_top)
                .map_err(|e| format!("Set always on top: {e}"))?;
        }
        if effects.compact_changed {
            let target = if settings.compact {
                previous_size.unwrap_or_default().compact()
            } else {
                expanded_size.unwrap_or_default()
            };
            if let Err(error) = resize(window, target) {
                return Err(rollback_window(
                    window,
                    &old.settings,
                    effects.pin_changed,
                    None,
                    error,
                ));
            }
        }
    }
    let saved = (|| {
        let mut snapshot = state.snapshot.lock().map_err(|e| e.to_string())?;
        // Clone after native calls so a completed poll cannot be lost while resizing.
        let mut next = snapshot.clone();
        apply_settings(&mut next, settings);
        next.expanded_size = expanded_size;
        write_snapshot(&state, &next)?;
        *snapshot = next;
        if effects.mode_changed {
            state.mode_generation.fetch_add(1, Ordering::Relaxed);
        }
        Ok::<_, String>(())
    })();
    if let Err(error) = saved {
        return Err(if let Some(window) = window.as_ref() {
            rollback_window(
                window,
                &old.settings,
                effects.pin_changed,
                previous_size,
                error,
            )
        } else {
            error
        });
    }
    if effects.mode_changed {
        state.force_fixtures.store(true, Ordering::Relaxed);
        state.wake.notify_one();
    }
    state.notification_wake.notify_one();
    app.emit("snapshot-updated", ())
        .map_err(|e| format!("Notify widget of saved settings: {e}"))?;
    // Return Rust's persisted normalization, rather than echoing the IPC payload.
    state
        .snapshot
        .lock()
        .map(|s| s.settings.clone())
        .map_err(|e| e.to_string())
}
fn rollback_window(
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
#[tauri::command]
fn refresh(app: tauri::AppHandle, state: tauri::State<'_, State>) {
    state.force_fixtures.store(true, Ordering::Relaxed);
    if let Ok(mut s) = state.snapshot.lock() {
        s.refreshing = true;
    }
    let _ = app.emit("snapshot-updated", ());
    state.wake.notify_one();
}
#[tauri::command]
fn test_notification(app: tauri::AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title("MatchRadar")
        .body("You're all set for matchday.")
        .show()
        .map_err(|e| e.to_string())
}

fn notification_log(state: &State, message: &str) {
    eprintln!("MatchRadar notifications: {message}");
    if let Ok(mut log) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(state.path.with_file_name("provider.log"))
    {
        let _ = writeln!(log, "{} notifications: {message}", Utc::now().to_rfc3339());
    }
}

fn submit_notification(
    app: &tauri::AppHandle,
    event: &model::PendingNotification,
) -> Result<(), delivery::SubmissionError> {
    // In plugin 2.8.0 this acknowledges background dispatch, not OS display.
    app.notification()
        .builder()
        .title("MatchRadar")
        .body(&event.body)
        .show()
        .map_err(|error| {
            let unavailable = matches!(&error,
                tauri_plugin_notification::Error::Io(e) if matches!(e.kind(),
                    std::io::ErrorKind::PermissionDenied
                        | std::io::ErrorKind::NotFound
                        | std::io::ErrorKind::Unsupported));
            if unavailable {
                delivery::SubmissionError::Unavailable(error.to_string())
            } else {
                delivery::SubmissionError::Temporary(error.to_string())
            }
        })
}

async fn deliver_notifications(app: tauri::AppHandle) {
    let mut save_failures = 0u32;
    let mut persistence_retry = None::<tokio::time::Instant>;
    loop {
        let state = app.state::<State>();
        let delay = if let Some(deadline) =
            persistence_retry.filter(|t| *t > tokio::time::Instant::now())
        {
            Some(deadline.saturating_duration_since(tokio::time::Instant::now()))
        } else {
            let mut snapshot = state.snapshot.lock().unwrap();
            if !snapshot.pending_notifications.is_empty() || save_failures > 0 {
                let result = delivery::submit_due(
                    &mut snapshot,
                    Utc::now,
                    |event| submit_notification(&app, event),
                    |next| write_snapshot(&state, next),
                    |message| notification_log(&state, message),
                );
                if let Err(error) = result {
                    // Back off persistence failures too; never submit an unpersisted candidate.
                    if save_failures == 0 {
                        notification_log(&state, &format!("Queue persistence failed: {error}"));
                    }
                    save_failures = save_failures.saturating_add(1);
                } else {
                    save_failures = 0;
                    persistence_retry = None;
                }
            }
            if save_failures > 0 {
                let delay = Duration::from_secs((30 * 2u64.pow(save_failures.min(4))).min(300));
                persistence_retry = Some(tokio::time::Instant::now() + delay);
                Some(delay)
            } else {
                delivery::next_due(&snapshot, Utc::now())
            }
        };
        // Independent wake/deadline: delivery retry never wakes the ESPN poller.
        tokio::select! {
            _ = async {
                match delay {
                    Some(delay) => tokio::time::sleep(delay.max(Duration::from_secs(1))).await,
                    None => std::future::pending::<()>().await,
                }
            } => {},
            _ = state.notification_wake.notified() => {},
        }
    }
}
async fn poll(app: tauri::AppHandle) {
    let mut failures = 0u32;
    let client = provider::client();
    loop {
        let state = app.state::<State>();
        let _guard = state.refresh_lock.lock().await;
        let (settings, cached, fixture_updated_at, generation) = {
            let mut s = state.snapshot.lock().unwrap();
            s.refreshing = true;
            (
                s.settings.clone(),
                s.matches.clone(),
                s.fixture_updated_at.clone(),
                state.mode_generation.load(Ordering::Relaxed),
            )
        };
        let _ = app.emit("snapshot-updated", ());
        let mut retry_after = None;
        if settings.mock {
            let mut s = state.snapshot.lock().unwrap();
            if feed_is_current(
                &s,
                true,
                generation,
                state.mode_generation.load(Ordering::Relaxed),
            ) {
                apply_feed(
                    &mut s,
                    provider::mock(),
                    Utc::now().to_rfc3339(),
                    false,
                    None,
                );
            }
            failures = 0;
        } else {
            let force = state.force_fixtures.swap(false, Ordering::Relaxed);
            let due = force
                || fixture_updated_at
                    .and_then(|v| DateTime::parse_from_rfc3339(&v).ok())
                    .is_none_or(|t| {
                        Utc::now()
                            .signed_duration_since(t.with_timezone(&Utc))
                            .num_minutes()
                            >= 360
                    });
            let (fixtures, scores) = match client.as_ref() {
                Ok(client) => {
                    let today = Utc::now().date_naive();
                    let fixtures = if due {
                        provider::fixtures(client, today).await
                    } else {
                        provider::FetchOutcome::default()
                    };
                    let scores = if fixtures
                        .error
                        .as_ref()
                        .is_some_and(provider::FetchError::rate_limited)
                    {
                        provider::FetchOutcome::failed(provider::FetchError {
                            message: "Daily requests deferred after fixture rate limit".into(),
                            retry_after: fixtures.error.as_ref().and_then(|e| e.retry_after),
                        })
                    } else {
                        // Check yesterday if either cached or newly fetched data says it is live.
                        let mut relevant = cached;
                        if let Some(matches) = &fixtures.matches {
                            relevant.extend(matches.iter().cloned());
                        }
                        provider::scores(client, today, &relevant).await
                    };
                    (fixtures, scores)
                }
                Err(error) => (
                    if due {
                        provider::FetchOutcome::failed(error.clone())
                    } else {
                        provider::FetchOutcome::default()
                    },
                    provider::FetchOutcome::failed(error.clone()),
                ),
            };
            let mut s = state.snapshot.lock().unwrap();
            if feed_is_current(
                &s,
                false,
                generation,
                state.mode_generation.load(Ordering::Relaxed),
            ) {
                let applied = refresh::apply(&mut s, fixtures, scores, Utc::now());
                retry_after = applied.retry_after;
                if applied.any_response {
                    let overflow = delivery::enqueue(&mut s, &applied.score_ids, Utc::now());
                    if overflow > 0 {
                        notification_log(
                            &state,
                            &format!("Pending queue full; {overflow} candidates omitted"),
                        );
                    }
                }
                if applied.failed {
                    failures = failures.saturating_add(1);
                    if let Some(error) = &s.error {
                        eprintln!("MatchRadar: {error}");
                        if let Ok(mut log) = fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(state.path.with_file_name("provider.log"))
                        {
                            let _ = writeln!(log, "{} {}", Utc::now().to_rfc3339(), error);
                        }
                    }
                } else {
                    failures = 0;
                }
            }
        }
        if let Ok(mut s) = state.snapshot.lock() {
            s.refreshing = false;
        }
        if let Err(e) = persist(&state) {
            eprintln!("MatchRadar: {e}");
        }
        state.notification_wake.notify_one();
        let _ = app.emit("snapshot-updated", ());
        let delay = {
            let s = state.snapshot.lock().unwrap();
            if failures > 0 {
                retry_after
                    .unwrap_or(60u64.saturating_mul(2u64.saturating_pow(failures.min(5))))
                    .min(3600)
            } else if s
                .matches
                .iter()
                .any(|m| m.status == "live" || m.status == "halftime")
            {
                60
            } else if s.matches.iter().any(|m| {
                DateTime::parse_from_rfc3339(&m.kickoff)
                    .ok()
                    .is_some_and(|d| {
                        let secs = (d.with_timezone(&Utc) - Utc::now()).num_seconds();
                        secs > 0 && secs < 24 * 3600
                    })
            }) {
                300
            } else {
                1800
            }
        };
        drop(_guard);
        tokio::select! { _=tokio::time::sleep(Duration::from_secs(delay))=>{}, _=state.wake.notified()=>{} }
    }
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        // Restore explicitly in setup before applying compact mode; plugin ready hooks
        // must not subsequently replace the compact size with a saved expanded size.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let path = dir.join("state.json");
            let loaded = persistence::load(&path)?;
            if let Some(notice) = loaded.notice {
                eprintln!("MatchRadar persistence: {notice}");
                if let Ok(mut log) = fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(dir.join("provider.log"))
                {
                    let _ = writeln!(log, "{} persistence: {notice}", Utc::now().to_rfc3339());
                }
            }
            let mut snapshot = loaded.snapshot;
            snapshot.refreshing = false;
            snapshot.migrate_catalog();
            refresh::mark_cached(&mut snapshot);
            alerts::cleanup(&mut snapshot, Utc::now());
            delivery::cleanup(&mut snapshot, Utc::now());
            if let Some(window) = app.get_webview_window("main") {
                window.restore_state(StateFlags::all())?;
                window.set_always_on_top(snapshot.settings.always_on_top)?;
                if snapshot.settings.compact {
                    // A legacy compact cache has no known expanded size. Use the normal
                    // default rather than treating the plugin's compact size as expanded.
                    let expanded = snapshot.expanded_size.unwrap_or_default().bounded();
                    snapshot.expanded_size = Some(expanded);
                    let current = logical_size(&window)?;
                    resize(&window, current.compact())?;
                }
            }
            app.manage(State {
                snapshot: Mutex::new(snapshot),
                path,
                wake: tokio::sync::Notify::new(),
                notification_wake: tokio::sync::Notify::new(),
                force_fixtures: AtomicBool::new(false),
                mode_generation: AtomicU64::new(0),
                settings_lock: Mutex::new(()),
                refresh_lock: tokio::sync::Mutex::new(()),
            });
            persist(&app.state::<State>())?;
            let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("MatchRadar")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" | "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            if event.id.as_ref() == "show"
                                && w.is_visible().unwrap_or(false)
                                && !w.is_minimized().unwrap_or(false)
                            {
                                let _ = w.hide();
                            } else {
                                let _ = w.show();
                                let _ = w.unminimize();
                                let _ = w.set_focus();
                                if event.id.as_ref() == "settings" {
                                    let _ = app.emit("open-settings", ());
                                }
                            }
                        }
                    }
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            tauri::async_runtime::spawn(poll(app.handle().clone()));
            tauri::async_runtime::spawn(deliver_notifications(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            save_settings,
            refresh,
            test_notification
        ])
        .run(tauri::generate_context!())
        .expect("failed to run MatchRadar");
}

#[cfg(test)]
mod persistence_tests {
    use super::*;

    #[test]
    fn persistence_failure_is_returned_with_path_context() {
        let path = std::env::temp_dir()
            .join(format!(
                "matchradar-missing-parent-{}-{}",
                std::process::id(),
                Utc::now().timestamp_nanos_opt().unwrap()
            ))
            .join("state.json");
        let state = State {
            snapshot: Mutex::new(Snapshot::default()),
            path: path.clone(),
            wake: tokio::sync::Notify::new(),
            notification_wake: tokio::sync::Notify::new(),
            force_fixtures: AtomicBool::new(false),
            mode_generation: AtomicU64::new(0),
            settings_lock: Mutex::new(()),
            refresh_lock: tokio::sync::Mutex::new(()),
        };
        let error = persist(&state).unwrap_err();
        assert!(error.contains("Save MatchRadar state"));
        assert!(error.contains(path.to_string_lossy().as_ref()));
    }
}
