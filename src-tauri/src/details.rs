//! On-demand Premier League summary data; never an authority for scoreboard scores.
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    id: String,
    minute: String,
    seconds: f64,
    period: u64,
    kind: String,
    text: String,
    team_id: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistic {
    team_id: String,
    name: String,
    label: String,
    value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    team_id: String,
    name: String,
    position: String,
    starter: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub match_id: String,
    pub events: Vec<Event>,
    pub statistics: Vec<Statistic>,
    pub players: Vec<Player>,
    pub updated_at: String,
    pub error: Option<String>,
    pub stale: bool,
}
fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").chars().take(500).collect()
}
fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
pub fn normalize(v: &Value, id: &str) -> Result<Details, String> {
    if v["header"]["id"].as_str() != Some(id) || array(&v["header"]["competitions"]).is_empty() {
        return Err("Summary identity/shape mismatch".into());
    }
    let mut events = BTreeMap::new();
    for e in array(&v["keyEvents"]).iter().take(1000) {
        let eid = text(e, "id");
        let kind = text(&e["type"], "type");
        let body = text(e, "text");
        let Some(seconds) = e["clock"]["value"]
            .as_f64()
            .filter(|n| n.is_finite() && *n >= 0.0)
        else {
            continue;
        };
        let Some(period) = e["period"]["number"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= 10)
        else {
            continue;
        };
        if eid.is_empty() || body.is_empty() {
            continue;
        }
        events.insert(
            eid.clone(),
            Event {
                id: eid,
                minute: text(&e["clock"], "displayValue"),
                seconds,
                period,
                kind,
                text: body,
                team_id: e["team"]["id"].as_str().map(str::to_owned),
            },
        );
    }
    let mut events: Vec<_> = events.into_values().collect();
    events.sort_by(|a, b| {
        a.period
            .cmp(&b.period)
            .then(a.seconds.total_cmp(&b.seconds))
            .then(a.id.cmp(&b.id))
    });
    let mut statistics = Vec::new();
    // Pregame summaries expose season totals under boxscore: never label those match stats.
    if v["header"]["competitions"][0]["status"]["type"]["state"]
        .as_str()
        .is_some_and(|s| matches!(s, "in" | "post"))
    {
        for t in array(&v["boxscore"]["teams"]).iter().take(2) {
            for s in array(&t["statistics"]).iter().take(40) {
                if let Some(value) = s["displayValue"].as_str() {
                    statistics.push(Statistic {
                        team_id: text(&t["team"], "id"),
                        name: text(s, "name"),
                        label: text(s, "label"),
                        value: value.chars().take(50).collect(),
                    });
                }
            }
        }
    }
    let mut players = Vec::new();
    for t in array(&v["rosters"]).iter().take(2) {
        for p in array(&t["roster"]).iter().take(40) {
            let name = text(&p["athlete"], "displayName");
            if name.is_empty() {
                continue;
            }
            players.push(Player {
                team_id: text(&t["team"], "id"),
                name,
                position: text(&p["position"], "abbreviation"),
                starter: p["starter"].as_bool().unwrap_or(false),
            });
        }
    }
    Ok(Details {
        match_id: id.into(),
        events,
        statistics,
        players,
        updated_at: Utc::now().to_rfc3339(),
        error: None,
        stale: false,
    })
}
#[derive(Default)]
pub struct Cache {
    entries: HashMap<String, Details>,
    blocked_until: i64,
    client: Option<reqwest::Client>,
}
fn valid_cached(d: &Details) -> bool {
    let bounded = |s: &str, n: usize| s.chars().count() <= n && !s.chars().any(char::is_control);
    !d.match_id.is_empty()
        && d.match_id.len() <= 128
        && d.match_id.bytes().all(|b| b.is_ascii_digit())
        && d.events.len() <= 1000
        && d.statistics.len() <= 80
        && d.players.len() <= 80
        && DateTime::parse_from_rfc3339(&d.updated_at).is_ok()
        && d.events.iter().all(|e| {
            !e.id.is_empty()
                && bounded(&e.id, 500)
                && bounded(&e.text, 500)
                && bounded(&e.kind, 500)
                && bounded(&e.minute, 500)
                && e.team_id.as_ref().is_none_or(|s| bounded(s, 128))
                && e.seconds.is_finite()
                && e.seconds >= 0.0
                && (1..=10).contains(&e.period)
        })
        && d.statistics.iter().all(|s| {
            bounded(&s.team_id, 128)
                && bounded(&s.name, 500)
                && bounded(&s.label, 500)
                && bounded(&s.value, 50)
        })
        && d.players
            .iter()
            .all(|p| bounded(&p.team_id, 128) && bounded(&p.name, 500) && bounded(&p.position, 500))
}
pub fn deserialize_cache<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Details>, D::Error> {
    let value = Value::deserialize(d)?;
    let mut entries = HashMap::new();
    for item in array(&value).iter().take(48) {
        if let Ok(detail) = serde_json::from_value::<Details>(item.clone()) {
            if valid_cached(&detail) {
                entries.insert(detail.match_id.clone(), detail);
            }
        }
    }
    let mut entries: Vec<_> = entries.into_values().collect();
    entries.sort_by(|a, b| {
        b.updated_at
            .cmp(&a.updated_at)
            .then(a.match_id.cmp(&b.match_id))
    });
    entries.truncate(24);
    Ok(entries)
}
impl Cache {
    pub fn seed(&mut self, saved: &[Details]) {
        if self.entries.is_empty() {
            for d in saved.iter().filter(|d| valid_cached(d)).take(24) {
                self.entries.insert(d.match_id.clone(), d.clone());
            }
        }
    }

    pub async fn get(&mut self, id: &str, active: bool) -> Result<Details, String> {
        if self.client.is_none() {
            self.client = crate::provider::client().ok();
        }
        let client = self.client.clone();
        self.get_with(id, active, Utc::now(), || async {
            let client =
                client.ok_or_else(|| Failure::temporary("Could not create summary client"))?;
            fetch(&client, id).await
        })
        .await
    }

    // The clock and transport boundary allow failure/restart tests without ESPN or sleeps.
    async fn get_with<F, Fut>(
        &mut self,
        id: &str,
        active: bool,
        now: DateTime<Utc>,
        fetch: F,
    ) -> Result<Details, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Details, Failure>>,
    {
        let old = self.entries.get(id).cloned();
        if let Some(d) = &old {
            let age = DateTime::parse_from_rfc3339(&d.updated_at)
                .map(|t| now.timestamp() - t.timestamp())
                .unwrap_or(i64::MAX);
            if (0..if active { 60 } else { 900 }).contains(&age) {
                return Ok(d.clone());
            }
        }
        if now.timestamp() < self.blocked_until {
            return saved_or_error(
                old,
                "Summary requests paused after an error; cached data retained".into(),
            );
        }
        match fetch().await {
            Ok(mut d) => {
                if d.match_id != id {
                    return self.failed(old, Failure::temporary("Summary identity mismatch"), now);
                }
                d.updated_at = now.to_rfc3339();
                d.stale = false;
                d.error = None;
                if self.entries.len() >= 24 && !self.entries.contains_key(id) {
                    if let Some(key) = self
                        .entries
                        .iter()
                        .min_by_key(|(_, v)| &v.updated_at)
                        .map(|(k, _)| k.clone())
                    {
                        self.entries.remove(&key);
                    }
                }
                self.entries.insert(id.into(), d.clone());
                Ok(d)
            }
            Err(e) => self.failed(old, e, now),
        }
    }
    fn failed(
        &mut self,
        old: Option<Details>,
        e: Failure,
        now: DateTime<Utc>,
    ) -> Result<Details, String> {
        self.blocked_until = now
            .timestamp()
            .saturating_add(e.retry_after.unwrap_or(60).max(60).min(i64::MAX as u64) as i64);
        eprintln!("MatchRadar summaries: {}", e.message);
        saved_or_error(old, e.message)
    }
}
fn saved_or_error(old: Option<Details>, error: String) -> Result<Details, String> {
    old.map(|mut d| {
        d.stale = true;
        d.error = Some(error.clone());
        d
    })
    .ok_or(error)
}
#[derive(Debug)]
struct Failure {
    message: String,
    retry_after: Option<u64>,
}
impl Failure {
    fn temporary(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            retry_after: None,
        }
    }
}
fn parse_response(
    id: &str,
    status: u16,
    retry: Option<u64>,
    bytes: &[u8],
) -> Result<Details, Failure> {
    if !(200..300).contains(&status) {
        return Err(Failure {
            message: format!("Summary {id}: HTTP {status}"),
            retry_after: retry,
        });
    }
    if bytes.len() > 4_000_000 {
        return Err(Failure::temporary("Summary exceeds size limit"));
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|e| Failure::temporary(format!("Summary {id} JSON: {e}")))?;
    normalize(&value, id).map_err(|e| Failure::temporary(format!("Summary {id}: {e}")))
}
async fn fetch(client: &reqwest::Client, id: &str) -> Result<Details, Failure> {
    let mut response = client
        .get("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary")
        .query(&[("event", id)])
        .send()
        .await
        .map_err(|e| Failure::temporary(format!("Summary {id}: {e}")))?;
    let status = response.status().as_u16();
    let retry = response
        .headers()
        .get("retry-after")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| crate::provider::retry_after(s, Utc::now()));
    if !(200..300).contains(&status) {
        return parse_response(id, status, retry, &[]);
    }
    if response.content_length().is_some_and(|n| n > 4_000_000) {
        return Err(Failure::temporary("Summary exceeds size limit"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| Failure::temporary(format!("Summary {id} read: {e}")))?
    {
        if bytes.len() + chunk.len() > 4_000_000 {
            return Err(Failure::temporary("Summary exceeds size limit"));
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_response(id, status, retry, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captured_summary_has_events_stats_and_rosters() {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json"))
                .unwrap();
        let d = normalize(&v, "401879268").unwrap();
        assert!(!d.events.is_empty());
        assert!(!d.statistics.is_empty());
        assert!(!d.players.is_empty());
    }
    #[test]
    fn upcoming_does_not_show_season_totals() {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/summary-upcoming.json"))
                .unwrap();
        let d = normalize(&v, "401879250").unwrap();
        assert!(d.statistics.is_empty());
        assert!(d.events.is_empty());
        assert!(normalize(&serde_json::json!({}), "1").is_err());
    }
    #[test]
    fn ordering_duplicates_and_missing_values() {
        let mut v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json"))
                .unwrap();
        let event = v["keyEvents"][0].clone();
        v["keyEvents"].as_array_mut().unwrap().reverse();
        v["keyEvents"].as_array_mut().unwrap().push(event);
        let d = normalize(&v, "401879268").unwrap();
        assert!(d.events.windows(2).all(|w| w[0].period < w[1].period
            || w[0].period == w[1].period && w[0].seconds <= w[1].seconds));
        let ids: std::collections::HashSet<_> = d.events.iter().map(|e| &e.id).collect();
        assert_eq!(ids.len(), d.events.len());
        assert!(d.statistics.iter().any(|s| s.value == "0"));
        v["boxscore"] = Value::Null;
        v["rosters"] = Value::Null;
        let d = normalize(&v, "401879268").unwrap();
        assert!(d.statistics.is_empty());
        assert!(d.players.is_empty());
    }
    #[test]
    fn old_state_and_detail_cache_roundtrip() {
        let legacy: crate::model::Snapshot = serde_json::from_str("{}").unwrap();
        assert!(legacy.detail_cache.is_empty());
        let mut state = legacy;
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json"))
                .unwrap();
        state.detail_cache.push(normalize(&v, "401879268").unwrap());
        let restored: crate::model::Snapshot =
            serde_json::from_str(&serde_json::to_string(&state).unwrap()).unwrap();
        assert_eq!(restored.detail_cache[0].match_id, "401879268");
    }
    fn clock() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }
    fn example() -> Details {
        let v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json"))
                .unwrap();
        normalize(&v, "401879268").unwrap()
    }
    #[tokio::test]
    async fn cache_hit_failure_cooldown_and_recovery() {
        let now = clock();
        let mut cache = Cache::default();
        let id = "401879268";
        cache
            .get_with(id, true, now, || async { Ok(example()) })
            .await
            .unwrap();
        let hit = cache
            .get_with(id, true, now + chrono::Duration::seconds(59), || async {
                panic!("fresh cache must not fetch")
            })
            .await
            .unwrap();
        assert!(!hit.stale);
        let saved = cache
            .get_with(id, true, now + chrono::Duration::seconds(60), || async {
                Err(Failure::temporary("timeout"))
            })
            .await
            .unwrap();
        assert!(saved.stale);
        assert_eq!(saved.updated_at, now.to_rfc3339());
        let deadline = cache.blocked_until;
        cache
            .get_with(id, true, now + chrono::Duration::seconds(90), || async {
                panic!("cooldown must not fetch")
            })
            .await
            .unwrap();
        assert_eq!(cache.blocked_until, deadline);
        let recovered = cache
            .get_with(id, true, now + chrono::Duration::seconds(120), || async {
                Ok(example())
            })
            .await
            .unwrap();
        assert!(!recovered.stale);
        assert!(recovered.error.is_none());
    }
    #[tokio::test]
    async fn restart_offline_and_future_timestamps() {
        let now = clock();
        let mut d = example();
        d.updated_at = (now - chrono::Duration::hours(1)).to_rfc3339();
        let mut cache = Cache::default();
        cache.seed(&[d]);
        let d = cache
            .get_with("401879268", false, now, || async {
                Err(Failure::temporary("offline"))
            })
            .await
            .unwrap();
        assert!(d.stale);
        assert!(!d.events.is_empty());
        let mut future = Cache::default();
        let mut d = example();
        d.updated_at = (now + chrono::Duration::hours(1)).to_rfc3339();
        future.seed(&[d]);
        assert!(
            future
                .get_with("401879268", true, now, || async {
                    Err(Failure::temporary("clock changed"))
                })
                .await
                .unwrap()
                .stale
        );
    }
    #[tokio::test]
    async fn rate_limit_deadline_and_empty_cache_errors() {
        let now = clock();
        let mut cache = Cache::default();
        assert!(cache
            .get_with("1", true, now, || async {
                Err(Failure {
                    message: "HTTP 429".into(),
                    retry_after: Some(7200),
                })
            })
            .await
            .is_err());
        assert_eq!(cache.blocked_until, now.timestamp() + 7200);
        assert!(cache
            .get_with("1", true, now + chrono::Duration::seconds(7199), || async {
                panic!("must respect Retry-After")
            })
            .await
            .is_err());
        assert_eq!(cache.blocked_until, now.timestamp() + 7200);
    }
    #[test]
    fn malformed_http_and_stoppage_time() {
        for status in [400, 429, 500] {
            assert!(parse_response("1", status, Some(120), b"{}").is_err());
        }
        assert!(parse_response("1", 200, None, b"not JSON").is_err());
        assert!(parse_response("1", 200, None, b"{}").is_err());
        let mut v: Value =
            serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json"))
                .unwrap();
        v["keyEvents"][0]["clock"]["displayValue"] = Value::String("45+2'".into());
        let d = normalize(&v, "401879268").unwrap();
        assert!(d.events.iter().any(|e| e.minute == "45+2'"));
        v["header"]["competitions"] = serde_json::json!([]);
        assert!(normalize(&v, "401879268").is_err());
    }
    #[tokio::test]
    async fn serialized_simultaneous_requests_reuse_one_result() {
        let cache = tokio::sync::Mutex::new(Cache::default());
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let request = || async {
            let mut c = cache.lock().await;
            c.get_with("401879268", true, clock(), || async {
                calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tokio::task::yield_now().await;
                Ok(example())
            })
            .await
            .unwrap()
        };
        let (a, b) = tokio::join!(request(), request());
        assert_eq!(a.updated_at, b.updated_at);
        assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 1);
    }
    #[tokio::test]
    async fn bounded_cache_and_invalid_persisted_entries() {
        let mut cache = Cache::default();
        for i in 1..=25 {
            let id = i.to_string();
            cache
                .get_with(
                    &id,
                    false,
                    clock() + chrono::Duration::seconds(i),
                    || async {
                        let mut d = example();
                        d.match_id = id.clone();
                        Ok(d)
                    },
                )
                .await
                .unwrap();
        }
        assert_eq!(cache.entries.len(), 24);
        assert!(!cache.entries.contains_key("1"));
        let mut invalid = example();
        invalid.players[0].name = "x".repeat(501);
        let value = serde_json::json!({"detailCache":[serde_json::to_value(invalid).unwrap(),serde_json::to_value(example()).unwrap(),{"broken":true}]});
        let restored: crate::model::Snapshot = serde_json::from_value(value).unwrap();
        assert_eq!(restored.detail_cache.len(), 1);
    }
    #[test]
    fn f01_recovery_preserves_details_preferences_and_pending_notifications() {
        let now = clock();
        let mut state = crate::model::Snapshot::default();
        state.settings.theme = crate::model::Theme::Light;
        state.settings.favorites = vec!["359".into()];
        state.settings.compact = true;
        state.detail_cache.push(example());
        state.sent_notifications.push("legacy-submitted-id".into());
        state
            .pending_notifications
            .push(crate::model::PendingNotification {
                id: "401879268:score:1:0".into(),
                match_id: "401879268".into(),
                home_team: "Arsenal".into(),
                away_team: "Leeds United".into(),
                body: "Confirmed score update".into(),
                kind: crate::model::NotificationKind::Goal { home: 1, away: 0 },
                created_at: now.to_rfc3339(),
                expires_at: (now + chrono::Duration::minutes(5)).to_rfc3339(),
                next_attempt_at: now.to_rfc3339(),
                attempts: 1,
            });
        let dir = std::env::temp_dir().join(format!(
            "matchradar-detail-recovery-{}-{}",
            std::process::id(),
            Utc::now().timestamp_nanos_opt().unwrap()
        ));
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("state.json");
        crate::persistence::save(&path, &state).unwrap();
        let expected = serde_json::to_value(&state).unwrap();
        state.detail_cache.clear();
        crate::persistence::save(&path, &state).unwrap();
        std::fs::write(&path, b"damaged primary").unwrap();
        let recovered = crate::persistence::load(&path).unwrap();
        assert!(recovered.notice.is_some());
        assert_eq!(serde_json::to_value(&recovered.snapshot).unwrap(), expected);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
