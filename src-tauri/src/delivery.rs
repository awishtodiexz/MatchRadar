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
mod tests {
    use super::*;
    use crate::model::MatchAlert;
    use std::{cell::RefCell, collections::VecDeque};

    fn now() -> DateTime<Utc> {
        date("2026-10-28T12:00:00Z").unwrap()
    }
    fn subscribed(status: &str) -> Snapshot {
        let mut s = Snapshot::default();
        let mut m = crate::provider::mock().remove(0);
        m.id = "match-1".into();
        m.status = status.into();
        m.kickoff = now().to_rfc3339();
        m.home_score = Some(0);
        m.away_score = Some(0);
        s.matches = vec![m];
        s.settings.favorites.clear();
        s.settings.goals = false;
        s.settings.starts = false;
        s.settings.reminders = false;
        s.settings.match_alerts.insert(
            "match-1".into(),
            MatchAlert {
                enabled: true,
                expires_at: (now() + Duration::days(1)).to_rfc3339(),
            },
        );
        s
    }
    fn goal() -> Snapshot {
        let mut s = subscribed("live");
        enqueue(&mut s, &["match-1".into()], now() - Duration::minutes(1));
        s.matches[0].home_score = Some(1);
        enqueue(&mut s, &["match-1".into()], now());
        assert_eq!(s.pending_notifications.len(), 1);
        s
    }
    fn reminder() -> Snapshot {
        let mut s = subscribed("scheduled");
        s.matches[0].kickoff = (now() + Duration::minutes(60)).to_rfc3339();
        s.settings.reminder_minutes = 120;
        enqueue(&mut s, &[], now());
        assert_eq!(s.pending_notifications.len(), 1);
        s
    }
    #[derive(Default)]
    struct Sink {
        results: VecDeque<Result<(), SubmissionError>>,
        calls: Vec<String>,
    }
    impl Sink {
        fn submit(&mut self, event: &PendingNotification) -> Result<(), SubmissionError> {
            self.calls.push(event.id.clone());
            self.results.pop_front().unwrap_or(Ok(()))
        }
    }
    fn run(s: &mut Snapshot, at: DateTime<Utc>, sink: &mut Sink) {
        submit_due(s, || at, |e| sink.submit(e), |_| Ok(()), |_| {}).unwrap();
    }
    fn reload(s: &Snapshot) -> Snapshot {
        serde_json::from_slice(&serde_json::to_vec(s).unwrap()).unwrap()
    }
    fn temporary() -> Result<(), SubmissionError> {
        Err(SubmissionError::Temporary(
            "temporary native failure".into(),
        ))
    }

    #[test]
    fn fail_once_retains_durable_event_despite_advanced_baseline_then_acknowledges_success() {
        let mut s = goal();
        let durable = RefCell::new(Snapshot::default());
        let mut calls = 0;
        submit_due(
            &mut s,
            now,
            |event| {
                calls += 1;
                assert_eq!(durable.borrow().pending_notifications[0], *event);
                assert_eq!(durable.borrow().alert_baselines["match-1"].home, Some(1));
                assert!(durable.borrow().sent_notifications.is_empty());
                temporary()
            },
            |snapshot| {
                *durable.borrow_mut() = reload(snapshot);
                Ok(())
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(calls, 1);
        assert!(s.sent_notifications.is_empty());
        assert_eq!(s.pending_notifications[0].attempts, 1);
        // Identical confirmed polls neither duplicate the event nor reset its retry deadline.
        enqueue(&mut s, &["match-1".into()], now() + Duration::seconds(10));
        let mut sink = Sink::default();
        run(&mut s, now() + Duration::seconds(29), &mut sink);
        assert!(sink.calls.is_empty());
        run(&mut s, now() + Duration::seconds(30), &mut sink);
        run(&mut s, now() + Duration::seconds(31), &mut sink);
        assert_eq!(sink.calls, ["match-1:score:1:0"]);
        assert_eq!(s.sent_notifications, sink.calls);
        assert!(s.pending_notifications.is_empty());
    }

    #[test]
    fn start_event_survives_failure_and_restart_without_replanning_the_transition() {
        let mut s = subscribed("scheduled");
        enqueue(&mut s, &[], now() - Duration::minutes(1));
        s.matches[0].status = "live".into();
        enqueue(&mut s, &["match-1".into()], now());
        let mut sink = Sink {
            results: [temporary()].into(),
            ..Sink::default()
        };
        run(&mut s, now(), &mut sink);
        let mut restarted = reload(&s);
        assert_eq!(restarted.pending_notifications[0].id, "match-1:start");
        assert_eq!(restarted.alert_baselines["match-1"].status, "live");
        enqueue(
            &mut restarted,
            &["match-1".into()],
            now() + Duration::seconds(20),
        );
        run(&mut restarted, now() + Duration::seconds(30), &mut sink);
        assert_eq!(sink.calls, ["match-1:start", "match-1:start"]);
        assert_eq!(restarted.sent_notifications, ["match-1:start"]);
        assert!(restarted.pending_notifications.is_empty());
    }

    #[test]
    fn repeated_failures_back_off_and_stop_after_five_attempts_without_reenqueuing_reminders() {
        let mut s = reminder();
        let mut sink = Sink {
            results: (0..5).map(|_| temporary()).collect(),
            ..Sink::default()
        };
        for (i, seconds) in [0, 30, 90, 210, 450].into_iter().enumerate() {
            let at = now() + Duration::seconds(seconds);
            enqueue(&mut s, &[], at);
            run(&mut s, at, &mut sink);
            assert_eq!(sink.calls.len(), i + 1);
            run(&mut s, at + Duration::seconds(1), &mut sink);
            assert_eq!(sink.calls.len(), i + 1);
        }
        enqueue(&mut s, &[], now() + Duration::minutes(20));
        run(&mut s, now() + Duration::minutes(20), &mut sink);
        assert_eq!(sink.calls.len(), 5);
        assert_eq!(s.pending_notifications[0].attempts, MAX_ATTEMPTS);
        assert_eq!(
            next_due(&s, now()),
            Some(std::time::Duration::from_secs(3600))
        );
        run(&mut s, now() + Duration::hours(1), &mut sink);
        assert!(s.pending_notifications.is_empty());
        assert!(s.sent_notifications.is_empty());
    }

    #[test]
    fn expired_goals_starts_and_reminders_never_submit_or_gain_sent_ids() {
        let mut s = goal();
        let mut start = s.pending_notifications[0].clone();
        start.kind = NotificationKind::Start;
        start.id = id(&start.match_id, &start.kind);
        start.expires_at = (now() + Duration::minutes(10)).to_rfc3339();
        s.pending_notifications.push(start);
        let mut sink = Sink::default();
        run(&mut s, now() + Duration::minutes(5), &mut sink);
        assert_eq!(sink.calls, ["match-1:start"]);
        let mut s = reminder();
        run(&mut s, now() + Duration::hours(1), &mut sink);
        assert!(s.pending_notifications.is_empty());
        assert!(s.sent_notifications.is_empty());
        let mut s = goal();
        s.pending_notifications[0].kind = NotificationKind::Start;
        s.pending_notifications[0].id = "match-1:start".into();
        run(&mut s, now() + Duration::hours(4), &mut sink);
        assert!(s.pending_notifications.is_empty());
        assert_eq!(sink.calls.len(), 1);
    }

    #[test]
    fn overlapping_eligibility_has_one_id_and_mute_or_global_disable_cancels_pending_work() {
        let mut s = goal();
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.goals = true;
        enqueue(&mut s, &["match-1".into()], now());
        assert_eq!(s.pending_notifications.len(), 1);
        s.settings.match_alerts.get_mut("match-1").unwrap().enabled = false;
        let mut sink = Sink::default();
        run(&mut s, now(), &mut sink);
        assert!(sink.calls.is_empty());
        s = goal();
        s.settings.match_alerts.clear(); // No followed team: no longer eligible.
        run(&mut s, now(), &mut sink);
        assert!(sink.calls.is_empty());
        s = goal();
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.match_alerts.clear();
        s.settings.goals = false;
        run(&mut s, now(), &mut sink);
        assert!(sink.calls.is_empty());
        s = goal(); // Individual subscriptions opt in even with global switches off.
        run(&mut s, now(), &mut sink);
        assert_eq!(sink.calls.len(), 1);
    }

    #[test]
    fn first_observations_and_score_corrections_keep_existing_high_water_safeguards() {
        let mut s = subscribed("live");
        s.matches[0].home_score = Some(3);
        enqueue(&mut s, &["match-1".into()], now());
        assert!(s.pending_notifications.is_empty());
        s.matches[0].home_score = Some(4);
        enqueue(&mut s, &["match-1".into()], now() + Duration::minutes(1));
        assert_eq!(s.pending_notifications.len(), 1);
        s.matches[0].home_score = Some(3); // Confirmed correction invalidates queued 4-0.
        enqueue(&mut s, &["match-1".into()], now() + Duration::minutes(2));
        assert!(s.pending_notifications.is_empty());
        s.matches[0].home_score = Some(4);
        enqueue(&mut s, &["match-1".into()], now() + Duration::minutes(3));
        assert!(s.pending_notifications.is_empty());
        s.matches[0].home_score = Some(5);
        enqueue(&mut s, &["match-1".into()], now() + Duration::minutes(4));
        assert_eq!(s.pending_notifications.len(), 1);
        assert_eq!(s.pending_notifications[0].id, "match-1:score:5:0");
    }

    #[test]
    fn unavailable_submission_pauses_the_whole_queue_persistently_without_false_acknowledgment() {
        let mut s = reminder();
        let mut second = s.pending_notifications[0].clone();
        second.match_id = "match-2".into();
        second.id = "match-2:reminder".into();
        s.settings.favorites.push(second.home_team.clone());
        s.settings.reminders = true;
        s.pending_notifications.push(second);
        let mut sink = Sink {
            results: [Err(SubmissionError::Unavailable(
                "permission denied".into(),
            ))]
            .into(),
            ..Sink::default()
        };
        run(&mut s, now(), &mut sink);
        assert_eq!(sink.calls.len(), 1);
        assert!(s.sent_notifications.is_empty());
        let mut s = reload(&s);
        run(&mut s, now() + Duration::minutes(1), &mut sink);
        assert_eq!(sink.calls.len(), 1);
        assert_eq!(
            next_due(&s, now()),
            Some(std::time::Duration::from_secs(1800))
        );
        run(&mut s, now() + Duration::minutes(30), &mut sink);
        assert_eq!(sink.calls.len(), 3);
        assert!(s.pending_notifications.is_empty());
    }

    #[test]
    fn stale_f03_scores_never_create_or_advance_events_but_confirmed_pending_events_can_retry() {
        let mut s = subscribed("live");
        enqueue(&mut s, &["match-1".into()], now() - Duration::minutes(1));
        s.matches[0].home_score = Some(1);
        enqueue(&mut s, &[], now()); // Monthly data alone does not confirm a live score.
        assert!(s.pending_notifications.is_empty());
        s.matches[0].score_stale = true;
        enqueue(&mut s, &["match-1".into()], now()); // Defensive stale guard, even with a bad ID list.
        assert!(s.pending_notifications.is_empty());
        assert_eq!(s.alert_baselines["match-1"].home, Some(0));
        s.matches[0].score_stale = false;
        enqueue(&mut s, &["match-1".into()], now());
        assert_eq!(s.pending_notifications.len(), 1);
        s.matches[0].score_stale = true;
        let mut sink = Sink::default();
        run(&mut s, now() + Duration::seconds(30), &mut sink);
        assert_eq!(sink.calls.len(), 1); // Retrying an already-confirmed event is safe.
    }

    #[test]
    fn legacy_ids_baselines_and_settings_survive_queue_defaults_and_round_trips() {
        let mut s = goal();
        let mut old = serde_json::to_value(&s).unwrap();
        old.as_object_mut().unwrap().remove("pendingNotifications");
        old.as_object_mut()
            .unwrap()
            .remove("notificationRetryAfter");
        old["sentNotifications"] = serde_json::json!(["match-1:score:1:0"]);
        let mut legacy: Snapshot = serde_json::from_value(old).unwrap();
        assert!(legacy.pending_notifications.is_empty());
        assert_eq!(legacy.alert_baselines["match-1"].high_water, 1);
        assert_eq!(legacy.settings, s.settings);
        enqueue(
            &mut legacy,
            &["match-1".into()],
            now() + Duration::seconds(30),
        );
        assert!(legacy.pending_notifications.is_empty());
        s.sent_notifications = legacy.sent_notifications.clone();
        cleanup(&mut s, now());
        assert!(s.pending_notifications.is_empty());
        assert_eq!(reload(&s).sent_notifications, legacy.sent_notifications);
    }

    #[test]
    fn partial_provider_results_and_restart_retain_pending_events_without_planning_saved_scores() {
        let mut s = goal();
        let baseline = s.alert_baselines["match-1"].seen_at.clone();
        let pending = s.pending_notifications.clone();
        let mut month = s.matches[0].clone();
        month.home_score = Some(2); // Monthly progress is not a newly confirmed goal.
        let applied = crate::refresh::apply(
            &mut s,
            crate::provider::FetchOutcome {
                matches: Some(vec![month]),
                error: None,
            },
            crate::provider::FetchOutcome::failed(crate::provider::FetchError {
                message: "Daily scoreboard HTTP 500".into(),
                retry_after: None,
            }),
            now() + Duration::seconds(10),
        );
        enqueue(&mut s, &applied.score_ids, now() + Duration::seconds(10));
        assert!(s.partial && s.matches[0].score_stale);
        assert_eq!(s.alert_baselines["match-1"].seen_at, baseline);
        assert_eq!(s.pending_notifications, pending);
        let mut s = reload(&s);
        let mut sink = Sink {
            results: [temporary()].into(),
            ..Sink::default()
        };
        run(&mut s, now() + Duration::seconds(10), &mut sink);
        let mut s = reload(&s);
        run(&mut s, now() + Duration::seconds(40), &mut sink);
        assert_eq!(sink.calls, ["match-1:score:1:0", "match-1:score:1:0"]);
        assert_eq!(s.sent_notifications, ["match-1:score:1:0"]);
        assert!(s.pending_notifications.is_empty());
        assert!(s.score_error.is_some());
    }

    #[test]
    fn persisted_entries_are_validated_deduplicated_and_bounded() {
        let s = goal();
        let mut wire = serde_json::to_value(&s).unwrap();
        let valid_entry = wire["pendingNotifications"][0].clone();
        let mut invalid = valid_entry.clone();
        invalid["id"] = "unrelated-id".into();
        let mut ancient = valid_entry.clone();
        ancient["expiresAt"] = (now() + Duration::days(1)).to_rfc3339().into();
        let mut attempts = valid_entry.clone();
        attempts["attempts"] = 200.into();
        let mut entries = vec![
            serde_json::json!({"bad":true}),
            invalid,
            ancient,
            attempts,
            valid_entry.clone(),
            valid_entry,
        ];
        for i in 0..100 {
            let mut event = s.pending_notifications[0].clone();
            event.match_id = format!("extra-{i}");
            event.id = id(&event.match_id, &event.kind);
            // Make every retained test entry eligible without a match override.
            entries.push(serde_json::to_value(event).unwrap());
        }
        wire["pendingNotifications"] = entries.into();
        let mut restored: Snapshot = serde_json::from_value(wire).unwrap();
        restored
            .settings
            .favorites
            .push(s.matches[0].home.id.clone());
        restored.settings.goals = true;
        cleanup(&mut restored, now());
        assert!(!restored.pending_notifications.is_empty());
        assert!(restored.pending_notifications.len() <= MAX_PENDING);
        assert_eq!(
            restored
                .pending_notifications
                .iter()
                .filter(|e| e.match_id == "match-1")
                .count(),
            1
        );
        assert!(restored.pending_notifications.iter().all(valid));
        restored.notification_retry_after = Some((now() + Duration::days(10)).to_rfc3339());
        cleanup(&mut restored, now());
        assert!(restored.notification_retry_after.is_none());
    }

    #[test]
    fn full_queue_stays_bounded_and_rescheduled_reminders_are_discarded() {
        let mut s = goal();
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.goals = true;
        for i in 1..MAX_PENDING {
            let mut event = s.pending_notifications[0].clone();
            event.match_id = format!("extra-{i}");
            event.id = id(&event.match_id, &event.kind);
            s.pending_notifications.push(event);
        }
        s.matches[0].home_score = Some(2);
        assert_eq!(
            enqueue(&mut s, &["match-1".into()], now() + Duration::seconds(30)),
            1
        );
        assert_eq!(s.pending_notifications.len(), MAX_PENDING);
        let mut s = reminder();
        s.matches[0].kickoff = (now() + Duration::days(2)).to_rfc3339();
        let mut sink = Sink::default();
        run(&mut s, now(), &mut sink);
        assert!(sink.calls.is_empty());
        assert!(s.pending_notifications.is_empty());
    }

    #[test]
    fn unconfirmed_monthly_final_scores_do_not_cancel_a_confirmed_pending_goal() {
        let mut s = goal();
        s.matches[0].status = "fulltime".into();
        s.matches[0].score_stale = false; // F03 only sets this marker on active matches.
        s.matches[0].home_score = Some(0);
        enqueue(&mut s, &[], now() + Duration::seconds(30));
        assert_eq!(s.pending_notifications.len(), 1);
        assert_eq!(s.alert_baselines["match-1"].home, Some(1));
        // Once a daily response confirms the correction, the queued goal is obsolete.
        enqueue(&mut s, &["match-1".into()], now() + Duration::seconds(60));
        assert!(s.pending_notifications.is_empty());
    }

    #[test]
    fn persistence_failure_prevents_submission_and_failed_ack_does_not_resubmit_in_process() {
        let mut s = goal();
        let mut calls = 0;
        let mut saves = 0;
        assert!(submit_due(
            &mut s,
            now,
            |_| {
                calls += 1;
                Ok(())
            },
            |_| {
                saves += 1;
                if saves == 2 {
                    Err("disk full before submission".into())
                } else {
                    Ok(())
                }
            },
            |_| {}
        )
        .is_err());
        assert_eq!(calls, 0);
        assert_eq!(s.pending_notifications[0].attempts, 0);
        saves = 0;
        assert!(submit_due(
            &mut s,
            now,
            |_| {
                calls += 1;
                Ok(())
            },
            |_| {
                saves += 1;
                if saves == 3 {
                    Err("acknowledgment save failed".into())
                } else {
                    Ok(())
                }
            },
            |_| {}
        )
        .is_err());
        assert_eq!(calls, 1);
        assert_eq!(s.sent_notifications, ["match-1:score:1:0"]);
        assert!(s.pending_notifications.is_empty());
        submit_due(
            &mut s,
            || now() + Duration::minutes(1),
            |_| {
                calls += 1;
                Ok(())
            },
            |_| Ok(()),
            |_| {},
        )
        .unwrap();
        assert_eq!(calls, 1);
    }

    #[test]
    fn slow_persistence_cannot_submit_an_event_that_expired_during_the_write() {
        let mut s = goal();
        let clock = std::cell::Cell::new(now());
        let mut calls = 0;
        submit_due(
            &mut s,
            || clock.get(),
            |_| {
                calls += 1;
                Ok(())
            },
            |_| {
                clock.set(now() + Duration::minutes(6));
                Ok(())
            },
            |_| {},
        )
        .unwrap();
        assert_eq!(calls, 0);
        assert!(s.pending_notifications.is_empty());
        assert!(s.sent_notifications.is_empty());
    }

    #[test]
    fn queue_round_trips_through_f01_repository_and_demo_switch_drops_live_pending_work() {
        let s = goal();
        let dir = std::env::temp_dir().join(format!(
            "matchradar-delivery-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("state.json");
        crate::persistence::save(&path, &s).unwrap();
        let mut loaded = crate::persistence::load(&path).unwrap().snapshot;
        assert_eq!(loaded.pending_notifications, s.pending_notifications);
        assert_eq!(loaded.alert_baselines["match-1"].home, Some(1));
        let mut settings = loaded.settings.clone();
        settings.mock = true;
        crate::model::apply_settings(&mut loaded, settings);
        assert!(loaded.pending_notifications.is_empty());
        loaded.matches = s.matches;
        enqueue(&mut loaded, &["match-1".into()], now());
        assert!(loaded.pending_notifications.is_empty());
        assert!(loaded.alert_baselines.is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
