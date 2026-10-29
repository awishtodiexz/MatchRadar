use crate::model::{AlertBaseline, Settings, Snapshot};
use chrono::{DateTime, Duration, Utc};

fn date(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|d| d.with_timezone(&Utc))
}

// The backend derives expiry from the fixture, never from client-supplied dates.
pub fn prepare_preferences(snapshot: &mut Snapshot, settings: &mut Settings, now: DateTime<Utc>) {
    settings.match_alerts.retain(|id, preference| {
        if let Some(m) = snapshot.matches.iter().find(|m| &m.id == id) {
            let Some(kickoff) = date(&m.kickoff) else {
                return false;
            };
            preference.expires_at = (kickoff + Duration::days(30)).to_rfc3339();
        } else if let Some(previous) = snapshot.settings.match_alerts.get(id) {
            preference.expires_at = previous.expires_at.clone();
        } else {
            return false;
        }
        id.len() <= 128 && date(&preference.expires_at).is_some_and(|expiry| expiry > now)
    });
    for (id, baseline) in &mut snapshot.alert_baselines {
        if snapshot.settings.match_alerts.get(id).map(|p| p.enabled)
            != settings.match_alerts.get(id).map(|p| p.enabled)
        {
            // Re-prime without losing the ceiling used to suppress score corrections.
            baseline.priming = true;
        }
    }
}

pub fn cleanup(snapshot: &mut Snapshot, now: DateTime<Utc>) {
    snapshot.settings.match_alerts.retain(|id, preference| {
        if let Some(m) = snapshot.matches.iter().find(|m| &m.id == id) {
            if let Some(kickoff) = date(&m.kickoff) {
                preference.expires_at = (kickoff + Duration::days(30)).to_rfc3339();
                if matches!(m.status.as_str(), "fulltime" | "cancelled")
                    && now > kickoff + Duration::days(1)
                {
                    return false;
                }
            }
        }
        date(&preference.expires_at).is_some_and(|expiry| expiry > now)
    });
    snapshot.alert_baselines.retain(|_, baseline| {
        date(&baseline.seen_at).is_some_and(|seen| now - seen < Duration::days(30))
    });
}

// Pure planning: each event has one ID regardless of team or match eligibility.
// Sent IDs are recorded by the delivery queue only after the native API returns success.
pub fn plan(snapshot: &mut Snapshot, now: DateTime<Utc>) -> Vec<(String, String)> {
    cleanup(snapshot, now);
    if snapshot.settings.mock {
        return Vec::new();
    }
    let mut alerts = Vec::new();
    for m in &snapshot.matches {
        if m.score_stale {
            continue;
        }
        let preference = snapshot.settings.match_alerts.get(&m.id);
        let subscribed = preference.is_some_and(|p| p.enabled);
        let followed = snapshot.settings.favorites.contains(&m.home.id)
            || snapshot.settings.favorites.contains(&m.away.id);
        let eligible = preference.map(|p| p.enabled).unwrap_or(followed);
        let previous = snapshot.alert_baselines.get(&m.id);
        let fresh = previous
            .filter(|p| !p.priming)
            .and_then(|p| date(&p.seen_at))
            .is_some_and(|seen| now >= seen && now - seen <= Duration::minutes(10));
        let fresh_score = previous
            .and_then(|p| date(&p.seen_at))
            .is_some_and(|seen| now >= seen && now - seen <= Duration::minutes(5));
        let kickoff = date(&m.kickoff);
        let name = format!("{} vs {}", m.home.name, m.away.name);
        if eligible {
            if (subscribed || snapshot.settings.reminders)
                && m.status == "scheduled"
                && kickoff.is_some_and(|k| {
                    k > now
                        && k - now
                            <= Duration::minutes(snapshot.settings.reminder_minutes.min(120) as i64)
                })
            {
                alerts.push((
                    format!("{}:reminder", m.id),
                    format!("{name} kicks off soon"),
                ));
            }
            // A first observation, stale cache, or newly enabled subscription is a baseline.
            if let Some(previous) = previous.filter(|_| fresh) {
                if (subscribed || snapshot.settings.starts)
                    && m.status == "live"
                    && previous.status == "scheduled"
                    && kickoff.is_some_and(|k| now >= k && now - k <= Duration::minutes(10))
                {
                    alerts.push((format!("{}:start", m.id), format!("{name} is underway")));
                }
                if (subscribed || snapshot.settings.goals)
                    && fresh_score
                    && matches!(m.status.as_str(), "live" | "halftime")
                    && matches!(previous.status.as_str(), "live" | "halftime")
                {
                    if let (Some(home), Some(away), Some(_), Some(_)) =
                        (m.home_score, m.away_score, previous.home, previous.away)
                    {
                        if u64::from(home) + u64::from(away) > previous.high_water {
                            alerts.push((
                                format!("{}:score:{home}:{away}", m.id),
                                format!("{name} · {home}–{away}"),
                            ));
                        }
                    }
                }
            }
        }
        let total = u64::from(m.home_score.unwrap_or(0)) + u64::from(m.away_score.unwrap_or(0));
        let high_water = previous.map(|p| p.high_water.max(total)).unwrap_or(total);
        snapshot.alert_baselines.insert(
            m.id.clone(),
            AlertBaseline {
                priming: false,
                status: m.status.clone(),
                home: m.home_score,
                away: m.away_score,
                high_water,
                seen_at: now.to_rfc3339(),
            },
        );
    }
    alerts.retain(|(id, _)| !snapshot.sent_notifications.contains(id));
    alerts
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MatchAlert;

    fn now() -> DateTime<Utc> {
        date("2026-10-28T12:00:00Z").unwrap()
    }
    fn fixture() -> Snapshot {
        let mut snapshot = Snapshot::default();
        let mut m = crate::demo::mock().remove(0);
        m.id = "match-1".into();
        m.kickoff = (now() + Duration::minutes(10)).to_rfc3339();
        m.status = "scheduled".into();
        m.home_score = Some(0);
        m.away_score = Some(0);
        snapshot.matches = vec![m];
        snapshot.settings.favorites.clear();
        snapshot.settings.reminders = false;
        snapshot.settings.starts = false;
        snapshot.settings.goals = false;
        snapshot
    }
    fn subscribe(snapshot: &mut Snapshot, enabled: bool) {
        let mut settings = snapshot.settings.clone();
        settings.match_alerts.insert(
            "match-1".into(),
            MatchAlert {
                enabled,
                expires_at: "client value ignored".into(),
            },
        );
        prepare_preferences(snapshot, &mut settings, now());
        snapshot.settings = settings;
    }
    #[test]
    fn independent_subscription_covers_reminder_start_and_goal_and_deduplicates() {
        let mut s = fixture();
        subscribe(&mut s, true);
        let reminder = plan(&mut s, now());
        assert_eq!(reminder.len(), 1);
        s.sent_notifications.push(reminder[0].0.clone());
        assert!(plan(&mut s, now()).is_empty());
        s.matches[0].status = "live".into();
        let start = plan(&mut s, now() + Duration::minutes(20));
        // A stale baseline cannot generate historical starts.
        assert!(start.is_empty());
        s.matches[0].home_score = Some(1);
        let goal = plan(&mut s, now() + Duration::minutes(21));
        assert_eq!(goal.len(), 1);
        assert!(goal[0].0.contains(":score:"));
        s.sent_notifications.push(goal[0].0.clone());
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.goals = true;
        assert!(plan(&mut s, now() + Duration::minutes(22)).is_empty());
    }
    #[test]
    fn fresh_start_emits_one_event_when_both_paths_apply_and_mute_overrides_teams() {
        let mut s = fixture();
        subscribe(&mut s, true);
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.starts = true;
        plan(&mut s, now() + Duration::minutes(9));
        s.matches[0].status = "live".into();
        let alerts = plan(&mut s, now() + Duration::minutes(10));
        assert_eq!(alerts.len(), 1);
        assert!(alerts[0].0.ends_with(":start"));
        subscribe(&mut s, false);
        s.settings.goals = true;
        plan(&mut s, now() + Duration::minutes(11));
        s.matches[0].home_score = Some(1);
        assert!(plan(&mut s, now() + Duration::minutes(12)).is_empty());
    }
    #[test]
    fn new_subscription_and_restart_do_not_replay_historical_events_or_score_corrections() {
        let mut s = fixture();
        s.matches[0].status = "live".into();
        s.matches[0].home_score = Some(2);
        plan(&mut s, now());
        subscribe(&mut s, true);
        s.matches[0].home_score = Some(3);
        assert!(plan(&mut s, now() + Duration::minutes(1)).is_empty());
        let mut reloaded: Snapshot =
            serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(reloaded.settings.match_alerts["match-1"].enabled);
        reloaded.matches[0].home_score = Some(2);
        assert!(plan(&mut reloaded, now() + Duration::minutes(2)).is_empty());
        reloaded.matches[0].home_score = Some(3);
        assert!(plan(&mut reloaded, now() + Duration::minutes(3)).is_empty());
        reloaded.matches[0].home_score = Some(4);
        assert_eq!(plan(&mut reloaded, now() + Duration::minutes(4)).len(), 1);
        reloaded.matches[0].home_score = Some(5);
        assert!(plan(&mut reloaded, now() + Duration::hours(3)).is_empty());
    }
    #[test]
    fn compatibility_and_expiry_preserve_saved_compact_preference() {
        let old: Settings = serde_json::from_str("{}").unwrap();
        assert!(!old.compact);
        assert!(old.match_alerts.is_empty());
        assert!(
            serde_json::from_str::<Settings>(r#"{"compact":true}"#)
                .unwrap()
                .compact
        );
        let mut s = fixture();
        subscribe(&mut s, true);
        let expiry = s.settings.match_alerts["match-1"].expires_at.clone();
        s.matches.clear();
        cleanup(&mut s, now() + Duration::days(1));
        assert_eq!(s.settings.match_alerts["match-1"].expires_at, expiry);
        cleanup(&mut s, now() + Duration::days(31));
        assert!(s.settings.match_alerts.is_empty());
        s = fixture();
        subscribe(&mut s, false);
        s.matches[0].status = "fulltime".into();
        cleanup(&mut s, now() + Duration::days(2));
        assert!(s.settings.match_alerts.is_empty());
    }

    #[test]
    fn cosmetic_saves_preserve_subscription_baselines_and_feed_timestamps() {
        let mut s = fixture();
        subscribe(&mut s, true);
        s.matches[0].status = "live".into();
        s.updated_at = Some(now().to_rfc3339());
        plan(&mut s, now());
        let mut settings = s.settings.clone();
        settings.opacity = 80;
        prepare_preferences(&mut s, &mut settings, now());
        assert!(s.alert_baselines.contains_key("match-1"));
        assert!(!crate::model::SettingsEffects::between(&s.settings, &settings).mode_changed);
        assert_eq!(s.updated_at.as_deref(), Some(now().to_rfc3339().as_str()));
        s.matches[0].home_score = Some(1);
        assert_eq!(plan(&mut s, now() + Duration::minutes(1)).len(), 1);
    }
}
