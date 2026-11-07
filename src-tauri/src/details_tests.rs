use super::*;
#[test]
fn captured_summary_has_events_stats_and_rosters() {
    let v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    let d = normalize(&v, "401879268", Competition::PremierLeague).unwrap();
    assert!(!d.events.is_empty());
    assert!(!d.statistics.is_empty());
    assert!(!d.players.is_empty());
    assert!(d
        .events
        .iter()
        .any(|e| e.kind == "goal" && e.text.contains("James Justin")));
    assert!(d.events.iter().any(|e| e.kind == "yellow-card"));
    assert!(d.events.iter().any(|e| e.kind == "substitution"));
    assert_eq!(
        d.players
            .iter()
            .filter(|p| p.team_id == "359" && p.starter)
            .count(),
        11
    );
    assert!(d.players.iter().any(|p| p.team_id == "359" && !p.starter));
}
#[test]
fn upcoming_does_not_show_season_totals() {
    let v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-upcoming.json")).unwrap();
    let d = normalize(&v, "401879250", Competition::PremierLeague).unwrap();
    assert!(d.statistics.is_empty());
    assert!(d.events.is_empty());
    assert!(normalize(&serde_json::json!({}), "1", Competition::PremierLeague).is_err());
}
#[test]
fn venue_is_optional_bounded_and_survives_legacy_cache() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-upcoming.json")).unwrap();
    v["gameInfo"] = serde_json::json!({"venue":{"fullName":"Villa Park"}});
    let details = normalize(&v, "401879250", Competition::PremierLeague).unwrap();
    assert_eq!(details.venue.as_deref(), Some("Villa Park"));
    v["gameInfo"]["venue"]["fullName"] = serde_json::json!("bad\nvalue");
    assert!(normalize(&v, "401879250", Competition::PremierLeague)
        .unwrap()
        .venue
        .is_none());
    let mut saved = serde_json::to_value(details).unwrap();
    saved.as_object_mut().unwrap().remove("venue");
    assert!(serde_json::from_value::<Details>(saved)
        .unwrap()
        .venue
        .is_none());
}
#[test]
fn ordering_duplicates_and_missing_values() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    let event = v["keyEvents"][0].clone();
    v["keyEvents"].as_array_mut().unwrap().reverse();
    v["keyEvents"].as_array_mut().unwrap().push(event);
    let d = normalize(&v, "401879268", Competition::PremierLeague).unwrap();
    assert!(d
        .events
        .windows(2)
        .all(|w| w[0].period < w[1].period
            || w[0].period == w[1].period && w[0].seconds <= w[1].seconds));
    let ids: std::collections::HashSet<_> = d.events.iter().map(|e| &e.id).collect();
    assert_eq!(ids.len(), d.events.len());
    assert!(d.statistics.iter().any(|s| s.value == "0"));
    v["boxscore"] = Value::Null;
    v["rosters"] = Value::Null;
    let d = normalize(&v, "401879268", Competition::PremierLeague).unwrap();
    assert!(d.statistics.is_empty());
    assert!(d.players.is_empty());
}
#[test]
fn old_state_and_detail_cache_roundtrip() {
    let legacy: crate::model::Snapshot = serde_json::from_str("{}").unwrap();
    assert!(legacy.detail_cache.is_empty());
    let mut state = legacy;
    let v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    state
        .detail_cache
        .push(normalize(&v, "401879268", Competition::PremierLeague).unwrap());
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
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    normalize(&v, "401879268", Competition::PremierLeague).unwrap()
}
#[tokio::test]
async fn cache_hit_failure_cooldown_and_recovery() {
    let now = clock();
    let mut cache = Cache::default();
    let id = "401879268";
    cache
        .get_with(Competition::PremierLeague, id, true, now, || async {
            Ok(example())
        })
        .await
        .unwrap();
    let hit = cache
        .get_with(
            Competition::PremierLeague,
            id,
            true,
            now + chrono::Duration::seconds(59),
            || async { panic!("fresh cache must not fetch") },
        )
        .await
        .unwrap();
    assert!(!hit.stale);
    let saved = cache
        .get_with(
            Competition::PremierLeague,
            id,
            true,
            now + chrono::Duration::seconds(60),
            || async { Err(Failure::temporary("timeout")) },
        )
        .await
        .unwrap();
    assert!(saved.stale);
    assert_eq!(saved.updated_at, now.to_rfc3339());
    let deadline = cache.blocked_until;
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            true,
            now + chrono::Duration::seconds(90),
            || async { panic!("cooldown must not fetch") },
        )
        .await
        .unwrap();
    assert_eq!(cache.blocked_until, deadline);
    let recovered = cache
        .get_with(
            Competition::PremierLeague,
            id,
            true,
            now + chrono::Duration::seconds(120),
            || async { Ok(example()) },
        )
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
        .get_with(
            Competition::PremierLeague,
            "401879268",
            false,
            now,
            || async { Err(Failure::temporary("offline")) },
        )
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
            .get_with(
                Competition::PremierLeague,
                "401879268",
                true,
                now,
                || async { Err(Failure::temporary("clock changed")) }
            )
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
        .get_with(Competition::PremierLeague, "1", true, now, || async {
            Err(Failure {
                message: "HTTP 429".into(),
                retry_after: Some(7200),
            })
        })
        .await
        .is_err());
    assert_eq!(cache.blocked_until, now.timestamp() + 7200);
    assert!(cache
        .get_with(
            Competition::PremierLeague,
            "1",
            true,
            now + chrono::Duration::seconds(7199),
            || async { panic!("must respect Retry-After") }
        )
        .await
        .is_err());
    assert_eq!(cache.blocked_until, now.timestamp() + 7200);
}
#[test]
fn malformed_http_and_stoppage_time() {
    for status in [400, 429, 500] {
        assert!(parse_response("1", Competition::PremierLeague, status, Some(120), b"{}").is_err());
    }
    assert!(parse_response("1", Competition::PremierLeague, 200, None, b"not JSON").is_err());
    assert!(parse_response("1", Competition::PremierLeague, 200, None, b"{}").is_err());
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    v["keyEvents"][0]["clock"]["displayValue"] = Value::String("45+2'".into());
    let d = normalize(&v, "401879268", Competition::PremierLeague).unwrap();
    assert!(d.events.iter().any(|e| e.minute == "45+2'"));
    v["header"]["competitions"] = serde_json::json!([]);
    assert!(normalize(&v, "401879268", Competition::PremierLeague).is_err());
}
#[tokio::test]
async fn serialized_simultaneous_requests_reuse_one_result() {
    let cache = tokio::sync::Mutex::new(Cache::default());
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let request = || async {
        let mut c = cache.lock().await;
        c.get_with(
            Competition::PremierLeague,
            "401879268",
            true,
            clock(),
            || async {
                calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tokio::task::yield_now().await;
                Ok(example())
            },
        )
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
                Competition::PremierLeague,
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
    assert!(!cache
        .entries
        .contains_key(&cache_key(Competition::PremierLeague, "1")));
    let mut invalid = example();
    invalid.players[0].name = "x".repeat(501);
    let value = serde_json::json!({"detailCache":[serde_json::to_value(invalid).unwrap(),serde_json::to_value(example()).unwrap(),{"broken":true}]});
    let restored: crate::model::Snapshot = serde_json::from_value(value).unwrap();
    assert_eq!(restored.detail_cache.len(), 1);
}

#[test]
fn commentary_enriches_live_timelines_and_scorers_carry_lineup_context() {
    let v = serde_json::json!({
        "header": {
            "id": "1",
            "competitions": [{
                "status": {"type": {"state": "in"}},
                "competitors": [
                    {"team": {"id": "359", "displayName": "Arsenal"}},
                    {"team": {"id": "357", "displayName": "Leeds United"}}
                ]
            }]
        },
        "keyEvents": [{
            "id": "k1",
            "type": {"type": "goal"},
            "text": "Goal! Arsenal 1, Leeds United 0. Bukayo Saka (Arsenal) left footed shot.",
            "period": {"number": 1},
            "clock": {"value": 600.0, "displayValue": "10'"},
            "scoringPlay": true,
            "team": {"id": "359"}
        }, {
            "id": "k2",
            "type": {"type": "substitution"},
            "text": "Substitution, Arsenal. Leandro Trossard replaces Bukayo Saka.",
            "period": {"number": 2},
            "clock": {"value": 3600.0, "displayValue": "60'"},
            "team": {"id": "359"},
            "participants": [
                {"athlete": {"displayName": "Leandro Trossard"}},
                {"athlete": {"displayName": "Bukayo Saka"}}
            ]
        }],
        "commentary": [
            {
                "sequence": 2,
                "time": {"value": 720.0, "displayValue": "12'"},
                "play": {
                    "id": "p2",
                    "type": {"type": "offside"},
                    "text": "Offside, Leeds United. Georginio Rutter is caught offside.",
                    "period": {"number": 1},
                    "clock": {"value": 720.0, "displayValue": "12'"},
                    "team": {"displayName": "Leeds United"}
                }
            },
            {
                "sequence": 3,
                "time": {"value": 1200.0, "displayValue": "20'"},
                "play": {
                    "id": "p3",
                    "type": {"type": "goal"},
                    "text": "Goal! Arsenal 1, Leeds United 1. Georginio Rutter (Leeds United) right footed shot.",
                    "participants": [{"athlete": {"displayName": "Georginio Rutter"}}],
                    "period": {"number": 1},
                    "clock": {"value": 1200.0, "displayValue": "20'"},
                    "team": {"displayName": "Leeds United"}
                }
            }
        ],
        "rosters": [{
            "team": {"id": "359"},
            "formation": "4-2-3-1",
            "roster": [
                {"jersey": "7", "starter": true, "formationPlace": "5", "position": {"abbreviation": "RW"}, "athlete": {"displayName": "Bukayo Saka"}},
                {"jersey": 19, "starter": false, "subbedIn": true, "position": {"abbreviation": "SUB"}, "athlete": {"displayName": "Leandro Trossard"}}
            ]
        }],
        "gameInfo": {"attendance": 36924},
        "lastFiveGames": [{
            "team": {"id": "359"},
            "events": [{
                "opponent": {"id": "363", "displayName": "Chelsea"},
                "gameResult": "W",
                "score": "2-1",
                "atVs": "vs"
            }]
        }],
        "leaders": [{
            "team": {"id": "359"},
            "leaders": [{
                "displayName": "Total Shots",
                "leaders": [{
                    "displayValue": "3",
                    "athlete": {"displayName": "Bukayo Saka", "jersey": "7", "position": {"abbreviation": "RW"}}
                }]
            }]
        }],
        "boxscore": {"teams": []}
    });
    let d = normalize(&v, "1", Competition::PremierLeague).unwrap();
    assert_eq!(
        d.events.len(),
        4,
        "two key events plus two unique commentary entries"
    );
    assert!(d.events.iter().any(|e| e.kind == "offside"));
    assert_eq!(d.scorers.len(), 2);
    assert_eq!(d.substitutions.len(), 1);
    assert_eq!(d.substitutions[0].player_in, "Leandro Trossard");
    assert_eq!(d.substitutions[0].player_out, "Bukayo Saka");
    assert_eq!(d.substitutions[0].minute, "60'");
    assert_eq!(d.scorers[0].name, "Bukayo Saka");
    assert_eq!(d.scorers[1].minute, "20'");
    assert_eq!(d.scorers[1].team_id, "357");
    assert_eq!(d.formations.get("359").map(String::as_str), Some("4-2-3-1"));
    let starter = d.players.iter().find(|p| p.name == "Bukayo Saka").unwrap();
    assert_eq!(starter.jersey.as_deref(), Some("7"));
    assert_eq!(starter.formation_place, Some(5));
    assert_eq!(d.attendance, Some(36924));
    let form = d.form.get("359").unwrap();
    assert_eq!(form.len(), 1);
    assert_eq!(form[0].result, "W");
    assert_eq!(form[0].opponent, "Chelsea");
    assert!(form[0].at_home);
    assert_eq!(d.leaders.len(), 1);
    assert_eq!(d.leaders[0].category, "Shots");
    assert_eq!(d.leaders[0].name, "Bukayo Saka");
    assert_eq!(d.leaders[0].value, "3");
    let sub = d
        .players
        .iter()
        .find(|p| p.name == "Leandro Trossard")
        .unwrap();
    assert!(sub.subbed_in && !sub.starter);
    let restored: Details = serde_json::from_value(serde_json::to_value(&d).unwrap()).unwrap();
    assert_eq!(restored.scorers.len(), 2);
    assert_eq!(
        restored.formations.get("359").map(String::as_str),
        Some("4-2-3-1")
    );
}

#[test]
fn champions_league_details_use_the_ucl_endpoint_and_a_separate_cache_key() {
    let v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    let pl = normalize(&v, "401879268", Competition::PremierLeague).unwrap();
    let ucl = normalize(&v, "401879268", Competition::ChampionsLeague).unwrap();
    assert_eq!(pl.league, Competition::PremierLeague);
    assert_eq!(ucl.league, Competition::ChampionsLeague);
    assert!(summary_url(Competition::ChampionsLeague).contains("/uefa.champions/summary"));
    assert!(summary_url(Competition::PremierLeague).contains("/eng.1/summary"));
    assert_ne!(
        cache_key(pl.league, &pl.match_id),
        cache_key(ucl.league, &ucl.match_id)
    );

    // Same ESPN event id in two leagues must not share a cache entry.
    let mut cache = Cache::default();
    cache.entries.insert(cache_key(pl.league, &pl.match_id), pl);
    cache
        .entries
        .insert(cache_key(ucl.league, &ucl.match_id), ucl);
    assert_eq!(cache.entries.len(), 2);

    // Older saved detail entries have no league and default to the Premier League.
    let mut legacy = serde_json::to_value(example()).unwrap();
    legacy.as_object_mut().unwrap().remove("league");
    let restored: Details = serde_json::from_value(legacy).unwrap();
    assert_eq!(restored.league, Competition::PremierLeague);
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
