use super::*;
#[test]
fn a_dense_summary_is_capped_at_the_event_limit_not_rejected() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-shootout.json")).unwrap();
    let events: Vec<Value> = (0..1000)
        .map(|i| {
            serde_json::json!({
                "id": format!("e{i}"),
                "type": {"type": "yellow-card"},
                "clock": {"value": i as f64, "displayValue": format!("{i}'")},
                "period": {"number": 1},
                "team": {"id": "359"},
                "text": "Card"
            })
        })
        .collect();
    v["keyEvents"] = Value::Array(events);
    v["commentary"] = serde_json::json!([
        {"sequence": 1, "time": {"value": 3000.0, "displayValue": "50'"}, "text": "Late commentary."}
    ]);
    let d = normalize(&v, "401862897", Competition::ChampionsLeague).unwrap();
    assert!(d.events.len() <= 1000);
    assert!(valid_cached(&d));
}
#[test]
fn incidents_keep_card_reasons_names_and_substitution_context() {
    assert_eq!(
        event_participants(
            &serde_json::json!({}),
            "Goal! Home 1, Away 0. Riccardo Player (Home) scores."
        ),
        vec!["Riccardo Player"]
    );
    assert_eq!(
        incident_reason(
            "yellow-card",
            "Player (Club) is shown the yellow card for a bad foul."
        )
        .as_deref(),
        Some("Bad foul")
    );
    assert_eq!(
        incident_reason(
            "red-card",
            "Player (Club) is shown the red card for violent conduct."
        )
        .as_deref(),
        Some("Violent conduct")
    );
    assert_eq!(
        incident_reason(
            "second-yellow-card",
            "Second yellow card to Player (Club) for dissent."
        )
        .as_deref(),
        Some("Dissent")
    );
    assert_eq!(
        incident_reason(
            "substitution",
            "Substitution, Club. Incoming replaces Outgoing because of an injury."
        )
        .as_deref(),
        Some("Injury")
    );
    assert!(incident_reason("yellow-card", "Player (Club) is shown the yellow card.").is_none());
    assert_eq!(
        event_participants(
            &serde_json::json!({}),
            "Second yellow card to Player Name (Club) for dissent."
        ),
        vec!["Player Name"]
    );
    let mut legacy = serde_json::to_value(example()).unwrap();
    for event in legacy["events"].as_array_mut().unwrap() {
        event.as_object_mut().unwrap().remove("reason");
    }
    assert!(valid_cached(
        &serde_json::from_value::<Details>(legacy).unwrap()
    ));
}
#[test]
fn shootout_penalties_are_timeline_events_not_goalscorers() {
    // Captured from uefa.champions summary?event=401862897 (2026 final,
    // Paris Saint-Germain 1-1 Arsenal, PSG won 4-3 on penalties).
    let v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-shootout.json")).unwrap();
    let d = normalize(&v, "401862897", Competition::ChampionsLeague).unwrap();
    let names: Vec<_> = d
        .scorers
        .iter()
        .map(|scorer| scorer.name.as_str())
        .collect();
    assert_eq!(names, ["Kai Havertz", "Ousmane Dembélé"]);
    for shootout in ["Gonçalo Ramos", "Viktor Gyökeres"] {
        assert!(
            !d.scorers.iter().any(|scorer| scorer.name == shootout),
            "{shootout} must not be listed as a match goalscorer"
        );
    }
    assert!(d.events.iter().any(|event| event.period == 5
        && event.kind == "penalty---scored"
        && event.participants == vec!["Gonçalo Ramos"]));
    assert!(d
        .events
        .iter()
        .any(|event| event.period == 5 && event.kind == "penalty---missed"));
}

#[test]
fn scoreless_shootout_keeps_penalties_out_of_scorers() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-shootout.json")).unwrap();
    v["keyEvents"] = serde_json::json!([]);
    v["header"]["competitions"][0]["competitors"][0]["score"] = serde_json::json!("0");
    v["header"]["competitions"][0]["competitors"][1]["score"] = serde_json::json!("0");
    let d = normalize(&v, "401862897", Competition::ChampionsLeague).unwrap();
    assert!(d.scorers.is_empty());
    assert!(d
        .events
        .iter()
        .any(|event| event.period == 5 && event.kind == "penalty---scored"));
}

#[test]
fn disallowed_commentary_goal_is_an_event_but_not_a_scorer() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-shootout.json")).unwrap();
    v["commentary"].as_array_mut().unwrap().push(serde_json::json!({
        "sequence": 70,
        "time": {"value": 4000.0, "displayValue": "70'"},
        "play": {
            "id": "var-goal",
            "type": {"type": "goal"},
            "text": "Goal! Paris Saint Germain 2, Arsenal 1. Disallowed Player (Paris Saint Germain) scores. The goal is disallowed after a VAR review.",
            "period": {"number": 2},
            "clock": {"value": 4000.0, "displayValue": "70'"},
            "team": {"displayName": "Paris Saint-Germain"},
            "participants": [{"athlete": {"displayName": "Disallowed Player"}}]
        }
    }));
    let d = normalize(&v, "401862897", Competition::ChampionsLeague).unwrap();
    assert!(!d
        .scorers
        .iter()
        .any(|scorer| scorer.name == "Disallowed Player"));
    assert!(d
        .events
        .iter()
        .any(|event| event.id == "c-var-goal" && event.kind == "goal"));
}

#[test]
fn legitimate_goal_with_an_overturned_flag_is_still_a_scorer() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-shootout.json")).unwrap();
    v["commentary"].as_array_mut().unwrap().push(serde_json::json!({
        "sequence": 71,
        "time": {"value": 4100.0, "displayValue": "71'"},
        "play": {
            "id": "legit-overturn",
            "type": {"type": "goal"},
            "text": "Goal! Paris Saint Germain 2, Arsenal 1. Legit Player (Paris Saint Germain) scores after the offside flag is overturned.",
            "period": {"number": 2},
            "clock": {"value": 4100.0, "displayValue": "71'"},
            "team": {"displayName": "Paris Saint-Germain"},
            "participants": [{"athlete": {"displayName": "Legit Player"}}]
        }
    }));
    let d = normalize(&v, "401862897", Competition::ChampionsLeague).unwrap();
    assert!(
        d.scorers.iter().any(|scorer| scorer.name == "Legit Player"),
        "a goal awarded after an overturned offside flag must keep its scorer"
    );
}

#[test]
fn captured_full_match_has_richer_statistics_without_season_placeholders() {
    let v: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/summary-brighton-full.json"
    ))
    .unwrap();
    let mut details = normalize(&v["summary"], "401879244", Competition::PremierLeague).unwrap();
    assert!(statistics::merge(
        &mut details,
        "331",
        &v["teamStatistics"][0]
    ));
    assert!(statistics::merge(
        &mut details,
        "337",
        &v["teamStatistics"][1]
    ));
    assert!(details.statistics.len() > 100);
    let value = |team: &str, name: &str| {
        details
            .statistics
            .iter()
            .find(|s| s.team_id == team && s.name == name)
            .unwrap()
            .value
            .as_str()
    };
    assert_eq!(value("331", "expectedGoals"), "2.20");
    assert_eq!(value("337", "expectedGoals"), "0.73");
    assert_eq!(value("331", "passPct"), "90.6%");
    assert_eq!(value("337", "passPct"), "66%");
    assert!(!details
        .statistics
        .iter()
        .any(|s| s.name == "appearances" || s.name == "wins"));
    assert!(details.events.iter().any(|e| e.kind == "pre-match"));
    assert!(details.events.iter().any(|e| e.kind == "full-time"));
    assert!(details.events.iter().any(|e| e.kind == "start-delay"));
    assert!(details.events.iter().all(|e| !e.kind.is_empty()));
    assert_eq!(details.attendance, Some(31629));
    assert_eq!(details.venue_city.as_deref(), Some("Falmer"));
    assert!(details.referee.is_none());
    assert!(details.capacity.is_none());
    assert!(valid_cached(&details));
}
#[test]
fn supplemental_totals_require_matching_identity_and_preserve_summary_counts() {
    let v: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/summary-brighton-full.json"
    ))
    .unwrap();
    let mut details = normalize(&v["summary"], "401879244", Competition::PremierLeague).unwrap();
    let mut totals = v["teamStatistics"][0].clone();
    assert!(!statistics::merge(&mut details, "337", &totals));
    totals["competition"]["$ref"] = serde_json::json!(
        "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/2/competitions/2"
    );
    assert!(!statistics::merge(&mut details, "331", &totals));
    totals = v["teamStatistics"][0].clone();
    totals["splits"]["type"] = serde_json::json!("firstHalf");
    assert!(!statistics::merge(&mut details, "331", &totals));
    totals = v["teamStatistics"][0].clone();
    for category in totals["splits"]["categories"].as_array_mut().unwrap() {
        for stat in category["stats"].as_array_mut().unwrap() {
            if stat["name"] == "totalShots" {
                stat["value"] = serde_json::json!(19);
                stat["displayValue"] = serde_json::json!("19");
            }
        }
    }
    assert!(statistics::merge(&mut details, "331", &totals));
    assert_eq!(
        details
            .statistics
            .iter()
            .find(|s| s.name == "totalShots" && s.team_id == "331")
            .unwrap()
            .value,
        "20"
    );
}
#[test]
fn referee_and_capacity_are_optional_validated_and_legacy_compatible() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-upcoming.json")).unwrap();
    v["gameInfo"] = serde_json::json!({"venue":{"fullName":"Test Stadium","capacity":31876,"address":{"city":"Test City"}},"officials":[{"fullName":"Assistant Name","position":{"name":"Assistant Referee"}},{"fullName":"Referee Name","position":{"name":"Referee"}}]});
    let details = normalize(&v, "401879250", Competition::PremierLeague).unwrap();
    assert_eq!(details.referee.as_deref(), Some("Referee Name"));
    assert_eq!(details.capacity, Some(31876));
    let mut legacy = serde_json::to_value(&details).unwrap();
    for key in ["referee", "capacity", "venueCity", "statisticsNote"] {
        legacy.as_object_mut().unwrap().remove(key);
    }
    assert!(valid_cached(
        &serde_json::from_value::<Details>(legacy).unwrap()
    ));
    v["gameInfo"]["venue"]["capacity"] = serde_json::json!(2000000);
    v["gameInfo"]["officials"][1]["fullName"] = serde_json::json!("bad\nname");
    let invalid = normalize(&v, "401879250", Competition::PremierLeague).unwrap();
    assert!(invalid.capacity.is_none());
    assert!(invalid.referee.is_none());
}
#[test]
fn commentary_merges_provider_ids_preserves_long_text_and_does_not_make_goal_kick_scorers() {
    let mut v: Value =
        serde_json::from_str(include_str!("../../tests/fixtures/summary-completed.json")).unwrap();
    let long = format!("Goal! {}", "Full provider description. ".repeat(35));
    v["keyEvents"] = serde_json::json!([{"id":"goal","type":{"type":"goal"},"clock":{"value":60,"displayValue":"1'"},"period":{"number":1},"team":{"id":"359"},"text":"Short goal text"}]);
    v["commentary"] = serde_json::json!([
        {"sequence":1,"time":{"value":60,"displayValue":"1'"},"play":{"id":"goal","type":{"type":"goal"},"clock":{"value":60,"displayValue":"1'"},"period":{"number":1},"team":{"id":"359"},"text":long,"participants":[{"athlete":{"displayName":"Scorer"}}]}},
        {"sequence":2,"time":{"value":120,"displayValue":"2'"},"play":{"id":"kick","type":{"type":"goal-kick"},"clock":{"value":120,"displayValue":"2'"},"period":{"number":1},"team":{"id":"359"},"text":"Goal kick","participants":[{"athlete":{"displayName":"Keeper"}}]}}
    ]);
    v["commentary"].as_array_mut().unwrap().push(serde_json::json!({"sequence":3,"time":{"value":180,"displayValue":"3'"},"text":"Foul involving Player (Arsenal) and Opponent (Leeds United)."}));
    let details = normalize(&v, "401879268", Competition::PremierLeague).unwrap();
    assert_eq!(details.events.len(), 3);
    assert_eq!(details.events[0].text, long);
    assert_eq!(details.events[0].participants, vec!["Scorer"]);
    assert!(!details.scorers.iter().any(|s| s.name == "Keeper"));
    assert!(
        details.events.last().unwrap().team_id.is_none(),
        "ambiguous commentary must remain neutral"
    );
}
#[test]
fn live_summary_keeps_compact_participants_and_accepts_old_photo_caches() {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../tests/fixtures/summary-live-compact.json"
    ))
    .unwrap();
    let d = normalize(&v, "401879244", Competition::PremierLeague).unwrap();
    assert!(d
        .events
        .iter()
        .any(|e| e.kind == "substitution" && e.participants.len() == 2));
    assert!(d
        .events
        .iter()
        .any(|e| e.kind == "yellow-card" && !e.participants.is_empty()));
    assert!(d.coaches.is_empty());
    assert!(serde_json::to_value(&d).unwrap()["players"]
        .as_array()
        .unwrap()
        .iter()
        .all(|player| player.get("headshot").is_none()));
    v["rosters"][0]["coaches"] = serde_json::json!([{"displayName":"Test coach"}]);
    let d = normalize(&v, "401879244", Competition::PremierLeague).unwrap();
    assert_eq!(d.coaches[0].name, "Test coach");
    let mut saved = serde_json::to_value(d).unwrap();
    saved.as_object_mut().unwrap().remove("coaches");
    for event in saved["events"].as_array_mut().unwrap() {
        event.as_object_mut().unwrap().remove("participants");
        event.as_object_mut().unwrap().remove("shortText");
    }
    for player in saved["players"].as_array_mut().unwrap() {
        player["headshot"] = serde_json::json!("https://a.espncdn.com/old-photo.png");
    }
    let legacy: Details = serde_json::from_value(saved).unwrap();
    assert!(legacy.coaches.is_empty());
    assert!(legacy
        .events
        .iter()
        .all(|event| event.participants.is_empty()));
    assert!(serde_json::to_value(legacy).unwrap()["players"]
        .as_array()
        .unwrap()
        .iter()
        .all(|player| player.get("headshot").is_none()));
}
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
async fn optional_statistics_failure_keeps_saved_extras_and_current_summary_counts() {
    let now = clock();
    let cache = Cache::default();
    let id = "401879268";
    let mut saved = example();
    saved.statistics.push(Statistic {
        team_id: "359".into(),
        name: "expectedGoals".into(),
        label: "Expected goals".into(),
        value: "1.23".into(),
    });
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now,
            || async { Ok(saved) },
        )
        .await
        .unwrap();
    let mut current = example();
    current.statistics_note = Some("Additional statistics unavailable".into());
    current
        .statistics
        .iter_mut()
        .find(|s| s.name == "totalShots" && s.team_id == "359")
        .unwrap()
        .value = "99".into();
    let result = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(121),
            || async { Ok(current) },
        )
        .await
        .unwrap();
    assert_eq!(
        result
            .statistics
            .iter()
            .find(|s| s.name == "totalShots" && s.team_id == "359")
            .unwrap()
            .value,
        "99"
    );
    assert!(result
        .statistics
        .iter()
        .any(|s| s.name == "expectedGoals" && s.value == "1.23"));
    assert!(result.statistics_note.unwrap().contains("saved values"));
    assert!(!result.stale);
}
#[tokio::test]
async fn cache_hit_failure_cooldown_and_recovery() {
    let now = clock();
    let cache = Cache::default();
    let id = "401879268";
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now,
            || async { Ok(example()) },
        )
        .await
        .unwrap();
    let hit = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(59),
            || async { panic!("fresh cache must not fetch") },
        )
        .await
        .unwrap();
    assert!(!hit.stale);
    let refreshed = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(60),
            || async { Ok(example()) },
        )
        .await
        .unwrap();
    assert_eq!(
        refreshed.updated_at,
        (now + chrono::Duration::seconds(60)).to_rfc3339()
    );
    let saved = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(121),
            || async { Err(Failure::temporary("timeout")) },
        )
        .await
        .unwrap();
    assert!(saved.stale);
    assert_eq!(saved.updated_at, refreshed.updated_at);
    // While the per-match cooldown runs, the cached summary is returned untouched.
    let blocked = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(150),
            || async { panic!("cooldown must not fetch") },
        )
        .await
        .unwrap();
    assert!(blocked.stale);
    let recovered = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(220),
            || async { Ok(example()) },
        )
        .await
        .unwrap();
    assert!(!recovered.stale);
    assert!(recovered.error.is_none());
}
#[tokio::test]
async fn oversized_summary_is_rejected_instead_of_cached() {
    let now = clock();
    let cache = Cache::default();
    let id = "401879268";
    let valid = example();
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now,
            || async { Ok(valid) },
        )
        .await
        .unwrap();
    let mut invalid = example();
    let template = invalid.events[0].clone();
    invalid.events = (0..1001)
        .map(|index| {
            let mut event = template.clone();
            event.id = format!("e{index}");
            event
        })
        .collect();
    let saved = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(121),
            || async { Ok(invalid) },
        )
        .await
        .unwrap();
    assert!(saved.stale);
    assert!(saved.error.unwrap().contains("limits"));
    assert_eq!(
        cache
            .entries
            .lock()
            .unwrap()
            .get(&cache_key(Competition::PremierLeague, id))
            .unwrap()
            .events
            .len(),
        example().events.len()
    );
    // With no prior copy there is nothing valid to show.
    let empty = Cache::default();
    let mut invalid = example();
    invalid.events = (0..1001)
        .map(|index| {
            let mut event = template.clone();
            event.id = format!("x{index}");
            event
        })
        .collect();
    assert!(empty
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now,
            || async { Ok(invalid) }
        )
        .await
        .is_err());
}

#[tokio::test]
async fn restart_offline_and_future_timestamps() {
    let now = clock();
    let mut d = example();
    d.updated_at = (now - chrono::Duration::hours(1)).to_rfc3339();
    let cache = Cache::default();
    cache.seed(&[d]);
    let d = cache
        .get_with(
            Competition::PremierLeague,
            "401879268",
            Phase::Other,
            false,
            now,
            || async { Err(Failure::temporary("offline")) },
        )
        .await
        .unwrap();
    assert!(d.stale);
    assert!(!d.events.is_empty());
    let future = Cache::default();
    let mut d = example();
    d.updated_at = (now + chrono::Duration::hours(1)).to_rfc3339();
    future.seed(&[d]);
    assert!(
        future
            .get_with(
                Competition::PremierLeague,
                "401879268",
                Phase::Live,
                false,
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
    let cache = Cache::default();
    assert!(cache
        .get_with(
            Competition::PremierLeague,
            "1",
            Phase::Live,
            false,
            now,
            || async {
                Err(Failure {
                    message: "HTTP 429".into(),
                    retry_after: Some(7200),
                })
            }
        )
        .await
        .is_err());
    // A bogus Retry-After is clamped to one hour.
    let key = cache_key(Competition::PremierLeague, "1");
    assert_eq!(
        cache.blocked.lock().unwrap().get(&key).copied(),
        Some(now.timestamp() + 3600)
    );
    assert!(cache
        .get_with(
            Competition::PremierLeague,
            "1",
            Phase::Live,
            false,
            now + chrono::Duration::seconds(3599),
            || async { panic!("must respect Retry-After") }
        )
        .await
        .is_err());
    let recovered = cache
        .get_with(
            Competition::PremierLeague,
            "1",
            Phase::Live,
            false,
            now + chrono::Duration::seconds(3600),
            || async {
                let mut detail = example();
                detail.match_id = "1".into();
                Ok(detail)
            },
        )
        .await
        .unwrap();
    assert!(!recovered.stale);
}
#[tokio::test]
async fn summary_cooldown_is_per_match() {
    let now = clock();
    let cache = Cache::default();
    assert!(cache
        .get_with(
            Competition::PremierLeague,
            "1",
            Phase::Live,
            false,
            now,
            || async { Err(Failure::temporary("boom")) }
        )
        .await
        .is_err());
    // A failure for one event must not pause every other summary.
    let other = cache
        .get_with(
            Competition::PremierLeague,
            "2",
            Phase::Live,
            false,
            now,
            || async {
                let mut detail = example();
                detail.match_id = "2".into();
                Ok(detail)
            },
        )
        .await
        .unwrap();
    assert!(!other.stale);
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
    let cache = Cache::default();
    let calls = std::sync::atomic::AtomicUsize::new(0);
    let request = || {
        cache.get_with(
            Competition::PremierLeague,
            "401879268",
            Phase::Live,
            false,
            clock(),
            || async {
                calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                tokio::task::yield_now().await;
                Ok(example())
            },
        )
    };
    let (a, b) = tokio::join!(request(), request());
    let a = a.unwrap();
    let b = b.unwrap();
    assert_eq!(a.updated_at, b.updated_at);
    assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 1);
}
#[tokio::test]
async fn bounded_cache_and_invalid_persisted_entries() {
    let cache = Cache::default();
    for i in 1..=25 {
        let id = i.to_string();
        cache
            .get_with(
                Competition::PremierLeague,
                &id,
                Phase::Other,
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
    let entries = cache.entries.lock().unwrap();
    assert_eq!(entries.len(), 24);
    assert!(!entries.contains_key(&cache_key(Competition::PremierLeague, "1")));
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
    let cache = Cache::default();
    cache
        .entries
        .lock()
        .unwrap()
        .insert(cache_key(pl.league, &pl.match_id), pl);
    cache
        .entries
        .lock()
        .unwrap()
        .insert(cache_key(ucl.league, &ucl.match_id), ucl);
    assert_eq!(cache.entries.lock().unwrap().len(), 2);

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

#[tokio::test]
async fn final_phase_bypasses_live_pregame_and_legacy_cache_until_provider_confirms_final() {
    for state in [Some("in"), Some("pre"), None] {
        let cache = Cache::default();
        let mut saved = example();
        let id = saved.match_id.clone();
        saved.match_state = state.map(str::to_owned);
        cache
            .get_with(
                Competition::PremierLeague,
                &id,
                Phase::Other,
                false,
                clock(),
                || async { Ok(saved) },
            )
            .await
            .unwrap();
        let mut still_live = example();
        still_live.match_state = Some("in".into());
        let pending = cache
            .get_with(
                Competition::PremierLeague,
                &id,
                Phase::Final,
                false,
                clock() + chrono::Duration::seconds(1),
                || async { Ok(still_live) },
            )
            .await
            .unwrap();
        assert_eq!(pending.match_state.as_deref(), Some("in"));
        let mut final_data = example();
        final_data.match_state = Some("post".into());
        let final_data = cache
            .get_with(
                Competition::PremierLeague,
                &id,
                Phase::Final,
                false,
                clock() + chrono::Duration::seconds(61),
                || async { Ok(final_data) },
            )
            .await
            .unwrap();
        assert_eq!(final_data.match_state.as_deref(), Some("post"));
        let cached = cache
            .get_with(
                Competition::PremierLeague,
                &id,
                Phase::Final,
                false,
                clock() + chrono::Duration::seconds(122),
                || async { panic!("final cache should stay fresh for 15 minutes") },
            )
            .await
            .unwrap();
        assert_eq!(cached.match_state.as_deref(), Some("post"));
    }
}

#[test]
fn recorded_summary_exposes_final_provider_phase_and_rejects_invalid_cached_phase() {
    let mut d = example();
    assert_eq!(d.match_state.as_deref(), Some("post"));
    d.match_state = Some("invalid".into());
    assert!(!valid_cached(&d));
    d.match_state = None;
    assert!(valid_cached(&d));
}

/// Minimal pre-match summary: just enough header for `normalize` to accept it.
fn pregame() -> Value {
    serde_json::json!({
        "header": {
            "id": "1",
            "season": {"name": "2026-27 English Premier League"},
            "competitions": [{
                "status": {"type": {"state": "pre"}},
                "competitors": [
                    {"id": "10", "team": {"id": "10", "displayName": "Home FC"}},
                    {"id": "20", "team": {"id": "20", "displayName": "Away FC"}}
                ]
            }]
        }
    })
}

#[test]
fn broadcasts_are_deduplicated_from_both_espn_sources() {
    let mut v = pregame();
    v["header"]["competitions"][0]["broadcasts"] = serde_json::json!([
        {"type": {"shortName": "TV"}, "media": {"shortName": "USA Net"}},
        {"type": {"shortName": "STREAMING"}, "media": {"shortName": "sky sports"}},
        {"media": {"shortName": "   "}}
    ]);
    v["broadcasts"] = serde_json::json!([
        {"media": {"shortName": "usa net"}},
        {"media": {"name": "Peacock"}},
        {"names": ["BBC iPlayer"]},
        {"media": {"shortName": "Sky Sports"}}
    ]);
    let d = normalize(&v, "1", Competition::PremierLeague).unwrap();
    assert_eq!(
        d.broadcasts,
        ["USA Net", "sky sports", "Peacock", "BBC iPlayer"]
    );
    v["broadcasts"] = Value::Array(
        (1..=8)
            .map(|n| serde_json::json!({"media": {"shortName": format!("Net {n}")}}))
            .collect(),
    );
    let capped = normalize(&v, "1", Competition::PremierLeague).unwrap();
    assert_eq!(capped.broadcasts.len(), 6);
    assert_eq!(capped.broadcasts.last().map(String::as_str), Some("Net 4"));
}

#[test]
fn weather_accepts_numeric_and_string_temperatures_and_drops_absent_data() {
    let mut v = pregame();
    assert!(normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .weather
        .is_none());
    v["gameInfo"] = serde_json::json!({"weather": {
        "temperature": 61,
        "highTemperature": 61,
        "conditionId": "3",
        "displayValue": "Partly Cloudy"
    }});
    let weather = normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .weather
        .unwrap();
    assert_eq!(weather.temperature_f, Some(61));
    assert_eq!(weather.condition.as_deref(), Some("Partly Cloudy"));
    v["gameInfo"]["weather"]["temperature"] = serde_json::json!("58");
    let weather = normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .weather
        .unwrap();
    assert_eq!(weather.temperature_f, Some(58));
    // An out-of-range temperature is dropped but the condition survives.
    v["gameInfo"]["weather"]["temperature"] = serde_json::json!(500);
    let weather = normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .weather
        .unwrap();
    assert_eq!(weather.temperature_f, None);
    assert_eq!(weather.condition.as_deref(), Some("Partly Cloudy"));
    v["gameInfo"] = serde_json::json!({"weather": {"temperature": "hot"}});
    assert!(normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .weather
        .is_none());
}

#[test]
fn predictor_prefers_espn_projection_and_normalises_to_one_hundred() {
    let mut v = pregame();
    v["predictor"] = serde_json::json!({
        "homeTeam": {"gameProjection": "50", "teamChanceTie": "25"},
        "awayTeam": {"gameProjection": 25}
    });
    let p = normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .predictor
        .unwrap();
    assert_eq!((p.home, p.draw, p.away), (50.0, 25.0, 25.0));
    assert_eq!(p.source, "espn");
    assert!(p.provider.is_none());
    // Without a tie figure, the draw is what remains of 100.
    v["predictor"] = serde_json::json!({
        "homeTeam": {"gameProjection": 40},
        "awayTeam": {"gameProjection": 35}
    });
    let p = normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .predictor
        .unwrap();
    assert_eq!((p.home, p.draw, p.away), (40.0, 25.0, 35.0));
    // Projections that cannot leave a non-negative draw are rejected.
    v["predictor"] = serde_json::json!({
        "homeTeam": {"gameProjection": 80},
        "awayTeam": {"gameProjection": 60}
    });
    assert!(normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .predictor
        .is_none());
}

#[test]
fn predictor_falls_back_to_bookmaker_moneylines() {
    let mut v = pregame();
    v["odds"] = serde_json::json!([{
        "provider": {"name": "DraftKings"},
        "homeTeamOdds": {"moneyLine": -240},
        "awayTeamOdds": {"moneyLine": 500},
        "drawOdds": {"moneyLine": 390}
    }]);
    let p = normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .predictor
        .unwrap();
    assert_eq!(p.source, "odds");
    assert_eq!(p.provider.as_deref(), Some("DraftKings"));
    // Implied 70.6 / 20.4 / 16.7 before normalising (raw sum 107.7).
    assert!((p.home - 65.6).abs() < 0.2, "{p:?}");
    assert!((p.draw - 19.0).abs() < 0.2, "{p:?}");
    assert!((p.away - 15.5).abs() < 0.2, "{p:?}");
    assert!((p.home + p.draw + p.away - 100.0).abs() < 0.2, "{p:?}");
}

#[test]
fn predictor_is_absent_without_all_three_usable_moneylines() {
    let mut v = pregame();
    v["odds"] = serde_json::json!([{
        "homeTeamOdds": {"moneyLine": -240},
        "awayTeamOdds": {"moneyLine": 500}
    }]);
    assert!(normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .predictor
        .is_none());
    // A price inside (-100, 100) is not a valid American moneyline.
    v["odds"] = serde_json::json!([{
        "homeTeamOdds": {"moneyLine": -240},
        "awayTeamOdds": {"moneyLine": 50},
        "drawOdds": {"moneyLine": 390}
    }]);
    assert!(normalize(&v, "1", Competition::PremierLeague)
        .unwrap()
        .predictor
        .is_none());
}

#[test]
fn standings_keep_only_the_two_clubs_across_every_group() {
    let mut v = pregame();
    v["standings"] = serde_json::json!({"groups": [
        {"standings": {"entries": [
            // Missing points: this row must be skipped in favour of a later one.
            {"id": "20", "stats": [{"name": "rank", "value": 4}]},
            {"id": "30", "stats": [{"name": "rank", "value": 1}, {"name": "points", "value": 30}]}
        ]}},
        {"standings": {"entries": [
            {"id": "99", "stats": [{"name": "rank", "value": 2}, {"name": "points", "value": 40}]},
            {"id": "10", "stats": [
                {"name": "rank", "value": 27},
                {"name": "points", "value": 27},
                {"name": "gamesPlayed", "value": 10}
            ]}
        ]}},
        {"standings": {"entries": [
            {"id": "20", "stats": [
                {"name": "rank", "value": 4},
                {"name": "points", "value": 12}
            ]}
        ]}}
    ]});
    let d = normalize(&v, "1", Competition::PremierLeague).unwrap();
    let rows: Vec<(String, u32, u32, Option<u32>)> = d
        .standings
        .iter()
        .map(|row| (row.team_id.clone(), row.rank, row.points, row.played))
        .collect();
    assert_eq!(
        rows,
        vec![
            ("10".to_owned(), 27, 27, Some(10)),
            ("20".to_owned(), 4, 12, None)
        ]
    );
}

#[test]
fn form_keeps_valid_game_dates_and_drops_malformed_ones() {
    let mut v = pregame();
    v["lastFiveGames"] = serde_json::json!([{
        "team": {"id": "10"},
        "events": [
            {"opponent": {"id": "1", "displayName": "Alpha"}, "gameResult": "W", "score": "2-1", "atVs": "vs", "gameDate": "2026-10-24T11:30Z"},
            {"opponent": {"id": "2", "displayName": "Beta"}, "gameResult": "D", "score": "0-0", "atVs": "@", "gameDate": "not a date"},
            {"opponent": {"id": "3", "displayName": "Gamma"}, "gameResult": "L", "score": "0-1", "atVs": "@", "gameDate": "2026-10-17T14:00:00Z"},
            {"opponent": {"id": "4", "displayName": "Delta"}, "gameResult": "W", "score": "3-0", "atVs": "vs", "gameDate": "2026-10-10T11:30Z\u{0007}"}
        ]
    }]);
    let d = normalize(&v, "1", Competition::PremierLeague).unwrap();
    let games = &d.form["10"];
    assert_eq!(games[0].date.as_deref(), Some("2026-10-24T11:30Z"));
    assert_eq!(games[1].date, None);
    assert_eq!(games[2].date.as_deref(), Some("2026-10-17T14:00:00Z"));
    assert_eq!(games[3].date, None);
}

#[test]
fn leaders_carry_athlete_id_and_appearances_only_when_valid() {
    let mut v = pregame();
    v["leaders"] = serde_json::json!([{
        "team": {"id": "10"},
        "leaders": [
            {"displayName": "Goals", "leaders": [{
                "displayValue": "9",
                "athlete": {"id": "4567", "displayName": "Striker One", "jersey": "9", "position": {"abbreviation": "F"}},
                "statistics": [{"name": "appearances", "value": 28}]
            }]},
            {"displayName": "Total Shots", "leaders": [{
                "displayValue": "31",
                "athlete": {"id": "778", "displayName": "Winger Two", "position": {"abbreviation": "M"}}
            }]},
            {"displayName": "Clean Sheets", "leaders": [{
                "displayValue": "5",
                "athlete": {"id": "12ab", "displayName": "Keeper Three"},
                "statistics": [{"name": "appearances", "value": 300}]
            }]}
        ]
    }]);
    let d = normalize(&v, "1", Competition::PremierLeague).unwrap();
    let goals = d.leaders.iter().find(|l| l.category == "Goals").unwrap();
    assert_eq!(goals.athlete_id.as_deref(), Some("4567"));
    assert_eq!(goals.apps, Some(28));
    // Shots carry no statistics block, so apps stays absent.
    let shots = d.leaders.iter().find(|l| l.category == "Shots").unwrap();
    assert_eq!(shots.athlete_id.as_deref(), Some("778"));
    assert_eq!(shots.apps, None);
    // A non-numeric id and an out-of-range appearance count are both dropped.
    let keeper = d.leaders.iter().find(|l| l.name == "Keeper Three").unwrap();
    assert_eq!(keeper.athlete_id, None);
    assert_eq!(keeper.apps, None);
}

#[test]
fn cache_written_before_new_fields_still_deserializes() {
    let mut legacy = serde_json::to_value(example()).unwrap();
    let object = legacy.as_object_mut().unwrap();
    for key in [
        "seasonName",
        "matchweek",
        "broadcasts",
        "weather",
        "predictor",
        "standings",
    ] {
        object.remove(key);
    }
    for games in legacy["form"].as_object_mut().unwrap().values_mut() {
        for game in games.as_array_mut().unwrap() {
            game.as_object_mut().unwrap().remove("date");
        }
    }
    for leader in legacy["leaders"].as_array_mut().unwrap() {
        let leader = leader.as_object_mut().unwrap();
        leader.remove("athleteId");
        leader.remove("apps");
    }
    let restored: Details = serde_json::from_value(legacy).unwrap();
    assert!(valid_cached(&restored));
    assert!(restored.season_name.is_none());
    assert!(restored.broadcasts.is_empty());
    assert!(restored.predictor.is_none());
    assert!(restored.standings.is_empty());
}

#[tokio::test]
async fn forced_refresh_bypasses_only_entries_at_least_thirty_seconds_old() {
    let now = clock();
    let cache = Cache::default();
    let id = "401879268";
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now,
            || async { Ok(example()) },
        )
        .await
        .unwrap();
    // 29s old: a forced request is still served from the cache.
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            true,
            now + chrono::Duration::seconds(29),
            || async { panic!("forced refresh under 30s must reuse the cache") },
        )
        .await
        .unwrap();
    // 45s old, inside the live TTL: a forced request refetches.
    let refreshed = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            true,
            now + chrono::Duration::seconds(45),
            || async { Ok(example()) },
        )
        .await
        .unwrap();
    assert_eq!(
        refreshed.updated_at,
        (now + chrono::Duration::seconds(45)).to_rfc3339()
    );
    // Unforced requests still honour the TTL.
    cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            false,
            now + chrono::Duration::seconds(50),
            || async { panic!("unforced fresh cache must not fetch") },
        )
        .await
        .unwrap();
    // A failed forced refresh starts the usual cooldown, which forced requests respect.
    let failed = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            true,
            now + chrono::Duration::seconds(100),
            || async { Err(Failure::temporary("timeout")) },
        )
        .await
        .unwrap();
    assert!(failed.stale);
    let cooled = cache
        .get_with(
            Competition::PremierLeague,
            id,
            Phase::Live,
            true,
            now + chrono::Duration::seconds(120),
            || async { panic!("cooldown must still apply to forced refresh") },
        )
        .await
        .unwrap();
    assert!(cooled.stale);
}
