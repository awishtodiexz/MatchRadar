//! Durable candidates are independent of observation baselines and native submission.
use crate::model::{Match, NotificationKind, PendingNotification, Snapshot};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Deserializer};
use std::collections::HashSet;

const MAX_PENDING: usize = 64;
const MAX_ATTEMPTS: u8 = 5;
const UNAVAILABLE_MINUTES: i64 = 30;

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
    if snapshot.settings.mock {
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

pub fn cleanup(snapshot: &mut Snapshot, now: DateTime<Utc>) {
    let mut seen = HashSet::new();
    snapshot.pending_notifications = std::mem::take(&mut snapshot.pending_notifications)
        .into_iter()
        .filter(|event| {
            valid(event)
                && date(&event.created_at).is_some_and(|t| t <= now)
                && date(&event.expires_at).is_some_and(|t| t > now)
                && !snapshot.sent_notifications.contains(&event.id)
                && eligible(snapshot, event)
                && snapshot
                    .matches
                    .iter()
                    .find(|m| m.id == event.match_id)
                    .is_none_or(|m| still_relevant(snapshot, event, m, now))
                && seen.insert(event.id.clone())
        })
        .take(MAX_PENDING)
        .collect();
    // Corrupt/far-future cooldowns must not disable alerts indefinitely after a clock change.
    if !snapshot
        .notification_retry_after
        .as_deref()
        .and_then(date)
        .is_some_and(|t| t > now && t - now <= Duration::minutes(UNAVAILABLE_MINUTES))
    {
        snapshot.notification_retry_after = None;
    }
}

/// Called only with newly confirmed observations; retries never re-run the planner.
pub fn enqueue(snapshot: &mut Snapshot, score_ids: &[String], now: DateTime<Utc>) -> usize {
    crate::alerts::cleanup(snapshot, now);
    cleanup(snapshot, now);
    if snapshot.settings.mock {
        return 0;
    }
    let mut observed = crate::refresh::notification_view(snapshot, score_ids);
    let candidates = crate::alerts::plan(&mut observed, now);
    snapshot.alert_baselines = observed.alert_baselines;
    let mut overflow = 0;
    for (event_id, body) in candidates {
        if snapshot
            .pending_notifications
            .iter()
            .any(|e| e.id == event_id)
        {
            continue;
        }
        let event = observed.matches.iter().find_map(|m| {
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
                id: event_id.clone(),
                match_id: m.id.clone(),
                home_team: m.home.id.clone(),
                away_team: m.away.id.clone(),
                body: body.clone(),
                kind,
                created_at: now.to_rfc3339(),
                expires_at: expiry.to_rfc3339(),
                next_attempt_at: now.to_rfc3339(),
                attempts: 0,
            })
        });
        if let Some(event) = event.filter(valid) {
            if snapshot.pending_notifications.len() < MAX_PENDING {
                snapshot.pending_notifications.push(event);
            } else {
                overflow += 1;
            }
        }
    }
    cleanup(snapshot, now);
    overflow
}

pub enum SubmissionError {
    Temporary(String),
    Unavailable(String),
}

/// Earliest retry/expiry deadline. Exhausted events remain as suppression records until expiry.
pub fn next_due(snapshot: &Snapshot, now: DateTime<Utc>) -> Option<std::time::Duration> {
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
    cleanup(snapshot, now);
    save(snapshot)?;
    if snapshot
        .notification_retry_after
        .as_deref()
        .and_then(date)
        .is_some_and(|t| t > now)
    {
        return Ok(());
    }
    let due: Vec<_> = snapshot
        .pending_notifications
        .iter()
        .filter(|event| {
            event.attempts < MAX_ATTEMPTS && date(&event.next_attempt_at).is_some_and(|t| t <= now)
        })
        .map(|event| event.id.clone())
        .collect();
    for id in due {
        let index = snapshot
            .pending_notifications
            .iter()
            .position(|e| e.id == id)
            .unwrap();
        let mut staged = snapshot.clone();
        let event = &mut staged.pending_notifications[index];
        event.attempts += 1;
        let delay = Duration::seconds(30 * 2i64.pow(u32::from(event.attempts - 1)));
        event.next_attempt_at = (clock() + delay)
            .min(date(&event.expires_at).unwrap())
            .to_rfc3339();
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
                event.next_attempt_at = (clock() + delay)
                    .min(date(&event.expires_at).unwrap())
                    .to_rfc3339();
                log(&format!(
                    "Notification {} attempt {}: {}{}",
                    event.id,
                    event.attempts,
                    reason,
                    if unavailable {
                        "; submissions paused for 30 minutes"
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

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod tests;
