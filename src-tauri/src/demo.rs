//! Synthetic fixture data, used only by demo mode and test fixtures.
use crate::model::{Match, Team};
use chrono::{DateTime, Duration, Local, TimeZone, Utc};

pub fn mock() -> Vec<Match> {
    mock_at(Utc::now())
}
fn mock_at(now: DateTime<Utc>) -> Vec<Match> {
    let tomorrow = (now.with_timezone(&Local).date_naive() + Duration::days(1))
        .and_hms_opt(20, 0, 0)
        .and_then(|date| Local.from_local_datetime(&date).earliest())
        .map(|date| date.with_timezone(&Utc))
        .unwrap_or(now + Duration::hours(26));
    let team = |id: &str, name: &str, short: &str| Team {
        id: id.into(),
        name: name.into(),
        short: short.into(),
        logo: None,
    };
    let pairs = [
        (
            "359",
            "Arsenal",
            "ARS",
            "363",
            "Chelsea",
            "CHE",
            "live",
            -1,
            Some(2),
            Some(1),
        ),
        (
            "364",
            "Liverpool",
            "LIV",
            "361",
            "Newcastle United",
            "NEW",
            "halftime",
            -1,
            Some(0),
            Some(0),
        ),
        (
            "382",
            "Manchester City",
            "MCI",
            "360",
            "Manchester United",
            "MUN",
            "scheduled",
            3,
            None,
            None,
        ),
        (
            "367",
            "Tottenham Hotspur",
            "TOT",
            "362",
            "Aston Villa",
            "AVL",
            "scheduled",
            26,
            None,
            None,
        ),
        (
            "331",
            "Brighton",
            "BHA",
            "368",
            "Everton",
            "EVE",
            "fulltime",
            -4,
            Some(1),
            Some(1),
        ),
        (
            "380",
            "Wolves",
            "WOL",
            "371",
            "West Ham",
            "WHU",
            "postponed",
            48,
            None,
            None,
        ),
        (
            "384",
            "Crystal Palace",
            "CRY",
            "370",
            "Fulham",
            "FUL",
            "live",
            -1,
            Some(0),
            Some(0),
        ),
        (
            "337",
            "Brentford",
            "BRE",
            "371",
            "West Ham United",
            "WHU",
            "fulltime",
            -28,
            Some(4),
            Some(3),
        ),
        (
            "370",
            "Fulham",
            "FUL",
            "361",
            "Newcastle United",
            "NEW",
            "fulltime",
            -52,
            Some(0),
            Some(0),
        ),
        (
            "368",
            "Everton",
            "EVE",
            "380",
            "Wolverhampton Wanderers",
            "WOL",
            "cancelled",
            54,
            None,
            None,
        ),
        (
            "367",
            "Tottenham Hotspur",
            "TOT",
            "368",
            "Everton",
            "EVE",
            "suspended",
            -2,
            Some(0),
            Some(0),
        ),
        (
            "371",
            "West Ham United",
            "WHU",
            "384",
            "Crystal Palace",
            "CRY",
            "unknown",
            72,
            None,
            None,
        ),
    ];
    pairs
        .iter()
        .enumerate()
        .map(
            |(i, (hi, hn, hs, ai, an, as_, status, hours, home_score, away_score))| Match {
                score_stale: false,
                id: format!("demo-{i}"),
                home: team(hi, hn, hs),
                away: team(ai, an, as_),
                home_score: *home_score,
                away_score: *away_score,
                kickoff: (if *hi == "382" && *ai == "360" {
                    now + Duration::minutes(15)
                } else if *hi == "367" && *ai == "362" {
                    tomorrow
                } else {
                    now + Duration::hours(*hours)
                })
                .to_rfc3339(),
                status: status.to_string(),
                detail: match *status {
                    "live" if *hi == "384" => "21′",
                    "live" => "67′",
                    "halftime" => "Half-time",
                    "fulltime" => "Full-time",
                    "postponed" => "Postponed",
                    "cancelled" => "Cancelled",
                    "suspended" => "Suspended",
                    "unknown" => "Status unavailable",
                    _ => "Scheduled",
                }
                .into(),
                competition: "Premier League".into(),
            },
        )
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn demo_scenarios_are_stable_for_a_chosen_clock() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        let matches = mock_at(now);
        assert_eq!(
            serde_json::to_value(&matches).unwrap(),
            serde_json::to_value(mock_at(now)).unwrap()
        );
        let ids: std::collections::HashSet<_> = matches.iter().map(|m| &m.id).collect();
        assert_eq!(ids.len(), matches.len());
        assert!(
            matches
                .iter()
                .all(|m| m.id.starts_with("demo-")
                    && DateTime::parse_from_rfc3339(&m.kickoff).is_ok())
        );
        for status in [
            "scheduled",
            "live",
            "halftime",
            "fulltime",
            "postponed",
            "cancelled",
            "suspended",
            "unknown",
        ] {
            assert!(matches.iter().any(|m| m.status == status));
        }
        let soon = matches
            .iter()
            .find(|m| m.home.id == "382" && m.away.id == "360")
            .unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(&soon.kickoff)
                .unwrap()
                .with_timezone(&Utc),
            now + Duration::minutes(15)
        );
        let tomorrow = matches
            .iter()
            .find(|m| m.home.id == "367" && m.away.id == "362")
            .unwrap();
        assert_eq!(
            DateTime::parse_from_rfc3339(&tomorrow.kickoff)
                .unwrap()
                .with_timezone(&Local)
                .date_naive(),
            now.with_timezone(&Local).date_naive() + Duration::days(1)
        );
        assert!(matches
            .iter()
            .any(|m| m.home.id == "384" && m.status == "live" && m.detail.starts_with("21")));
    }
}
