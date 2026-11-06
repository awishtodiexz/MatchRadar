//! Reconcile independent validated responses. No networking, settings writes, or delivery.
//!
//! Each call applies exactly one competition, so a failure or empty response from
//! one league cannot remove the other league's cached fixtures.
use crate::{
    model::{Competition, LeagueStatus, Match, Snapshot},
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
fn in_window(m: &Match, now: DateTime<Utc>, league: Competition) -> bool {
    DateTime::parse_from_rfc3339(&m.kickoff)
        .ok()
        .is_some_and(|kickoff| {
            let day = kickoff.with_timezone(&Utc).date_naive();
            day >= now.date_naive() - Duration::days(1)
                && day <= now.date_naive() + Duration::days(league.lookahead_days())
        })
}

fn latest(current: Option<String>, candidate: Option<String>) -> Option<String> {
    match (current, candidate) {
        (Some(current), Some(candidate)) => Some(current.max(candidate)),
        (current, candidate) => candidate.or(current),
    }
}

fn combine(errors: impl IntoIterator<Item = String>) -> Option<String> {
    let errors: Vec<_> = errors.into_iter().collect();
    (!errors.is_empty()).then(|| errors.join("; "))
}

/// Rebuild the legacy aggregate fields from per-competition status.
fn recompute_aggregates(snapshot: &mut Snapshot) {
    if snapshot.league_status.is_empty() {
        return;
    }
    let mut updated_at = None;
    let mut fixture_updated_at = None;
    let mut fixture_errors = Vec::new();
    let mut score_errors = Vec::new();
    for league in Competition::ALL {
        let Some(status) = snapshot.league_status.get(league.slug()) else {
            continue;
        };
        updated_at = latest(updated_at, status.updated_at.clone());
        fixture_updated_at = latest(fixture_updated_at, status.fixture_updated_at.clone());
        if let Some(error) = &status.fixture_error {
            fixture_errors.push(format!("{}: {error}", league.name()));
        }
        if let Some(error) = &status.score_error {
            score_errors.push(format!("{}: {error}", league.name()));
        }
    }
    snapshot.updated_at = updated_at;
    snapshot.fixture_updated_at = fixture_updated_at;
    snapshot.fixture_error = combine(fixture_errors);
    snapshot.score_error = combine(score_errors);
    let mut errors = Vec::new();
    if let Some(error) = &snapshot.fixture_error {
        errors.push(format!("Fixtures: {error}"));
    }
    if let Some(error) = &snapshot.score_error {
        errors.push(format!("Scores: {error}"));
    }
    snapshot.error = combine(errors);
}

/// A cycle fails partially only when it also produced usable data.
pub fn finish(snapshot: &mut Snapshot, any_response: bool) {
    snapshot.partial =
        any_response && (snapshot.fixture_error.is_some() || snapshot.score_error.is_some());
}

fn fixture_merge(mut base: Vec<Match>, fixtures: &mut FetchOutcome, complete: bool) -> Vec<Match> {
    let Some(mut incoming) = fixtures.matches.take() else {
        return base;
    };
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
    if complete {
        base.retain(active);
    }
    provider::merge(base, incoming)
}

pub fn apply_league(
    snapshot: &mut Snapshot,
    league: Competition,
    mut fixtures: FetchOutcome,
    scores: FetchOutcome,
    now: DateTime<Utc>,
) -> Applied {
    let any_response = fixtures.matches.is_some() || scores.matches.is_some();
    let failed = fixtures.error.is_some() || scores.error.is_some();
    let retry_after = fixtures
        .error
        .as_ref()
        .and_then(|e| e.retry_after)
        .max(scores.error.as_ref().and_then(|e| e.retry_after));
    let fixtures_complete = fixtures.matches.is_some() && fixtures.error.is_none();
    let score_ids: Vec<_> = scores
        .matches
        .as_ref()
        .into_iter()
        .flatten()
        .map(|m| m.id.clone())
        .collect();

    // Seed legacy top-level freshness into the Premier League status once, so an
    // upgrade keeps showing the last known source times and failures.
    if snapshot.league_status.is_empty() && league == Competition::PremierLeague {
        snapshot.league_status.insert(
            league.slug().into(),
            LeagueStatus {
                fixture_updated_at: snapshot.fixture_updated_at.clone(),
                updated_at: snapshot.updated_at.clone(),
                fixture_error: snapshot.fixture_error.clone(),
                score_error: snapshot.score_error.clone(),
                ..LeagueStatus::default()
            },
        );
    }

    let mut others: Vec<Match> = snapshot
        .matches
        .iter()
        .filter(|m| m.league != league)
        .cloned()
        .collect();
    let mut base: Vec<Match> = snapshot
        .matches
        .iter()
        .filter(|m| m.league == league)
        .cloned()
        .collect();

    base = fixture_merge(base, &mut fixtures, fixtures_complete);
    if let Some(updates) = scores.matches.clone() {
        base = provider::merge(base, updates);
    }
    if any_response {
        base.retain(|m| in_window(m, now, league));
    }
    for m in &mut base {
        m.score_stale = active(m) && !score_ids.contains(&m.id);
    }
    others.append(&mut base);
    snapshot.matches = provider::merge(others, Vec::new());

    let status = snapshot
        .league_status
        .entry(league.slug().into())
        .or_default();
    if fixtures.matches.is_some() || fixtures.error.is_some() {
        status.fixture_error = fixtures.error.as_ref().map(|e| e.message.clone());
    }
    if fixtures_complete {
        status.fixture_updated_at = Some(now.to_rfc3339());
    }
    if scores.matches.is_some() || scores.error.is_some() {
        status.score_error = scores.error.as_ref().map(|e| e.message.clone());
    }
    // updated_at remains the last fully successful daily-score batch, never a
    // fixture-only success.
    if scores.matches.is_some() && scores.error.is_none() {
        status.updated_at = Some(now.to_rfc3339());
    }
    recompute_aggregates(snapshot);

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
    fn ucl(mut m: Match) -> Match {
        m.league = Competition::ChampionsLeague;
        m.competition = Competition::ChampionsLeague.name().into();
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
    fn apply(
        snapshot: &mut Snapshot,
        league: Competition,
        fixtures: FetchOutcome,
        scores: FetchOutcome,
    ) -> Applied {
        let applied = apply_league(snapshot, league, fixtures, scores, now());
        finish(snapshot, applied.any_response);
        applied
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
                let applied = apply(&mut snapshot, Competition::PremierLeague, fixtures, scores);
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
            Competition::PremierLeague,
            good(vec![fixture("new", "scheduled", 2, 0)]),
            bad("day"),
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
            Competition::PremierLeague,
            FetchOutcome::default(),
            good(vec![fixture("live", "live", 0, 3)]),
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
            apply(
                &mut s,
                Competition::PremierLeague,
                good(vec![fresh]),
                bad("day"),
            );
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
        apply(
            &mut s,
            Competition::PremierLeague,
            good(vec![]),
            good(vec![]),
        );
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
        let applied = apply(&mut s, Competition::PremierLeague, fixtures, scores);
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
        let applied = apply(
            &mut s,
            Competition::PremierLeague,
            FetchOutcome::default(),
            good(vec![]),
        );
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
            Competition::PremierLeague,
            good(vec![fixture("new", "scheduled", 3, 0)]),
            bad("day"),
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
            Competition::PremierLeague,
            good(vec![fixture("far", "scheduled", 15, 0)]),
            good(vec![update.clone(), update]),
        );
        assert_eq!(s.matches.len(), 1);
        assert_eq!(s.matches[0].status, "halftime");
        assert_eq!(s.matches[0].home_score, Some(3));
    }

    #[test]
    fn competitions_merge_chronologically_and_fail_independently() {
        let mut s = Snapshot::default();
        let pl = fixture("pl-1", "scheduled", 2, 0);
        let ucl_match = ucl(fixture("ucl-1", "scheduled", 1, 0));
        let ucl_later = ucl(fixture("ucl-2", "scheduled", 20, 0));
        apply(
            &mut s,
            Competition::PremierLeague,
            good(vec![pl]),
            good(vec![]),
        );
        apply(
            &mut s,
            Competition::ChampionsLeague,
            good(vec![ucl_match, ucl_later]),
            good(vec![]),
        );
        assert_eq!(s.matches.len(), 3);
        assert!(s.matches.windows(2).all(|w| w[0].kickoff <= w[1].kickoff));
        assert_eq!(
            s.matches
                .iter()
                .filter(|m| m.league == Competition::ChampionsLeague)
                .count(),
            2
        );

        // A UCL failure must not erase UCL cache or PL data.
        apply(
            &mut s,
            Competition::ChampionsLeague,
            bad("month"),
            bad("day"),
        );
        assert_eq!(s.matches.len(), 3);
        assert!(s.error.as_deref().unwrap().contains("Champions League"));
        assert!(s
            .league_status
            .get(Competition::ChampionsLeague.slug())
            .unwrap()
            .score_error
            .is_some());
        assert!(s
            .league_status
            .get(Competition::PremierLeague.slug())
            .unwrap()
            .score_error
            .is_none());
        assert!(!s.partial, "a total failure is not a partial update");
    }

    #[test]
    fn empty_success_for_one_competition_does_not_delete_the_other() {
        let mut s = Snapshot {
            matches: vec![
                fixture("pl-1", "scheduled", 2, 0),
                ucl(fixture("ucl-1", "scheduled", 1, 0)),
                ucl(fixture("ucl-live", "live", 0, 2)),
            ],
            ..Snapshot::default()
        };
        // UCL completes with no upcoming games; its active game is retained until
        // scores confirm it, while the Premier League fixture is untouched.
        apply(
            &mut s,
            Competition::ChampionsLeague,
            good(vec![]),
            good(vec![]),
        );
        assert!(s.matches.iter().any(|m| m.id == "pl-1"));
        assert!(!s.matches.iter().any(|m| m.id == "ucl-1"));
        assert!(s.matches.iter().any(|m| m.id == "ucl-live"));
    }

    #[test]
    fn champions_league_keeps_a_thirty_day_window() {
        let mut s = Snapshot {
            matches: vec![
                ucl(fixture("ucl-25", "scheduled", 25, 0)),
                ucl(fixture("ucl-31", "scheduled", 31, 0)),
            ],
            ..Snapshot::default()
        };
        apply(
            &mut s,
            Competition::ChampionsLeague,
            FetchOutcome::default(),
            good(vec![]),
        );
        assert!(s.matches.iter().any(|m| m.id == "ucl-25"));
        assert!(!s.matches.iter().any(|m| m.id == "ucl-31"));
    }
}
