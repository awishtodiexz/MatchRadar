//! On-demand match summary data for supported competitions; never an authority for scores.
use crate::model::Competition;
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
    /// Missing in saved Premier League caches, which default to that competition.
    #[serde(default)]
    pub league: Competition,
    #[serde(default)]
    pub venue: Option<String>,
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
pub fn normalize(v: &Value, id: &str, league: Competition) -> Result<Details, String> {
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
        league,
        venue: v["gameInfo"]["venue"]["fullName"]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty() && !name.chars().any(char::is_control))
            .map(|name| name.chars().take(200).collect()),
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
        && d.venue.as_ref().is_none_or(|venue| bounded(venue, 200))
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
fn cache_key(league: Competition, id: &str) -> String {
    format!("{}:{id}", league.slug())
}

pub fn deserialize_cache<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Details>, D::Error> {
    let value = Value::deserialize(d)?;
    let mut entries = HashMap::new();
    for item in array(&value).iter().take(48) {
        if let Ok(detail) = serde_json::from_value::<Details>(item.clone()) {
            if valid_cached(&detail) {
                entries.insert(cache_key(detail.league, &detail.match_id), detail);
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
                self.entries
                    .insert(cache_key(d.league, &d.match_id), d.clone());
            }
        }
    }

    pub async fn get(
        &mut self,
        league: Competition,
        id: &str,
        active: bool,
    ) -> Result<Details, String> {
        if self.client.is_none() {
            self.client = crate::provider::client().ok();
        }
        let client = self.client.clone();
        self.get_with(league, id, active, Utc::now(), || async {
            let client =
                client.ok_or_else(|| Failure::temporary("Could not create summary client"))?;
            fetch(&client, league, id).await
        })
        .await
    }

    // The clock and transport boundary allow failure/restart tests without ESPN or sleeps.
    async fn get_with<F, Fut>(
        &mut self,
        league: Competition,
        id: &str,
        active: bool,
        now: DateTime<Utc>,
        fetch: F,
    ) -> Result<Details, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Details, Failure>>,
    {
        let key = cache_key(league, id);
        let old = self.entries.get(&key).cloned();
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
                if d.match_id != id || d.league != league {
                    return self.failed(old, Failure::temporary("Summary identity mismatch"), now);
                }
                d.updated_at = now.to_rfc3339();
                d.stale = false;
                d.error = None;
                if self.entries.len() >= 24 && !self.entries.contains_key(&key) {
                    if let Some(oldest) = self
                        .entries
                        .iter()
                        .min_by_key(|(_, v)| &v.updated_at)
                        .map(|(k, _)| k.clone())
                    {
                        self.entries.remove(&oldest);
                    }
                }
                self.entries.insert(key, d.clone());
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
    league: Competition,
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
    normalize(&value, id, league).map_err(|e| Failure::temporary(format!("Summary {id}: {e}")))
}
fn summary_url(league: Competition) -> String {
    format!(
        "https://site.api.espn.com/apis/site/v2/sports/soccer/{}/summary",
        league.slug()
    )
}
async fn fetch(
    client: &reqwest::Client,
    league: Competition,
    id: &str,
) -> Result<Details, Failure> {
    let mut response = client
        .get(summary_url(league))
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
        return parse_response(id, league, status, retry, &[]);
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
    parse_response(id, league, status, retry, &bytes)
}

#[cfg(test)]
#[path = "details_tests.rs"]
mod tests;
