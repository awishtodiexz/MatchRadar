//! On-demand match summary data for supported competitions; never an authority for scores.
use crate::model::Competition;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex as StdMutex, OnceLock,
    },
};
use tokio::sync::Mutex as AsyncMutex;
#[path = "details_statistics.rs"]
mod statistics;
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
    #[serde(default)]
    participants: Vec<String>,
    #[serde(default)]
    short_text: Option<String>,
    #[serde(default)]
    reason: Option<String>,
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
    #[serde(default)]
    jersey: Option<String>,
    #[serde(default)]
    formation_place: Option<u32>,
    #[serde(default)]
    subbed_in: bool,
    #[serde(default)]
    subbed_out: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Coach {
    team_id: String,
    name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scorer {
    team_id: String,
    team_name: String,
    name: String,
    minute: String,
    #[serde(default)]
    own_goal: bool,
    #[serde(default)]
    penalty: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Substitution {
    team_id: String,
    player_in: String,
    player_out: String,
    minute: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormGame {
    opponent: String,
    opponent_id: String,
    result: String,
    score: String,
    at_home: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamLeader {
    team_id: String,
    category: String,
    name: String,
    #[serde(default)]
    jersey: Option<String>,
    position: String,
    value: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub match_id: String,
    #[serde(default)]
    pub match_state: Option<String>,
    /// Missing in saved Premier League caches, which default to that competition.
    #[serde(default)]
    pub league: Competition,
    #[serde(default)]
    pub venue: Option<String>,
    #[serde(default)]
    pub venue_city: Option<String>,
    #[serde(default)]
    pub referee: Option<String>,
    #[serde(default)]
    pub capacity: Option<u32>,
    #[serde(default)]
    pub statistics_note: Option<String>,
    #[serde(default)]
    pub attendance: Option<u32>,
    #[serde(default)]
    pub form: HashMap<String, Vec<FormGame>>,
    #[serde(default)]
    pub leaders: Vec<TeamLeader>,
    pub events: Vec<Event>,
    pub statistics: Vec<Statistic>,
    pub players: Vec<Player>,
    #[serde(default)]
    pub scorers: Vec<Scorer>,
    #[serde(default)]
    pub substitutions: Vec<Substitution>,
    #[serde(default)]
    pub formations: HashMap<String, String>,
    #[serde(default)]
    pub coaches: Vec<Coach>,
    pub updated_at: String,
    pub error: Option<String>,
    pub stale: bool,
}
fn text(v: &Value, key: &str) -> String {
    v[key].as_str().unwrap_or("").chars().take(500).collect()
}
fn clean_text(v: &Value, limit: usize) -> Option<String> {
    v.as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && !s.chars().any(char::is_control))
        .map(|s| s.chars().take(limit).collect())
}
fn referee(v: &Value) -> Option<String> {
    clean_text(&v["gameInfo"]["referee"]["displayName"], 120)
        .or_else(|| clean_text(&v["gameInfo"]["referee"]["fullName"], 120))
        .or_else(|| {
            [
                &v["gameInfo"]["officials"],
                &v["header"]["competitions"][0]["officials"],
            ]
            .into_iter()
            .find_map(|list| {
                array(list).iter().find_map(|official| {
                    let role = official["position"]["name"]
                        .as_str()
                        .or_else(|| official["type"]["name"].as_str())
                        .or_else(|| official["type"].as_str())
                        .unwrap_or("")
                        .to_ascii_lowercase();
                    if !matches!(role.as_str(), "referee" | "head referee" | "main referee")
                        && !(role.is_empty() && array(list).len() == 1)
                    {
                        return None;
                    }
                    clean_text(&official["fullName"], 120)
                        .or_else(|| clean_text(&official["displayName"], 120))
                })
            })
        })
}
fn commentary_kind(body: &str) -> &'static str {
    let text = body.to_ascii_lowercase();
    if text.starts_with("lineups") {
        "pre-match"
    } else if text.starts_with("match ends") {
        "full-time"
    } else if text.contains("half ends") {
        "half-time"
    } else if text.contains("half begins") {
        "kickoff"
    } else if text.starts_with("goal!") {
        "goal"
    } else if text.contains("second yellow") {
        "second-yellow-card"
    } else if text.contains("red card") {
        "red-card"
    } else if text.contains("yellow card") {
        "yellow-card"
    } else if text.starts_with("substitution") {
        "substitution"
    } else if text.contains("var decision") {
        "var-decision"
    } else if text.starts_with("delay over") {
        "end-delay"
    } else if text.starts_with("delay") {
        "start-delay"
    } else if text.starts_with("corner") {
        "corner"
    } else if text.starts_with("offside") {
        "offside"
    } else if text.starts_with("attempt saved") {
        "shot-on-target"
    } else if text.starts_with("attempt blocked") {
        "shot-blocked"
    } else if text.starts_with("attempt missed") {
        "shot-off-target"
    } else if text.starts_with("foul") {
        "foul"
    } else {
        "commentary"
    }
}
fn scoring_kind(kind: &str) -> bool {
    matches!(
        kind,
        "goal" | "own-goal" | "penalty-scored" | "penalty---scored"
    ) || (kind.starts_with("goal---")
        && !["disallowed", "cancelled", "overturned"]
            .iter()
            .any(|word| kind.contains(word)))
}
fn array(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn event_participants(play: &Value, body: &str) -> Vec<String> {
    let names: Vec<_> = array(&play["participants"])
        .iter()
        .take(2)
        .map(|person| text(&person["athlete"], "displayName"))
        .filter(|name| !name.is_empty())
        .collect();
    if !names.is_empty() {
        return names;
    }
    if let Some((player_in, player_out)) = substitution_from_text(body) {
        return vec![player_in, player_out];
    }
    if body.to_ascii_lowercase().contains("yellow card")
        || body.to_ascii_lowercase().contains("red card")
    {
        let lower = body.to_ascii_lowercase();
        let start = lower.find("card to ").map_or(0, |index| index + 8);
        if let Some((name, _)) = body[start..].split_once(" (") {
            let name = name.trim();
            if !name.is_empty() {
                return vec![name.chars().take(120).collect()];
            }
        }
    }
    if let Some((name, _)) = scorer_from_text(body) {
        return vec![name];
    }
    Vec::new()
}
fn incident_reason(kind: &str, body: &str) -> Option<String> {
    let lower = body.to_ascii_lowercase();
    let start = if kind.contains("card") || kind.starts_with("second-yellow") {
        lower.rfind(" for ").map(|index| index + 5)
    } else if kind == "substitution" {
        lower.rfind(" because of ").map(|index| index + 12)
    } else {
        None
    }?;
    let reason = body[start..].split('.').next()?.trim();
    let reason = reason
        .strip_prefix("a ")
        .or_else(|| reason.strip_prefix("an "))
        .unwrap_or(reason);
    if reason.is_empty() || reason.chars().any(char::is_control) {
        return None;
    }
    let mut letters = reason.chars();
    Some(
        letters
            .next()?
            .to_uppercase()
            .chain(letters)
            .take(120)
            .collect(),
    )
}
fn event_team(team: &Value, by_name: &HashMap<String, String>) -> Option<String> {
    team["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            team["displayName"]
                .as_str()
                .and_then(|name| by_name.get(name).cloned())
        })
}

fn commentary_period(body: &str, display: &str, seconds: f64) -> Option<u64> {
    let lower = body.to_ascii_lowercase();
    if lower.starts_with("first half") {
        return Some(1);
    }
    if lower.starts_with("second half") {
        return Some(2);
    }
    if lower.starts_with("match ends") || lower.starts_with("lineups are announced") {
        return None;
    }
    if lower.starts_with("extra time") {
        return Some(if lower.contains("second") { 4 } else { 3 });
    }
    if lower.starts_with("penalties") {
        return Some(5);
    }
    let minute = display
        .chars()
        .take_while(char::is_ascii_digit)
        .collect::<String>()
        .parse::<u64>()
        .ok()
        .or_else(|| (seconds.is_finite() && seconds >= 0.0).then_some((seconds / 60.0) as u64))?;
    Some(match minute {
        0..=45 => 1,
        46..=90 => 2,
        91..=105 => 3,
        106..=120 => 4,
        _ => 4,
    })
}

fn substitution_from_text(body: &str) -> Option<(String, String)> {
    let (before, after) = body.split_once(" replaces ")?;
    let player_in = before.rsplit(". ").next()?.trim();
    let player_out = after
        .split_once(" because")
        .map_or(after, |(name, _)| name)
        .trim()
        .trim_end_matches('.')
        .trim();
    (!player_in.is_empty() && !player_out.is_empty())
        .then(|| (player_in.to_string(), player_out.to_string()))
}

fn add_substitution(
    rows: &mut Vec<(f64, Substitution)>,
    seen: &mut HashSet<String>,
    participants: &Value,
    team_id: String,
    minute: String,
    body: &str,
    seconds: f64,
) {
    let names = array(participants);
    let player_in = names
        .first()
        .map(|entry| text(&entry["athlete"], "displayName"))
        .filter(|name| !name.is_empty());
    let player_out = names
        .get(1)
        .map(|entry| text(&entry["athlete"], "displayName"))
        .filter(|name| !name.is_empty());
    let (player_in, player_out) = match (player_in, player_out) {
        (Some(player_in), Some(player_out)) => (player_in, player_out),
        _ => match substitution_from_text(body) {
            Some(pair) => pair,
            None => return,
        },
    };
    if !seen.insert(format!("{team_id}:{minute}:{player_in}")) {
        return;
    }
    rows.push((
        seconds,
        Substitution {
            team_id,
            player_in,
            player_out,
            minute,
        },
    ));
}

fn scorer_from_text(body: &str) -> Option<(String, String)> {
    let after = body
        .rsplit_once(". ")
        .map(|(_, rest)| rest)
        .or_else(|| body.strip_prefix("Goal! "))
        .unwrap_or(body);
    let name = after.split(" (").next()?.trim();
    let team = after.split(" (").nth(1)?.split(')').next()?.trim();
    (!name.is_empty() && !team.is_empty()).then(|| {
        (
            name.chars().take(120).collect(),
            team.chars().take(120).collect(),
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn add_scorer(
    rows: &mut Vec<(f64, Scorer)>,
    seen: &mut HashSet<String>,
    seconds: f64,
    minute: String,
    name: String,
    team_id: String,
    team_name: String,
    body: &str,
) {
    if name.is_empty() {
        return;
    }
    if !seen.insert(format!("{team_id}:{name}:{minute}")) {
        return;
    }
    let lower = body.to_ascii_lowercase();
    rows.push((
        seconds,
        Scorer {
            team_id,
            team_name,
            name: name.chars().take(120).collect(),
            minute,
            own_goal: lower.contains("own goal"),
            penalty: lower.contains("penalty"),
        },
    ));
}

pub fn normalize(v: &Value, id: &str, league: Competition) -> Result<Details, String> {
    if v["header"]["id"].as_str() != Some(id) || array(&v["header"]["competitions"]).is_empty() {
        return Err("Summary identity/shape mismatch".into());
    }
    let mut team_by_name = HashMap::new();
    let mut team_names = HashMap::new();
    for side in array(&v["header"]["competitions"][0]["competitors"])
        .iter()
        .take(2)
    {
        if let (Some(team_id), Some(name)) = (
            side["team"]["id"].as_str(),
            side["team"]["displayName"].as_str(),
        ) {
            team_by_name.insert(name.to_string(), team_id.to_string());
            team_names.insert(team_id.to_string(), name.to_string());
        }
    }
    let mut events = BTreeMap::new();
    let mut seen_text = HashSet::new();
    let mut scorer_rows = Vec::new();
    let mut seen_scorers = HashSet::new();
    let mut substitution_rows = Vec::new();
    let mut seen_substitutions = HashSet::new();
    for e in array(&v["keyEvents"]).iter().take(1000) {
        let eid = text(e, "id");
        let kind = text(&e["type"], "type");
        let body = e["text"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(2000)
            .collect::<String>();
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
        let team_id = event_team(&e["team"], &team_by_name);
        if scoring_kind(&kind)
            || (e["scoringPlay"].as_bool() == Some(true) && !kind.contains("disallowed"))
        {
            let participant = e["participants"][0]["athlete"]["displayName"]
                .as_str()
                .map(str::to_owned);
            let parsed = scorer_from_text(&body);
            let name = participant.or_else(|| parsed.as_ref().map(|(name, _)| name.clone()));
            if let Some(name) = name {
                let team_name = team_id
                    .as_ref()
                    .and_then(|id| team_names.get(id).cloned())
                    .or_else(|| parsed.map(|(_, team)| team))
                    .unwrap_or_default();
                add_scorer(
                    &mut scorer_rows,
                    &mut seen_scorers,
                    seconds,
                    text(&e["clock"], "displayValue"),
                    name,
                    team_id.clone().unwrap_or_default(),
                    team_name,
                    &body,
                );
            }
        }
        if kind == "substitution" {
            add_substitution(
                &mut substitution_rows,
                &mut seen_substitutions,
                &e["participants"],
                team_id.clone().unwrap_or_default(),
                text(&e["clock"], "displayValue"),
                &body,
                seconds,
            );
        }
        seen_text.insert(body.clone());
        events.insert(
            eid.clone(),
            Event {
                id: eid,
                minute: text(&e["clock"], "displayValue"),
                seconds,
                period,
                reason: incident_reason(&kind, &body),
                kind,
                participants: event_participants(e, &body),
                short_text: e["shortText"]
                    .as_str()
                    .map(|s| s.chars().take(160).collect()),
                text: body,
                team_id,
            },
        );
    }
    // ESPN's live keyEvents can be nearly empty while commentary carries the
    // running match detail. Add unique commentary entries for a useful timeline.
    for entry in array(&v["commentary"]).iter().take(1000) {
        let play = &entry["play"];
        let mut kind = if text(&play["type"], "type").is_empty() {
            text(&entry["type"], "type")
        } else {
            text(&play["type"], "type")
        };
        let body = play["text"]
            .as_str()
            .filter(|s| !s.is_empty())
            .or_else(|| entry["text"].as_str())
            .unwrap_or("")
            .chars()
            .take(2000)
            .collect::<String>();
        if body.is_empty() {
            continue;
        }
        if kind.is_empty() {
            kind = commentary_kind(&body).into();
        }
        let mut seconds = play["clock"]["value"]
            .as_f64()
            .or_else(|| entry["time"]["value"].as_f64())
            .filter(|n| n.is_finite() && *n >= 0.0)
            .unwrap_or(0.0);
        let mut minute = if text(&play["clock"], "displayValue").is_empty() {
            text(&entry["time"], "displayValue")
        } else {
            text(&play["clock"], "displayValue")
        };
        if minute.is_empty() || minute == "—" {
            match kind.as_str() {
                "pre-match" => minute = "Before".into(),
                "kickoff" if body.to_ascii_lowercase().contains("first half") => {
                    minute = "0'".into()
                }
                "kickoff" if body.to_ascii_lowercase().contains("second half") => {
                    minute = "46'".into();
                    seconds = 2700.0;
                }
                "full-time" => {
                    minute = "FT".into();
                    seconds = events
                        .values()
                        .map(|event: &Event| event.seconds)
                        .fold(5400.0, f64::max)
                        + 1.0;
                }
                _ => continue,
            }
        }
        let Some(period) = (if kind == "pre-match" {
            Some(0)
        } else if kind == "full-time" {
            Some(
                v["header"]["competitions"][0]["status"]["period"]
                    .as_u64()
                    .filter(|p| (1..=5).contains(p))
                    .unwrap_or(2),
            )
        } else {
            play["period"]["number"]
                .as_u64()
                .or_else(|| entry["time"]["period"].as_u64())
                .filter(|n| *n > 0 && *n <= 10)
                .or_else(|| commentary_period(&body, &minute, seconds))
        }) else {
            continue;
        };
        let raw_id = text(play, "id");
        let fallback = entry["sequence"]
            .as_u64()
            .map(|n| n.to_string())
            .unwrap_or_default();
        let eid = if events.contains_key(&raw_id) {
            raw_id
        } else {
            format!("c-{}", if raw_id.is_empty() { fallback } else { raw_id })
        };
        if eid == "c-" || (!events.contains_key(&eid) && !seen_text.insert(body.clone())) {
            continue;
        }
        let team_id = event_team(&play["team"], &team_by_name).or_else(|| {
            let candidates: HashSet<_> = team_by_name
                .iter()
                .filter(|(name, _)| {
                    body.contains(&format!("({name})"))
                        || body.starts_with(&format!("Substitution, {name}."))
                })
                .map(|(_, id)| id.clone())
                .collect();
            if candidates.len() == 1 {
                candidates.into_iter().next()
            } else {
                None
            }
        });
        if scoring_kind(&kind) || (kind == "commentary" && body.starts_with("Goal!")) {
            let participant = play["participants"][0]["athlete"]["displayName"]
                .as_str()
                .map(str::to_owned);
            let parsed = scorer_from_text(&body);
            let name = participant.or_else(|| parsed.as_ref().map(|(name, _)| name.clone()));
            if let Some(name) = name {
                let team_name = play["team"]["displayName"]
                    .as_str()
                    .map(str::to_owned)
                    .or_else(|| team_id.as_ref().and_then(|id| team_names.get(id).cloned()))
                    .or_else(|| parsed.map(|(_, team)| team))
                    .unwrap_or_default();
                add_scorer(
                    &mut scorer_rows,
                    &mut seen_scorers,
                    seconds,
                    minute.clone(),
                    name,
                    team_id.clone().unwrap_or_default(),
                    team_name,
                    &body,
                );
            }
        }
        if kind == "substitution" {
            add_substitution(
                &mut substitution_rows,
                &mut seen_substitutions,
                &play["participants"],
                team_id.clone().unwrap_or_default(),
                minute.clone(),
                &body,
                seconds,
            );
        }
        if let Some(existing) = events.get_mut(&eid) {
            if body.chars().count() > existing.text.chars().count() {
                existing.text = body.clone();
            }
            if existing.reason.is_none() {
                existing.reason = incident_reason(&kind, &body);
            }
            if existing.participants.is_empty() {
                existing.participants = event_participants(play, &body);
            }
            if existing.team_id.is_none() {
                existing.team_id = team_id;
            }
            seen_text.insert(body);
            continue;
        }
        events.insert(
            eid.clone(),
            Event {
                id: eid,
                minute,
                seconds,
                period,
                reason: incident_reason(&kind, &body),
                kind,
                participants: event_participants(play, &body),
                short_text: play["shortText"]
                    .as_str()
                    .map(|s| s.chars().take(160).collect()),
                text: body,
                team_id,
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
    scorer_rows.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then(a.1.name.cmp(&b.1.name))
            .then(a.1.team_id.cmp(&b.1.team_id))
    });
    let scorers = scorer_rows.into_iter().map(|(_, scorer)| scorer).collect();
    substitution_rows.sort_by(|a, b| {
        a.0.total_cmp(&b.0)
            .then(a.1.minute.cmp(&b.1.minute))
            .then(a.1.player_in.cmp(&b.1.player_in))
    });
    let substitutions = substitution_rows
        .into_iter()
        .map(|(_, substitution)| substitution)
        .collect();
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
    let mut coaches = Vec::new();
    for side in array(&v["rosters"])
        .iter()
        .chain(array(&v["header"]["competitions"][0]["competitors"]).iter())
    {
        let team_id = text(&side["team"], "id");
        for coach in array(&side["coaches"]).iter().take(4) {
            let name = text(coach, "displayName");
            let name = if name.is_empty() {
                text(coach, "name")
            } else {
                name
            };
            if !team_id.is_empty()
                && !name.is_empty()
                && !coaches
                    .iter()
                    .any(|c: &Coach| c.team_id == team_id && c.name == name)
            {
                coaches.push(Coach {
                    team_id: team_id.clone(),
                    name: name.chars().take(120).collect(),
                });
            }
        }
    }
    let mut formations = HashMap::new();
    for t in array(&v["rosters"]).iter().take(2) {
        let team_id = text(&t["team"], "id");
        if let Some(formation) = t["formation"]
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty() && value.chars().count() <= 20)
        {
            if !team_id.is_empty() {
                formations.insert(team_id.clone(), formation.to_string());
            }
        }
        for p in array(&t["roster"]).iter().take(40) {
            let name = text(&p["athlete"], "displayName");
            if name.is_empty() {
                continue;
            }
            let jersey = p["jersey"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| p["jersey"].as_u64().map(|n| n.to_string()))
                .filter(|value| {
                    !value.is_empty()
                        && value.len() <= 4
                        && value.bytes().all(|b| b.is_ascii_digit())
                });
            players.push(Player {
                team_id: team_id.clone(),
                name,
                position: text(&p["position"], "abbreviation"),
                starter: p["starter"].as_bool().unwrap_or(false),
                jersey,
                formation_place: p["formationPlace"]
                    .as_u64()
                    .or_else(|| {
                        p["formationPlace"]
                            .as_str()
                            .and_then(|value| value.parse::<u64>().ok())
                    })
                    .filter(|n| (1..=11).contains(n))
                    .map(|n| n as u32),
                subbed_in: p["subbedIn"].as_bool().unwrap_or(false),
                subbed_out: p["subbedOut"].as_bool().unwrap_or(false),
            });
        }
    }
    players.sort_by(|a, b| {
        a.team_id
            .cmp(&b.team_id)
            .then(b.starter.cmp(&a.starter))
            .then(
                a.formation_place
                    .unwrap_or(99)
                    .cmp(&b.formation_place.unwrap_or(99)),
            )
            .then(a.name.cmp(&b.name))
    });
    let attendance = v["gameInfo"]["attendance"]
        .as_u64()
        .or_else(|| {
            v["gameInfo"]["attendance"]
                .as_str()
                .and_then(|value| value.parse::<u64>().ok())
        })
        .filter(|n| (1..=1_000_000).contains(n))
        .map(|n| n as u32);
    let mut form = HashMap::new();
    for team in array(&v["lastFiveGames"]).iter().take(2) {
        let team_id = text(&team["team"], "id");
        if team_id.is_empty() {
            continue;
        }
        let games = array(&team["events"])
            .iter()
            .take(5)
            .filter_map(|game| {
                let opponent = text(&game["opponent"], "displayName");
                let result = text(game, "gameResult").to_uppercase();
                if opponent.is_empty() || !matches!(result.as_str(), "W" | "D" | "L") {
                    return None;
                }
                Some(FormGame {
                    opponent: opponent.chars().take(100).collect(),
                    opponent_id: text(&game["opponent"], "id"),
                    result,
                    score: text(game, "score").chars().take(20).collect(),
                    at_home: text(game, "atVs") == "vs",
                })
            })
            .collect::<Vec<_>>();
        if !games.is_empty() {
            form.insert(team_id, games);
        }
    }
    let mut leaders = Vec::new();
    let mut seen_leaders = HashSet::new();
    for team in array(&v["leaders"]).iter().take(2) {
        let team_id = text(&team["team"], "id");
        if team_id.is_empty() {
            continue;
        }
        for category in array(&team["leaders"]).iter().take(8) {
            let Some(entry) = array(&category["leaders"]).first() else {
                continue;
            };
            let name = text(&entry["athlete"], "displayName");
            let value = text(entry, "displayValue");
            let display = text(category, "displayName");
            if name.is_empty() || value.is_empty() || display.is_empty() {
                continue;
            }
            let category = match display.as_str() {
                "Total Shots" => "Shots",
                "Accurate Passes" => "Passes",
                "Defensive Interventions" => "Duels",
                other => other,
            };
            if !seen_leaders.insert(format!("{team_id}:{category}:{name}")) {
                continue;
            }
            let jersey = entry["athlete"]["jersey"]
                .as_str()
                .map(str::to_owned)
                .or_else(|| entry["athlete"]["jersey"].as_u64().map(|n| n.to_string()))
                .filter(|value| {
                    !value.is_empty()
                        && value.len() <= 4
                        && value.bytes().all(|b| b.is_ascii_digit())
                });
            leaders.push(TeamLeader {
                team_id: team_id.clone(),
                category: category.chars().take(60).collect(),
                name: name.chars().take(120).collect(),
                jersey,
                position: text(&entry["athlete"]["position"], "abbreviation")
                    .chars()
                    .take(50)
                    .collect(),
                value: value.chars().take(40).collect(),
            });
            if leaders.len() >= 16 {
                break;
            }
        }
    }
    Ok(Details {
        match_id: id.into(),
        match_state: v["header"]["competitions"][0]["status"]["type"]["state"]
            .as_str()
            .filter(|state| matches!(*state, "pre" | "in" | "post"))
            .map(str::to_owned),
        league,
        venue: v["gameInfo"]["venue"]["fullName"]
            .as_str()
            .map(str::trim)
            .filter(|name| !name.is_empty() && !name.chars().any(char::is_control))
            .map(|name| name.chars().take(200).collect()),
        venue_city: clean_text(&v["gameInfo"]["venue"]["address"]["city"], 100),
        referee: referee(v),
        capacity: v["gameInfo"]["venue"]["capacity"]
            .as_u64()
            .filter(|n| *n > 0 && *n <= 1_000_000)
            .map(|n| n as u32),
        statistics_note: None,
        attendance,
        form,
        leaders,
        events,
        statistics,
        players,
        scorers,
        substitutions,
        formations,
        coaches,
        updated_at: Utc::now().to_rfc3339(),
        error: None,
        stale: false,
    })
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Live,
    Final,
    Other,
}
pub struct Cache {
    entries: StdMutex<HashMap<String, Details>>,
    blocked: StdMutex<HashMap<String, i64>>,
    key_locks: StdMutex<HashMap<String, Arc<AsyncMutex<()>>>>,
    client: OnceLock<Option<reqwest::Client>>,
    seeded: AtomicBool,
}
impl Default for Cache {
    fn default() -> Self {
        Self {
            entries: StdMutex::new(HashMap::new()),
            blocked: StdMutex::new(HashMap::new()),
            key_locks: StdMutex::new(HashMap::new()),
            client: OnceLock::new(),
            seeded: AtomicBool::new(false),
        }
    }
}
fn lock<T>(mutex: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poison| poison.into_inner())
}
fn valid_cached(d: &Details) -> bool {
    let bounded = |s: &str, n: usize| s.chars().count() <= n && !s.chars().any(char::is_control);
    !d.match_id.is_empty()
        && d.match_id.len() <= 128
        && d.match_id.bytes().all(|b| b.is_ascii_digit())
        && d.match_state
            .as_deref()
            .is_none_or(|state| matches!(state, "pre" | "in" | "post"))
        && d.events.len() <= 1000
        && d.statistics.len() <= 256
        && d.players.len() <= 80
        && d.venue.as_ref().is_none_or(|venue| bounded(venue, 200))
        && d.venue_city.as_ref().is_none_or(|s| bounded(s, 100))
        && d.referee.as_ref().is_none_or(|s| bounded(s, 120))
        && d.capacity.is_none_or(|n| n > 0 && n <= 1_000_000)
        && d.statistics_note.as_ref().is_none_or(|s| bounded(s, 200))
        && d.attendance.is_none_or(|value| value <= 1_000_000)
        && d.form.len() <= 2
        && d.form.iter().all(|(team_id, games)| {
            bounded(team_id, 128)
                && games.len() <= 5
                && games.iter().all(|game| {
                    bounded(&game.opponent, 100)
                        && bounded(&game.opponent_id, 128)
                        && matches!(game.result.as_str(), "W" | "D" | "L")
                        && bounded(&game.score, 20)
                })
        })
        && d.leaders.len() <= 16
        && d.leaders.iter().all(|leader| {
            bounded(&leader.team_id, 128)
                && bounded(&leader.category, 60)
                && bounded(&leader.name, 120)
                && bounded(&leader.position, 50)
                && bounded(&leader.value, 40)
                && leader.jersey.as_ref().is_none_or(|value| {
                    value.len() <= 4 && value.bytes().all(|b| b.is_ascii_digit())
                })
        })
        && DateTime::parse_from_rfc3339(&d.updated_at).is_ok()
        && d.events.iter().all(|e| {
            !e.id.is_empty()
                && bounded(&e.id, 500)
                && bounded(&e.text, 2000)
                && e.reason.as_ref().is_none_or(|s| bounded(s, 120))
                && bounded(&e.kind, 500)
                && bounded(&e.minute, 500)
                && e.team_id.as_ref().is_none_or(|s| bounded(s, 128))
                && e.seconds.is_finite()
                && e.seconds >= 0.0
                && (0..=10).contains(&e.period)
        })
        && d.statistics.iter().all(|s| {
            bounded(&s.team_id, 128)
                && bounded(&s.name, 500)
                && bounded(&s.label, 500)
                && bounded(&s.value, 50)
        })
        && d.players.iter().all(|p| {
            bounded(&p.team_id, 128)
                && bounded(&p.name, 500)
                && bounded(&p.position, 500)
                && p.jersey.as_ref().is_none_or(|value| {
                    value.len() <= 4 && value.bytes().all(|b| b.is_ascii_digit())
                })
                && p.formation_place.is_none_or(|place| place <= 11)
        })
        && d.scorers.len() <= 50
        && d.scorers.iter().all(|scorer| {
            bounded(&scorer.team_id, 128)
                && bounded(&scorer.team_name, 200)
                && bounded(&scorer.name, 200)
                && bounded(&scorer.minute, 50)
        })
        && d.substitutions.len() <= 40
        && d.substitutions.iter().all(|substitution| {
            bounded(&substitution.team_id, 128)
                && bounded(&substitution.player_in, 200)
                && bounded(&substitution.player_out, 200)
                && bounded(&substitution.minute, 50)
        })
        && d.formations.len() <= 2
        && d.formations
            .iter()
            .all(|(team_id, formation)| bounded(team_id, 128) && bounded(formation, 20))
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
    pub fn seed(&self, saved: &[Details]) {
        if self.seeded.swap(true, Ordering::Relaxed) {
            return;
        }
        let mut entries = lock(&self.entries);
        for d in saved.iter().filter(|d| valid_cached(d)).take(24) {
            entries
                .entry(cache_key(d.league, &d.match_id))
                .or_insert_with(|| d.clone());
        }
    }

    pub async fn get(
        &self,
        league: Competition,
        id: &str,
        phase: Phase,
    ) -> Result<Details, String> {
        let client = self
            .client
            .get_or_init(|| crate::provider::client().ok())
            .clone();
        self.get_with(league, id, phase, Utc::now(), || async move {
            let client =
                client.ok_or_else(|| Failure::temporary("Could not create summary client"))?;
            fetch(&client, league, id).await
        })
        .await
    }

    // The clock and transport boundary allow failure/restart tests without ESPN or sleeps.
    async fn get_with<F, Fut>(
        &self,
        league: Competition,
        id: &str,
        phase: Phase,
        now: DateTime<Utc>,
        fetch: F,
    ) -> Result<Details, String>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Details, Failure>>,
    {
        let key = cache_key(league, id);
        let ttl = if phase == Phase::Live { 60 } else { 900 };
        let phase_matches = |d: &Details| match phase {
            Phase::Final => d.match_state.as_deref() == Some("post"),
            Phase::Live => d.match_state.as_deref() != Some("pre"),
            Phase::Other => true,
        };
        let fresh = |d: &Details| {
            DateTime::parse_from_rfc3339(&d.updated_at)
                .map(|t| now.timestamp() - t.timestamp())
                .unwrap_or(i64::MAX)
        };
        if let Some(d) = lock(&self.entries).get(&key) {
            if phase_matches(d) && (0..ttl).contains(&fresh(d)) {
                return Ok(d.clone());
            }
        }
        // One in-flight request per match. Different matches no longer queue behind
        // the same cache mutex for the full network round-trip.
        let key_lock = lock(&self.key_locks)
            .entry(key.clone())
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone();
        let _guard = key_lock.lock().await;
        let old = lock(&self.entries).get(&key).cloned();
        if let Some(d) = &old {
            if phase_matches(d) && (0..ttl).contains(&fresh(d)) {
                return Ok(d.clone());
            }
        }
        let blocked = lock(&self.blocked).get(&key).copied();
        if blocked.is_some_and(|until| now.timestamp() < until) {
            return saved_or_error(
                old,
                "Summary requests paused after an error; cached data retained".into(),
            );
        }
        match fetch().await {
            Ok(mut d) if d.match_id == id && d.league == league => {
                if d.statistics_note.is_some() {
                    let mut retained = false;
                    if let Some(saved) = &old {
                        for stat in &saved.statistics {
                            if d.statistics.len() < 256
                                && !d.statistics.iter().any(|current| {
                                    current.team_id == stat.team_id && current.name == stat.name
                                })
                            {
                                d.statistics.push(stat.clone());
                                retained = true;
                            }
                        }
                    }
                    if retained {
                        d.statistics_note=Some("Extended statistics could not refresh; saved values are retained alongside current match totals.".into());
                    }
                }
                d.updated_at = now.to_rfc3339();
                d.stale = false;
                d.error = None;
                let mut entries = lock(&self.entries);
                if entries.len() >= 24 && !entries.contains_key(&key) {
                    if let Some(oldest) = entries
                        .iter()
                        .min_by_key(|(_, value)| &value.updated_at)
                        .map(|(key, _)| key.clone())
                    {
                        entries.remove(&oldest);
                    }
                }
                entries.insert(key.clone(), d.clone());
                drop(entries);
                lock(&self.blocked).remove(&key);
                Ok(d)
            }
            Ok(_) => self.failed(
                &key,
                Failure::temporary("Summary identity mismatch"),
                now,
                old,
            ),
            Err(error) => self.failed(&key, error, now, old),
        }
    }

    fn failed(
        &self,
        key: &str,
        error: Failure,
        now: DateTime<Utc>,
        old: Option<Details>,
    ) -> Result<Details, String> {
        // A bogus Retry-After must not disable summaries for days.
        let until = now
            .timestamp()
            .saturating_add(error.retry_after.unwrap_or(60).clamp(60, 3600) as i64);
        lock(&self.blocked).insert(key.to_string(), until);
        eprintln!("MatchRadar summaries: {}", error.message);
        saved_or_error(old, error.message)
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
    let mut details = parse_response(id, league, status, retry, &bytes)?;
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|e| Failure::temporary(e.to_string()))?;
    let competition = &value["header"]["competitions"][0];
    if competition["status"]["type"]["state"]
        .as_str()
        .is_some_and(|s| matches!(s, "in" | "post"))
    {
        let teams: Vec<String> = array(&competition["competitors"])
            .iter()
            .take(2)
            .filter_map(|side| side["team"]["id"].as_str().map(str::to_owned))
            .collect();
        statistics::enrich(client, &mut details, &teams).await;
    }
    Ok(details)
}

#[cfg(test)]
#[path = "details_tests.rs"]
mod tests;
