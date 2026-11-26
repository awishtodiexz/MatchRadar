#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod alerts;
mod delivery;
#[cfg(test)]
mod demo;
mod details;
mod model;
mod notification_navigation;
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
use window::{
    dpi_repair_target, ensure_visible, logical_size, logical_size_unbounded, resize,
    restore_target, rollback_window,
};

struct State {
    snapshot: Mutex<Snapshot>,
    path: PathBuf,
    wake: tokio::sync::Notify,
    notification_wake: tokio::sync::Notify,
    force_fixtures: AtomicBool,
    settings_lock: Mutex<()>,
    refresh_lock: tokio::sync::Mutex<()>,
    last_persist: Mutex<Option<std::time::Instant>>,
    manual_refresh_at: Mutex<Option<std::time::Instant>>,
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
    persist_with(state, |snapshot| write_snapshot(state, snapshot))
}
fn persist_with(
    state: &State,
    save: impl FnOnce(&Snapshot) -> Result<(), String>,
) -> Result<(), String> {
    let snapshot = snapshot_lock(state);
    save(&snapshot)?;
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
        let rotated = path.with_extension("log.1");
        // Windows rename does not replace an existing destination; rotation would
        // silently stop after the first rollover and the active log would grow forever.
        let _ = fs::remove_file(&rotated);
        let _ = fs::rename(path, rotated);
    }
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{message}");
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum DetailPersist {
    None,
    Periodic,
    Immediate,
}

fn update_detail_cache(
    snapshot: &mut Snapshot,
    data: &details::Details,
    phase: details::Phase,
) -> DetailPersist {
    let live_ids: std::collections::HashSet<&str> = snapshot
        .matches
        .iter()
        .map(|m| m.id.as_str())
        .chain(snapshot.recent_results.iter().map(|m| m.id.as_str()))
        .collect();
    let existing_position = snapshot
        .detail_cache
        .iter()
        .position(|detail| detail.match_id == data.match_id);
    if data.stale {
        if existing_position.is_some() || !live_ids.contains(data.match_id.as_str()) {
            return DetailPersist::None;
        }
        // Prune before applying the cap so dead matches cannot evict live ones.
        snapshot
            .detail_cache
            .retain(|detail| live_ids.contains(detail.match_id.as_str()));
        snapshot.detail_cache.push(data.clone());
        snapshot
            .detail_cache
            .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        snapshot.detail_cache.truncate(24);
        return DetailPersist::Immediate;
    }
    let existing_clean = existing_position.is_some_and(|position| {
        let existing = &snapshot.detail_cache[position];
        !existing.stale && existing.error.is_none()
    });
    let unchanged = existing_clean
        && existing_position
            .is_some_and(|position| snapshot.detail_cache[position].content_eq(data));
    if unchanged {
        return DetailPersist::None;
    }
    snapshot
        .detail_cache
        .retain(|detail| detail.match_id != data.match_id);
    snapshot
        .detail_cache
        .retain(|detail| live_ids.contains(detail.match_id.as_str()));
    if live_ids.contains(data.match_id.as_str()) {
        snapshot.detail_cache.push(data.clone());
    }
    snapshot
        .detail_cache
        .sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    snapshot.detail_cache.truncate(24);
    if !existing_clean
        || phase == details::Phase::Final
        || data.match_state.as_deref() == Some("post")
    {
        DetailPersist::Immediate
    } else {
        DetailPersist::Periodic
    }
}

fn attach_detail_persistence_error(data: &mut details::Details, error: &str) {
    let message = format!("Details available, but offline cache could not be saved: {error}");
    data.error = Some(match data.error.take() {
        Some(existing) if !existing.is_empty() => format!("{existing}; {message}"),
        _ => message,
    });
}

#[tauri::command]
async fn get_match_details(
    id: String,
    force: Option<bool>,
    app: tauri::AppHandle,
    cache: tauri::State<'_, details::Cache>,
) -> Result<details::Details, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err("Invalid match ID".into());
    }
    let (league, phase) = {
        let state = app.state::<State>();
        let snapshot = snapshot_lock(&state);
        let m = snapshot
            .matches
            .iter()
            .chain(snapshot.recent_results.iter())
            .filter(|m| m.id == id)
            .max_by_key(|m| {
                m.score_updated_at
                    .as_ref()
                    .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
            })
            .ok_or("Match not in fixture cache")?;
        (
            m.league,
            match m.status.as_str() {
                "live" | "halftime" => details::Phase::Live,
                "fulltime" => details::Phase::Final,
                _ => details::Phase::Other,
            },
        )
    };
    let mut data = cache
        .get(league, &id, phase, force.unwrap_or(false))
        .await?;
    let state = app.state::<State>();
    let persistence = {
        let mut snapshot = snapshot_lock(&state);
        let mut next = snapshot.clone();
        let persistence = update_detail_cache(&mut next, &data, phase);
        match persistence {
            DetailPersist::None => {}
            DetailPersist::Periodic => {
                snapshot.detail_cache = next.detail_cache;
            }
            DetailPersist::Immediate => match write_snapshot(&state, &next) {
                Ok(()) => *snapshot = next,
                Err(error) => attach_detail_persistence_error(&mut data, &error),
            },
        }
        persistence
    };
    if persistence == DetailPersist::Periodic {
        if let Err(error) = persist_periodic(&state) {
            attach_detail_persistence_error(&mut data, &error);
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
async fn save_settings(settings: Settings, app: tauri::AppHandle) -> Result<Settings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        save_settings_blocking(settings, &app, &state)
    })
    .await
    .map_err(|e| format!("Save settings task failed: {e}"))?
}

fn save_settings_blocking(
    mut settings: Settings,
    app: &tauri::AppHandle,
    state: &State,
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
        let mut snapshot = snapshot_lock(state);
        // Clone after native calls so a completed poll cannot be lost while resizing.
        let mut next = snapshot.clone();
        apply_settings(&mut next, settings);
        next.expanded_size = expanded_size;
        write_snapshot(state, &next)?;
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
            log_provider(&format!("autostart: {error}"));
        }
    }
    app.emit("snapshot-updated", ())
        .map_err(|e| format!("Notify widget of saved settings: {e}"))?;
    // Return Rust's persisted normalization, rather than echoing the IPC payload.
    let snapshot = snapshot_lock(state);
    Ok(snapshot.settings.clone())
}

fn manual_refresh_allowed(
    last: Option<std::time::Instant>,
    now: std::time::Instant,
    has_error: bool,
) -> bool {
    has_error || last.is_none_or(|t| now.duration_since(t) >= Duration::from_secs(15))
}

#[tauri::command]
fn refresh(app: tauri::AppHandle, state: tauri::State<'_, State>) {
    // Coalesce manual refresh clicks: each forced cycle burns fixture + scoreboard
    // requests outside the cadence, so clicks closer than 15s merge into one.
    // A failed cycle is exempt: the user can retry immediately rather than wait
    // out the coalescing window with stale data still on screen.
    {
        let has_error = snapshot_lock(&state).error.is_some();
        let mut last = state
            .manual_refresh_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let now = std::time::Instant::now();
        if !manual_refresh_allowed(*last, now, has_error) {
            return;
        }
        *last = Some(now);
    }
    // Clicks that survive coalescing are always recorded: a poll may be in
    // flight, and its next iteration must still force a fixture refresh.
    snapshot_lock(&state).refreshing = true;
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

#[tauri::command]
fn get_notification_target(
    navigation: tauri::State<'_, notification_navigation::Navigation>,
    state: tauri::State<'_, State>,
) -> Option<notification_navigation::Target> {
    navigation.get(&snapshot_lock(&state))
}

#[tauri::command]
fn acknowledge_notification_target(
    request_id: u64,
    navigation: tauri::State<'_, notification_navigation::Navigation>,
) {
    navigation.acknowledge(request_id);
}

fn notification_log(state: &State, message: &str) {
    eprintln!("MatchRadar notifications: {message}");
    append_log(
        &state.path.with_file_name("provider.log"),
        &format!("{} notifications: {message}", Utc::now().to_rfc3339()),
    );
}

// The durable log lives beside state.json; set once at startup so deep modules
// (summaries, statistics) can log without threading a path through every call.
static PROVIDER_LOG: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
pub(crate) fn log_provider(message: &str) {
    eprintln!("MatchRadar {message}");
    if let Some(path) = PROVIDER_LOG.get() {
        append_log(path, &format!("{} {message}", Utc::now().to_rfc3339()));
    }
}

fn spawn_monitored(
    name: &'static str,
    expect_running: bool,
    task: impl std::future::Future<Output = ()> + Send + 'static,
) {
    let handle = tauri::async_runtime::spawn(task);
    tauri::async_runtime::spawn(async move {
        match handle.await {
            Ok(()) if expect_running => log_provider(&format!("{name} task stopped unexpectedly")),
            Err(error) => log_provider(&format!("{name} task failed: {error}")),
            Ok(()) => {}
        }
    });
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
        .extra("matchId", &event.match_id)
        .show()
        .map_err(|error| {
            let unavailable = matches!(&error,
                tauri_plugin_notification::Error::Io(e)
                    if e.kind() == std::io::ErrorKind::PermissionDenied);
            if unavailable {
                delivery::SubmissionError::Unavailable(error.to_string())
            } else {
                delivery::SubmissionError::Temporary(error.to_string())
            }
        })
}

fn deliver_notifications_step<S, W, L>(
    snapshot: &mut Snapshot,
    save_failures: &mut u32,
    now: impl Fn() -> DateTime<Utc>,
    submit: S,
    mut save: W,
    mut log: L,
) where
    S: FnMut(&model::PendingNotification) -> Result<(), delivery::SubmissionError>,
    W: FnMut(&Snapshot) -> Result<(), String>,
    L: FnMut(&str),
{
    // If an earlier post-submit acknowledgement save failed, flush the updated
    // in-memory sent_notifications/queue before checking whether any new
    // candidates are due, even when pending_notifications is now empty or only
    // holds backed-off items.
    if *save_failures > 0 {
        if save(snapshot).is_err() {
            *save_failures = save_failures.saturating_add(1);
            return;
        }
        *save_failures = 0;
    }
    if snapshot.pending_notifications.is_empty() {
        return;
    }
    let result = delivery::submit_due(snapshot, now, submit, save, &mut log);
    if let Err(error) = result {
        // Back off persistence failures too; never submit an unpersisted candidate.
        if *save_failures == 0 {
            log(&format!("Queue persistence failed: {error}"));
        }
        *save_failures = save_failures.saturating_add(1);
    } else {
        *save_failures = 0;
    }
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
            deliver_notifications_step(
                &mut snapshot,
                &mut save_failures,
                Utc::now,
                |event| submit_notification(&app, event),
                |next| write_snapshot(&state, next),
                |message| notification_log(&state, message),
            );
            if save_failures > 0 {
                let delay = Duration::from_secs((30 * 2u64.pow(save_failures.min(4))).min(300));
                persistence_retry = Some(tokio::time::Instant::now() + delay);
                Some(delay)
            } else {
                persistence_retry = None;
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
    scheduling::fixtures_due(&snapshot_lock(state), league, now)
}

fn scores_due(state: &tauri::State<'_, State>, league: Competition, now: DateTime<Utc>) -> bool {
    scheduling::scores_due(&snapshot_lock(state), league, now)
}

async fn poll(app: tauri::AppHandle) {
    let client = provider::client();
    // Host-wide rate limiting is separate from per-league failure cooldowns so a
    // single competition's outage no longer slows the other down.
    let mut gate = scheduling::RequestGate::default();
    let mut fixture_failures = [0u32; Competition::ALL.len()];
    let mut score_failures = [0u32; Competition::ALL.len()];
    let mut fixture_retry: [Option<std::time::Instant>; Competition::ALL.len()] =
        [None; Competition::ALL.len()];
    let mut score_retry: [Option<std::time::Instant>; Competition::ALL.len()] =
        [None; Competition::ALL.len()];
    let mut last_poll_error = None::<String>;
    loop {
        let state = app.state::<State>();
        if let Some(delay) = gate.remaining(tokio::time::Instant::now().into_std()) {
            let changed = {
                let mut snapshot = snapshot_lock(&state);
                let changed = snapshot.refreshing;
                snapshot.refreshing = false;
                // A deferred poll must not defer durable reminders: kickoff times
                // are already cached, so keep planning while the provider is
                // unreachable. The delivery loop persists before it submits.
                // revalidate also keeps baselines warm so a goal scored during
                // the deferral stays inside alerts::plan's freshness window.
                delivery::revalidate(&mut snapshot, &[], Utc::now());
                changed
            };
            if changed {
                let _ = app.emit("snapshot-updated", ());
            }
            state.notification_wake.notify_one();
            tokio::select! {_=tokio::time::sleep(scheduling::deferred_sleep(delay))=>{},_=state.wake.notified()=>{}}
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
                    let now_instant = std::time::Instant::now();
                    let fixtures_cooling =
                        !force && fixture_retry[index].is_some_and(|until| now_instant < until);
                    let scores_cooling =
                        !force && score_retry[index].is_some_and(|until| now_instant < until);
                    let due = force || fixtures_due(&state, league, now);
                    let scores_needed = force || scores_due(&state, league, now);
                    if (!due || fixtures_cooling) && (!scores_needed || scores_cooling) {
                        continue;
                    }
                    let fixtures = if due && !fixtures_cooling {
                        provider::fixtures(client, league, today).await
                    } else {
                        provider::FetchOutcome::default()
                    };
                    let limited = fixtures
                        .error
                        .as_ref()
                        .is_some_and(provider::FetchError::rate_limited);
                    let scores = if scores_needed && !scores_cooling && !limited {
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
                    } else {
                        provider::FetchOutcome::default()
                    };
                    let cooldown = provider::host_cooldown(&[&fixtures, &scores]);
                    if cooldown.is_some() {
                        host_rate_limit = cooldown;
                    }
                    outcomes.push((index, league, fixtures, scores, Utc::now()));
                    if cooldown.is_some() {
                        break;
                    }
                }
            }
            Err(error) => {
                for (index, league) in Competition::ALL.into_iter().enumerate() {
                    let now_instant = std::time::Instant::now();
                    let fixtures_cooling =
                        !force && fixture_retry[index].is_some_and(|until| now_instant < until);
                    let scores_cooling =
                        !force && score_retry[index].is_some_and(|until| now_instant < until);
                    let due = force || fixtures_due(&state, league, now);
                    let scores_needed = force || scores_due(&state, league, now);
                    if (!due || fixtures_cooling) && (!scores_needed || scores_cooling) {
                        continue;
                    }
                    outcomes.push((
                        index,
                        league,
                        if due && !fixtures_cooling {
                            provider::FetchOutcome::failed(error.clone())
                        } else {
                            provider::FetchOutcome::default()
                        },
                        if scores_needed && !scores_cooling {
                            provider::FetchOutcome::failed(error.clone())
                        } else {
                            provider::FetchOutcome::default()
                        },
                        Utc::now(),
                    ));
                }
            }
        }
        let requests = provider::take_request_count();
        {
            let mut s = snapshot_lock(&state);
            let mut any_response = false;
            let mut score_ids = Vec::new();
            for (index, league, fixtures, scores, confirmed_at) in outcomes {
                let applied = refresh::apply_league(&mut s, league, fixtures, scores, confirmed_at);
                any_response |= applied.any_response;
                if applied.fixture_attempted {
                    if applied.fixture_failed {
                        fixture_failures[index] = fixture_failures[index].saturating_add(1);
                        let cooldown = scheduling::failure_delay(
                            fixture_failures[index],
                            applied.fixture_retry_after,
                        );
                        fixture_retry[index] =
                            Some(std::time::Instant::now() + Duration::from_secs(cooldown));
                    } else {
                        fixture_failures[index] = 0;
                        fixture_retry[index] = None;
                    }
                }
                if applied.score_attempted {
                    if applied.score_failed {
                        score_failures[index] = score_failures[index].saturating_add(1);
                        let cooldown = scheduling::score_delay(
                            score_failures[index],
                            applied.score_retry_after,
                            scheduling::base_poll_seconds(&s.matches, confirmed_at)
                                == scheduling::LIVE_CADENCE_SECONDS,
                        );
                        score_retry[index] =
                            Some(std::time::Instant::now() + Duration::from_secs(cooldown));
                    } else {
                        score_failures[index] = 0;
                        score_retry[index] = None;
                    }
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
            match &s.error {
                // The same transport failure repeats every cycle; log it once.
                Some(error) if last_poll_error.as_deref() == Some(error.as_str()) => {}
                Some(error) => {
                    eprintln!("MatchRadar: {error}");
                    append_log(
                        &state.path.with_file_name("provider.log"),
                        &format!("{} {}", Utc::now().to_rfc3339(), error),
                    );
                    last_poll_error = Some(error.clone());
                }
                None => last_poll_error = None,
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
        snapshot_lock(&state).refreshing = false;
        if let Err(e) = persist_periodic(&state) {
            eprintln!("MatchRadar: {e}");
        }
        state.notification_wake.notify_one();
        let _ = app.emit("snapshot-updated", ());
        let delay = {
            let s = snapshot_lock(&state);
            let base = scheduling::base_poll_seconds(&s.matches, Utc::now());
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
            let retry_in = fixture_retry
                .iter()
                .chain(score_retry.iter())
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
        let rate_limited_until = if let Some(retry_after) = host_rate_limit {
            let seconds = scheduling::failure_delay(1, Some(retry_after));
            gate.defer(std::time::Instant::now(), seconds);
            Some((Utc::now() + chrono::Duration::seconds(seconds as i64)).to_rfc3339())
        } else {
            gate.clear();
            None
        };
        let rate_limit_changed = {
            let mut s = snapshot_lock(&state);
            let changed = s.rate_limited_until != rate_limited_until;
            s.rate_limited_until = rate_limited_until;
            changed
        };
        if rate_limit_changed {
            let _ = app.emit("snapshot-updated", ());
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
        // A display may have been attached or detached while the machine slept.
        // Recover placement now rather than waiting for the next watchdog tick.
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = ensure_visible(&window) {
                eprintln!("MatchRadar window recovery: {error}");
            }
        }
        let state = app.state::<State>();
        // Notify even when a pre-sleep poll is still in flight: Notify stores the
        // permit, so the loop starts a fresh post-resume cycle as soon as it can.
        state.wake.notify_one();
    }
}

fn show_main_window(window: &tauri::WebviewWindow) {
    let _ = window.show();
    let _ = window.unminimize();
    // Place the window before focusing it so a widget restored from a detached
    // display is brought onto the current monitor, not focused off-screen.
    if let Err(error) = ensure_visible(window) {
        eprintln!("MatchRadar window recovery: {error}");
    }
    let _ = window.set_focus();
    let _ = window.app_handle().emit("window-visibility", true);
}

fn hide_main_window(window: &tauri::WebviewWindow) {
    let _ = window.hide();
    let _ = window.app_handle().emit("window-visibility", false);
}

fn hide_window(window: &tauri::Window) {
    let _ = window.hide();
    let _ = window.app_handle().emit("window-visibility", false);
}

/// A sign-in launch (`--hidden`) stays in the tray only when the user asked to
/// start hidden. A manual launch is always shown, even if it carries the flag.
fn starts_in_tray(launched_hidden: bool, start_hidden: bool) -> bool {
    launched_hidden && start_hidden
}

/// Re-register the global shortcut for a short window after a failed first
/// attempt. Relaunches and sign-in can race another process that still owns the
/// combination for a moment; a transient conflict should not cost the shortcut
/// for the whole session.
const SHORTCUT_RETRY_SECONDS: [u64; 4] = [1, 2, 4, 8];

async fn retry_global_shortcut(app: tauri::AppHandle, shortcut: Shortcut) {
    for delay in SHORTCUT_RETRY_SECONDS {
        tokio::time::sleep(Duration::from_secs(delay)).await;
        if app.global_shortcut().register(shortcut).is_ok() {
            eprintln!("MatchRadar global shortcut: registered after retry");
            return;
        }
    }
    eprintln!("MatchRadar global shortcut: Ctrl+Shift+M is unavailable");
    let _ = app.emit("shortcut-unavailable", ());
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_focused().unwrap_or(false)
        && window.is_visible().unwrap_or(false)
        && !window.is_minimized().unwrap_or(false)
    {
        hide_main_window(&window);
    } else {
        show_main_window(&window);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                show_main_window(&window);
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
            let _ = PROVIDER_LOG.set(dir.join("provider.log"));
            let path = dir.join("state.json");
            let loaded = persistence::load(&path)
                .or_else(|error| {
                    eprintln!("MatchRadar persistence: {error}");
                    persistence::start_over(&path)
                })
                // A subsystem build has no console; leave a trail in provider.log.
                .map_err(|error| {
                    append_log(
                        &dir.join("provider.log"),
                        &format!("{} persistence: {error}", Utc::now().to_rfc3339()),
                    );
                    std::io::Error::other(error)
                })?;
            if let Some(notice) = loaded.notice {
                eprintln!("MatchRadar persistence: {notice}");
                append_log(
                    &dir.join("provider.log"),
                    &format!("{} persistence: {notice}", Utc::now().to_rfc3339()),
                );
            }
            let mut snapshot = loaded.snapshot;
            snapshot.refreshing = false;
            refresh::mark_cached(&mut snapshot);
            alerts::cleanup(&mut snapshot, Utc::now());
            delivery::cleanup(&mut snapshot, Utc::now());
            let launched_hidden = std::env::args().any(|arg| arg == "--hidden");
            let start_hidden = snapshot.settings.start_hidden;
            let start_in_tray = starts_in_tray(launched_hidden, start_hidden);
            if let Some(window) = app.get_webview_window("main") {
                // The configured window is created hidden. Restore only placement and
                // size: a widget must never reopen from an old maximized/fullscreen
                // state (it would fight compact sizing), and visibility is decided
                // below so a sign-in launch never paints or steals focus first.
                if let Err(error) = window.restore_state(StateFlags::POSITION | StateFlags::SIZE) {
                    eprintln!("MatchRadar window state: {error}");
                }
                if let Err(error) = window.set_always_on_top(snapshot.settings.always_on_top) {
                    eprintln!("MatchRadar always-on-top: {error}");
                }
                if !snapshot.settings.compact {
                    // The plugin caches whatever size it last saw, including ticker
                    // mode's 112px strip; logical_size() reports it clamped to the
                    // floor, so the raw size decides whether a resize is needed.
                    if let Ok(current) = logical_size_unbounded(&window) {
                        if let Some(target) = restore_target(current, snapshot.expanded_size) {
                            let _ = resize(&window, target);
                        }
                    }
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
                if !start_in_tray {
                    if let Err(error) = window.show() {
                        eprintln!("MatchRadar show window: {error}");
                    }
                }
                // The saved position may belong to a monitor that is no longer attached.
                // Hidden windows are left alone; showing one recovers its placement.
                if let Err(error) = ensure_visible(&window) {
                    eprintln!("MatchRadar window recovery: {error}");
                }
                // Only a launch-at-sign-in with the user's start-hidden preference on
                // stays in the tray; a manual launch is brought to the foreground after
                // it has been placed on a display.
                if !start_in_tray {
                    if let Err(error) = window.set_focus() {
                        eprintln!("MatchRadar focus window: {error}");
                    }
                }
            }
            let detail_cache = snapshot.detail_cache.clone();
            let cache = details::Cache::default();
            cache.seed(&detail_cache);
            app.manage(cache);
            app.manage(results::History::default());
            app.manage(notification_navigation::Navigation::default());
            app.manage(State {
                snapshot: Mutex::new(snapshot),
                path,
                wake: tokio::sync::Notify::new(),
                notification_wake: tokio::sync::Notify::new(),
                force_fixtures: AtomicBool::new(false),
                settings_lock: Mutex::new(()),
                refresh_lock: tokio::sync::Mutex::new(()),
                last_persist: Mutex::new(None),
                manual_refresh_at: Mutex::new(None),
            });
            if let Err(error) = persist(&app.state::<State>()) {
                eprintln!("MatchRadar persistence: {error}");
            }
            let notification_app = app.handle().clone();
            app.notification().on_action(move |action| {
                if action.action_id() != "tap" {
                    return;
                }
                let match_id = action
                    .notification()
                    .and_then(|notification| notification.extra().get("matchId"))
                    .and_then(serde_json::Value::as_str);
                notification_app
                    .state::<notification_navigation::Navigation>()
                    .activate(match_id);
                let _ = notification_app.emit("notification-opened", ());
                let handle = notification_app.clone();
                if let Err(error) = notification_app.run_on_main_thread(move || {
                    if let Some(window) = handle.get_webview_window("main") {
                        show_main_window(&window);
                    }
                }) {
                    eprintln!("MatchRadar notification window activation: {error}");
                }
            })?;
            // An entry written by an older build has no --hidden argument; rewrite
            // it once when start-hidden is enabled so the setting takes effect now.
            if start_hidden && app.autolaunch().is_enabled().unwrap_or(false) {
                if let Err(error) = app.autolaunch().enable() {
                    eprintln!("MatchRadar autostart: {error}");
                }
            }
            let shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyM);
            if let Err(error) = app.global_shortcut().register(shortcut) {
                eprintln!("MatchRadar global shortcut: {error}; retrying");
                spawn_monitored(
                    "shortcut retry",
                    false,
                    retry_global_shortcut(app.handle().clone(), shortcut),
                );
            }
            let show = MenuItem::with_id(app, "show", "Show MatchRadar", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide MatchRadar", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &settings, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("MatchRadar")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => {
                        // Poll results are saved at most every five minutes; flush the
                        // latest fixtures, alert baselines and freshness before exiting.
                        if let Err(error) = persist(&app.state::<State>()) {
                            eprintln!("MatchRadar persistence on quit: {error}");
                        }
                        app.exit(0)
                    }
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            show_main_window(&window);
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            hide_main_window(&window);
                        }
                    }
                    "settings" => {
                        if let Some(w) = app.get_webview_window("main") {
                            show_main_window(&w);
                            let _ = app.emit("open-settings", ());
                        }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            show_main_window(&window);
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            spawn_monitored("poll", true, poll(app.handle().clone()));
            spawn_monitored(
                "notification delivery",
                true,
                deliver_notifications(app.handle().clone()),
            );
            spawn_monitored("window watchdog", true, watch_window(app.handle().clone()));
            spawn_monitored("resume watchdog", true, watch_resume(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                hide_window(window);
            }
            // The window is tray-only: a minimize from any source (for example
            // Win+Down) hides it instead of leaving it minimized off-screen.
            tauri::WindowEvent::Resized(_) => {
                if window.is_minimized().unwrap_or(false) {
                    hide_window(window);
                }
            }
            tauri::WindowEvent::ScaleFactorChanged {
                scale_factor,
                new_inner_size,
                ..
            } => {
                if let Some(window) = window.app_handle().get_webview_window("main") {
                    let (compact, expanded_size) = {
                        let state = window.app_handle().state::<State>();
                        let snapshot = snapshot_lock(&state);
                        (snapshot.settings.compact, snapshot.expanded_size)
                    };
                    if let Some(target) = dpi_repair_target(
                        new_inner_size.width,
                        new_inner_size.height,
                        *scale_factor,
                        compact,
                        expanded_size,
                    ) {
                        // Ticker mode is deliberately shorter than ExpandedSize's floor,
                        // so repair with the exact logical target instead of resize().
                        if let Err(error) =
                            window.set_size(tauri::LogicalSize::new(target.width, target.height))
                        {
                            eprintln!("MatchRadar DPI size repair: {error}");
                        }
                    }
                    if let Err(error) = ensure_visible(&window) {
                        eprintln!("MatchRadar window recovery: {error}");
                    }
                }
            }
            // Restored focus is a cheap moment to confirm placement.
            tauri::WindowEvent::Focused(true) => {
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
            test_notification,
            get_notification_target,
            acknowledge_notification_target
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
            manual_refresh_at: Mutex::new(None),
        };
        let error = persist(&state).unwrap_err();
        assert!(error.contains("Save MatchRadar state"));
        assert!(error.contains(path.to_string_lossy().as_ref()));
    }
    #[test]
    fn periodic_save_serializes_with_acknowledged_settings_writes() {
        let state = std::sync::Arc::new(State {
            snapshot: Mutex::new(Snapshot::default()),
            path: PathBuf::new(),
            wake: tokio::sync::Notify::new(),
            notification_wake: tokio::sync::Notify::new(),
            force_fixtures: AtomicBool::new(false),
            settings_lock: Mutex::new(()),
            refresh_lock: tokio::sync::Mutex::new(()),
            last_persist: Mutex::new(None),
            manual_refresh_at: Mutex::new(None),
        });
        let disk = std::sync::Arc::new(Mutex::new(0));
        let (started, wait_started) = std::sync::mpsc::channel();
        let competing_state = state.clone();
        let competing_disk = disk.clone();
        let mut writer = None;
        persist_with(&state, |snapshot| {
            assert!(
                state.snapshot.try_lock().is_err(),
                "save must retain the snapshot lock"
            );
            writer = Some(std::thread::spawn(move || {
                started.send(()).unwrap();
                let mut snapshot = snapshot_lock(&competing_state);
                snapshot.settings.opacity = 80;
                *competing_disk.lock().unwrap() = snapshot.settings.opacity;
            }));
            wait_started.recv().unwrap();
            *disk.lock().unwrap() = snapshot.settings.opacity;
            Ok(())
        })
        .unwrap();
        writer.unwrap().join().unwrap();
        assert_eq!(*disk.lock().unwrap(), 80);
    }
}

#[cfg(test)]
mod detail_cache_tests {
    use super::*;

    fn detail(id: &str, minute: u32) -> details::Details {
        details::Details {
            match_id: id.into(),
            match_state: Some("in".into()),
            league: Competition::PremierLeague,
            venue: None,
            venue_city: None,
            referee: None,
            capacity: None,
            statistics_note: None,
            attendance: None,
            form: Default::default(),
            leaders: Vec::new(),
            season_name: None,
            matchweek: None,
            broadcasts: Vec::new(),
            weather: None,
            predictor: None,
            standings: Vec::new(),
            events: Vec::new(),
            statistics: Vec::new(),
            players: Vec::new(),
            scorers: Vec::new(),
            substitutions: Vec::new(),
            formations: Default::default(),
            coaches: Vec::new(),
            updated_at: format!("2026-01-01T00:{minute:02}:00Z"),
            error: None,
            stale: false,
        }
    }

    fn snapshot_with_live_ids(ids: &[String]) -> Snapshot {
        let template = demo::mock().remove(0);
        let matches = ids
            .iter()
            .map(|id| {
                let mut m = template.clone();
                m.id = id.clone();
                m
            })
            .collect();
        Snapshot {
            matches,
            ..Snapshot::default()
        }
    }

    #[test]
    fn dead_entries_are_pruned_before_the_cache_cap() {
        let valid_ids: Vec<String> = (1..=14).map(|i| format!("10{i:02}")).collect();
        let new_id = "2000".to_string();
        let live_ids: Vec<String> = valid_ids
            .iter()
            .cloned()
            .chain(std::iter::once(new_id.clone()))
            .collect();
        let mut snapshot = snapshot_with_live_ids(&live_ids);
        for i in 0..10 {
            snapshot
                .detail_cache
                .push(detail(&format!("30{i:02}"), 40 + i));
        }
        for (i, id) in valid_ids.iter().enumerate() {
            snapshot.detail_cache.push(detail(id, 20 + i as u32));
        }
        assert_eq!(snapshot.detail_cache.len(), 24);

        let incoming = detail(&new_id, 50);
        assert_eq!(
            update_detail_cache(&mut snapshot, &incoming, details::Phase::Live),
            DetailPersist::Immediate
        );

        assert_eq!(snapshot.detail_cache.len(), 15);
        assert!(live_ids.iter().all(|id| snapshot
            .detail_cache
            .iter()
            .any(|detail| detail.match_id == *id)));
        assert!(!snapshot
            .detail_cache
            .iter()
            .any(|detail| detail.match_id.starts_with("30")));
    }

    #[test]
    fn unchanged_live_detail_does_not_request_a_disk_write() {
        let id = "1001".to_string();
        let mut snapshot = snapshot_with_live_ids(std::slice::from_ref(&id));
        let cached = detail(&id, 10);
        snapshot.detail_cache.push(cached.clone());
        let mut incoming = cached;
        incoming.updated_at = "2026-01-01T00:11:00Z".into();
        let before = snapshot.detail_cache.clone();

        assert_eq!(
            update_detail_cache(&mut snapshot, &incoming, details::Phase::Live),
            DetailPersist::None
        );
        assert_eq!(snapshot.detail_cache, before);
    }

    #[test]
    fn changed_live_detail_for_a_cached_match_is_periodic() {
        let id = "1001".to_string();
        let mut snapshot = snapshot_with_live_ids(std::slice::from_ref(&id));
        snapshot.detail_cache.push(detail(&id, 10));
        let mut incoming = detail(&id, 11);
        incoming.venue = Some("Changed venue".into());

        assert_eq!(
            update_detail_cache(&mut snapshot, &incoming, details::Phase::Live),
            DetailPersist::Periodic
        );
        assert_eq!(snapshot.detail_cache.len(), 1);
        assert_eq!(
            snapshot.detail_cache[0].venue.as_deref(),
            Some("Changed venue")
        );
        assert_eq!(snapshot.detail_cache[0].updated_at, incoming.updated_at);
    }

    #[test]
    fn first_time_and_final_details_are_immediate() {
        let first_id = "1001".to_string();
        let final_id = "1002".to_string();
        let live_ids = vec![first_id.clone(), final_id.clone()];
        let mut snapshot = snapshot_with_live_ids(&live_ids);

        let first = detail(&first_id, 10);
        assert_eq!(
            update_detail_cache(&mut snapshot, &first, details::Phase::Live),
            DetailPersist::Immediate
        );

        snapshot.detail_cache.push(detail(&final_id, 11));
        let mut final_detail = detail(&final_id, 12);
        final_detail.match_state = Some("post".into());
        final_detail.venue = Some("Final venue".into());
        assert_eq!(
            update_detail_cache(&mut snapshot, &final_detail, details::Phase::Final),
            DetailPersist::Immediate
        );
    }

    #[test]
    fn missing_stale_detail_recovers_a_transiently_failed_first_write() {
        let id = "1001".to_string();
        let mut snapshot = snapshot_with_live_ids(std::slice::from_ref(&id));
        let mut stale = detail(&id, 10);
        stale.stale = true;
        stale.error = Some("offline".into());

        assert_eq!(
            update_detail_cache(&mut snapshot, &stale, details::Phase::Live),
            DetailPersist::Immediate
        );
        assert_eq!(snapshot.detail_cache.len(), 1);
        assert!(snapshot.detail_cache[0].stale);

        assert_eq!(
            update_detail_cache(&mut snapshot, &stale, details::Phase::Live),
            DetailPersist::None
        );
        assert_eq!(snapshot.detail_cache.len(), 1);
    }

    #[test]
    fn stale_detail_outside_the_fixture_window_is_not_cached() {
        let live_id = "1001".to_string();
        let mut snapshot = snapshot_with_live_ids(std::slice::from_ref(&live_id));
        let mut stale = detail("9999", 10);
        stale.stale = true;

        assert_eq!(
            update_detail_cache(&mut snapshot, &stale, details::Phase::Live),
            DetailPersist::None
        );
        assert!(snapshot.detail_cache.is_empty());
    }

    #[test]
    fn clean_detail_heals_a_persisted_stale_entry_immediately() {
        let id = "1001".to_string();
        let mut snapshot = snapshot_with_live_ids(std::slice::from_ref(&id));
        let mut stale = detail(&id, 10);
        stale.stale = true;
        stale.error = Some("offline".into());
        assert_eq!(
            update_detail_cache(&mut snapshot, &stale, details::Phase::Live),
            DetailPersist::Immediate
        );
        assert!(snapshot.detail_cache[0].stale);

        let recovered = detail(&id, 15);
        assert_eq!(
            update_detail_cache(&mut snapshot, &recovered, details::Phase::Live),
            DetailPersist::Immediate
        );
        assert!(!snapshot.detail_cache[0].stale);
        assert!(snapshot.detail_cache[0].error.is_none());
        assert_eq!(snapshot.detail_cache[0].updated_at, recovered.updated_at);
    }

    #[test]
    fn notification_retry_flushes_in_memory_ack_when_queue_is_empty() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T15:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut snapshot = Snapshot::default();
        snapshot.sent_notifications.push("1001:score:1:0".into());
        let mut save_failures = 1u32;
        let mut saves = 0usize;

        deliver_notifications_step(
            &mut snapshot,
            &mut save_failures,
            || now,
            |_| panic!("empty queue should not submit"),
            |_| {
                saves += 1;
                Err("disk temporarily locked".into())
            },
            |_| {},
        );
        assert_eq!(saves, 1);
        assert_eq!(save_failures, 2);

        deliver_notifications_step(
            &mut snapshot,
            &mut save_failures,
            || now,
            |_| panic!("empty queue should not submit"),
            |_| {
                saves += 1;
                Ok(())
            },
            |_| {},
        );
        assert_eq!(saves, 2);
        assert_eq!(save_failures, 0);
    }
}

#[cfg(test)]
mod native_tests {
    use super::*;

    #[test]
    fn only_a_sign_in_launch_with_start_hidden_stays_in_the_tray() {
        assert!(starts_in_tray(true, true));
        assert!(!starts_in_tray(true, false));
        assert!(!starts_in_tray(false, true));
        assert!(!starts_in_tray(false, false));
    }

    #[test]
    fn manual_refresh_coalesces_only_successful_recent_cycles() {
        let now = std::time::Instant::now();
        let recent = now - Duration::from_secs(5);
        assert!(manual_refresh_allowed(None, now, false));
        assert!(!manual_refresh_allowed(Some(recent), now, false));
        assert!(manual_refresh_allowed(
            Some(now - Duration::from_secs(15)),
            now,
            false
        ));
        assert!(manual_refresh_allowed(Some(recent), now, true));
    }

    #[test]
    fn log_rotation_replaces_a_previous_windows_backup() {
        let directory = std::env::temp_dir().join(format!(
            "matchradar-log-test-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        fs::create_dir_all(&directory).unwrap();
        let path = directory.join("provider.log");
        let rotated = path.with_extension("log.1");
        fs::write(&path, vec![b'x'; 1_000_001]).unwrap();
        fs::write(&rotated, "previous backup").unwrap();
        append_log(&path, "next line");
        assert_eq!(fs::read(&rotated).unwrap().len(), 1_000_001);
        assert!(fs::metadata(&path).unwrap().len() < 100);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn shortcut_retry_is_bounded_and_positive() {
        // Guards against accidentally retrying forever or busy-looping.
        assert!(SHORTCUT_RETRY_SECONDS.iter().all(|delay| *delay > 0));
        assert!(SHORTCUT_RETRY_SECONDS.iter().sum::<u64>() <= 30);
    }
}
