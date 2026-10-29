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
    if v["header"]["id"].as_str() != Some(id) || !v["header"]["competitions"].is_array() {
        return Err("Summary identity/shape mismatch".into());
    }
    let mut events = BTreeMap::new();
    for e in array(&v["keyEvents"]).iter().take(1000) {
        let eid = text(e, "id");
        let kind = text(&e["type"], "type");
        let body = text(e, "text");
        if eid.is_empty() || body.is_empty() {
            continue;
        }
        events.insert(
            eid.clone(),
            Event {
                id: eid,
                minute: text(&e["clock"], "displayValue"),
                seconds: e["clock"]["value"].as_f64().unwrap_or(0.0),
                period: e["period"]["number"].as_u64().unwrap_or(0),
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
        .is_some_and(|s| s != "pre")
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
}
pub fn deserialize_cache<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<Details>, D::Error> {
    let value = Value::deserialize(d)?;
    Ok(array(&value)
        .iter()
        .take(24)
        .filter_map(|v| serde_json::from_value::<Details>(v.clone()).ok())
        .filter(|d| {
            !d.match_id.is_empty()
                && d.match_id.bytes().all(|b| b.is_ascii_digit())
                && d.events.len() <= 1000
                && d.statistics.len() <= 80
                && d.players.len() <= 80
                && DateTime::parse_from_rfc3339(&d.updated_at).is_ok()
        })
        .collect())
}
impl Cache {
    pub fn seed(&mut self, saved: &[Details]) {
        if self.entries.is_empty() {
            for d in saved.iter().take(24) {
                self.entries.insert(d.match_id.clone(), d.clone());
            }
        }
    }

    pub async fn get(&mut self, id: &str, active: bool) -> Result<Details, String> {
        let now = Utc::now().timestamp();
        let old = self.entries.get(id).cloned();
        if let Some(d) = &old {
            let age = DateTime::parse_from_rfc3339(&d.updated_at)
                .map(|t| now - t.timestamp())
                .unwrap_or(i64::MAX);
            if age < if active { 60 } else { 900 } {
                return Ok(d.clone());
            }
        }
        let result = async {
            if now < self.blocked_until {
                return Err("Summary requests paused after an error; cached data retained".into());
            }
            let client = crate::provider::client().map_err(|e| e.message)?;
            let mut response = client
                .get("https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary")
                .query(&[("event", id)])
                .send()
                .await
                .map_err(|e| format!("Summary {id}: {e}"))?;
            let status = response.status();
            if !status.is_success() {
                let delay = response
                    .headers()
                    .get("retry-after")
                    .and_then(|h| h.to_str().ok())
                    .and_then(|s| crate::provider::retry_after(s, Utc::now()))
                    .unwrap_or(60)
                    .max(60);
                self.blocked_until = now.saturating_add(delay.min(i64::MAX as u64) as i64);
                return Err(format!("Summary {id}: HTTP {status}"));
            }
            if response.content_length().is_some_and(|n| n > 4_000_000) {
                return Err("Summary exceeds size limit".into());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|e| format!("Summary read: {e}"))?
            {
                if bytes.len() + chunk.len() > 4_000_000 {
                    return Err("Summary exceeds size limit".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            let value: Value =
                serde_json::from_slice(&bytes).map_err(|e| format!("Summary JSON: {e}"))?;
            normalize(&value, id)
        }
        .await;
        match result {
            Ok(d) => {
                if self.entries.len() >= 24 {
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
            Err(e) => {
                self.blocked_until = self.blocked_until.max(now + 60);
                eprintln!("MatchRadar {e}");
                old.map(|mut d| {
                    d.stale = true;
                    d.error = Some(e.clone());
                    d
                })
                .ok_or(e)
            }
        }
    }
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
}
