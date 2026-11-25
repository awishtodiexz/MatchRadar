use super::*;
use crate::model::MatchAlert;
use std::{cell::RefCell, collections::VecDeque};

fn now() -> DateTime<Utc> {
    date("2026-10-28T12:00:00Z").unwrap()
}
fn subscribed(status: &str) -> Snapshot {
    let mut s = Snapshot::default();
    let mut m = crate::demo::mock().remove(0);
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
fn warmed_baselines_keep_a_goal_scored_during_deferral_inside_the_window() {
    let deferral_start = now() - Duration::minutes(1);
    let deferral_end = now() + Duration::minutes(15);
    // Without warming, a baseline observed >5 minutes before the post-deferral
    // confirmation is dropped by alerts::plan's fresh_score check.
    let mut cold = subscribed("live");
    cold.settings.goals = true;
    enqueue(&mut cold, &["match-1".into()], deferral_start);
    cold.matches[0].home_score = Some(1);
    enqueue(&mut cold, &["match-1".into()], deferral_end);
    assert!(cold.pending_notifications.is_empty());

    // The deferred branch wakes at live cadence and runs revalidate each wake.
    let mut s = subscribed("live");
    s.settings.goals = true;
    enqueue(&mut s, &["match-1".into()], deferral_start);
    for wake in 0..15 {
        revalidate(&mut s, &[], deferral_start + Duration::minutes(wake + 1));
    }
    s.matches[0].home_score = Some(1);
    enqueue(&mut s, &["match-1".into()], deferral_end);
    assert_eq!(s.pending_notifications.len(), 1);
}

#[test]
fn warmed_baselines_keep_a_kickoff_during_deferral_inside_the_start_window() {
    let deferral_start = now() - Duration::minutes(1);
    let deferral_end = now() + Duration::minutes(12);
    // Without warming, a baseline observed >10 minutes before the post-deferral
    // confirmation is dropped by alerts::plan's fresh_start check.
    let mut cold = subscribed("scheduled");
    cold.settings.starts = true;
    enqueue(&mut cold, &["match-1".into()], deferral_start);
    cold.matches[0].status = "live".into();
    enqueue(&mut cold, &["match-1".into()], deferral_end);
    assert!(cold.pending_notifications.is_empty());

    let mut s = subscribed("scheduled");
    s.settings.starts = true;
    enqueue(&mut s, &["match-1".into()], deferral_start);
    for wake in 0..12 {
        revalidate(&mut s, &[], deferral_start + Duration::minutes(wake + 1));
    }
    s.matches[0].status = "live".into();
    enqueue(&mut s, &["match-1".into()], deferral_end);
    assert_eq!(s.pending_notifications.len(), 1);
}

#[test]
fn a_genuine_observation_gap_is_not_replayed_as_a_new_goal() {
    // A baseline persisted hours ago must stay cold: the score change confirmed
    // after a real gap (overnight, app closed) is history, not a new event.
    let mut s = subscribed("live");
    s.settings.goals = true;
    enqueue(&mut s, &["match-1".into()], now() - Duration::hours(6));
    s.matches[0].home_score = Some(1);
    revalidate(&mut s, &["match-1".into()], now());
    enqueue(&mut s, &["match-1".into()], now());
    assert!(s.pending_notifications.is_empty());

    // A failed cycle after reopening must not resurrect the stale baseline
    // either: the warm only extends a chain still inside the window.
    let mut cold = subscribed("live");
    cold.settings.goals = true;
    enqueue(&mut cold, &["match-1".into()], now() - Duration::hours(6));
    revalidate(&mut cold, &[], now());
    cold.matches[0].home_score = Some(1);
    enqueue(&mut cold, &["match-1".into()], now() + Duration::minutes(1));
    assert!(cold.pending_notifications.is_empty());
}

#[test]
fn a_goal_first_confirmed_while_suspended_is_announced() {
    // Suspension reports the goal late: still a goal, not a correction.
    let mut s = subscribed("live");
    s.settings.goals = true;
    enqueue(&mut s, &["match-1".into()], now() - Duration::minutes(1));
    s.matches[0].status = "suspended".into();
    s.matches[0].home_score = Some(1);
    enqueue(&mut s, &["match-1".into()], now());
    assert_eq!(s.pending_notifications.len(), 1);

    // And a goal first visible when play resumes is not eaten either.
    let mut resumed = subscribed("live");
    resumed.settings.goals = true;
    resumed.matches[0].status = "suspended".into();
    enqueue(&mut resumed, &["match-1".into()], now() - Duration::minutes(1));
    resumed.matches[0].status = "live".into();
    resumed.matches[0].home_score = Some(1);
    enqueue(&mut resumed, &["match-1".into()], now());
    assert_eq!(resumed.pending_notifications.len(), 1);
}

#[test]
fn a_backward_clock_step_does_not_drop_a_queued_alert() {
    // The event was queued while the clock ran ahead; stepping back must not
    // drop it, because its baseline already advanced and it cannot re-plan.
    let mut s = goal();
    cleanup(&mut s, now() - Duration::minutes(2));
    assert_eq!(s.pending_notifications.len(), 1);
    let mut sink = Sink::default();
    run(&mut s, now(), &mut sink);
    assert_eq!(sink.calls, ["match-1:score:1:0"]);
}

#[test]
fn revalidate_keeps_a_live_baseline_warm_through_an_outage() {
    // Failed poll cycles call revalidate with no confirmed scores; the live
    // baseline must still be refreshed or alerts::plan's fresh_score drops the
    // first post-outage goal even though the app kept polling every minute.
    let t0 = now() - Duration::minutes(2);
    let t1 = now() + Duration::minutes(5);
    let mut s = subscribed("live");
    s.settings.goals = true;
    enqueue(&mut s, &["match-1".into()], t0);
    for minute in 1..=7 {
        revalidate(&mut s, &[], t0 + Duration::minutes(minute));
    }
    s.matches[0].home_score = Some(1);
    enqueue(&mut s, &["match-1".into()], t1);
    assert_eq!(s.pending_notifications.len(), 1);

    // Control: the same seven-minute confirmation gap without the warm is
    // outside the five-minute window and the goal is dropped.
    let mut cold = subscribed("live");
    cold.settings.goals = true;
    enqueue(&mut cold, &["match-1".into()], t0);
    cold.matches[0].home_score = Some(1);
    enqueue(&mut cold, &["match-1".into()], t1);
    assert!(cold.pending_notifications.is_empty());
}

#[test]
fn a_wake_with_nothing_due_does_not_pay_for_a_save() {
    let mut s = reminder();
    s.pending_notifications[0].next_attempt_at =
        (now() + Duration::minutes(30)).to_rfc3339();
    let mut saves = 0;
    submit_due(
        &mut s,
        now,
        |_| Ok(()),
        |_| {
            saves += 1;
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert_eq!(saves, 0);
    // A due event still stages and persists before native submission.
    s.pending_notifications[0].next_attempt_at =
        (now() - Duration::minutes(1)).to_rfc3339();
    submit_due(
        &mut s,
        now,
        |_| Ok(()),
        |_| {
            saves += 1;
            Ok(())
        },
        |_| {},
    )
    .unwrap();
    assert!(saves > 0);
}

#[test]
fn enabling_match_alerts_at_two_three_delivers_two_four_once_after_restart() {
    let mut s = subscribed("live");
    s.settings.match_alerts.clear();
    s.settings.favorites = vec![s.matches[0].home.id.clone()];
    s.settings.goals = true;
    s.matches[0].home_score = Some(2);
    s.matches[0].away_score = Some(3);
    enqueue(&mut s, &["match-1".into()], now());
    assert!(s.pending_notifications.is_empty());
    let seen_at = s.alert_baselines["match-1"].seen_at.clone();
    let mut settings = s.settings.clone();
    settings.match_alerts.insert(
        "match-1".into(),
        MatchAlert {
            enabled: true,
            expires_at: String::new(),
        },
    );
    crate::model::apply_settings_at(&mut s, settings, now() + Duration::seconds(10));
    assert!(!s.alert_baselines["match-1"].priming);
    assert_eq!(s.alert_baselines["match-1"].seen_at, seen_at);
    let mut restarted = reload(&s);
    crate::refresh::mark_cached(&mut restarted);
    assert!(restarted.pending_notifications.is_empty());
    restarted.matches[0].score_stale = false;
    restarted.matches[0].away_score = Some(4);
    enqueue(
        &mut restarted,
        &["match-1".into()],
        now() + Duration::minutes(1),
    );
    let mut sink = Sink::default();
    run(&mut restarted, now() + Duration::minutes(1), &mut sink);
    enqueue(
        &mut restarted,
        &["match-1".into()],
        now() + Duration::minutes(2),
    );
    run(&mut restarted, now() + Duration::minutes(2), &mut sink);
    assert_eq!(sink.calls, ["match-1:score:2:4"]);
    assert_eq!(restarted.sent_notifications, sink.calls);
}

#[test]
fn a_new_goal_in_the_first_confirmed_fulltime_poll_is_delivered_once() {
    for (status, league, home_goal) in [
        ("live", crate::model::Competition::PremierLeague, true),
        ("halftime", crate::model::Competition::PremierLeague, false),
        ("live", crate::model::Competition::ChampionsLeague, false),
    ] {
        let mut s = subscribed(status);
        s.matches[0].league = league;
        s.matches[0].kickoff = (now() - Duration::minutes(110)).to_rfc3339();
        enqueue(&mut s, &["match-1".into()], now());
        s.matches[0].status = "fulltime".into();
        if home_goal {
            s.matches[0].home_score = Some(1);
        } else {
            s.matches[0].away_score = Some(1);
        }
        enqueue(&mut s, &["match-1".into()], now() + Duration::minutes(1));
        assert_eq!(
            s.pending_notifications.len(),
            1,
            "last-minute goal must survive the full-time transition"
        );
        let mut sink = Sink::default();
        run(&mut s, now() + Duration::minutes(1), &mut sink);
        let mut restarted = reload(&s);
        enqueue(
            &mut restarted,
            &["match-1".into()],
            now() + Duration::minutes(2),
        );
        run(&mut restarted, now() + Duration::minutes(2), &mut sink);
        assert_eq!(sink.calls.len(), 1);
        assert_eq!(restarted.sent_notifications, sink.calls);
        // A later edit to an already finished score is a correction, not a new goal.
        restarted.matches[0].home_score = Some(2);
        enqueue(
            &mut restarted,
            &["match-1".into()],
            now() + Duration::minutes(3),
        );
        assert!(restarted.pending_notifications.is_empty());
    }
}

#[test]
fn fulltime_goal_requires_a_recent_live_baseline_and_daily_confirmation() {
    let mut s = subscribed("live");
    enqueue(&mut s, &["match-1".into()], now());
    s.matches[0].status = "fulltime".into();
    s.matches[0].home_score = Some(1);
    enqueue(&mut s, &[], now() + Duration::minutes(1));
    assert!(
        s.pending_notifications.is_empty(),
        "monthly data cannot invent a goal"
    );
    assert_eq!(s.alert_baselines["match-1"].home, Some(0));
    enqueue(&mut s, &["match-1".into()], now() + Duration::minutes(6));
    assert!(
        s.pending_notifications.is_empty(),
        "an old live baseline cannot replay historical goals"
    );
    let mut first = subscribed("fulltime");
    first.matches[0].home_score = Some(1);
    enqueue(&mut first, &["match-1".into()], now());
    assert!(
        first.pending_notifications.is_empty(),
        "first observation is not a goal transition"
    );
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
        Some(std::time::Duration::from_secs(120))
    );
    run(&mut s, now() + Duration::minutes(2), &mut sink);
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
    let applied = crate::refresh::apply_league(
        &mut s,
        crate::model::Competition::PremierLeague,
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
    crate::refresh::finish(&mut s, applied.any_response);
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
    // Use a second match for the overflow assertion: a fresh scoreline for a match
    // with a queued goal now supersedes that older entry rather than overflowing.
    let mut second = s.matches[0].clone();
    second.id = "match-2".into();
    second.home_score = Some(0);
    second.away_score = Some(0);
    s.matches.push(second);
    enqueue(&mut s, &["match-1".into(), "match-2".into()], now());
    for i in 1..MAX_PENDING {
        let mut event = s.pending_notifications[0].clone();
        event.match_id = format!("extra-{i}");
        event.id = id(&event.match_id, &event.kind);
        s.pending_notifications.push(event);
    }
    s.matches[1].home_score = Some(1);
    assert_eq!(
        enqueue(
            &mut s,
            &["match-1".into(), "match-2".into()],
            now() + Duration::seconds(30)
        ),
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
fn cached_kickoff_reminders_are_planned_without_a_provider_response() {
    let mut s = subscribed("scheduled");
    s.matches[0].kickoff = (now() + Duration::minutes(10)).to_rfc3339();
    s.settings.reminder_minutes = 15;
    // A poll cycle whose fixture and score requests both failed still calls
    // revalidate, which has all the data a reminder needs.
    revalidate(&mut s, &[], now());
    assert_eq!(s.pending_notifications.len(), 1);
    assert_eq!(s.pending_notifications[0].id, "match-1:reminder");
    let mut sink = Sink::default();
    run(&mut s, now(), &mut sink);
    assert_eq!(sink.calls, ["match-1:reminder"]);
    assert_eq!(s.sent_notifications, sink.calls);
}

#[test]
fn successful_poll_cycle_plans_each_reminder_once_across_revalidate_and_enqueue() {
    let mut s = subscribed("scheduled");
    s.matches[0].kickoff = (now() + Duration::minutes(10)).to_rfc3339();
    s.settings.reminder_minutes = 15;
    // The poll loop calls revalidate and then enqueue for the same confirmed cycle.
    revalidate(&mut s, &[], now());
    enqueue(&mut s, &[], now());
    assert_eq!(s.pending_notifications.len(), 1);
    let mut sink = Sink::default();
    run(&mut s, now(), &mut sink);
    assert_eq!(sink.calls, ["match-1:reminder"]);
}

#[test]
fn cached_reminder_planning_never_invents_score_events() {
    let mut s = goal();
    let revalidate_at = now() + Duration::seconds(30);
    s.matches[0].home_score = Some(2);
    revalidate(&mut s, &[], revalidate_at);
    assert_eq!(s.pending_notifications.len(), 1);
    assert_eq!(s.pending_notifications[0].id, "match-1:score:1:0");
    assert_eq!(s.alert_baselines["match-1"].home, Some(1));
    // The unconfirmed score stays out of the baseline's score state, but the
    // failed cycle still re-warms seen_at so a real goal mid-outage is not
    // dropped by the freshness window.
    assert_eq!(
        s.alert_baselines["match-1"].seen_at,
        revalidate_at.to_rfc3339()
    );
}

#[test]
fn shortening_the_reminder_window_replans_the_undelivered_reminder() {
    let mut s = reminder();
    assert_eq!(s.pending_notifications[0].id, "match-1:reminder");
    let mut settings = s.settings.clone();
    settings.reminder_minutes = 15;
    crate::model::apply_settings_at(&mut s, settings, now());
    assert!(s.pending_notifications.is_empty());
    // Fifteen minutes before the kickoff of a 60-minute reminder window.
    let later = now() + Duration::minutes(45);
    revalidate(&mut s, &[], later);
    assert_eq!(s.pending_notifications.len(), 1);
    assert_eq!(s.pending_notifications[0].id, "match-1:reminder");
    let mut sink = Sink::default();
    run(&mut s, later, &mut sink);
    assert_eq!(sink.calls, ["match-1:reminder"]);
}

#[test]
fn muting_then_unmuting_before_kickoff_restores_the_reminder() {
    let mut s = reminder();
    let mut muted = s.settings.clone();
    muted.match_alerts.get_mut("match-1").unwrap().enabled = false;
    crate::model::apply_settings_at(&mut s, muted, now());
    assert!(s.pending_notifications.is_empty());
    let mut enabled = s.settings.clone();
    enabled.match_alerts.get_mut("match-1").unwrap().enabled = true;
    crate::model::apply_settings_at(&mut s, enabled, now());
    revalidate(&mut s, &[], now());
    assert_eq!(s.pending_notifications.len(), 1);
    assert_eq!(s.pending_notifications[0].id, "match-1:reminder");
}

#[test]
fn a_newer_confirmed_goal_supersedes_an_undelivered_older_scoreline() {
    let mut s = goal();
    s.pending_notifications[0].attempts = 2;
    s.matches[0].home_score = Some(2);
    enqueue(&mut s, &["match-1".into()], now() + Duration::seconds(30));
    assert_eq!(s.pending_notifications.len(), 1);
    assert_eq!(s.pending_notifications[0].id, "match-1:score:2:0");
    let mut sink = Sink::default();
    run(&mut s, now() + Duration::seconds(30), &mut sink);
    assert_eq!(sink.calls, ["match-1:score:2:0"]);
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
fn queue_round_trips_through_f01_repository() {
    let s = goal();
    let dir = std::env::temp_dir().join(format!(
        "matchradar-delivery-{}-{}",
        std::process::id(),
        Utc::now().timestamp_nanos_opt().unwrap()
    ));
    std::fs::create_dir(&dir).unwrap();
    let path = dir.join("state.json");
    crate::persistence::save(&path, &s).unwrap();
    let loaded = crate::persistence::load(&path).unwrap().snapshot;
    assert_eq!(loaded.pending_notifications, s.pending_notifications);
    assert_eq!(loaded.alert_baselines["match-1"].home, Some(1));
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn legacy_demo_migration_preserves_pending_until_fresh_confirmation() {
    let mut s = goal();
    s.settings.mock = true;
    s.migrate_demo_state();
    assert!(!s.settings.mock);
    assert!(s.revalidate_pending);
    assert!(s.matches[0].score_stale);
    let mut s = reload(&s);
    let mut sink = Sink::default();
    run(&mut s, now() + Duration::seconds(30), &mut sink);
    assert!(sink.calls.is_empty());
    revalidate(&mut s, &[], now() + Duration::seconds(31));
    assert!(s.revalidate_pending);
    revalidate(&mut s, &["match-1".into()], now() + Duration::seconds(32));
    run(&mut s, now() + Duration::seconds(33), &mut sink);
    assert_eq!(sink.calls, ["match-1:score:1:0"]);
}

#[test]
fn legacy_demo_migration_does_not_deliver_expired_alerts() {
    let mut s = goal();
    s.settings.mock = true;
    s.migrate_demo_state();
    let mut sink = Sink::default();
    revalidate(&mut s, &["match-1".into()], now() + Duration::minutes(10));
    run(&mut s, now() + Duration::minutes(10), &mut sink);
    assert!(sink.calls.is_empty());
    assert!(s.pending_notifications.is_empty());
}

#[test]
fn confirmed_score_correction_cancels_a_retained_goal() {
    let mut s = goal();
    s.settings.mock = true;
    s.migrate_demo_state();
    s.alert_baselines.get_mut("match-1").unwrap().home = Some(0);
    revalidate(&mut s, &["match-1".into()], now() + Duration::seconds(31));
    let mut sink = Sink::default();
    run(&mut s, now() + Duration::seconds(32), &mut sink);
    assert!(sink.calls.is_empty());
    assert!(s.pending_notifications.is_empty());
}

#[test]
fn synthetic_pending_events_cannot_reach_native_delivery() {
    let mut s = goal();
    s.pending_notifications[0].match_id = "demo-0".into();
    s.pending_notifications[0].id = "demo-0:score:1:0".into();
    let mut sink = Sink::default();
    run(&mut s, now(), &mut sink);
    assert!(sink.calls.is_empty());
    assert!(s.pending_notifications.is_empty());
}
