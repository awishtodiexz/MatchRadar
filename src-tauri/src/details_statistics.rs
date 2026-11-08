use super::{Details, Statistic};
use crate::model::Competition;
use serde_json::Value;
use std::time::Duration;
use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
};

static BLOCKED: OnceLock<Mutex<HashMap<String, i64>>> = OnceLock::new();

// Match-only fields. The core response also carries season-style placeholders
// (appearances, ratings, wins, etc.); those do not belong in a match comparison.
const METRICS: &[&str] = &[
    "expectedGoals",
    "expectedGoalsNonPenalty",
    "expectedGoalsOnTarget",
    "expectedAssists",
    "bigChanceCreated",
    "bigChanceMissed",
    "totalShots",
    "shotsOnTarget",
    "shotsOffTarget",
    "attemptsIbox",
    "attemptsObox",
    "blockedShots",
    "hitWoodwork",
    "shotPct",
    "penaltyKickGoals",
    "penaltyKickShots",
    "possessionPct",
    "wonCorners",
    "touches",
    "touchesInOppBox",
    "finalThirdEntries",
    "penAreaEntries",
    "totalPasses",
    "accuratePasses",
    "passPct",
    "totalCrosses",
    "accurateCrosses",
    "crossPct",
    "totalLongBalls",
    "accurateLongBalls",
    "longballPct",
    "totalThroughBalls",
    "accurateThroughBalls",
    "successfulFinalThirdPasses",
    "totalFinalThirdPasses",
    "shotAssists",
    "totalContest",
    "wonContest",
    "duels",
    "duelsWon",
    "duelsLost",
    "duelWinPct",
    "aerialsWon",
    "aerialsLost",
    "aerialDuelPct",
    "totalTackles",
    "effectiveTackles",
    "tacklePct",
    "interceptions",
    "totalClearance",
    "effectiveClearance",
    "ballRecovery",
    "possWonAtt3rd",
    "possWonMid3rd",
    "possWonDef3rd",
    "ppda",
    "dispossessed",
    "saves",
    "goalsPrevented",
    "expectedGoalsOnTargetConceded",
    "crossesCaught",
    "punches",
    "accurateKeeperSweeper",
    "foulsCommitted",
    "foulsSuffered",
    "offsides",
    "yellowCards",
    "redCards",
    "secondYellow",
];

fn numeric_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 128 && id.bytes().all(|b| b.is_ascii_digit())
}
fn valid_identity(value: &Value, details: &Details, team: &str) -> bool {
    let Some(competition) = value["competition"]["$ref"]
        .as_str()
        .and_then(|s| reqwest::Url::parse(s).ok())
    else {
        return false;
    };
    let Some(team_url) = value["team"]["$ref"]
        .as_str()
        .and_then(|s| reqwest::Url::parse(s).ok())
    else {
        return false;
    };
    let prefix = format!("/v2/sports/soccer/leagues/{}/", details.league.slug());
    competition.host_str() == Some("sports.core.api.espn.com")
        && team_url.host_str() == Some("sports.core.api.espn.com")
        && competition.path()
            == format!(
                "{prefix}events/{}/competitions/{}",
                details.match_id, details.match_id
            )
        && team_url.path().starts_with(&prefix)
        && team_url.path().ends_with(&format!("/teams/{team}"))
        && value["splits"]["type"].as_str() == Some("total")
}

pub(super) fn merge(details: &mut Details, team: &str, value: &Value) -> bool {
    if !numeric_id(team) || !valid_identity(value, details, team) {
        return false;
    }
    let Some(categories) = value["splits"]["categories"].as_array() else {
        return false;
    };
    let mut added = false;
    for category in categories.iter().take(10) {
        for stat in category["stats"].as_array().into_iter().flatten().take(160) {
            let Some(name) = stat["name"].as_str().filter(|name| METRICS.contains(name)) else {
                continue;
            };
            let Some(number) = stat["value"]
                .as_f64()
                .filter(|n| n.is_finite() && (*n >= 0.0 || name == "goalsPrevented"))
            else {
                continue;
            };
            let shown = if name.ends_with("Pct") {
                let pct = if name == "possessionPct" {
                    number
                } else {
                    number * 100.0
                };
                if !(0.0..=100.0).contains(&pct) {
                    continue;
                }
                format!(
                    "{}%",
                    format!("{pct:.1}")
                        .trim_end_matches('0')
                        .trim_end_matches('.')
                )
            } else {
                stat["displayValue"]
                    .as_str()
                    .filter(|s| s.len() <= 50 && s.parse::<f64>().is_ok_and(f64::is_finite))
                    .map(str::to_owned)
                    .unwrap_or_else(|| number.to_string())
            };
            let label = stat["displayName"]
                .as_str()
                .filter(|s| !s.chars().any(char::is_control))
                .unwrap_or(name)
                .chars()
                .take(120)
                .collect();
            if let Some(existing) = details
                .statistics
                .iter_mut()
                .find(|s| s.name == name && s.team_id == team)
            {
                // Preserve the summary's counters. Core adds precision to rates,
                // but should not replace a newer live shot/card count.
                if name.ends_with("Pct") {
                    existing.value = shown;
                }
            } else {
                details.statistics.push(Statistic {
                    team_id: team.into(),
                    name: name.into(),
                    label,
                    value: shown,
                });
            }
            added = true;
        }
    }
    added
}

async fn fetch(
    client: &reqwest::Client,
    league: Competition,
    id: &str,
    team: &str,
) -> Result<Value, String> {
    if !numeric_id(id) || !numeric_id(team) {
        return Err("Invalid match statistics identity".into());
    }
    let url=format!("https://sports.core.api.espn.com/v2/sports/soccer/leagues/{}/events/{id}/competitions/{id}/competitors/{team}/statistics",league.slug());
    let now = chrono::Utc::now();
    {
        let mut blocked = BLOCKED
            .get_or_init(Mutex::default)
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        blocked.retain(|_, until| *until > now.timestamp());
        if blocked.contains_key(&url) {
            return Err("Paused after Retry-After".into());
        }
    }
    let mut response = client
        .get(&url)
        .query(&[("lang", "en"), ("region", "us")])
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        if let Some(delay) = response
            .headers()
            .get("retry-after")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| crate::provider::retry_after(s, now))
        {
            let mut blocked = BLOCKED
                .get_or_init(Mutex::default)
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            if blocked.len() >= 128 {
                if let Some(key) = blocked
                    .iter()
                    .min_by_key(|(_, until)| **until)
                    .map(|(key, _)| key.clone())
                {
                    blocked.remove(&key);
                }
            }
            blocked.insert(
                url,
                now.timestamp().saturating_add(delay.clamp(60, 3600) as i64),
            );
        }
        return Err(format!("HTTP {}", response.status()));
    }
    if response.content_length().is_some_and(|n| n > 256_000) {
        return Err("Statistics exceed size limit".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > 256_000 {
            return Err("Statistics exceed size limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

pub(super) async fn enrich(client: &reqwest::Client, details: &mut Details, teams: &[String]) {
    if teams.len() != 2 {
        return;
    }
    let (home, away) = tokio::join!(
        fetch(client, details.league, &details.match_id, &teams[0]),
        fetch(client, details.league, &details.match_id, &teams[1])
    );
    let mut complete = true;
    for (team, result) in teams.iter().zip([home, away]) {
        match result {
            Ok(value) if merge(details, team, &value) => {}
            Ok(_) => {
                complete = false;
                eprintln!(
                    "MatchRadar statistics: {} team {team}: invalid or empty match totals",
                    details.match_id
                );
            }
            Err(error) => {
                complete = false;
                eprintln!(
                    "MatchRadar statistics: {} team {team}: {error}",
                    details.match_id
                );
            }
        }
    }
    if !complete {
        details.statistics_note =
            Some("Additional statistics unavailable; showing available match totals.".into());
    }
}
