//! Provider backoff is a deadline, so UI wakes cannot bypass Retry-After.
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
#[cfg(test)]
mod tests {
    use super::*;
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
