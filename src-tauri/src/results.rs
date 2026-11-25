//! Results are fetched on demand and never enter live notification planning.
//! Each competition has its own schedule, failure window and six-hour cache.
use crate::{
    model::{Competition, Match, Snapshot},
    provider, write_snapshot, State,
};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use std::collections::HashMap;
use tauri::Manager;
#[derive(Default)]
pub struct History(tokio::sync::Mutex<()>);
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LeagueResults {
    updated_at: Option<String>,
    error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    matches: Vec<Match>,
    updated_at: Option<String>,
    error: Option<String>,
    leagues: HashMap<String, LeagueResults>,
}
fn view(s: &Snapshot) -> Results {
    let today = Utc::now().date_naive();
    let mut leagues = HashMap::new();
    for league in Competition::ALL {
        let status = s.league_status.get(league.slug());
        let legacy = league == Competition::PremierLeague;
        let (updated_at, error) = match status {
            Some(status) => (
                status.recent_updated_at.clone(),
                status.recent_error.clone(),
            ),
            None if legacy => (s.recent_updated_at.clone(), s.recent_error.clone()),
            None => (None, None),
        };
        leagues.insert(league.slug().into(), LeagueResults { updated_at, error });
    }
    Results {
        matches: provider::merge_results(
            s.recent_results.clone(),
            s.matches
                .iter()
                .filter(|m| provider::recent_result(m, today))
                .cloned()
                .collect(),
        )
        .into_iter()
        .filter(|m| provider::recent_result(m, today))
        .collect(),
        updated_at: s.recent_updated_at.clone(),
        error: s.recent_error.clone(),
        leagues,
    }
}
fn timestamps(s: &Snapshot, league: Competition) -> (Option<String>, Option<String>) {
    let status = s.league_status.get(league.slug());
    let legacy = league == Competition::PremierLeague;
    match status {
        Some(status) => (
            status.recent_updated_at.clone(),
            status.recent_retry_at.clone(),
        ),
        None if legacy => (s.recent_updated_at.clone(), s.recent_retry_at.clone()),
        None => (None, None),
    }
}
fn due(s: &Snapshot, league: Competition, now: DateTime<Utc>, force: bool) -> bool {
    let (updated, retry) = timestamps(s, league);
    if retry
        .as_ref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .is_some_and(|t| t.with_timezone(&Utc) > now)
    {
        return false;
    }
    updated
        .as_ref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .is_none_or(|t| {
            let age = (now - t.with_timezone(&Utc)).num_seconds();
            !(0..if force { 30 } else { 21600 }).contains(&age)
        })
}
fn refresh_aggregates(s: &mut Snapshot) {
    let mut updated_at = None;
    let mut retry_at = None;
    let mut errors = Vec::new();
    for league in Competition::ALL {
        let Some(status) = s.league_status.get(league.slug()) else {
            continue;
        };
        if let Some(time) = &status.recent_updated_at {
            updated_at =
                Some(updated_at.map_or(time.clone(), |current: String| current.max(time.clone())));
        }
        if let Some(time) = &status.recent_retry_at {
            retry_at =
                Some(retry_at.map_or(time.clone(), |current: String| current.max(time.clone())));
        }
        if let Some(error) = &status.recent_error {
            errors.push(format!("{}: {error}", league.name()));
        }
    }
    s.recent_updated_at = updated_at;
    s.recent_retry_at = retry_at;
    s.recent_error = (!errors.is_empty()).then(|| errors.join("; "));
}
fn apply_league(
    s: &mut Snapshot,
    league: Competition,
    outcome: provider::FetchOutcome,
    now: DateTime<Utc>,
) {
    let partial = outcome.error.is_some();
    let error = outcome.error.as_ref().map(|e| e.message.clone());
    let retry_after = outcome.error.as_ref().and_then(|e| e.retry_after);
    let existing: Vec<_> = s
        .recent_results
        .iter()
        .filter(|m| m.league == league)
        .cloned()
        .collect();
    let mut others: Vec<_> = s
        .recent_results
        .iter()
        .filter(|m| m.league != league)
        .cloned()
        .collect();
    if let Some(mut matches) = outcome.matches {
        matches.retain(|m| provider::recent_result(m, now.date_naive()));
        for m in &mut matches {
            m.score_updated_at = Some(now.to_rfc3339());
            // Result batches can omit shootoutScore where the scoreboard had it;
            // keep a known tally instead of replacing it with None.
            if m.shootout.is_none() && m.status == "fulltime" {
                if let Some(previous) = existing.iter().find(|p| p.id == m.id && p.kickoff == m.kickoff)
                {
                    m.shootout = previous.shootout;
                }
            }
        }
        // A complete-but-empty batch is ambiguous, not a purge: a CDN or region
        // glitch must not erase accumulated history and stamp a fresh timestamp.
        let matches = if partial || (matches.is_empty() && !existing.is_empty()) {
            provider::merge(existing, matches)
        } else {
            matches
        };
        others.extend(matches);
    } else {
        others.extend(existing);
    }
    s.recent_results = provider::merge(others, Vec::new())
        .into_iter()
        .filter(|m| provider::recent_result(m, now.date_naive()))
        .collect();
    let excess = s.recent_results.len().saturating_sub(200);
    if excess > 0 {
        s.recent_results.drain(..excess);
    }

    if s.league_status.is_empty() && league == Competition::PremierLeague {
        s.league_status.insert(
            league.slug().into(),
            crate::model::LeagueStatus {
                recent_updated_at: s.recent_updated_at.clone(),
                recent_error: s.recent_error.clone(),
                recent_retry_at: s.recent_retry_at.clone(),
                ..crate::model::LeagueStatus::default()
            },
        );
    }
    let status = s.league_status.entry(league.slug().into()).or_default();
    status.recent_error = error;
    if !partial {
        status.recent_updated_at = Some(now.to_rfc3339());
        status.recent_retry_at = None;
    } else {
        let seconds = retry_after.unwrap_or(300).clamp(300, 3600) as i64;
        status.recent_retry_at = Duration::try_seconds(seconds)
            .and_then(|delay| now.checked_add_signed(delay))
            .map(|t| t.to_rfc3339());
    }
    refresh_aggregates(s);
}
#[tauri::command]
pub async fn get_recent_results(
    app: tauri::AppHandle,
    history: tauri::State<'_, History>,
    leagues: Option<Vec<String>>,
    force: Option<bool>,
) -> Result<Results, String> {
    let _guard = history.0.lock().await;
    let now = Utc::now();
    let today = now.date_naive();
    let client = provider::client();
    let requested: Vec<Competition> = match &leagues {
        Some(list) if !list.is_empty() => Competition::ALL
            .into_iter()
            .filter(|league| list.iter().any(|slug| slug == league.slug()))
            .collect(),
        _ => Competition::ALL.to_vec(),
    };
    let mut outcomes = Vec::new();
    for league in requested {
        let fetch = {
            let state = app.state::<State>();
            let s = state.snapshot.lock().map_err(|e| e.to_string())?;
            due(&s, league, now, force.unwrap_or(false))
        };
        if !fetch {
            continue;
        }
        let outcome = match &client {
            Ok(client) => provider::recent_results(client, league, today).await,
            Err(e) => provider::FetchOutcome::failed(e.clone()),
        };
        if let Some(e) = &outcome.error {
            eprintln!(
                "MatchRadar recent results ({}): {}",
                league.name(),
                e.message
            );
        }
        eprintln!(
            "MatchRadar recent results ({}): {} matches fetched",
            league.name(),
            outcome.matches.as_ref().map_or(0, Vec::len)
        );
        outcomes.push((league, outcome, Utc::now()));
    }
    if !outcomes.is_empty() {
        let state = app.state::<State>();
        let mut s = state.snapshot.lock().map_err(|e| e.to_string())?;
        {
            let mut next = s.clone();
            for (league, outcome, confirmed_at) in outcomes {
                apply_league(&mut next, league, outcome, confirmed_at);
            }
            let saved = write_snapshot(&state, &next);
            *s = next;
            if let Err(e) = saved {
                s.recent_error = Some(format!("Results cache could not be saved: {e}"));
            }
        }
    }
    let state = app.state::<State>();
    let s = state.snapshot.lock().map_err(|e| e.to_string())?;
    Ok(view(&s))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn manual_refresh_bypasses_history_cache_but_keeps_cooldown_and_backoff() {
        let now = DateTime::parse_from_rfc3339("2026-11-14T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![]),
                error: None,
            },
            now,
        );
        assert!(!due(
            &s,
            Competition::PremierLeague,
            now + Duration::seconds(29),
            true
        ));
        assert!(due(
            &s,
            Competition::PremierLeague,
            now + Duration::seconds(30),
            true
        ));
        assert!(!due(
            &s,
            Competition::PremierLeague,
            now + Duration::seconds(30),
            false
        ));
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome::failed(provider::FetchError {
                message: "HTTP 429".into(),
                retry_after: Some(600),
            }),
            now,
        );
        assert!(!due(
            &s,
            Competition::PremierLeague,
            now + Duration::seconds(60),
            true
        ));
        assert!(due(
            &s,
            Competition::PremierLeague,
            now + Duration::seconds(600),
            true
        ));
    }
    #[test]
    fn history_survives_daily_empty_and_failure() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        let mut m = crate::demo::mock().remove(4);
        m.id = "123".into();
        m.kickoff = "2026-10-20T12:00:00Z".into();
        let outcome = provider::FetchOutcome {
            matches: Some(vec![m]),
            error: None,
        };
        apply_league(&mut s, Competition::PremierLeague, outcome, now);
        assert_eq!(s.recent_results.len(), 1);
        assert!(!due(&s, Competition::PremierLeague, now, false));
        let timestamp = s.recent_updated_at.clone();
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome::failed(provider::FetchError {
                message: "HTTP 500".into(),
                retry_after: None,
            }),
            now,
        );
        assert_eq!(s.recent_results.len(), 1);
        assert_eq!(s.recent_updated_at, timestamp);
        assert!(s.recent_error.is_some());
        assert!(!due(&s, Competition::PremierLeague, now, false));
        assert!(s.matches.is_empty());
        assert!(s.pending_notifications.is_empty());
    }
    #[test]
    fn legacy_empty_and_window_boundaries() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s: Snapshot = serde_json::from_str("{}").unwrap();
        assert!(due(&s, Competition::PremierLeague, now, false));
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![]),
                error: None,
            },
            now,
        );
        assert!(s.recent_error.is_none());
        assert!(s.recent_updated_at.is_some());
        let mut m = crate::demo::mock().remove(4);
        m.kickoff = "2026-10-13T23:59:00Z".into();
        assert!(!provider::recent_result(&m, now.date_naive()));
        m.kickoff = "2026-10-14T00:00:00Z".into();
        assert!(provider::recent_result(&m, now.date_naive()));
    }
    #[test]
    fn partial_results_and_recovery_preserve_live_state() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        s.error = Some("live failure".into());
        s.score_error = s.error.clone();
        let mut m = crate::demo::mock().remove(4);
        m.kickoff = "2026-10-20T12:00:00Z".into();
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![m.clone()]),
                error: Some(provider::FetchError {
                    message: "second month failed".into(),
                    retry_after: Some(600),
                }),
            },
            now,
        );
        assert_eq!(s.recent_results.len(), 1);
        assert!(s.recent_updated_at.is_none());
        assert_eq!(s.error.as_deref(), Some("live failure"));
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![m]),
                error: None,
            },
            now + Duration::minutes(10),
        );
        assert!(s.recent_error.is_none());
        assert!(s.recent_retry_at.is_none());
        assert!(!due(
            &s,
            Competition::PremierLeague,
            now + Duration::minutes(11),
            false
        ));
        let restored: Snapshot = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(restored.recent_results.len(), 1);
        assert_eq!(restored.recent_updated_at, s.recent_updated_at);
        assert_eq!(restored.score_error, s.score_error);
    }

    #[test]
    fn competitions_keep_separate_results_and_failure_windows() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        let mut pl = crate::demo::mock().remove(4);
        pl.kickoff = "2026-10-20T12:00:00Z".into();
        let mut ucl = crate::demo::mock().remove(5);
        ucl.id = "ucl-1".into();
        ucl.league = Competition::ChampionsLeague;
        ucl.competition = "Champions League".into();
        ucl.status = "fulltime".into();
        ucl.kickoff = "2026-10-21T12:00:00Z".into();
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![pl.clone()]),
                error: None,
            },
            now,
        );
        apply_league(
            &mut s,
            Competition::ChampionsLeague,
            provider::FetchOutcome {
                matches: Some(vec![ucl.clone()]),
                error: None,
            },
            now,
        );
        assert_eq!(s.recent_results.len(), 2);
        assert!(!due(&s, Competition::PremierLeague, now, false));
        assert!(!due(&s, Competition::ChampionsLeague, now, false));

        // UCL failure retains UCL results and leaves the PL cache untouched.
        apply_league(
            &mut s,
            Competition::ChampionsLeague,
            provider::FetchOutcome::failed(provider::FetchError {
                message: "UCL HTTP 429".into(),
                retry_after: Some(600),
            }),
            now,
        );
        assert_eq!(s.recent_results.len(), 2);
        assert!(s
            .league_status
            .get(Competition::ChampionsLeague.slug())
            .unwrap()
            .recent_retry_at
            .is_some());
        assert!(!due(&s, Competition::ChampionsLeague, now, false));
        assert!(s
            .league_status
            .get(Competition::PremierLeague.slug())
            .unwrap()
            .recent_error
            .is_none());
        // The legacy aggregate reports the competition, not a generic failure.
        assert!(s
            .recent_error
            .as_deref()
            .unwrap()
            .contains("Champions League"));
        let view = view(&s);
        assert_eq!(view.leagues.len(), 2);
        assert!(view.leagues[Competition::ChampionsLeague.slug()]
            .error
            .is_some());
        assert!(view.leagues[Competition::PremierLeague.slug()]
            .error
            .is_none());
    }
    #[test]
    fn partial_history_timestamps_only_the_matches_actually_returned() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        let mut first = crate::demo::mock().remove(4);
        first.id = "111".into();
        first.kickoff = "2026-10-20T12:00:00Z".into();
        let mut second = first.clone();
        second.id = "222".into();
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![first.clone(), second]),
                error: None,
            },
            now,
        );
        let later = now + Duration::hours(1);
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![first]),
                error: Some(provider::FetchError {
                    message: "partial".into(),
                    retry_after: None,
                }),
            },
            later,
        );
        assert_eq!(
            s.recent_results
                .iter()
                .find(|m| m.id == "111")
                .unwrap()
                .score_updated_at,
            Some(later.to_rfc3339())
        );
        assert_eq!(
            s.recent_results
                .iter()
                .find(|m| m.id == "222")
                .unwrap()
                .score_updated_at,
            Some(now.to_rfc3339())
        );
    }
    #[test]
    fn complete_empty_batch_does_not_erase_accumulated_history() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        let mut m = crate::demo::mock().remove(4);
        m.id = "keep".into();
        m.kickoff = "2026-10-28T20:00:00Z".into();
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![m]),
                error: None,
            },
            now,
        );
        assert_eq!(s.recent_results.len(), 1);
        // A successful-but-empty batch is ambiguous (CDN/region glitch), not a
        // purge: history must survive and the retry timestamp is still stamped.
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![]),
                error: None,
            },
            now + Duration::hours(1),
        );
        assert_eq!(s.recent_results.len(), 1);
        assert_eq!(s.recent_results[0].id, "keep");
    }
    #[test]
    fn results_keep_a_known_shootout_tally_when_the_batch_omits_it() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s = Snapshot::default();
        let mut m = crate::demo::mock().remove(4);
        m.id = "pen".into();
        m.kickoff = "2026-10-28T20:00:00Z".into();
        m.status = "fulltime".into();
        m.detail = "Full time".into();
        m.home_score = Some(1);
        m.away_score = Some(1);
        m.shootout = Some(crate::model::Shootout { home: 4, away: 3 });
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![m.clone()]),
                error: None,
            },
            now,
        );
        let mut stripped = m;
        stripped.shootout = None;
        apply_league(
            &mut s,
            Competition::PremierLeague,
            provider::FetchOutcome {
                matches: Some(vec![stripped]),
                error: None,
            },
            now + Duration::hours(1),
        );
        assert_eq!(
            s.recent_results.iter().find(|m| m.id == "pen").unwrap().shootout,
            Some(crate::model::Shootout { home: 4, away: 3 })
        );
    }
}
