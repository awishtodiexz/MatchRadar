//! Provider backoff is a deadline, so UI wakes cannot bypass Retry-After.
use crate::model::Match;
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
pub fn failure_delay(failures: u32, retry_after: Option<u64>) -> u64 {
    // A server-requested cooldown is honoured, but a bogus header must not freeze
    // updates for days. 60s..1h keeps Retry-After useful and recoverable.
    retry_after.map(|s| s.clamp(60, 3600)).unwrap_or_else(|| {
        60u64
            .saturating_mul(2u64.saturating_pow(failures.min(5)))
            .min(3600)
    })
}
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
        60
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
