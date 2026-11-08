#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod alerts;
mod delivery;
#[cfg(test)]
mod demo;
mod details;
mod model;
mod persistence;
mod provider;
mod refresh;
mod results;
mod scheduling;
mod window;
use chrono::{DateTime, Utc};
use model::{apply_settings, Competition, Settings, SettingsEffects, Snapshot, WidgetSnapshot};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};
use window::{ensure_visible, logical_size, resize, rollback_window};

struct State {
    snapshot: Mutex<Snapshot>,
    path: PathBuf,
    wake: tokio::sync::Notify,
    notification_wake: tokio::sync::Notify,
    force_fixtures: AtomicBool,
    settings_lock: Mutex<()>,
    refresh_lock: tokio::sync::Mutex<()>,
    last_persist: Mutex<Option<std::time::Instant>>,
}
fn snapshot_lock(state: &State) -> std::sync::MutexGuard<'_, Snapshot> {
    state
        .snapshot
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
fn write_snapshot(state: &State, snapshot: &Snapshot) -> Result<(), String> {
    persistence::save(&state.path, snapshot)
}
fn persist(state: &State) -> Result<(), String> {
    let snapshot = snapshot_lock(state).clone();
    write_snapshot(state, &snapshot)?;
    *state
        .last_persist
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(std::time::Instant::now());
    Ok(())
}
/// Poll snapshots are written at most every five minutes; settings, details and
/// results still persist immediately. Score data is re-fetched on startup anyway.
fn persist_periodic(state: &State) -> Result<(), String> {
    let now = std::time::Instant::now();
    let due = state
        .last_persist
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .is_none_or(|previous| now.duration_since(previous) >= Duration::from_secs(300));
    if !due {
        return Ok(());
    }
    persist(state)
}
/// Append one diagnostic line, rotating the log once it passes 1 MB.
fn append_log(path: &Path, message: &str) {
    if fs::metadata(path).is_ok_and(|metadata| metadata.len() > 1_000_000) {
        let _ = fs::rename(path, path.with_extension("log.1"));
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}
#[tauri::command]
async fn get_match_details(
    id: String,
    app: tauri::AppHandle,
    cache: tauri::State<'_, details::Cache>,
) -> Result<details::Details, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid match ID".into());
    }
    let (league, active) = {
        let state = app.state::<State>();
        let snapshot = snapshot_lock(&state);
        let m = snapshot
            .matches
            .iter()
            .chain(snapshot.recent_results.iter())
            .find(|m| m.id == id)
            .ok_or("Match not in fixture cache")?;
        (m.league, matches!(m.status.as_str(), "live" | "halftime"))
    };
    let mut data = cache.get(league, &id, active).await?;
    if !data.stale {
        let state = app.state::<State>();
        let mut snapshot = snapshot_lock(&state);
        if !snapshot
            .detail_cache
            .iter()
            .any(|d| d.match_id == id && d.updated_at == data.updated_at)
        {
            let mut next = snapshot.clone();
            next.detail_cache.retain(|d| d.match_id != id);
            next.detail_cache.push(data.clone());
            next.detail_cache
                .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
            next.detail_cache.truncate(24);
            // Drop cached details for matches that left the fixture/results window.
            let live_ids: std::collections::HashSet<&str> = snapshot
                .matches
                .iter()
                .map(|m| m.id.as_str())
                .chain(snapshot.recent_results.iter().map(|m| m.id.as_str()))
                .collect();
            next.detail_cache
                .retain(|detail| live_ids.contains(detail.match_id.as_str()));
            match write_snapshot(&state, &next) {
                Ok(()) => *snapshot = next,
                Err(e) => {
                    data.error = Some(format!(
                        "Details available, but offline cache could not be saved: {e}"
                    ));
                }
            }
        }
    }
    Ok(data)
}
#[tauri::command]
fn get_snapshot(state: tauri::State<'_, State>) -> Result<WidgetSnapshot, String> {
    let snapshot = snapshot_lock(&state);
    Ok(WidgetSnapshot::from(&*snapshot))
}
#[tauri::command]
fn save_settings(
    mut settings: Settings,
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
) -> Result<Settings, String> {
    // Ignore legacy clients attempting to select the removed mode.
    settings.mock = false;
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
    let enable_start_hidden = settings.start_hidden && !old.settings.start_hidden;
    let saved = (|| {
        let mut snapshot = snapshot_lock(&state);
        // Clone after native calls so a completed poll cannot be lost while resizing.
        let mut next = snapshot.clone();
        apply_settings(&mut next, settings);
        next.expanded_size = expanded_size;
        write_snapshot(&state, &next)?;
        *snapshot = next;
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
    state.notification_wake.notify_one();
    if enable_start_hidden && app.autolaunch().is_enabled().unwrap_or(false) {
        // Rewrite the Run entry so an older install gains the --hidden argument.
        if let Err(error) = app.autolaunch().enable() {
            eprintln!("MatchRadar autostart: {error}");
        }
    }
    app.emit("snapshot-updated", ())
        .map_err(|e| format!("Notify widget of saved settings: {e}"))?;
    // Return Rust's persisted normalization, rather than echoing the IPC payload.
    let snapshot = snapshot_lock(&state);
    Ok(snapshot.settings.clone())
}
#[tauri::command]
fn refresh(app: tauri::AppHandle, state: tauri::State<'_, State>) {
    // Always record the request: a poll may be in flight, and its next iteration
    // must still force a fixture refresh instead of silently dropping the click.
    if let Ok(mut s) = state.snapshot.lock() {
        s.refreshing = true;
    }
    state.force_fixtures.store(true, Ordering::Relaxed);
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
    append_log(
        &state.path.with_file_name("provider.log"),
        &format!("{} notifications: {message}", Utc::now().to_rfc3339()),
    );
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
            let mut snapshot = snapshot_lock(&state);
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
fn fixtures_due(state: &tauri::State<'_, State>, league: Competition, now: DateTime<Utc>) -> bool {
    let snapshot = snapshot_lock(state);
    let per_league = snapshot
        .league_status
        .get(league.slug())
        .and_then(|status| status.fixture_updated_at.clone());
    let legacy = if league == Competition::PremierLeague {
        snapshot.fixture_updated_at.clone()
    } else {
        None
    };
    per_league
        .or(legacy)
        .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .is_none_or(|updated| {
            now.signed_duration_since(updated.with_timezone(&Utc))
                .num_minutes()
                >= 360
        })
}

async fn poll(app: tauri::AppHandle) {
    let client = provider::client();
    // Host-wide rate limiting is separate from per-league failure cooldowns so a
    // single competition's outage no longer slows the other down.
    let mut gate = scheduling::RequestGate::default();
    let mut league_failures = [0u32; 2];
    let mut league_retry: [Option<std::time::Instant>; 2] = [None, None];
    loop {
        let state = app.state::<State>();
        if let Some(delay) = gate.remaining(tokio::time::Instant::now().into_std()) {
            let changed = {
                let mut snapshot = snapshot_lock(&state);
                let changed = snapshot.refreshing;
                snapshot.refreshing = false;
                changed
            };
            if changed {
                let _ = app.emit("snapshot-updated", ());
            }
            tokio::select! {_=tokio::time::sleep(scheduling::sleep_chunk(delay))=>{},_=state.wake.notified()=>{}}
            continue;
        }
        let _guard = state.refresh_lock.lock().await;
        let cached = {
            let mut s = snapshot_lock(&state);
            s.refreshing = true;
            s.matches.clone()
        };
        let _ = app.emit("snapshot-updated", ());
        let now = Utc::now();
        let today = now.date_naive();
        let force = state.force_fixtures.swap(false, Ordering::Relaxed);
        let mut outcomes = Vec::new();
        let mut host_rate_limit: Option<u64> = None;
        match &client {
            Ok(client) => {
                for (index, league) in Competition::ALL.into_iter().enumerate() {
                    let retry_at = league_retry[index];
                    if !force && retry_at.is_some_and(|until| std::time::Instant::now() < until) {
                        continue;
                    }
                    let due = force || fixtures_due(&state, league, now);
                    let fixtures = if due {
                        provider::fixtures(client, league, today).await
                    } else {
                        provider::FetchOutcome::default()
                    };
                    let limited = fixtures
                        .error
                        .as_ref()
                        .is_some_and(provider::FetchError::rate_limited);
                    let scores = if limited {
                        provider::FetchOutcome::failed(provider::FetchError {
                            message: format!(
                                "{} daily requests deferred after fixture rate limit",
                                league.name()
                            ),
                            retry_after: fixtures.error.as_ref().and_then(|e| e.retry_after),
                        })
                    } else {
                        // Check yesterday when cached or newly fetched data says it is live.
                        let mut relevant: Vec<_> = cached
                            .iter()
                            .filter(|m| m.league == league)
                            .cloned()
                            .collect();
                        if let Some(matches) = &fixtures.matches {
                            relevant.extend(matches.iter().cloned());
                        }
                        provider::scores(client, league, today, &relevant).await
                    };
                    if limited {
                        // A provider rate limit applies to the host, not just this league.
                        host_rate_limit =
                            fixtures.error.as_ref().and_then(|error| error.retry_after);
                    }
                    outcomes.push((index, league, fixtures, scores));
                    if limited {
                        break;
                    }
                }
            }
            Err(error) => {
                for (index, league) in Competition::ALL.into_iter().enumerate() {
                    let retry_at = league_retry[index];
                    if !force && retry_at.is_some_and(|until| std::time::Instant::now() < until) {
                        continue;
                    }
                    let due = force || fixtures_due(&state, league, now);
                    outcomes.push((
                        index,
                        league,
                        if due {
                            provider::FetchOutcome::failed(error.clone())
                        } else {
                            provider::FetchOutcome::default()
                        },
                        provider::FetchOutcome::failed(error.clone()),
                    ));
                }
            }
        }
        let requests = provider::take_request_count();
        {
            let mut s = snapshot_lock(&state);
            let mut any_response = false;
            let mut score_ids = Vec::new();
            for (index, league, fixtures, scores) in outcomes {
                let applied = refresh::apply_league(&mut s, league, fixtures, scores, Utc::now());
                any_response |= applied.any_response;
                if applied.failed {
                    league_failures[index] = league_failures[index].saturating_add(1);
                    let cooldown =
                        scheduling::failure_delay(league_failures[index], applied.retry_after);
                    league_retry[index] =
                        Some(std::time::Instant::now() + Duration::from_secs(cooldown));
                } else {
                    league_failures[index] = 0;
                    league_retry[index] = None;
                }
                score_ids.extend(applied.score_ids);
            }
            refresh::finish(&mut s, any_response);
            delivery::revalidate(&mut s, &score_ids, Utc::now());
            if any_response {
                let overflow = delivery::enqueue(&mut s, &score_ids, Utc::now());
                if overflow > 0 {
                    notification_log(
                        &state,
                        &format!("Pending queue full; {overflow} candidates omitted"),
                    );
                }
            }
            if let Some(error) = &s.error {
                eprintln!("MatchRadar: {error}");
                append_log(
                    &state.path.with_file_name("provider.log"),
                    &format!("{} {}", Utc::now().to_rfc3339(), error),
                );
            }
        }
        if force && requests > 0 {
            let message = format!("Manual refresh used {requests} scoreboard request(s)");
            eprintln!("MatchRadar: {message}");
            append_log(
                &state.path.with_file_name("provider.log"),
                &format!("{} {message}", Utc::now().to_rfc3339()),
            );
        }
        if let Ok(mut s) = state.snapshot.lock() {
            s.refreshing = false;
        }
        if let Err(e) = persist_periodic(&state) {
            eprintln!("MatchRadar: {e}");
        }
        state.notification_wake.notify_one();
        let _ = app.emit("snapshot-updated", ());
        let delay = {
            let s = snapshot_lock(&state);
            let base = if s
                .matches
                .iter()
                .any(|m| matches!(m.status.as_str(), "live" | "halftime"))
            {
                60u64
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
            };
            // Wake once a minute through the reminder window so a 5-minute reminder
            // is not missed between coarse fixtures.
            let reminder_window = i64::from(s.settings.reminder_minutes.min(120)) * 60;
            let reminder_soon = s.matches.iter().any(|m| {
                if m.status != "scheduled" {
                    return false;
                }
                let subscribed = s
                    .settings
                    .match_alerts
                    .get(&m.id)
                    .is_some_and(|preference| preference.enabled);
                let followed = s.settings.favorites.contains(&m.home.id)
                    || s.settings.favorites.contains(&m.away.id);
                if !(subscribed || (followed && s.settings.reminders)) {
                    return false;
                }
                DateTime::parse_from_rfc3339(&m.kickoff)
                    .ok()
                    .is_some_and(|d| {
                        let secs = (d.with_timezone(&Utc) - Utc::now()).num_seconds();
                        secs > 0 && secs <= reminder_window + 60
                    })
            });
            let retry_in = league_retry
                .iter()
                .flatten()
                .filter_map(|until| until.checked_duration_since(std::time::Instant::now()))
                .map(|duration| duration.as_secs().max(1))
                .min();
            let mut delay = base;
            if reminder_soon {
                delay = delay.min(60);
            }
            if let Some(retry) = retry_in {
                delay = delay.min(retry);
            }
            delay
        };
        if let Some(retry_after) = host_rate_limit {
            gate.defer(
                std::time::Instant::now(),
                scheduling::failure_delay(1, Some(retry_after)),
            );
        } else {
            gate.clear();
        }
        drop(_guard);
        tokio::select! { _=tokio::time::sleep(scheduling::sleep_chunk(Duration::from_secs(delay)))=>{}, _=state.wake.notified()=>{} }
    }
}
async fn watch_window(app: tauri::AppHandle) {
    // Windows can drop a display without delivering a window event, so re-check
    // placement periodically. This is a small, non-blocking read of monitor data.
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut error_logged = false;
    loop {
        tick.tick().await;
        let Some(window) = app.get_webview_window("main") else {
            continue;
        };
        match ensure_visible(&window) {
            Ok(_) => error_logged = false,
            Err(error) => {
                if !error_logged {
                    eprintln!("MatchRadar window recovery: {error}");
                    error_logged = true;
                }
            }
        }
    }
}

async fn watch_resume(app: tauri::AppHandle) {
    // Wall-clock time advances through sleep even when the monotonic timer does
    // not, so a long gap between ticks means the machine just woke up. The poll
    // loop treats the wake notification as an immediate refresh.
    let mut tick = tokio::time::interval(Duration::from_secs(60));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut last = Utc::now();
    loop {
        tick.tick().await;
        let now = Utc::now();
        let resumed = now.signed_duration_since(last).num_seconds() >= 90;
        last = now;
        if !resumed {
            continue;
        }
        let state = app.state::<State>();
        let idle = state
            .snapshot
            .lock()
            .map(|s| !s.refreshing)
            .unwrap_or(false);
        if idle {
            state.wake.notify_one();
        }
    }
}

fn show_main_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    if let Err(error) = ensure_visible(window) {
        eprintln!("MatchRadar window recovery: {error}");
    }
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) {
        let _ = window.hide();
    } else {
        show_main_window(&window);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.show();
                let _ = w.unminimize();
                let _ = w.set_focus();
                if let Err(error) = ensure_visible(&w) {
                    eprintln!("MatchRadar window recovery: {error}");
                }
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
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--hidden"])
                .build(),
        )
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            fs::create_dir_all(&dir)?;
            let path = dir.join("state.json");
            let loaded = persistence::load(&path).unwrap_or_else(|error| {
                eprintln!("MatchRadar persistence: {error}");
                match persistence::start_over(&path) {
                    Ok(loaded) => loaded,
                    Err(again) => {
                        eprintln!("MatchRadar persistence: {again}");
                        persistence::Loaded {
                            snapshot: Snapshot::default(),
                            notice: Some(format!("{error}; {again}")),
                        }
                    }
                }
            });
            if let Some(notice) = loaded.notice {
                eprintln!("MatchRadar persistence: {notice}");
                append_log(
                    &dir.join("provider.log"),
                    &format!("{} persistence: {notice}", Utc::now().to_rfc3339()),
                );
            }
            let mut snapshot = loaded.snapshot;
            snapshot.refreshing = false;
            snapshot.migrate_catalog();
            snapshot.migrate_demo_state();
            snapshot.migrate_competition_state();
            refresh::mark_cached(&mut snapshot);
            alerts::cleanup(&mut snapshot, Utc::now());
            delivery::cleanup(&mut snapshot, Utc::now());
            let launched_hidden = std::env::args().any(|arg| arg == "--hidden");
            let start_hidden = snapshot.settings.start_hidden;
            if let Some(window) = app.get_webview_window("main") {
                // Restore placement/size without the visibility flag: the widget
                // should not steal focus at login, and start-hidden gets one clean
                // hide instead of a show/focus/hide flash.
                if let Err(error) = window.restore_state(StateFlags::all() & !StateFlags::VISIBLE) {
                    eprintln!("MatchRadar window state: {error}");
                }
                if let Err(error) = window.set_always_on_top(snapshot.settings.always_on_top) {
                    eprintln!("MatchRadar always-on-top: {error}");
                }
                if snapshot.settings.compact {
                    // A legacy compact cache has no known expanded size. Use the normal
                    // default rather than treating the plugin's compact size as expanded.
                    let expanded = snapshot.expanded_size.unwrap_or_default().bounded();
                    snapshot.expanded_size = Some(expanded);
                    if let Err(error) =
                        logical_size(&window).and_then(|current| resize(&window, current.compact()))
                    {
                        eprintln!("MatchRadar compact size: {error}");
                    }
                }
                // The saved position may belong to a monitor that is no longer attached.
                if let Err(error) = ensure_visible(&window) {
                    eprintln!("MatchRadar window recovery: {error}");
                }
                // Launch-at-sign-in passes --hidden; honour it only when the user
                // asked to start in the tray.
                if launched_hidden && start_hidden {
                    let _ = window.hide();
                }
            }
            let detail_cache = snapshot.detail_cache.clone();
            let cache = details::Cache::default();
            cache.seed(&detail_cache);
            app.manage(cache);
            app.manage(results::History::default());
            app.manage(State {
                snapshot: Mutex::new(snapshot),
                path,
                wake: tokio::sync::Notify::new(),
                notification_wake: tokio::sync::Notify::new(),
                force_fixtures: AtomicBool::new(false),
                settings_lock: Mutex::new(()),
                refresh_lock: tokio::sync::Mutex::new(()),
                last_persist: Mutex::new(None),
            });
            if let Err(error) = persist(&app.state::<State>()) {
                eprintln!("MatchRadar persistence: {error}");
            }
            // An entry written by an older build has no --hidden argument; rewrite
            // it once when start-hidden is enabled so the setting takes effect now.
            if start_hidden && app.autolaunch().is_enabled().unwrap_or(false) {
                if let Err(error) = app.autolaunch().enable() {
                    eprintln!("MatchRadar autostart: {error}");
                }
            }
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!("MatchRadar global shortcut: {error}");
                let _ = app.emit("shortcut-unavailable", ());
            }
            let show = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &settings, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("MatchRadar")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => toggle_main_window(app),
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            show_main_window(&w);
                            let _ = app.emit("open-settings", ());
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event({
                    // Windows delivers a double-click as two single clicks.
                    let last_click = std::sync::Mutex::new(None::<std::time::Instant>);
                    move |tray, event| {
                        // The widget has no taskbar button, so a left click on the tray
                        // icon is the quickest way to bring it back or put it away.
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let now = std::time::Instant::now();
                            let duplicate = {
                                let mut last = last_click
                                    .lock()
                                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                                let duplicate = last.is_some_and(|previous| {
                                    now.duration_since(previous) < Duration::from_millis(400)
                                });
                                *last = Some(now);
                                duplicate
                            };
                            if !duplicate {
                                toggle_main_window(tray.app_handle());
                            }
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            tauri::async_runtime::spawn(poll(app.handle().clone()));
            tauri::async_runtime::spawn(deliver_notifications(app.handle().clone()));
            tauri::async_runtime::spawn(watch_window(app.handle().clone()));
            tauri::async_runtime::spawn(watch_resume(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            // The window is tray-only: a minimize from any source (for example
            // Win+Down) hides it instead of leaving it minimized off-screen.
            tauri::WindowEvent::Resized(_) => {
                if window.is_minimized().unwrap_or(false) {
                    let _ = window.hide();
                }
            }
            // DPI changes and restored focus are cheap moments to confirm placement.
            tauri::WindowEvent::Focused(true) | tauri::WindowEvent::ScaleFactorChanged { .. } => {
                if let Some(window) = window.app_handle().get_webview_window("main") {
                    if let Err(error) = ensure_visible(&window) {
                        eprintln!("MatchRadar window recovery: {error}");
                    }
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_match_details,
            results::get_recent_results,
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
            settings_lock: Mutex::new(()),
            refresh_lock: tokio::sync::Mutex::new(()),
            last_persist: Mutex::new(None),
        };
        let error = persist(&state).unwrap_err();
        assert!(error.contains("Save MatchRadar state"));
        assert!(error.contains(path.to_string_lossy().as_ref()));
    }
}
