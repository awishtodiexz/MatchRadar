//! Durable candidates are independent of observation baselines and native submission.
use crate::model::{Match, NotificationKind, PendingNotification, Snapshot};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Deserializer};
use std::collections::HashSet;

const MAX_PENDING: usize = 64;
const MAX_ATTEMPTS: u8 = 5;
const UNAVAILABLE_MINUTES: i64 = 2;

fn date(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}
fn id(match_id: &str, kind: &NotificationKind) -> String {
    match kind {
        NotificationKind::Reminder => format!("{match_id}:reminder"),
        NotificationKind::Start => format!("{match_id}:start"),
        NotificationKind::Goal { home, away } => format!("{match_id}:score:{home}:{away}"),
    }
}
fn lifetime(kind: &NotificationKind) -> Duration {
    match kind {
        NotificationKind::Reminder => Duration::minutes(120),
        NotificationKind::Start => Duration::minutes(10),
        NotificationKind::Goal { .. } => Duration::minutes(5),
    }
}
fn valid(event: &PendingNotification) -> bool {
    let identifier = |s: &str| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control);
    let (Some(created), Some(expires), Some(next)) = (
        date(&event.created_at),
        date(&event.expires_at),
        date(&event.next_attempt_at),
    ) else {
        return false;
    };
    identifier(&event.match_id)
        && identifier(&event.home_team)
        && identifier(&event.away_team)
        && event.id == id(&event.match_id, &event.kind)
        && !event.body.is_empty()
        && event.body.len() <= 512
        && !event.body.chars().any(char::is_control)
        && expires > created
        && expires - created <= lifetime(&event.kind)
        && next >= created
        && next <= expires
        && event.attempts <= MAX_ATTEMPTS
}

// Invalid individual queue records must not make an otherwise valid legacy state unreadable.
pub fn deserialize_pending<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<PendingNotification>, D::Error> {
    let values = serde_json::Value::deserialize(deserializer)?;
    Ok(values
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| serde_json::from_value(v.clone()).ok())
        .filter(valid)
        .take(MAX_PENDING)
        .collect())
}

fn eligible(snapshot: &Snapshot, event: &PendingNotification) -> bool {
    if event.match_id.starts_with("demo-") {
        return false;
    }
    if let Some(preference) = snapshot.settings.match_alerts.get(&event.match_id) {
        return preference.enabled;
    }
    let followed = snapshot.settings.favorites.contains(&event.home_team)
        || snapshot.settings.favorites.contains(&event.away_team);
    followed
        && match event.kind {
            NotificationKind::Reminder => snapshot.settings.reminders,
            NotificationKind::Start => snapshot.settings.starts,
            NotificationKind::Goal { .. } => snapshot.settings.goals,
        }
}
fn still_relevant(
    snapshot: &Snapshot,
    event: &PendingNotification,
    m: &Match,
    now: DateTime<Utc>,
) -> bool {
    if matches!(m.status.as_str(), "cancelled" | "postponed") {
        return false;
    }
    match event.kind {
        NotificationKind::Reminder => {
            m.status == "scheduled"
                && date(&m.kickoff).is_some_and(|k| {
                    k > now
                        && k - now
                            <= Duration::minutes(snapshot.settings.reminder_minutes.min(120) as i64)
                })
        }
        // Only planner-confirmed baselines can cancel a score. Monthly final-score data
        // is not necessarily daily-confirmed, even when score_stale is false (F03).
        NotificationKind::Goal { home, away } => snapshot
            .alert_baselines
            .get(&event.match_id)
            .is_none_or(|baseline| {
                baseline.home.is_some_and(|score| score >= home)
                    && baseline.away.is_some_and(|score| score >= away)
            }),
        NotificationKind::Start if !m.score_stale => m.status != "scheduled",
        _ => true,
    }
}

/// Returns how many state mutations the pass made, so callers can skip
/// persisting a snapshot nothing changed in.
pub fn cleanup(snapshot: &mut Snapshot, now: DateTime<Utc>) -> usize {
    let mut seen = HashSet::new();
    let mut dropped_reminders = Vec::new();
    let mut changed = 0usize;
    let pending_before = snapshot.pending_notifications.len();
    snapshot.pending_notifications = std::mem::take(&mut snapshot.pending_notifications)
        .into_iter()
        .filter(|event| {
            let keep = valid(event)
                // A backward clock step must not drop an already-queued alert:
                // its baseline advanced when it was planned, so the drop is
                // unrecoverable. Only a creation date beyond any plausible
                // step marks the record as corrupt.
                && date(&event.created_at).is_some_and(|t| t <= now + Duration::days(1))
                && date(&event.expires_at).is_some_and(|t| t > now)
                && !snapshot.sent_notifications.contains(&event.id)
                && eligible(snapshot, event)
                && snapshot
                    .matches
                    .iter()
                    .find(|m| m.id == event.match_id)
                    .is_none_or(|m| still_relevant(snapshot, event, m, now))
                && seen.insert(event.id.clone());
            if !keep && matches!(event.kind, NotificationKind::Reminder) {
                dropped_reminders.push(event.match_id.clone());
            }
            keep
        })
        .take(MAX_PENDING)
        .collect();
    changed += pending_before - snapshot.pending_notifications.len();
    // A reminder that never reached the OS must not leave its kickoff marked as
    // reminded. Clearing the marker lets a later mute/unmute, reminder-time change
    // or reschedule plan the reminder again; the sent list still suppresses an
    // already-delivered reminder.
    for match_id in dropped_reminders {
        if let Some(baseline) = snapshot.alert_baselines.get_mut(&match_id) {
            if baseline.reminder_kickoff.take().is_some() {
                changed += 1;
            }
        }
    }
    // Corrupt/far-future cooldowns must not disable alerts indefinitely after a clock change.
    if !snapshot
        .notification_retry_after
        .as_deref()
        .and_then(date)
        .is_some_and(|t| t > now && t - now <= Duration::minutes(UNAVAILABLE_MINUTES))
    {
        changed += usize::from(snapshot.notification_retry_after.is_some());
        snapshot.notification_retry_after = None;
    }
    changed
}

fn build_event(
    observed: &Snapshot,
    event_id: &str,
    body: &str,
    now: DateTime<Utc>,
) -> Option<PendingNotification> {
    observed.matches.iter().find_map(|m| {
        let kind = [
            NotificationKind::Reminder,
            NotificationKind::Start,
            NotificationKind::Goal {
                home: m.home_score.unwrap_or(0),
                away: m.away_score.unwrap_or(0),
            },
        ]
        .into_iter()
        .find(|kind| id(&m.id, kind) == event_id)?;
        let expiry = match kind {
            NotificationKind::Reminder => date(&m.kickoff)?.min(now + lifetime(&kind)),
            _ => now + lifetime(&kind),
        };
        Some(PendingNotification {
            id: event_id.to_owned(),
            match_id: m.id.clone(),
            home_team: m.home.id.clone(),
            away_team: m.away.id.clone(),
            body: body.to_owned(),
            kind,
            created_at: now.to_rfc3339(),
            expires_at: expiry.to_rfc3339(),
            next_attempt_at: now.to_rfc3339(),
            attempts: 0,
        })
    })
}

fn queue_candidates(
    snapshot: &mut Snapshot,
    observed: &Snapshot,
    candidates: Vec<(String, String)>,
    now: DateTime<Utc>,
) -> usize {
    let mut overflow = 0;
    for (event_id, body) in candidates {
        if snapshot
            .pending_notifications
            .iter()
            .any(|e| e.id == event_id)
        {
            continue;
        }
        let Some(event) = build_event(observed, &event_id, &body, now).filter(valid) else {
            continue;
        };
        // A newer confirmed scoreline makes an older undelivered goal obsolete.
        // Delivering both after a pause would replay stale scores for the same match.
        if matches!(event.kind, NotificationKind::Goal { .. }) {
            snapshot.pending_notifications.retain(|pending| {
                !(pending.match_id == event.match_id
                    && matches!(pending.kind, NotificationKind::Goal { .. }))
            });
        }
        if snapshot.pending_notifications.len() < MAX_PENDING {
            snapshot.pending_notifications.push(event);
        } else {
            overflow += 1;
        }
    }
    overflow
}

/// Called only with newly confirmed observations; retries never re-run the planner.
pub fn enqueue(snapshot: &mut Snapshot, score_ids: &[String], now: DateTime<Utc>) -> usize {
    crate::alerts::cleanup(snapshot, now);
    cleanup(snapshot, now);
    let mut observed = crate::refresh::notification_view(snapshot, score_ids);
    let candidates = crate::alerts::plan(&mut observed, now);
    snapshot.alert_baselines = observed.alert_baselines.clone();
    snapshot.sent_notifications = observed.sent_notifications.clone();
    let overflow = queue_candidates(snapshot, &observed, candidates, now);
    cleanup(snapshot, now);
    overflow
}

pub enum SubmissionError {
    Temporary(String),
    Unavailable(String),
}

/// Earliest retry/expiry deadline. Exhausted events remain as suppression records until expiry.
pub fn next_due(snapshot: &Snapshot, now: DateTime<Utc>) -> Option<std::time::Duration> {
    if snapshot.revalidate_pending {
        return snapshot
            .pending_notifications
            .iter()
            .filter_map(|event| date(&event.expires_at))
            .min()
            .map(|expiry| (expiry - now).to_std().unwrap_or_default());
    }
    let blocked = snapshot.notification_retry_after.as_deref().and_then(date);
    snapshot
        .pending_notifications
        .iter()
        .filter_map(|event| {
            let expiry = date(&event.expires_at)?;
            let due = if event.attempts >= MAX_ATTEMPTS {
                expiry
            } else {
                date(&event.next_attempt_at)?
                    .max(blocked.unwrap_or(now))
                    .min(expiry)
            };
            Some((due - now).to_std().unwrap_or_default())
        })
        .min()
}

/// Caller serializes with snapshot writes. Persist before each submission and after acknowledgment.
/// A failed acknowledgment save keeps the in-memory sent ID; caller retries persistence, not show().
pub fn submit_due(
    snapshot: &mut Snapshot,
    mut clock: impl FnMut() -> DateTime<Utc>,
    mut submit: impl FnMut(&PendingNotification) -> Result<(), SubmissionError>,
    mut save: impl FnMut(&Snapshot) -> Result<(), String>,
    mut log: impl FnMut(&str),
) -> Result<(), String> {
    let now = clock();
    let removed = cleanup(snapshot, now);
    if snapshot.pending_notifications.is_empty() {
        snapshot.revalidate_pending = false;
    }
    let waiting_retry = snapshot
        .notification_retry_after
        .as_deref()
        .and_then(date)
        .is_some_and(|t| t > now);
    let due: Vec<String> = snapshot
        .pending_notifications
        .iter()
        .filter(|event| {
            event.attempts < MAX_ATTEMPTS && date(&event.next_attempt_at).is_some_and(|t| t <= now)
        })
        .map(|event| event.id.clone())
        .collect();
    // A wake with nothing cleaned up, nothing to plan, and nothing submittable
    // must not cost the double fsync `save` performs; poll wakes arrive every
    // minute while a backed-off event sits in the queue.
    if removed == 0 && !snapshot.revalidate_pending && (due.is_empty() || waiting_retry) {
        return Ok(());
    }
    save(snapshot)?;
    if snapshot.revalidate_pending || waiting_retry {
        return Ok(());
    }
    for id in due {
        let Some(index) = snapshot
            .pending_notifications
            .iter()
            .position(|e| e.id == id)
        else {
            continue;
        };
        let mut staged = snapshot.clone();
        let event = &mut staged.pending_notifications[index];
        event.attempts += 1;
        let delay = Duration::seconds(30 * 2i64.pow(u32::from(event.attempts - 1)));
        let expires = date(&event.expires_at).unwrap_or_else(|| clock() + Duration::minutes(5));
        event.next_attempt_at = (clock() + delay).min(expires).to_rfc3339();
        // No native call if the durable attempt/candidate cannot be saved.
        save(&staged)?;
        *snapshot = staged;
        // Disk/native work can stall: recheck age immediately before handing off.
        if date(&snapshot.pending_notifications[index].expires_at).is_none_or(|t| t <= clock()) {
            snapshot.pending_notifications.remove(index);
            save(snapshot)?;
            continue;
        }
        let event = &snapshot.pending_notifications[index];
        match submit(event) {
            Ok(()) => {
                snapshot.sent_notifications.push(id);
                snapshot.pending_notifications.remove(index);
                if snapshot.sent_notifications.len() > 1000 {
                    snapshot
                        .sent_notifications
                        .drain(..snapshot.sent_notifications.len() - 1000);
                }
            }
            Err(error) => {
                let (reason, unavailable) = match error {
                    SubmissionError::Temporary(reason) => (reason, false),
                    SubmissionError::Unavailable(reason) => (reason, true),
                };
                let reason: String = reason
                    .chars()
                    .filter(|c| !c.is_control())
                    .take(512)
                    .collect();
                let event = &mut snapshot.pending_notifications[index];
                let expires =
                    date(&event.expires_at).unwrap_or_else(|| clock() + Duration::minutes(5));
                event.next_attempt_at = (clock() + delay).min(expires).to_rfc3339();
                log(&format!(
                    "Notification {} attempt {}: {}{}",
                    event.id,
                    event.attempts,
                    reason,
                    if unavailable {
                        "; submissions paused briefly"
                    } else if event.attempts >= MAX_ATTEMPTS {
                        "; retry limit reached"
                    } else {
                        "; retry scheduled"
                    }
                ));
                if unavailable {
                    snapshot.notification_retry_after =
                        Some((clock() + Duration::minutes(UNAVAILABLE_MINUTES)).to_rfc3339());
                    save(snapshot)?;
                    break;
                }
            }
        }
        save(snapshot)?;
    }
    Ok(())
}

// Kickoff times are already durable, so a reminder must not wait for the provider:
// a poll cycle that failed both fixtures and scores still has everything a reminder
// needs. Score events stay out of this path because only a newly confirmed response
// may advance their baselines.
fn queue_cached_reminders(snapshot: &mut Snapshot, now: DateTime<Utc>) {
    let mut observed = snapshot.clone();
    observed
        .matches
        .retain(|m| m.status == "scheduled" && !m.score_stale);
    let candidates: Vec<_> = crate::alerts::plan(&mut observed, now)
        .into_iter()
        .filter(|(event_id, _)| event_id.ends_with(":reminder"))
        .collect();
    snapshot.alert_baselines = observed.alert_baselines.clone();
    snapshot.sent_notifications = observed.sent_notifications.clone();
    if candidates.is_empty() {
        return;
    }
    cleanup(snapshot, now);
    queue_candidates(snapshot, &observed, candidates, now);
    cleanup(snapshot, now);
}

// A server-requested deferral parks the poll loop without new observations.
// Refresh seen_at on baselines of matches still tracked so the first
// post-deferral confirmation counts as recent instead of being dropped by the
// 5-minute goal and 10-minute start windows. Only a baseline still inside the
// outer window is extended: a chain of failed or deferred cycles never lets
// the clock run out, while a genuinely old observation (hours away with the
// app closed) stays cold and its first confirmed score is not replayed.
pub fn keep_baselines_warm(snapshot: &mut Snapshot, now: DateTime<Utc>) {
    let seen_at = now.to_rfc3339();
    for (id, baseline) in snapshot.alert_baselines.iter_mut() {
        let warm = snapshot.matches.iter().any(|m| &m.id == id)
            && date(&baseline.seen_at)
                .is_some_and(|seen| now - seen <= Duration::minutes(10));
        if warm {
            baseline.seen_at = seen_at.clone();
        }
    }
}

// Called after every poll cycle, even a failed one. Cached reminders are planned
// first; then migrated pending alerts stay held until their matches are freshly
// confirmed. Tracked baselines are re-warmed too: a cycle that confirmed nothing
// produced no observation, so the failure must not run the five-minute goal or
// ten-minute start windows down and swallow an event that happened mid-outage.
pub fn revalidate(snapshot: &mut Snapshot, score_ids: &[String], now: DateTime<Utc>) {
    queue_cached_reminders(snapshot, now);
    keep_baselines_warm(snapshot, now);
    if !snapshot.revalidate_pending {
        return;
    }
    cleanup(snapshot, now);
    if snapshot
        .pending_notifications
        .iter()
        .all(|event| score_ids.contains(&event.match_id))
    {
        snapshot.revalidate_pending = false;
    }
}

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod tests;
