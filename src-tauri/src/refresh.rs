//! Reconcile independent validated responses. No networking, settings writes, or delivery.
use crate::{
    model::{Match, Snapshot},
    provider::{self, FetchOutcome},
};
use chrono::{DateTime, Duration, Utc};

pub struct Applied {
    pub failed: bool,
    pub retry_after: Option<u64>,
    pub any_response: bool,
    pub score_ids: Vec<String>,
}

fn active(m: &Match) -> bool {
    matches!(m.status.as_str(), "live" | "halftime" | "suspended")
}

// Restoring a last-confirmed observation from disk is not a new scoreboard check.
pub fn mark_cached(snapshot: &mut Snapshot) {
    for m in &mut snapshot.matches {
        if active(m) {
            m.score_stale = true;
        }
    }
}
fn in_window(m: &Match, now: DateTime<Utc>) -> bool {
    DateTime::parse_from_rfc3339(&m.kickoff)
        .ok()
        .is_some_and(|kickoff| {
            let day = kickoff.with_timezone(&Utc).date_naive();
            day >= now.date_naive() - Duration::days(1)
                && day <= now.date_naive() + Duration::days(14)
        })
}

pub fn apply(
    snapshot: &mut Snapshot,
    fixtures: FetchOutcome,
    scores: FetchOutcome,
    now: DateTime<Utc>,
) -> Applied {
    let any_response = fixtures.matches.is_some() || scores.matches.is_some();
    let failed = fixtures.error.is_some() || scores.error.is_some();
    if fixtures.matches.is_some() || fixtures.error.is_some() {
        snapshot.fixture_error = fixtures.error.as_ref().map(|e| e.message.clone());
    }
    if scores.matches.is_some() || scores.error.is_some() {
        snapshot.score_error = scores.error.as_ref().map(|e| e.message.clone());
    }
    let retry_after = fixtures
        .error
        .as_ref()
        .and_then(|e| e.retry_after)
        .max(scores.error.as_ref().and_then(|e| e.retry_after));
    if fixtures.matches.is_some() && fixtures.error.is_none() {
        snapshot.fixture_updated_at = Some(now.to_rfc3339());
    }
    // updated_at remains the last fully successful daily-score batch, never a fixture-only success.
    if scores.matches.is_some() && scores.error.is_none() {
        snapshot.updated_at = Some(now.to_rfc3339());
    }
    let score_ids: Vec<_> = scores
        .matches
        .as_ref()
        .into_iter()
        .flatten()
        .map(|m| m.id.clone())
        .collect();
    let mut base = snapshot.matches.clone();
    if let Some(mut incoming) = fixtures.matches {
        for m in &mut incoming {
            if let Some(previous) = base.iter().find(|p| p.id == m.id && p.kickoff == m.kickoff) {
                // A monthly pre-match placeholder must not erase known progress. Keep fresh
                // schedule/team metadata; explicit rescheduling/cancellation/terminal data wins.
                if matches!(m.status.as_str(), "scheduled" | "unknown")
                    && (active(previous) || previous.status == "fulltime")
                {
                    m.home_score = previous.home_score;
                    m.away_score = previous.away_score;
                    m.status = previous.status.clone();
                    m.detail = previous.detail.clone();
                }
            }
        }
        // Complete schedules reconcile absent upcoming fixtures. Partial month batches must
        // not delete unseen fixtures; retain active cached games until scores confirm them.
        if fixtures.error.is_none() {
            base.retain(active);
        }
        base = provider::merge(base, incoming);
    }
    if let Some(updates) = scores.matches {
        base = provider::merge(base, updates);
    }
    if any_response {
        base.retain(|m| in_window(m, now));
    }
    for m in &mut base {
        m.score_stale = active(m) && !score_ids.contains(&m.id);
    }
    snapshot.matches = base;
    let errors: Vec<_> = [
        ("Fixtures", &snapshot.fixture_error),
        ("Scores", &snapshot.score_error),
    ]
    .into_iter()
    .filter_map(|(source, error)| error.as_ref().map(|e| format!("{source}: {e}")))
    .collect();
    snapshot.partial = any_response && !errors.is_empty();
    snapshot.error = if !errors.is_empty() {
        Some(errors.join("; "))
    } else {
        None
    };
    Applied {
        failed,
        retry_after,
        any_response,
        score_ids,
    }
}

pub fn notification_view(snapshot: &Snapshot, score_ids: &[String]) -> Snapshot {
    let mut observed = snapshot.clone();
    observed
        .matches
        .retain(|m| m.status == "scheduled" || score_ids.contains(&m.id));
    observed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::provider::FetchError;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-28T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }
    fn fixture(id: &str, status: &str, day: i64, score: u32) -> Match {
        let mut m = crate::demo::mock().remove(0);
        m.id = id.into();
        m.kickoff = (now() + Duration::days(day)).to_rfc3339();
        m.status = status.into();
        m.home_score = Some(score);
        m.detail = status.into();
        m
    }
    fn good(matches: Vec<Match>) -> FetchOutcome {
        FetchOutcome {
            matches: Some(matches),
            error: None,
        }
    }
    fn bad(source: &str) -> FetchOutcome {
        FetchOutcome::failed(FetchError {
            message: format!("{source} HTTP 500"),
            retry_after: None,
        })
    }
    fn cached() -> Snapshot {
        Snapshot {
            matches: vec![
                fixture("live", "live", 0, 2),
                fixture("cached", "scheduled", 2, 0),
            ],
            updated_at: Some("2026-10-28T11:59:00Z".into()),
            fixture_updated_at: Some("2026-10-28T06:00:00Z".into()),
            ..Snapshot::default()
        }
    }

    #[test]
    fn all_four_outcomes_preserve_data_and_advance_only_successful_source_times() {
        for fixture_ok in [false, true] {
            for scores_ok in [false, true] {
                let mut snapshot = cached();
                let settings = snapshot.settings.clone();
                let fixtures = if fixture_ok {
                    good(vec![
                        fixture("live", "scheduled", 0, 0),
                        fixture("cached", "scheduled", 2, 0),
                        fixture("new", "scheduled", 3, 0),
                    ])
                } else {
                    bad("month")
                };
                let scores = if scores_ok {
                    good(vec![fixture("live", "live", 0, 3)])
                } else {
                    bad("day")
                };
                let applied = apply(&mut snapshot, fixtures, scores, now());
                assert_eq!(snapshot.matches.len(), if fixture_ok { 3 } else { 2 });
                let live = snapshot.matches.iter().find(|m| m.id == "live").unwrap();
                assert_eq!(live.status, "live");
                assert_eq!(live.home_score, Some(if scores_ok { 3 } else { 2 }));
                assert_eq!(live.score_stale, !scores_ok);
                assert_eq!(
                    snapshot.fixture_updated_at,
                    Some(if fixture_ok {
                        now().to_rfc3339()
                    } else {
                        "2026-10-28T06:00:00Z".into()
                    })
                );
                assert_eq!(
                    snapshot.updated_at,
                    Some(if scores_ok {
                        now().to_rfc3339()
                    } else {
                        "2026-10-28T11:59:00Z".into()
                    })
                );
                assert_eq!(snapshot.partial, fixture_ok != scores_ok);
                assert_eq!(applied.failed, !(fixture_ok && scores_ok));
                assert_eq!(snapshot.error.is_some(), applied.failed);
                assert_eq!(snapshot.settings, settings);
            }
        }
    }

    #[test]
    fn first_fixture_success_is_visible_even_when_scores_fail() {
        let mut s = Snapshot::default();
        apply(
            &mut s,
            good(vec![fixture("new", "scheduled", 2, 0)]),
            bad("day"),
            now(),
        );
        assert_eq!(s.matches[0].id, "new");
        assert!(s.updated_at.is_none());
        assert_eq!(s.fixture_updated_at, Some(now().to_rfc3339()));
        assert!(s.partial);
        assert!(s.error.unwrap().starts_with("Scores:"));
    }

    #[test]
    fn restart_marks_cached_live_scores_saved_without_advancing_source_times() {
        let mut s = cached();
        let times = (s.updated_at.clone(), s.fixture_updated_at.clone());
        mark_cached(&mut s);
        assert!(
            s.matches
                .iter()
                .find(|m| m.id == "live")
                .unwrap()
                .score_stale
        );
        assert!(
            !s.matches
                .iter()
                .find(|m| m.id == "cached")
                .unwrap()
                .score_stale
        );
        assert_eq!((s.updated_at.clone(), s.fixture_updated_at.clone()), times);
        let observed = notification_view(&s, &[]);
        assert!(!observed.matches.iter().any(|m| m.id == "live"));
        apply(
            &mut s,
            FetchOutcome::default(),
            good(vec![fixture("live", "live", 0, 3)]),
            now(),
        );
        assert!(
            !s.matches
                .iter()
                .find(|m| m.id == "live")
                .unwrap()
                .score_stale
        );
    }

    #[test]
    fn fresh_reschedule_or_cancellation_is_not_overwritten_by_cached_live_state() {
        for status in ["scheduled", "postponed", "cancelled", "fulltime"] {
            let mut s = cached();
            let mut fresh = fixture("live", status, if status == "scheduled" { 2 } else { 0 }, 0);
            fresh.home.name = "Updated club name".into();
            apply(&mut s, good(vec![fresh]), bad("day"), now());
            let m = s.matches.iter().find(|m| m.id == "live").unwrap();
            assert_eq!(m.status, status);
            assert_eq!(m.home.name, "Updated club name");
            assert_eq!(m.home_score, Some(0));
        }
    }

    #[test]
    fn valid_empty_responses_are_success_not_network_failure() {
        let mut s = cached();
        s.matches.retain(|m| m.status == "scheduled");
        apply(&mut s, good(vec![]), good(vec![]), now());
        assert!(s.matches.is_empty());
        assert!(s.error.is_none());
        assert!(!s.partial);
        assert_eq!(s.fixture_updated_at, Some(now().to_rfc3339()));
        assert_eq!(s.updated_at, Some(now().to_rfc3339()));
    }

    #[test]
    fn partial_month_or_day_batches_keep_successes_and_unseen_cached_fixtures() {
        let mut s = cached();
        let mut fixtures = good(vec![fixture("new", "scheduled", 3, 0)]);
        fixtures.error = bad("other month").error;
        let mut scores = good(vec![fixture("live", "live", 0, 3)]);
        scores.error = Some(FetchError {
            message: "Yesterday HTTP 429".into(),
            retry_after: Some(600),
        });
        let applied = apply(&mut s, fixtures, scores, now());
        assert_eq!(s.matches.len(), 3);
        assert_eq!(s.updated_at.as_deref(), Some("2026-10-28T11:59:00Z"));
        assert_eq!(
            s.fixture_updated_at.as_deref(),
            Some("2026-10-28T06:00:00Z")
        );
        assert_eq!(applied.retry_after, Some(600));
        assert_eq!(applied.score_ids, vec!["live"]);
        assert!(
            !s.matches
                .iter()
                .find(|m| m.id == "live")
                .unwrap()
                .score_stale
        );
        assert!(s.partial && s.fixture_error.is_some() && s.score_error.is_some());
    }

    #[test]
    fn skipped_month_does_not_refresh_its_timestamp_or_clear_its_last_failure() {
        let mut s = cached();
        s.fixture_error = Some("Previous month failure".into());
        let applied = apply(&mut s, FetchOutcome::default(), good(vec![]), now());
        assert!(!applied.failed);
        assert!(s.partial);
        assert!(s.fixture_error.is_some());
        assert_eq!(
            s.fixture_updated_at.as_deref(),
            Some("2026-10-28T06:00:00Z")
        );
        assert_eq!(s.matches.len(), 2);
    }

    #[test]
    fn cached_scores_do_not_advance_notification_observations_on_partial_success() {
        let mut s = cached();
        let seen = (now() - Duration::minutes(1)).to_rfc3339();
        s.alert_baselines.insert(
            "live".into(),
            crate::model::AlertBaseline {
                priming: false,
                status: "live".into(),
                home: Some(1),
                away: Some(1),
                high_water: 2,
                seen_at: seen.clone(),
            },
        );
        s.settings.goals = true;
        let applied = apply(
            &mut s,
            good(vec![fixture("new", "scheduled", 3, 0)]),
            bad("day"),
            now(),
        );
        let mut observed = notification_view(&s, &applied.score_ids);
        assert!(crate::alerts::plan(&mut observed, now()).is_empty());
        assert_eq!(observed.alert_baselines["live"].seen_at, seen);
        assert!(
            s.matches
                .iter()
                .find(|m| m.id == "live")
                .unwrap()
                .score_stale
        );
    }

    #[test]
    fn successful_updates_remain_deduplicated_and_inside_existing_utc_window() {
        let mut s = cached();
        let update = fixture("live", "halftime", 0, 3);
        apply(
            &mut s,
            good(vec![fixture("far", "scheduled", 15, 0)]),
            good(vec![update.clone(), update]),
            now(),
        );
        assert_eq!(s.matches.len(), 1);
        assert_eq!(s.matches[0].status, "halftime");
        assert_eq!(s.matches[0].home_score, Some(3));
    }
}
