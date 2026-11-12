use crate::model::{AlertBaseline, Settings, Snapshot};
use chrono::{DateTime, Duration, Utc};

// A provider can keep a delayed kickoff marked "scheduled" and then report it
// live well after the nominal time. The observation still needs a fresh
// scheduled baseline, but the kickoff age alone must not swallow the alert.
const START_GRACE_MINUTES: i64 = 30;

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
            // A settings change must not consume the next goal when a recent,
            // confirmed scoreboard already supplies the subscription's baseline.
            // Keep its original observation time and correction ceiling.
            let confirmed = date(&baseline.seen_at)
                .is_some_and(|seen| now >= seen && now - seen <= Duration::minutes(5))
                && snapshot.matches.iter().any(|m| {
                    m.id == *id
                        && !m.score_stale
                        && m.home_score.is_some()
                        && m.away_score.is_some()
                        && m.home_score == baseline.home
                        && m.away_score == baseline.away
                        && m.status == baseline.status
                });
            baseline.priming = !confirmed;
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
        let reminder_kickoff = kickoff.map(|k| k.to_rfc3339());
        let previous_reminder = previous.and_then(|p| p.reminder_kickoff.clone());
        let mut planned_reminder_kickoff = previous_reminder.clone();
        let name = format!("{} vs {}", m.home.name, m.away.name);
        if eligible {
            let within_reminder_window = m.status == "scheduled"
                && kickoff.is_some_and(|k| {
                    k > now
                        && k - now
                            <= Duration::minutes(snapshot.settings.reminder_minutes.min(120) as i64)
                });
            if within_reminder_window {
                if subscribed || snapshot.settings.reminders {
                    let reminder_id = format!("{}:reminder", m.id);
                    let sent = snapshot
                        .sent_notifications
                        .iter()
                        .any(|id| id == &reminder_id);
                    let is_new = match previous_reminder.as_ref() {
                        Some(previous) => Some(previous) != reminder_kickoff.as_ref(),
                        // A migrated state has no recorded kickoff. If the ID was
                        // already sent, do not replay it merely because the field is new.
                        None => !sent,
                    };
                    if is_new {
                        if sent {
                            snapshot.sent_notifications.retain(|id| id != &reminder_id);
                        }
                        alerts.push((reminder_id, format!("{name} kicks off soon")));
                    }
                    // Record the kickoff only once a reminder is allowed. Recording it
                    // while reminders are disabled would silently consume the current
                    // reminder when the user turns them on later in the same window.
                    planned_reminder_kickoff = reminder_kickoff.clone();
                }
            }
            // First/unconfirmed observations establish a baseline. A subscription
            // armed from a recent confirmed score keeps watching the next change.
            if let Some(previous) = previous.filter(|_| fresh) {
                if (subscribed || snapshot.settings.starts)
                    && m.status == "live"
                    && previous.status == "scheduled"
                    && kickoff.is_some_and(|k| {
                        now >= k && now - k <= Duration::minutes(START_GRACE_MINUTES)
                    })
                {
                    alerts.push((format!("{}:start", m.id), format!("{name} is underway")));
                }
                if (subscribed || snapshot.settings.goals)
                    && fresh_score
                    // A late goal can first appear in the same confirmed response
                    // that marks full-time. Already-finished baselines stay excluded.
                    && matches!(m.status.as_str(), "live" | "halftime" | "fulltime")
                    && matches!(previous.status.as_str(), "live" | "halftime")
                    // An awarded forfeit score is not a goal.
                    && m.detail != crate::provider::FORFEIT_DETAIL
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
                reminder_kickoff: planned_reminder_kickoff,
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
    fn an_awarded_forfeit_score_is_not_announced_as_a_goal() {
        let mut s = fixture();
        subscribe(&mut s, true);
        s.matches[0].status = "live".into();
        plan(&mut s, now() + Duration::minutes(20));
        let at = now() + Duration::minutes(21);
        let mut played = s.clone();
        played.matches[0].status = "fulltime".into();
        played.matches[0].home_score = Some(3);
        assert_eq!(
            plan(&mut played, at).len(),
            1,
            "a played late goal still alerts"
        );
        s.matches[0].status = "fulltime".into();
        s.matches[0].detail = crate::provider::FORFEIT_DETAIL.into();
        s.matches[0].home_score = Some(3);
        assert!(plan(&mut s, at).is_empty());
    }
    #[test]
    fn a_rescheduled_match_can_remind_again_but_duplicate_kickoffs_do_not() {
        let mut s = fixture();
        subscribe(&mut s, true);
        s.settings.reminder_minutes = 120;
        let first = plan(&mut s, now());
        assert_eq!(first.len(), 1);
        s.sent_notifications.push(first[0].0.clone());
        assert!(plan(&mut s, now()).is_empty());
        s.matches[0].kickoff = (now() + Duration::minutes(30)).to_rfc3339();
        let second = plan(&mut s, now() + Duration::minutes(20));
        assert_eq!(second.len(), 1);
        assert_eq!(second[0].0, "match-1:reminder");
        assert!(!s.sent_notifications.contains(&"match-1:reminder".into()));
    }

    #[test]
    fn enabling_kickoff_reminders_inside_the_window_still_alerts_once() {
        let mut s = fixture();
        s.settings.favorites.push(s.matches[0].home.id.clone());
        // Followed club, but kickoff reminders are off: observing the window must
        // not consume the reminder that the user then asks for.
        assert!(plan(&mut s, now()).is_empty());
        assert!(s.alert_baselines["match-1"].reminder_kickoff.is_none());
        s.settings.reminders = true;
        let alerts = plan(&mut s, now());
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].0, "match-1:reminder");
        assert!(plan(&mut s, now()).is_empty());
    }

    #[test]
    fn a_delayed_kickoff_still_reports_the_start_within_the_grace_period() {
        let mut s = fixture();
        s.matches[0].kickoff = (now() + Duration::minutes(5)).to_rfc3339();
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.starts = true;
        plan(&mut s, now());
        // The provider keeps reporting "scheduled" for 15 minutes after kickoff.
        plan(&mut s, now() + Duration::minutes(19));
        s.matches[0].status = "live".into();
        let alerts = plan(&mut s, now() + Duration::minutes(20));
        assert_eq!(alerts.len(), 1);
        assert!(alerts[0].0.ends_with(":start"));
    }

    #[test]
    fn a_provider_lag_beyond_the_grace_period_does_not_replay_the_start() {
        let mut s = fixture();
        s.matches[0].kickoff = (now() - Duration::minutes(10)).to_rfc3339();
        s.settings.favorites.push(s.matches[0].home.id.clone());
        s.settings.starts = true;
        plan(&mut s, now() + Duration::minutes(30));
        s.matches[0].status = "live".into();
        assert!(
            plan(&mut s, now() + Duration::minutes(31)).is_empty(),
            "a start observed long after the nominal kickoff is not useful"
        );
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
    fn new_subscription_arms_from_confirmed_score_without_replaying_history_or_corrections() {
        let mut s = fixture();
        s.matches[0].status = "live".into();
        s.matches[0].home_score = Some(2);
        plan(&mut s, now());
        subscribe(&mut s, true);
        assert!(
            plan(&mut s, now()).is_empty(),
            "enabling must not replay the current score"
        );
        s.matches[0].home_score = Some(3);
        assert_eq!(
            plan(&mut s, now() + Duration::minutes(1)).len(),
            1,
            "the first new goal after enabling must alert"
        );
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
    fn champions_league_favorites_plan_distinct_events_and_goals() {
        let mut s = fixture();
        let team = s.matches[0].home.id.clone();
        s.matches[0].kickoff = (now() + Duration::minutes(10)).to_rfc3339();
        s.settings.favorites = vec![team.clone()];
        s.settings.reminders = true;
        s.settings.reminder_minutes = 30;
        let mut ucl = s.matches[0].clone();
        ucl.id = "ucl-match-1".into();
        ucl.league = crate::model::Competition::ChampionsLeague;
        ucl.competition = "Champions League".into();
        ucl.kickoff = (now() + Duration::minutes(20)).to_rfc3339();
        s.matches.push(ucl);
        let reminders = plan(&mut s, now());
        assert_eq!(reminders.len(), 2, "one reminder per match, never per team");
        let ids: std::collections::HashSet<_> = reminders.iter().map(|(id, _)| id).collect();
        assert_eq!(ids.len(), 2);
        assert!(ids.contains(&"match-1:reminder".to_string()));
        assert!(ids.contains(&"ucl-match-1:reminder".to_string()));

        // A confirmed UCL score transition produces a goal event through the same
        // planner as the Premier League.
        let mut live = fixture();
        live.matches[0].league = crate::model::Competition::ChampionsLeague;
        live.matches[0].status = "live".into();
        live.matches[0].home_score = Some(0);
        live.matches[0].away_score = Some(0);
        live.matches[0].kickoff = (now() - Duration::minutes(5)).to_rfc3339();
        live.settings.favorites = vec![live.matches[0].home.id.clone()];
        live.settings.goals = true;
        assert!(plan(&mut live, now()).is_empty());
        live.matches[0].home_score = Some(1);
        let goals = plan(&mut live, now() + Duration::minutes(1));
        assert_eq!(goals.len(), 1);
        assert_eq!(goals[0].0, "match-1:score:1:0");
        assert!(goals[0].1.contains("1–0"));
        live.sent_notifications.push(goals[0].0.clone());
        assert!(plan(&mut live, now() + Duration::minutes(2)).is_empty());
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
        assert_eq!(s.updated_at.as_deref(), Some(now().to_rfc3339().as_str()));
        s.matches[0].home_score = Some(1);
        assert_eq!(plan(&mut s, now() + Duration::minutes(1)).len(), 1);
    }

    #[test]
    fn subscriptions_with_stale_or_unconfirmed_scores_still_prime_without_historical_alerts() {
        for condition in ["stale", "mismatch", "old", "missing"] {
            let mut s = fixture();
            s.matches[0].status = "live".into();
            s.matches[0].home_score = Some(2);
            plan(&mut s, now());
            match condition {
                "stale" => s.matches[0].score_stale = true,
                "mismatch" => s.matches[0].home_score = Some(3),
                "old" => {
                    s.alert_baselines.get_mut("match-1").unwrap().seen_at =
                        (now() - Duration::minutes(6)).to_rfc3339()
                }
                "missing" => s.matches[0].away_score = None,
                _ => unreachable!(),
            }
            subscribe(&mut s, true);
            assert!(s.alert_baselines["match-1"].priming, "{condition}");
            s.matches[0].score_stale = false;
            s.matches[0].home_score = Some(4);
            s.matches[0].away_score = Some(0);
            assert!(
                plan(&mut s, now() + Duration::minutes(1)).is_empty(),
                "{condition}"
            );
            s.matches[0].home_score = Some(5);
            assert_eq!(
                plan(&mut s, now() + Duration::minutes(2)).len(),
                1,
                "{condition}"
            );
        }
    }
}
