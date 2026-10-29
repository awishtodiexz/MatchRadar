//! Results are fetched on demand and never enter live notification planning.
use crate::{
    model::{Match, Snapshot},
    provider, write_snapshot, State,
};
use chrono::{DateTime, Duration, Utc};
use serde::Serialize;
use tauri::Manager;
#[derive(Default)]
pub struct History(tokio::sync::Mutex<()>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Results {
    matches: Vec<Match>,
    updated_at: Option<String>,
    error: Option<String>,
}
fn view(s: &Snapshot) -> Results {
    let today = Utc::now().date_naive();
    Results {
        matches: provider::merge(
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
    }
}
fn due(s: &Snapshot, now: DateTime<Utc>) -> bool {
    if s.recent_retry_at
        .as_ref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .is_some_and(|t| t.with_timezone(&Utc) > now)
    {
        return false;
    }
    s.recent_updated_at
        .as_ref()
        .and_then(|t| DateTime::parse_from_rfc3339(t).ok())
        .is_none_or(|t| {
            let age = (now - t.with_timezone(&Utc)).num_seconds();
            !(0..21600).contains(&age)
        })
}
fn apply(s: &mut Snapshot, outcome: provider::FetchOutcome, now: DateTime<Utc>) {
    let partial = outcome.error.is_some();
    if let Some(matches) = outcome.matches {
        s.recent_results = if partial {
            provider::merge(s.recent_results.clone(), matches)
        } else {
            matches
        };
        if !partial {
            s.recent_updated_at = Some(now.to_rfc3339());
        }
    }
    s.recent_results
        .retain(|m| provider::recent_result(m, now.date_naive()));
    s.recent_results.truncate(200);
    s.recent_retry_at = outcome.error.as_ref().map(|e| {
        let seconds = e.retry_after.unwrap_or(300).max(300).min(i64::MAX as u64) as i64;
        Duration::try_seconds(seconds)
            .and_then(|delay| now.checked_add_signed(delay))
            .unwrap_or(DateTime::<Utc>::MAX_UTC)
            .to_rfc3339()
    });
    s.recent_error = outcome.error.map(|e| e.message);
}
#[tauri::command]
pub async fn get_recent_results(
    app: tauri::AppHandle,
    history: tauri::State<'_, History>,
) -> Result<Results, String> {
    let _guard = history.0.lock().await;
    let (generation, fetch) = {
        let state = app.state::<State>();
        let s = state.snapshot.lock().map_err(|e| e.to_string())?;
        if s.settings.mock {
            return Err("Recent results unavailable in demo mode".into());
        }
        (
            state
                .mode_generation
                .load(std::sync::atomic::Ordering::Relaxed),
            due(&s, Utc::now()),
        )
    };
    if fetch {
        let outcome = match provider::client() {
            Ok(client) => provider::recent_results(&client, Utc::now().date_naive()).await,
            Err(e) => provider::FetchOutcome::failed(e),
        };
        if let Some(e) = &outcome.error {
            eprintln!("MatchRadar recent results: {}", e.message);
        }
        let state = app.state::<State>();
        let mut s = state.snapshot.lock().map_err(|e| e.to_string())?;
        if !s.settings.mock
            && generation
                == state
                    .mode_generation
                    .load(std::sync::atomic::Ordering::Relaxed)
        {
            let mut next = s.clone();
            apply(&mut next, outcome, Utc::now());
            let saved = write_snapshot(&state, &next);
            *s = next;
            if let Err(e) = saved {
                s.recent_error = Some(format!("Results cache could not be saved: {e}"));
            }
        }
    }
    let state = app.state::<State>();
    let s = state.snapshot.lock().map_err(|e| e.to_string())?;
    if s.settings.mock {
        return Err("Results source changed".into());
    }
    Ok(view(&s))
}
#[cfg(test)]
mod tests {
    use super::*;
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
        apply(&mut s, outcome, now);
        assert_eq!(s.recent_results.len(), 1);
        assert!(!due(&s, now));
        let timestamp = s.recent_updated_at.clone();
        apply(
            &mut s,
            provider::FetchOutcome::failed(provider::FetchError {
                message: "HTTP 500".into(),
                retry_after: None,
            }),
            now,
        );
        assert_eq!(s.recent_results.len(), 1);
        assert_eq!(s.recent_updated_at, timestamp);
        assert!(s.recent_error.is_some());
        assert!(!due(&s, now));
        assert!(s.matches.is_empty());
        assert!(s.pending_notifications.is_empty());
    }
    #[test]
    fn legacy_empty_and_window_boundaries() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let mut s: Snapshot = serde_json::from_str("{}").unwrap();
        assert!(due(&s, now));
        apply(
            &mut s,
            provider::FetchOutcome {
                matches: Some(vec![]),
                error: None,
            },
            now,
        );
        assert!(s.recent_error.is_none());
        assert!(s.recent_updated_at.is_some());
        let mut m = crate::demo::mock().remove(4);
        m.kickoff = "2026-10-14T23:59:00Z".into();
        assert!(!provider::recent_result(&m, now.date_naive()));
        m.kickoff = "2026-10-15T00:00:00Z".into();
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
        apply(
            &mut s,
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
        apply(
            &mut s,
            provider::FetchOutcome {
                matches: Some(vec![m]),
                error: None,
            },
            now + Duration::minutes(10),
        );
        assert!(s.recent_error.is_none());
        assert!(s.recent_retry_at.is_none());
        assert!(!due(&s, now + Duration::minutes(11)));
        let restored: Snapshot = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert_eq!(restored.recent_results.len(), 1);
        assert_eq!(restored.recent_updated_at, s.recent_updated_at);
        assert_eq!(restored.score_error, s.score_error);
    }
}
