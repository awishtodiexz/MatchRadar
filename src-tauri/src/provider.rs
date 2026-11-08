use crate::model::{Competition, Match, Team};
use chrono::{DateTime, Datelike, Duration, Local, Months, NaiveDate, Utc};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    OnceLock,
};
use std::time::Duration as StdDuration;

// Diagnostics only: scoreboard HTTP attempts since the last manual refresh.
static REQUESTS: AtomicU64 = AtomicU64::new(0);

pub fn take_request_count() -> u64 {
    REQUESTS.swap(0, Ordering::Relaxed)
}

#[derive(Clone, Debug)]
pub struct FetchError {
    pub message: String,
    pub retry_after: Option<u64>,
}

impl FetchError {
    pub fn rate_limited(&self) -> bool {
        self.retry_after.is_some() || self.message.contains("HTTP 429")
    }
}

/// None means no valid response; Some(empty) is a valid empty response.
/// Data plus an error represents partial success across month/day queries.
#[derive(Debug, Default)]
pub struct FetchOutcome {
    pub matches: Option<Vec<Match>>,
    pub error: Option<FetchError>,
}
impl FetchOutcome {
    pub fn failed(error: FetchError) -> Self {
        Self {
            matches: None,
            error: Some(error),
        }
    }
    pub fn record(&mut self, result: Result<Vec<Match>, FetchError>) {
        match result {
            Ok(matches) => {
                self.matches = Some(merge(self.matches.take().unwrap_or_default(), matches))
            }
            Err(error) => {
                self.error = Some(if let Some(previous) = self.error.take() {
                    FetchError {
                        message: format!("{}; {}", previous.message, error.message),
                        retry_after: previous.retry_after.max(error.retry_after),
                    }
                } else {
                    error
                });
            }
        }
    }
}

async fn queries(
    client: &reqwest::Client,
    competition: Competition,
    dates: &[String],
) -> FetchOutcome {
    let mut outcome = FetchOutcome::default();
    for date in dates {
        let result = query(client, competition, date).await;
        let limited = result.as_ref().err().is_some_and(FetchError::rate_limited);
        outcome.record(result);
        if limited {
            break;
        }
    }
    outcome
}
fn field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn safe_crest(value: &str) -> Option<String> {
    let url = reqwest::Url::parse(value).ok()?;
    if url.scheme() != "https"
        || url.host_str() != Some("a.espncdn.com")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let path = url.path();
    let extension = path.rsplit_once('.')?.1.to_ascii_lowercase();
    if !path.starts_with("/i/teamlogos/soccer/")
        || !path
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b))
        || !matches!(
            extension.as_str(),
            "png" | "webp" | "jpg" | "jpeg" | "gif" | "svg"
        )
    {
        return None;
    }
    Some(url.to_string())
}
fn crest(team: &Value, id: &str) -> Option<String> {
    team.get("logo")
        .and_then(Value::as_str)
        .and_then(safe_crest)
        .or_else(|| {
            team.get("logos")
                .and_then(Value::as_array)?
                .iter()
                .filter_map(|logo| {
                    logo.get("href")
                        .and_then(Value::as_str)
                        .and_then(safe_crest)
                })
                .next()
        })
        .or_else(|| {
            if id.bytes().all(|b| b.is_ascii_digit())
                && id.parse::<u64>().ok().is_some_and(|id| id > 0)
            {
                Some(format!(
                    "https://a.espncdn.com/i/teamlogos/soccer/500/{id}.png"
                ))
            } else {
                None
            }
        })
}
fn team(side: &Value) -> Option<Team> {
    let t = side.get("team")?;
    let id = field(t, "id");
    let name = field(t, "displayName");
    if id.is_empty() || name.is_empty() {
        return None;
    }
    Some(Team {
        id: id.into(),
        name: name.into(),
        short: field(t, "abbreviation").into(),
        logo: crest(t, id),
    })
}
fn score(side: &Value) -> Option<u32> {
    side.get("score").and_then(|s| {
        s.as_str()
            .and_then(|s| s.parse().ok())
            .or_else(|| s.as_u64().and_then(|n| u32::try_from(n).ok()))
    })
}
fn parse_kickoff(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .or_else(|| {
            // ESPN commonly emits UTC timestamps without seconds, e.g. 2026-10-31T12:30Z.
            let base = value.strip_suffix('Z')?;
            if base.len() != 16 {
                return None;
            }
            DateTime::parse_from_rfc3339(&format!("{base}:00Z")).ok()
        })
        .map(|date| date.with_timezone(&Utc))
}
fn normalize(event: &Value, league: Competition) -> Option<Match> {
    let id = field(event, "id");
    let kickoff = parse_kickoff(field(event, "date"))?;
    if id.is_empty() {
        return None;
    }
    let competition = event.get("competitions")?.as_array()?.first()?;
    let competitors = competition.get("competitors")?.as_array()?;
    let home = competitors
        .iter()
        .find(|c| field(c, "homeAway") == "home")?;
    let away = competitors
        .iter()
        .find(|c| field(c, "homeAway") == "away")?;
    let status = event.get("status").or_else(|| competition.get("status"))?;
    let kind = status.get("type")?;
    let name = field(kind, "name").to_ascii_lowercase();
    let state = field(kind, "state");
    let mapped = if name.contains("postpon") {
        "postponed"
    } else if name.contains("cancel") {
        "cancelled"
    } else if name.contains("suspend") {
        "suspended"
    } else if name.contains("halftime") || name.contains("half_time") {
        "halftime"
    } else {
        match state {
            "pre" => "scheduled",
            "in" => "live",
            "post" => "fulltime",
            _ => "unknown",
        }
    };
    let detail = if mapped == "live" {
        let clock = field(status, "displayClock");
        if clock.is_empty() {
            field(kind, "shortDetail")
        } else {
            clock
        }
    } else {
        field(kind, "shortDetail")
    };
    Some(Match {
        score_stale: false,
        id: id.into(),
        home: team(home)?,
        away: team(away)?,
        home_score: score(home),
        away_score: score(away),
        kickoff: kickoff.to_rfc3339(),
        status: mapped.into(),
        detail: if detail.is_empty() {
            mapped.into()
        } else {
            detail.into()
        },
        competition: league.name().into(),
        league,
    })
}
fn parse_response(
    status: u16,
    retry_after: Option<u64>,
    body: &str,
    query: &str,
    league: Competition,
) -> Result<Vec<Match>, FetchError> {
    let label = format!("ESPN {} scoreboard", league.name());
    if !(200..300).contains(&status) {
        return Err(FetchError {
            message: format!("{label} dates={query}: HTTP {status}"),
            retry_after,
        });
    }
    let json: Value = serde_json::from_str(body).map_err(|e| FetchError {
        message: format!("{label} dates={query}: invalid JSON: {e}"),
        retry_after: None,
    })?;
    let events = json
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| FetchError {
            message: format!("{label} dates={query}: missing events array"),
            retry_after: None,
        })?;
    let matches: Vec<_> = events
        .iter()
        .filter_map(|event| normalize(event, league))
        .collect();
    if !events.is_empty() && matches.is_empty() {
        return Err(FetchError {
            message: format!(
                "{label} dates={query}: no valid fixtures in {} events",
                events.len()
            ),
            retry_after: None,
        });
    }
    Ok(matches)
}
static CLIENT: OnceLock<Result<reqwest::Client, FetchError>> = OnceLock::new();

/// One pooled, compressed client for the whole process: sharing it keeps TLS
/// connections alive across polls, details and results instead of rebuilding them.
pub fn client() -> Result<reqwest::Client, FetchError> {
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(StdDuration::from_secs(15))
                .build()
                .map_err(|e| FetchError {
                    message: format!("ESPN HTTP client: {e}"),
                    retry_after: None,
                })
        })
        .clone()
}
pub fn retry_after(value: &str, now: DateTime<Utc>) -> Option<u64> {
    value.trim().parse::<u64>().ok().or_else(|| {
        DateTime::parse_from_rfc2822(value)
            .ok()
            .map(|t| (t.with_timezone(&Utc) - now).num_seconds().max(0) as u64)
    })
}
async fn query(
    client: &reqwest::Client,
    league: Competition,
    dates: &str,
) -> Result<Vec<Match>, FetchError> {
    REQUESTS.fetch_add(1, Ordering::Relaxed);
    let response = client
        .get(format!(
            "https://site.api.espn.com/apis/site/v2/sports/soccer/{}/scoreboard",
            league.slug()
        ))
        .query(&[("dates", dates), ("limit", "200")])
        .send()
        .await
        .map_err(|e| FetchError {
            message: format!("ESPN {} scoreboard dates={dates}: {e}", league.name()),
            retry_after: None,
        })?;
    let status = response.status().as_u16();
    let retry_after = response
        .headers()
        .get("retry-after")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| retry_after(s, Utc::now()));
    let body = response.text().await.map_err(|e| FetchError {
        message: format!(
            "ESPN {} scoreboard dates={dates}: response read failed: {e}",
            league.name()
        ),
        retry_after: None,
    })?;
    parse_response(status, retry_after, &body, dates, league)
}
pub fn merge(base: Vec<Match>, updates: Vec<Match>) -> Vec<Match> {
    let mut by_id: std::collections::HashMap<String, Match> =
        base.into_iter().map(|m| (m.id.clone(), m)).collect();
    for m in updates {
        by_id.insert(m.id.clone(), m);
    }
    let mut result: Vec<_> = by_id.into_values().collect();
    result.sort_by(|a, b| a.kickoff.cmp(&b.kickoff).then(a.id.cmp(&b.id)));
    result
}
fn query_months(start: NaiveDate, end: NaiveDate) -> Vec<String> {
    let mut months = Vec::new();
    let Some(mut cursor) = NaiveDate::from_ymd_opt(start.year(), start.month(), 1) else {
        return months;
    };
    let last = NaiveDate::from_ymd_opt(end.year(), end.month(), 1);
    loop {
        months.push(cursor.format("%Y%m").to_string());
        if last.is_none_or(|last| cursor >= last) {
            break;
        }
        let Some(next) = cursor.checked_add_months(Months::new(1)) else {
            break;
        };
        cursor = next;
    }
    months
}
/// UCL is sparse, so it looks further ahead than the Premier League. One extra
/// day on both ends keeps local-time fixtures inside the window when the UTC
/// date has already turned over.
pub fn fixture_window(league: Competition, today: NaiveDate) -> (NaiveDate, NaiveDate) {
    (
        today - Duration::days(2),
        today + Duration::days(league.lookahead_days() + 1),
    )
}
pub async fn fixtures(
    client: &reqwest::Client,
    league: Competition,
    today: NaiveDate,
) -> FetchOutcome {
    let (start, end) = fixture_window(league, today);
    let mut outcome = queries(client, league, &query_months(start, end)).await;
    if let Some(matches) = &mut outcome.matches {
        matches.retain(|m| {
            parse_kickoff(&m.kickoff)
                .is_some_and(|d| d.date_naive() >= start && d.date_naive() <= end)
        });
    }
    outcome
}
pub fn recent_query_dates(today: NaiveDate) -> Vec<String> {
    query_months(today - Duration::days(14), today)
}
pub async fn recent_results(
    client: &reqwest::Client,
    league: Competition,
    today: NaiveDate,
) -> FetchOutcome {
    let dates = recent_query_dates(today);
    let mut outcome = queries(client, league, &dates).await;
    if let Some(matches) = &mut outcome.matches {
        matches.retain(|m| recent_result(m, today));
    }
    outcome
}
pub fn recent_result(m: &Match, today: NaiveDate) -> bool {
    m.status == "fulltime"
        && parse_kickoff(&m.kickoff).is_some_and(|d| {
            // Allow one day of slack so a late local kick-off is not hidden by
            // the UTC date rollover on the 14-day boundary.
            d.date_naive() >= today - Duration::days(15)
                && d.date_naive() <= today + Duration::days(1)
        })
}
pub async fn scores(
    client: &reqwest::Client,
    league: Competition,
    today: NaiveDate,
    cached: &[Match],
) -> FetchOutcome {
    let local = Local::now().date_naive();
    let mut dates = vec![today.format("%Y%m%d").to_string()];
    if local != today {
        dates.push(local.format("%Y%m%d").to_string());
    }
    if cached.iter().any(|m| {
        m.league == league
            && (m.status == "live" || m.status == "halftime")
            && parse_kickoff(&m.kickoff)
                .is_some_and(|d| d.date_naive() == today - Duration::days(1))
    }) {
        dates.push((today - Duration::days(1)).format("%Y%m%d").to_string());
    }
    dates.sort();
    dates.dedup();
    queries(client, league, &dates).await
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_bad_fixture() {
        assert!(normalize(&serde_json::json!({"id":"1"}), Competition::PremierLeague).is_none());
    }
    #[test]
    fn normalizes_home_away_by_role() {
        let v = serde_json::json!({"id":"1","date":"2026-08-22T14:00:00Z","status":{"type":{"state":"in","name":"STATUS_IN_PROGRESS"},"displayClock":"67'"},"competitions":[{"competitors":[{"homeAway":"away","score":"1","team":{"id":"2","displayName":"Away"}},{"homeAway":"home","score":"2","team":{"id":"1","displayName":"Home"}}]}]});
        let m = normalize(&v, Competition::PremierLeague).unwrap();
        assert_eq!(m.home.name, "Home");
        assert_eq!(m.status, "live");
        assert_eq!(m.home_score, Some(2));
    }
}
#[cfg(test)]
mod response_tests {
    use super::*;
    fn event() -> Value {
        serde_json::json!({"id":"1","date":"2026-10-31T12:30Z","status":{"type":{"state":"pre","name":"STATUS_SCHEDULED"}},"competitions":[{"competitors":[{"homeAway":"home","team":{"id":"1","displayName":"Home"}},{"homeAway":"away","team":{"id":"2","displayName":"Away"}}]}]})
    }
    #[test]
    fn successful_response_accepts_espn_minute_timestamp() {
        let body = serde_json::json!({"events":[event()]}).to_string();
        let matches =
            parse_response(200, None, &body, "20261031", Competition::PremierLeague).unwrap();
        assert_eq!(matches.len(), 1);
        assert_eq!(matches[0].kickoff, "2026-10-31T12:30:00+00:00");
    }
    #[test]
    fn bad_request_reports_status_and_query() {
        let err = parse_response(400, None, "{}", "20261031", Competition::PremierLeague)
            .err()
            .unwrap();
        assert!(err.message.contains("HTTP 400"));
        assert!(err.message.contains("20261031"));
    }
    #[test]
    fn rejects_unexpected_json() {
        assert!(parse_response(200, None, "{}", "202610", Competition::PremierLeague).is_err());
        assert!(
            parse_response(200, None, "no json", "202610", Competition::PremierLeague).is_err()
        );
        assert!(parse_response(
            200,
            None,
            "{\"events\":[{}]}",
            "202610",
            Competition::PremierLeague
        )
        .is_err());
    }
    #[test]
    fn empty_events_are_success() {
        assert!(parse_response(
            200,
            None,
            "{\"events\":[]}",
            "202610",
            Competition::PremierLeague
        )
        .unwrap()
        .is_empty());
    }
    #[test]
    fn deduplicates_and_prefers_latest() {
        let m = normalize(&event(), Competition::PremierLeague).unwrap();
        let mut update = m.clone();
        update.status = "live".into();
        let merged = merge(vec![m], vec![update]);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].status, "live");
    }

    #[test]
    fn independent_query_results_keep_valid_data_after_malformed_or_rate_limited_response() {
        let body = serde_json::json!({"events":[event()]}).to_string();
        for invalid in ["no JSON", "{}", "{\"events\":[{}]}"] {
            let mut outcome = FetchOutcome::default();
            outcome.record(parse_response(
                200,
                None,
                &body,
                "202610",
                Competition::PremierLeague,
            ));
            outcome.record(parse_response(
                200,
                None,
                invalid,
                "202611",
                Competition::PremierLeague,
            ));
            assert_eq!(outcome.matches.as_ref().unwrap().len(), 1);
            assert!(outcome.error.is_some());
        }
        let mut outcome = FetchOutcome::default();
        outcome.record(parse_response(
            200,
            None,
            "{\"events\":[]}",
            "202610",
            Competition::PremierLeague,
        ));
        outcome.record(parse_response(
            429,
            Some(300),
            "{}",
            "202611",
            Competition::PremierLeague,
        ));
        assert!(outcome.matches.as_ref().unwrap().is_empty());
        assert!(outcome.error.as_ref().unwrap().rate_limited());
        assert_eq!(outcome.error.unwrap().retry_after, Some(300));
    }
}

#[cfg(test)]
mod crest_tests {
    use super::*;
    use crate::demo::mock;
    #[test]
    fn accepts_direct_and_alternate_crests() {
        let standard = "https://a.espncdn.com/i/teamlogos/soccer/500/359.png";
        let dark = "https://a.espncdn.com/i/teamlogos/soccer/500-dark/359.png";
        assert_eq!(
            crest(&serde_json::json!({"logo":standard}), "359").as_deref(),
            Some(standard)
        );
        let alternate = serde_json::json!({"logo":"http://evil.test/image.png","logos":[{}, {"href":false}, {"href":dark}, {"href":standard}]});
        assert_eq!(crest(&alternate, "359").as_deref(), Some(dark));
    }
    #[test]
    fn rejects_unsafe_urls_and_non_image_paths() {
        for url in [
            "http://a.espncdn.com/i/teamlogos/soccer/500/359.png",
            "https://a.espncdn.com.evil.test/i/teamlogos/soccer/500/359.png",
            "https://user@a.espncdn.com/i/teamlogos/soccer/500/359.png",
            "https://user:pass@a.espncdn.com/i/teamlogos/soccer/500/359.png",
            "https://a.espncdn.com:8443/i/teamlogos/soccer/500/359.png",
            "https://a.espncdn.com/i/teamlogos/soccer/500/359.html",
            "https://a.espncdn.com/redirect/359.png",
            "https://a.espncdn.com/i/teamlogos/soccer/500/359.png?redirect=evil",
            "https://a.espncdn.com/i/teamlogos/soccer/500/359.png#fragment",
            "https://a.espncdn.com/i/teamlogos/soccer/500/%2f359.png",
            "data:image/png;base64,abc",
            "not a url",
        ] {
            assert!(safe_crest(url).is_none(), "accepted {url}");
        }
    }
    #[test]
    fn falls_back_only_for_numeric_stable_ids_and_handles_malformed_values() {
        let expected = "https://a.espncdn.com/i/teamlogos/soccer/500/368.png";
        for malformed in [
            serde_json::json!({}),
            serde_json::json!({"logo":{},"logos":"bad"}),
            serde_json::json!({"logos":[null,3,{"href":[]} ]}),
        ] {
            assert_eq!(crest(&malformed, "368").as_deref(), Some(expected));
        }
        for invalid in [
            "",
            "../368",
            "368?x=1",
            "-1",
            "0",
            "club-368",
            "999999999999999999999999999999999999",
        ] {
            assert!(crest(&Value::Null, invalid).is_none());
        }
        assert!(team(&serde_json::json!({"team":{"id":368,"displayName":"Everton"}})).is_none());
        assert!(team(&serde_json::json!({"team":{"id":"368"}})).is_none());
    }
    #[test]
    fn demo_uses_real_catalog_ids() {
        let matches = mock();
        let teams: std::collections::HashMap<_, _> = matches
            .iter()
            .flat_map(|m| [&m.home, &m.away])
            .map(|t| (t.name.as_str(), t.id.as_str()))
            .collect();
        for (name, id) in [
            ("Newcastle United", "361"),
            ("Aston Villa", "362"),
            ("Brighton", "331"),
            ("Everton", "368"),
            ("Wolves", "380"),
        ] {
            assert_eq!(teams.get(name).copied(), Some(id));
        }
    }
}

#[cfg(test)]
mod retry_header_tests {
    use super::*;
    #[test]
    fn numeric_and_http_date() {
        let now = DateTime::parse_from_rfc3339("2026-10-29T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(retry_after("120", now), Some(120));
        assert_eq!(retry_after("Thu, 29 Oct 2026 12:02:00 GMT", now), Some(120));
        assert_eq!(retry_after("Thu, 29 Oct 2026 11:00:00 GMT", now), Some(0));
        assert_eq!(retry_after("bad", now), None);
    }
}

#[cfg(test)]
mod history_query_tests {
    use super::*;
    #[test]
    fn bounded_supported_months() {
        assert_eq!(
            recent_query_dates(NaiveDate::from_ymd_opt(2026, 10, 29).unwrap()),
            vec!["202610"]
        );
        assert_eq!(
            recent_query_dates(NaiveDate::from_ymd_opt(2026, 1, 5).unwrap()),
            vec!["202512", "202601"]
        );
    }
}

#[cfg(test)]
mod captured_history_tests {
    use super::*;
    #[test]
    fn monthly_results_exist_despite_empty_today_and_yesterday() {
        let matches = parse_response(
            200,
            None,
            include_str!("../../tests/fixtures/recent-scoreboard.json"),
            "202610",
            Competition::PremierLeague,
        )
        .unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 10, 29).unwrap();
        assert_eq!(
            matches.iter().filter(|m| recent_result(m, today)).count(),
            3
        );
        assert!(matches
            .iter()
            .all(|m| parse_kickoff(&m.kickoff).unwrap().date_naive() < today - Duration::days(1)));
    }
}

#[cfg(test)]
mod competition_tests {
    use super::*;

    fn event() -> Value {
        serde_json::json!({"id":"401915418","date":"2026-10-13T16:45Z","status":{"type":{"state":"post","name":"STATUS_FULL_TIME"}},"competitions":[{"competitors":[{"homeAway":"home","score":"2","team":{"id":"169","displayName":"Lens","abbreviation":"RCL"}},{"homeAway":"away","score":"1","team":{"id":"225","displayName":"Sporting CP","abbreviation":"SCP"}}]}]})
    }

    #[test]
    fn champions_league_normalization_is_attributed_and_era_agnostic() {
        let m = normalize(&event(), Competition::ChampionsLeague).unwrap();
        assert_eq!(m.league, Competition::ChampionsLeague);
        assert_eq!(m.competition, "Champions League");
        assert_eq!(m.status, "fulltime");
        assert_eq!(m.home.name, "Lens");
        assert_eq!(m.home_score, Some(2));
        let body = serde_json::json!({"events":[event()]}).to_string();
        let parsed =
            parse_response(200, None, &body, "202610", Competition::ChampionsLeague).unwrap();
        assert_eq!(parsed[0].league, Competition::ChampionsLeague);
        let pl = normalize(&event(), Competition::PremierLeague).unwrap();
        assert_eq!(pl.league, Competition::PremierLeague);
        assert_eq!(pl.competition, "Premier League");
    }

    #[test]
    fn upcoming_windows_and_month_queries_cover_the_whole_lookahead() {
        let today = NaiveDate::from_ymd_opt(2026, 1, 31).unwrap();
        assert_eq!(
            fixture_window(Competition::PremierLeague, today),
            (today - Duration::days(2), today + Duration::days(15))
        );
        assert_eq!(
            fixture_window(Competition::ChampionsLeague, today),
            (today - Duration::days(2), today + Duration::days(31))
        );
        // UCL's 30-day window can touch three calendar months.
        assert_eq!(
            query_months(today - Duration::days(1), today + Duration::days(30)),
            ["202601", "202602", "202603"]
        );
        assert_eq!(
            query_months(
                NaiveDate::from_ymd_opt(2026, 10, 28).unwrap(),
                NaiveDate::from_ymd_opt(2026, 11, 20).unwrap()
            ),
            ["202610", "202611"]
        );
    }

    #[test]
    fn ucl_empty_and_malformed_responses_never_invent_fixtures() {
        assert!(parse_response(
            200,
            None,
            "{\"events\":[]}",
            "202611",
            Competition::ChampionsLeague
        )
        .unwrap()
        .is_empty());
        assert!(parse_response(
            200,
            None,
            "{\"events\":[{}]}",
            "202611",
            Competition::ChampionsLeague
        )
        .is_err());
        let limited = parse_response(429, Some(120), "{}", "202611", Competition::ChampionsLeague)
            .err()
            .unwrap();
        assert!(limited.rate_limited());
        assert_eq!(limited.retry_after, Some(120));
    }
}
