#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod alerts;
mod model;
mod provider;
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
    force_fixtures: AtomicBool,
    mode_generation: AtomicU64,
    settings_lock: Mutex<()>,
    refresh_lock: tokio::sync::Mutex<()>,
}
fn write_snapshot(state: &State, snapshot: &Snapshot) -> Result<(), String> {
    let data =
        serde_json::to_vec(snapshot).map_err(|e| format!("Serialize MatchRadar settings: {e}"))?;
    fs::write(&state.path, data)
        .map_err(|e| format!("Save MatchRadar state to {}: {e}", state.path.display()))
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
) -> Result<(), String> {
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
    app.emit("snapshot-updated", ())
        .map_err(|e| format!("Notify widget of saved settings: {e}"))
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

fn notifications(app: &tauri::AppHandle, next: &mut Snapshot) {
    for (id, body) in alerts::plan(next, Utc::now()) {
        match app
            .notification()
            .builder()
            .title("MatchRadar")
            .body(&body)
            .show()
        {
            Ok(()) => next.sent_notifications.push(id),
            Err(error) => eprintln!("MatchRadar notification delivery: {error}"),
        }
    }
    if next.sent_notifications.len() > 1000 {
        next.sent_notifications
            .drain(..next.sent_notifications.len() - 1000);
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
            let result = async {
                let client = client.as_ref().map_err(|e| provider::FetchError {
                    message: e.message.clone(),
                    retry_after: e.retry_after,
                })?;
                let today = Utc::now().date_naive();
                let fixture_result = if due {
                    provider::fixtures(client, today).await
                } else {
                    Ok(cached.clone())
                };
                // Continue refreshing scores when the less frequent fixture request fails,
                // except when the provider explicitly rate-limits us.
                if fixture_result
                    .as_ref()
                    .err()
                    .is_some_and(|e| e.retry_after.is_some() || e.message.contains("HTTP 429"))
                {
                    return Err(fixture_result.err().unwrap());
                }
                let fixtures = fixture_result
                    .as_ref()
                    .cloned()
                    .unwrap_or_else(|_| cached.clone());
                let scores = provider::scores(client, today, &fixtures).await?;
                Ok::<_, provider::FetchError>((
                    provider::merge(fixtures, scores),
                    fixture_result.err(),
                ))
            }
            .await;
            match result {
                Ok((matches, fixture_error)) => {
                    let mut s = state.snapshot.lock().unwrap();
                    if feed_is_current(
                        &s,
                        false,
                        generation,
                        state.mode_generation.load(Ordering::Relaxed),
                    ) {
                        apply_feed(
                            &mut s,
                            matches,
                            Utc::now().to_rfc3339(),
                            due && fixture_error.is_none(),
                            fixture_error.as_ref().map(|e| e.message.clone()),
                        );
                        notifications(&app, &mut s);
                    }
                    if let Some(e) = fixture_error {
                        eprintln!("MatchRadar: {}", e.message);
                        if let Ok(mut f) = fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(state.path.with_file_name("provider.log"))
                        {
                            let _ = writeln!(f, "{} {}", Utc::now().to_rfc3339(), e.message);
                        }
                        failures = failures.saturating_add(1);
                    } else {
                        failures = 0;
                    }
                }
                Err(e) => {
                    retry_after = e.retry_after;
                    eprintln!("MatchRadar: {}", e.message);
                    if let Ok(mut f) = fs::OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(state.path.with_file_name("provider.log"))
                    {
                        let _ = writeln!(f, "{} {}", Utc::now().to_rfc3339(), e.message);
                    }
                    let mut s = state.snapshot.lock().unwrap();
                    if feed_is_current(
                        &s,
                        false,
                        generation,
                        state.mode_generation.load(Ordering::Relaxed),
                    ) {
                        s.error = Some(e.message);
                    }
                    failures = failures.saturating_add(1);
                }
            }
        }
        if let Ok(mut s) = state.snapshot.lock() {
            s.refreshing = false;
        }
        if let Err(e) = persist(&state) {
            eprintln!("MatchRadar: {e}");
        }
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
            let mut snapshot: Snapshot = fs::read(&path)
                .ok()
                .and_then(|b| serde_json::from_slice(&b).ok())
                .unwrap_or_default();
            snapshot.refreshing = false;
            snapshot.migrate_catalog();
            alerts::cleanup(&mut snapshot, Utc::now());
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
