//! Provider backoff is a deadline, so UI wakes cannot bypass Retry-After.
use crate::model::{Competition, Match, Snapshot};
use chrono::{DateTime, Utc};
use std::time::{Duration, Instant};
#[derive(Default)]
pub struct RequestGate {
    deferred: Option<(Instant, Duration)>,
}
impl RequestGate {
    pub fn remaining(&self, now: Instant) -> Option<Duration> {
        self.deferred
            .and_then(|(started, delay)| delay.checked_sub(now.saturating_duration_since(started)))
            .filter(|d| !d.is_zero())
    }
    pub fn defer(&mut self, now: Instant, seconds: u64) {
        self.deferred = Some((now, Duration::from_secs(seconds)));
    }
    pub fn clear(&mut self) {
        self.deferred = None;
    }
}
// Chunk sleeping, not the server deadline: even an absurd header cannot overflow a timer.
pub fn sleep_chunk(delay: Duration) -> Duration {
    delay.min(Duration::from_secs(86400))
}
// A deferred wake must come back around at the live cadence: each chunk re-runs
// revalidate so baselines stay inside the alert freshness windows and kickoff
// reminders are planned as their windows open mid-deferral. Sleeping the whole
// Retry-After would let a goal scored during the deferral expire unseen.
pub fn deferred_sleep(delay: Duration) -> Duration {
    delay.min(Duration::from_secs(LIVE_CADENCE_SECONDS))
}
// The combined aggregate is the max across leagues: borrowing it for a league
// that already has its own status row suppresses that league's fixture retry for
// up to six hours when the other league alone stays fresh.
pub fn fixtures_due(snapshot: &Snapshot, league: Competition, now: DateTime<Utc>) -> bool {
    let per_league = snapshot
        .league_status
        .get(league.slug())
        .and_then(|status| status.fixture_updated_at.clone());
    let legacy = (league == Competition::PremierLeague && snapshot.league_status.is_empty())
        .then(|| snapshot.fixture_updated_at.clone())
        .flatten();
    per_league
        .or(legacy)
        .and_then(|value| DateTime::parse_from_rfc3339(&value).ok())
        .is_none_or(|updated| {
            let minutes = now
                .signed_duration_since(updated.with_timezone(&Utc))
                .num_minutes();
            // A clock rollback can put the stored timestamp in the future; treat it
            // as due instead of suppressing fixtures until the window catches up.
            !(0..360).contains(&minutes)
        })
}
#[allow(dead_code)]
pub fn scores_due(snapshot: &Snapshot, league: Competition, now: DateTime<Utc>) -> bool {
    let per_league = snapshot
        .league_status
        .get(league.slug())
        .and_then(|status| status.updated_at.clone());
    let legacy = (league == Competition::PremierLeague && snapshot.league_status.is_empty())
        .then(|| snapshot.updated_at.clone())
        .flatten();
    let Some(updated) = per_league.or(legacy) else {
        return true;
    };
    let Ok(updated) = DateTime::parse_from_rfc3339(&updated) else {
        return true;
    };
    let updated = updated.with_timezone(&Utc);
    if updated > now {
        return true;
    }
    let league_matches: Vec<_> = snapshot
        .matches
        .iter()
        .filter(|m| m.league == league)
        .cloned()
        .collect();
    let cadence = base_poll_seconds(&league_matches, now);
    now.signed_duration_since(updated).num_seconds() >= cadence.saturating_sub(5) as i64
}
pub fn failure_delay(failures: u32, retry_after: Option<u64>) -> u64 {
    // A server-requested cooldown is honoured, but a bogus header must not freeze
    // updates for days. 60s..1h keeps Retry-After useful and recoverable.
    retry_after.map(|s| s.clamp(60, 3600)).unwrap_or_else(|| {
        60u64
            .saturating_mul(2u64.saturating_pow(failures.min(5)))
            .min(3600)
    })
}
/// Score-fetch retry delay. While matches poll at the 60s live cadence, cap
/// transport-error backoff at that cadence: two back-to-back failures would
/// otherwise push the next poll past the five-minute alert baseline window
/// (alerts::fresh_score) and silently swallow a goal scored during the outage.
/// A server-requested Retry-After is still honoured as-is.
pub fn score_delay(failures: u32, retry_after: Option<u64>, live_cadence: bool) -> u64 {
    let delay = failure_delay(failures, retry_after);
    if live_cadence && retry_after.is_none() {
        delay.min(LIVE_CADENCE_SECONDS)
    } else {
        delay
    }
}
/// The once-a-minute cadence used while a match is live, at halftime, or a
/// kickoff has just passed unconfirmed. Score retries during this window must
/// stay inside it or the five-minute alert baseline goes stale.
pub const LIVE_CADENCE_SECONDS: u64 = 60;

/// A kickoff that has passed while the provider still reports the match as
/// scheduled is about to start (ESPN often flips state minutes late). Keep
/// polling at live cadence through this window so the start and early goals
/// are observed with a fresh baseline.
const KICKOFF_PENDING_HOURS: i64 = 3;

/// Base poll interval in seconds before reminder and retry adjustments.
pub fn base_poll_seconds(matches: &[Match], now: DateTime<Utc>) -> u64 {
    let kickoff = |m: &Match| {
        DateTime::parse_from_rfc3339(&m.kickoff)
            .ok()
            .map(|d| d.with_timezone(&Utc))
    };
    let pending_kickoff = |m: &Match| {
        m.status == "scheduled"
            && kickoff(m).is_some_and(|k| {
                k <= now && now - k <= chrono::Duration::hours(KICKOFF_PENDING_HOURS)
            })
    };
    if matches
        .iter()
        .any(|m| matches!(m.status.as_str(), "live" | "halftime") || pending_kickoff(m))
    {
        LIVE_CADENCE_SECONDS
    } else if matches.iter().any(|m| {
        // A suspended game can resume at any time; check it at the matchday rate.
        m.status == "suspended"
            || kickoff(m).is_some_and(|k| {
                let secs = (k - now).num_seconds();
                secs > 0 && secs < 24 * 3600
            })
    }) {
        300
    } else {
        1800
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn at(status: &str, minutes_from_now: i64, now: DateTime<Utc>) -> Match {
        let mut m = crate::demo::mock().remove(0);
        m.status = status.into();
        m.kickoff = (now + chrono::Duration::minutes(minutes_from_now)).to_rfc3339();
        m
    }
    #[test]
    fn passed_kickoff_still_marked_scheduled_polls_at_live_cadence() {
        let now = Utc::now();
        // Regression: this used to fall through to the 30-minute idle interval.
        assert_eq!(base_poll_seconds(&[at("scheduled", -2, now)], now), 60);
        assert_eq!(base_poll_seconds(&[at("scheduled", -170, now)], now), 60);
        assert_eq!(base_poll_seconds(&[at("scheduled", 0, now)], now), 60);
        // A stale leftover far past kickoff does not pin the poller at 60s.
        assert_eq!(base_poll_seconds(&[at("scheduled", -200, now)], now), 1800);
        // Postponed games are not about to start.
        assert_eq!(base_poll_seconds(&[at("postponed", -2, now)], now), 1800);
    }
    #[test]
    fn base_cadence_by_state() {
        let now = Utc::now();
        assert_eq!(base_poll_seconds(&[at("live", -20, now)], now), 60);
        assert_eq!(base_poll_seconds(&[at("halftime", -50, now)], now), 60);
        assert_eq!(base_poll_seconds(&[at("scheduled", 120, now)], now), 300);
        assert_eq!(base_poll_seconds(&[at("suspended", -300, now)], now), 300);
        assert_eq!(
            base_poll_seconds(&[at("scheduled", 3 * 24 * 60, now)], now),
            1800
        );
        assert_eq!(base_poll_seconds(&[at("fulltime", -120, now)], now), 1800);
        assert_eq!(base_poll_seconds(&[], now), 1800);
    }
    #[test]
    fn scores_due_uses_each_leagues_own_cadence() {
        let now = Utc::now();
        let mut s = Snapshot::default();
        let mut ucl = at("live", -20, now);
        ucl.league = Competition::ChampionsLeague;
        let pl = at("fulltime", -120, now);
        s.matches = vec![ucl, pl];
        for league in Competition::ALL {
            s.league_status.insert(
                league.slug().into(),
                crate::model::LeagueStatus {
                    updated_at: Some(now.to_rfc3339()),
                    ..crate::model::LeagueStatus::default()
                },
            );
        }
        assert!(!scores_due(
            &s,
            Competition::ChampionsLeague,
            now + chrono::Duration::seconds(30)
        ));
        assert!(scores_due(
            &s,
            Competition::ChampionsLeague,
            now + chrono::Duration::seconds(60)
        ));
        assert!(!scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(60)
        ));
        assert!(!scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(1790)
        ));
        assert!(scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(1800)
        ));
    }

    #[test]
    fn scores_due_uses_matchday_cadence_and_recovers_bad_timestamps() {
        let now = Utc::now();
        let mut s = Snapshot::default();
        assert!(scores_due(&s, Competition::PremierLeague, now));
        s.matches = vec![at("scheduled", 120, now)];
        s.league_status.insert(
            Competition::PremierLeague.slug().into(),
            crate::model::LeagueStatus {
                updated_at: Some(now.to_rfc3339()),
                ..crate::model::LeagueStatus::default()
            },
        );
        assert!(!scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(240)
        ));
        assert!(scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(300)
        ));
        s.league_status
            .get_mut(Competition::PremierLeague.slug())
            .unwrap()
            .updated_at = Some("not a timestamp".into());
        assert!(scores_due(&s, Competition::PremierLeague, now));
        s.league_status
            .get_mut(Competition::PremierLeague.slug())
            .unwrap()
            .updated_at = Some((now + chrono::Duration::minutes(1)).to_rfc3339());
        assert!(scores_due(&s, Competition::PremierLeague, now));
    }

    #[test]
    fn scores_due_uses_legacy_premier_league_timestamp_only_without_rows() {
        let now = Utc::now();
        let s = Snapshot {
            updated_at: Some(now.to_rfc3339()),
            ..Snapshot::default()
        };
        assert!(!scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(60)
        ));
        assert!(scores_due(
            &s,
            Competition::PremierLeague,
            now + chrono::Duration::seconds(1800)
        ));
        assert!(scores_due(
            &s,
            Competition::ChampionsLeague,
            now + chrono::Duration::seconds(1800)
        ));
    }

    #[test]
    fn wakes_and_mode_changes_do_not_advance_deadline() {
        let now = Instant::now();
        let mut gate = RequestGate::default();
        gate.defer(now, 7200);
        assert_eq!(
            gate.remaining(now + Duration::from_secs(60)),
            Some(Duration::from_secs(7140))
        );
        assert!(gate.remaining(now + Duration::from_secs(7200)).is_none());
        gate.clear();
        assert!(gate.remaining(now).is_none());
    }
    #[test]
    fn backoff_is_bounded_but_server_deadline_is_not_shortened() {
        assert_eq!(failure_delay(1, None), 120);
        assert_eq!(failure_delay(100, None), 1920);
        assert_eq!(failure_delay(2, Some(600)), 600);
        assert_eq!(failure_delay(2, Some(7200)), 3600);
        assert_eq!(failure_delay(2, Some(0)), 60);
    }
    #[test]
    fn fixtures_due_ignores_the_other_leagues_freshness() {
        let now = Utc::now();
        let mut s = Snapshot::default();
        s.league_status.insert(
            Competition::PremierLeague.slug().into(),
            crate::model::LeagueStatus::default(),
        );
        // The combined aggregate is fresh from UCL, but PL's own row has no
        // fixture timestamp after its month query failed. The aggregate must
        // not suppress PL's retry for the six-hour fixture window.
        s.fixture_updated_at = Some((now - chrono::Duration::minutes(1)).to_rfc3339());
        assert!(fixtures_due(&s, Competition::PremierLeague, now));
    }
    #[test]
    fn live_score_backoff_stays_within_alert_baseline_window() {
        // Regression: two transport failures used to back scores off 120s then
        // 240s, pushing the next poll past alerts::fresh_score's five-minute
        // baseline and swallowing a goal scored during the outage.
        assert_eq!(score_delay(1, None, true), 60);
        assert_eq!(score_delay(2, None, true), 60);
        // Off the live cadence the full backoff still applies.
        assert_eq!(score_delay(2, None, false), 240);
        // A server-requested cooldown is honoured even while live.
        assert_eq!(score_delay(1, Some(600), true), 600);
    }
    #[test]
    fn deferred_wakes_rechunk_to_the_live_cadence() {
        // A long Retry-After must still return to the deferred branch every
        // minute so baselines re-warm and reminder windows get planned; sleeping
        // the whole deferral let a mid-deferral goal expire unseen.
        assert_eq!(
            deferred_sleep(Duration::from_secs(3600)),
            Duration::from_secs(60)
        );
        assert_eq!(
            deferred_sleep(Duration::from_secs(300)),
            Duration::from_secs(60)
        );
        // The tail of a deferral sleeps only what remains, never past the deadline.
        assert_eq!(
            deferred_sleep(Duration::from_secs(45)),
            Duration::from_secs(45)
        );
    }
    #[test]
    fn huge_headers_do_not_overflow_timers_or_erase_cooldown() {
        let now = Instant::now();
        let mut gate = RequestGate::default();
        gate.defer(now, u64::MAX);
        assert!(gate.remaining(now).is_some());
        assert_eq!(
            sleep_chunk(gate.remaining(now).unwrap()),
            Duration::from_secs(86400)
        );
    }
}
