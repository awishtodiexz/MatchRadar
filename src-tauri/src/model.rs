use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchAlert {
    pub enabled: bool,
    pub expires_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AlertBaseline {
    #[serde(default)]
    pub priming: bool,
    pub status: String,
    pub home: Option<u32>,
    pub away: Option<u32>,
    pub high_water: u64,
    pub seen_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NotificationKind {
    Reminder,
    Start,
    Goal { home: u32, away: u32 },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingNotification {
    pub id: String,
    pub match_id: String,
    pub home_team: String,
    pub away_team: String,
    pub body: String,
    pub kind: NotificationKind,
    pub created_at: String,
    pub expires_at: String,
    pub next_attempt_at: String,
    pub attempts: u8,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Team {
    pub id: String,
    pub name: String,
    pub short: String,
    pub logo: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    #[serde(default)]
    pub score_stale: bool,
    pub id: String,
    pub home: Team,
    pub away: Team,
    pub home_score: Option<u32>,
    pub away_score: Option<u32>,
    pub kickoff: String,
    pub status: String,
    pub detail: String,
    pub competition: String,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    Dark,
    Light,
}
impl<'de> Deserialize<'de> for Theme {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(if value.as_str() == Some("light") {
            Self::Light
        } else {
            Self::Dark
        })
    }
}
fn opacity<'de, D: Deserializer<'de>>(deserializer: D) -> Result<u8, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_i64().map(|v| v.clamp(70, 100) as u8).unwrap_or(96))
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub match_alerts: HashMap<String, MatchAlert>,
    pub favorites: Vec<String>,
    pub followed_only: bool,
    pub compact: bool,
    pub always_on_top: bool,
    pub reduced_motion: bool,
    pub theme: Theme,
    #[serde(deserialize_with = "opacity")]
    pub opacity: u8,
    pub reminders: bool,
    pub reminder_minutes: u32,
    pub starts: bool,
    pub goals: bool,
    pub mock: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            match_alerts: HashMap::new(),
            favorites: ["359", "363", "364", "382", "360", "367"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
            followed_only: false,
            compact: false,
            always_on_top: true,
            reduced_motion: false,
            theme: Theme::Dark,
            opacity: 96,
            reminders: true,
            reminder_minutes: 15,
            starts: true,
            goals: false,
            mock: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedSize {
    pub width: f64,
    pub height: f64,
}
impl Default for ExpandedSize {
    fn default() -> Self {
        Self {
            width: 390.0,
            height: 700.0,
        }
    }
}
impl ExpandedSize {
    pub fn bounded(self) -> Self {
        let fallback = Self::default();
        Self {
            width: if self.width.is_finite() {
                self.width.clamp(320.0, 600.0)
            } else {
                fallback.width
            },
            height: if self.height.is_finite() {
                self.height.clamp(460.0, 1100.0)
            } else {
                fallback.height
            },
        }
    }
    pub fn compact(self) -> Self {
        Self {
            width: self.bounded().width.min(390.0),
            height: 460.0,
        }
    }
    pub fn from_physical(width: u32, height: u32, scale: f64) -> Option<Self> {
        if width == 0 || height == 0 || !scale.is_finite() || scale <= 0.0 {
            return None;
        }
        Some(
            Self {
                width: width as f64 / scale,
                height: height as f64 / scale,
            }
            .bounded(),
        )
    }
}

pub const TEAM_CATALOG_VERSION: u32 = 1;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Snapshot {
    pub recent_results: Vec<Match>,
    pub recent_updated_at: Option<String>,
    pub recent_error: Option<String>,
    pub recent_retry_at: Option<String>,
    #[serde(deserialize_with = "crate::details::deserialize_cache")]
    pub detail_cache: Vec<crate::details::Details>,
    #[serde(deserialize_with = "crate::delivery::deserialize_pending")]
    pub pending_notifications: Vec<PendingNotification>,
    pub notification_retry_after: Option<String>,
    pub fixture_error: Option<String>,
    pub score_error: Option<String>,
    pub partial: bool,
    pub alert_baselines: HashMap<String, AlertBaseline>,
    pub matches: Vec<Match>,
    pub updated_at: Option<String>,
    pub fixture_updated_at: Option<String>,
    pub error: Option<String>,
    pub refreshing: bool,
    pub settings: Settings,
    pub sent_notifications: Vec<String>,
    pub expanded_size: Option<ExpandedSize>,
    // Missing in old caches means legacy; new snapshots explicitly start current.
    #[serde(default)]
    pub team_catalog_version: u32,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            recent_results: Vec::new(),
            recent_updated_at: None,
            recent_error: None,
            recent_retry_at: None,
            detail_cache: Vec::new(),
            pending_notifications: Vec::new(),
            notification_retry_after: None,
            fixture_error: None,
            score_error: None,
            partial: false,
            alert_baselines: HashMap::new(),
            matches: Vec::new(),
            updated_at: None,
            fixture_updated_at: None,
            error: None,
            refreshing: false,
            settings: Settings::default(),
            sent_notifications: Vec::new(),
            expanded_size: None,
            team_catalog_version: TEAM_CATALOG_VERSION,
        }
    }
}
impl Snapshot {
    pub fn migrate_catalog(&mut self) {
        if self.team_catalog_version >= TEAM_CATALOG_VERSION {
            return;
        }
        let mut seen = std::collections::HashSet::new();
        self.settings.favorites = self
            .settings
            .favorites
            .iter()
            .map(|id| {
                match id.as_str() {
                    "362" => "368",
                    "361" => "362",
                    "331" => "361",
                    "337" => "331",
                    "379" => "380",
                    "376" => "370",
                    "393" => "337",
                    "349" => "393",
                    "306" => "379",
                    "3492" => "349",
                    other => other,
                }
                .to_string()
            })
            .filter(|id| seen.insert(id.clone()))
            .collect();
        self.team_catalog_version = TEAM_CATALOG_VERSION;
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct SettingsEffects {
    pub mode_changed: bool,
    pub pin_changed: bool,
    pub compact_changed: bool,
}
impl SettingsEffects {
    pub fn between(old: &Settings, next: &Settings) -> Self {
        Self {
            mode_changed: old.mock != next.mock,
            pin_changed: old.always_on_top != next.always_on_top,
            compact_changed: old.compact != next.compact,
        }
    }
}
pub fn apply_settings(snapshot: &mut Snapshot, mut settings: Settings) -> SettingsEffects {
    crate::alerts::prepare_preferences(snapshot, &mut settings, chrono::Utc::now());
    settings.opacity = settings.opacity.clamp(70, 100);
    let effects = SettingsEffects::between(&snapshot.settings, &settings);
    if effects.mode_changed {
        snapshot.pending_notifications.clear();
        snapshot.alert_baselines.clear();
        snapshot.matches.clear();
        snapshot.updated_at = None;
        snapshot.fixture_updated_at = None;
        snapshot.error = None;
        snapshot.fixture_error = None;
        snapshot.score_error = None;
        snapshot.partial = false;
    }
    snapshot.settings = settings;
    crate::delivery::cleanup(snapshot, chrono::Utc::now());
    effects
}
// Feed completion only updates feed fields, preserving preferences saved during I/O.
pub fn apply_feed(
    snapshot: &mut Snapshot,
    matches: Vec<Match>,
    updated_at: String,
    fixtures_updated: bool,
    error: Option<String>,
) {
    snapshot.matches = matches;
    snapshot.updated_at = Some(updated_at);
    if fixtures_updated {
        snapshot.fixture_updated_at = snapshot.updated_at.clone();
    }
    snapshot.error = error;
    snapshot.fixture_error = None;
    snapshot.score_error = None;
    snapshot.partial = false;
}

pub fn feed_is_current(
    snapshot: &Snapshot,
    request_mock: bool,
    request_generation: u64,
    current_generation: u64,
) -> bool {
    snapshot.settings.mock == request_mock && request_generation == current_generation
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn theme_migration_and_round_trip() {
        let old: Settings = serde_json::from_str("{}").unwrap();
        assert_eq!(old.theme, Theme::Dark);
        assert_eq!(old.opacity, 96);
        let dark: Settings = serde_json::from_str(&serde_json::to_string(&old).unwrap()).unwrap();
        assert_eq!(dark, old);
        assert_eq!(serde_json::to_value(&dark).unwrap()["theme"], "dark");
        for invalid in ["null", "42", "\"unknown\"", "{}"] {
            let settings: Settings =
                serde_json::from_str(&format!("{{\"theme\":{invalid}}}")).unwrap();
            assert_eq!(settings.theme, Theme::Dark);
        }
        let light: Settings =
            serde_json::from_str("{\"theme\":\"light\",\"opacity\":300}").unwrap();
        assert_eq!(light.theme, Theme::Light);
        assert_eq!(light.opacity, 100);
        let round_trip: Settings =
            serde_json::from_str(&serde_json::to_string(&light).unwrap()).unwrap();
        assert_eq!(round_trip, light);
        assert_eq!(
            serde_json::from_str::<Settings>("{\"opacity\":-1}")
                .unwrap()
                .opacity,
            70
        );
    }
    #[test]
    fn cosmetic_and_notification_settings_preserve_feed_state() {
        let mut snapshot = Snapshot {
            updated_at: Some("score time".into()),
            fixture_updated_at: Some("fixture time".into()),
            error: Some("cached error".into()),
            ..Snapshot::default()
        };
        let mut next = snapshot.settings.clone();
        next.theme = Theme::Light;
        next.opacity = 80;
        next.compact = true;
        next.always_on_top = false;
        next.favorites = vec!["368".into()];
        next.followed_only = true;
        next.goals = true;
        next.starts = false;
        next.reminders = false;
        next.reminder_minutes = 30;
        next.reduced_motion = true;
        let effects = apply_settings(&mut snapshot, next.clone());
        assert!(!effects.mode_changed);
        assert!(effects.pin_changed && effects.compact_changed);
        assert_eq!(snapshot.updated_at.as_deref(), Some("score time"));
        assert_eq!(snapshot.fixture_updated_at.as_deref(), Some("fixture time"));
        assert_eq!(snapshot.error.as_deref(), Some("cached error"));
        assert!(!snapshot.refreshing);
        apply_feed(
            &mut snapshot,
            Vec::new(),
            "new score time".into(),
            false,
            None,
        );
        assert_eq!(snapshot.settings, next);
        assert_eq!(snapshot.fixture_updated_at.as_deref(), Some("fixture time"));
        next.mock = true;
        assert!(apply_settings(&mut snapshot, next).mode_changed);
        assert!(snapshot.updated_at.is_none() && snapshot.fixture_updated_at.is_none());
    }
    #[test]
    fn only_mode_changes_request_a_feed_refresh() {
        let original = Settings::default();
        let changes: [fn(&mut Settings); 11] = [
            |s| s.theme = Theme::Light,
            |s| s.opacity = 70,
            |s| s.compact = true,
            |s| s.always_on_top = false,
            |s| s.favorites = vec!["368".into()],
            |s| s.followed_only = true,
            |s| s.reminders = false,
            |s| s.reminder_minutes = 30,
            |s| s.starts = false,
            |s| s.goals = true,
            |s| s.reduced_motion = true,
        ];
        for change in changes {
            let mut next = original.clone();
            change(&mut next);
            let effects = SettingsEffects::between(&original, &next);
            assert!(!effects.mode_changed);
            assert_eq!(
                effects.pin_changed,
                original.always_on_top != next.always_on_top
            );
            assert_eq!(effects.compact_changed, original.compact != next.compact);
        }
        let mut mock = original.clone();
        mock.mock = true;
        assert!(SettingsEffects::between(&original, &mock).mode_changed);
        assert!(SettingsEffects::between(&mock, &original).mode_changed);
        assert_eq!(
            SettingsEffects::between(&original, &original),
            SettingsEffects {
                mode_changed: false,
                pin_changed: false,
                compact_changed: false
            }
        );
    }
    #[test]
    fn in_flight_feed_cannot_cross_a_mode_round_trip() {
        let mut snapshot = Snapshot::default();
        assert!(feed_is_current(&snapshot, false, 0, 0));
        let mut settings = snapshot.settings.clone();
        settings.mock = true;
        apply_settings(&mut snapshot, settings.clone());
        assert!(!feed_is_current(&snapshot, false, 0, 1));
        settings.mock = false;
        apply_settings(&mut snapshot, settings);
        assert!(!feed_is_current(&snapshot, false, 0, 2));
        assert!(feed_is_current(&snapshot, false, 2, 2));
    }
    #[test]
    fn compact_preserves_logical_expanded_dimensions_across_restart() {
        for scale in [1.0, 1.25, 1.5] {
            let expanded =
                ExpandedSize::from_physical((520.0 * scale) as u32, (880.0 * scale) as u32, scale)
                    .unwrap();
            assert_eq!(
                expanded,
                ExpandedSize {
                    width: 520.0,
                    height: 880.0
                }
            );
            assert_eq!(
                expanded.compact(),
                ExpandedSize {
                    width: 390.0,
                    height: 460.0
                }
            );
            let original = Snapshot {
                expanded_size: Some(expanded),
                settings: Settings {
                    compact: true,
                    ..Settings::default()
                },
                ..Snapshot::default()
            };
            let restored: Snapshot =
                serde_json::from_str(&serde_json::to_string(&original).unwrap()).unwrap();
            assert_eq!(restored.expanded_size, Some(expanded));
            // Keep the saved expanded value when disabling compact after restart.
            let mut restarted = restored;
            let compact_window = expanded.compact();
            let mut next = restarted.settings.clone();
            next.compact = false;
            apply_settings(&mut restarted, next);
            assert_eq!(restarted.expanded_size.unwrap().bounded(), expanded);
            assert_ne!(restarted.expanded_size.unwrap(), compact_window);
        }
        assert_eq!(
            ExpandedSize {
                width: 340.0,
                height: 750.0
            }
            .compact()
            .width,
            340.0
        );
        assert!(ExpandedSize::from_physical(0, 0, 1.0).is_none());
        assert!(ExpandedSize::from_physical(390, 700, 0.0).is_none());
    }
    #[test]
    fn legacy_catalog_mapping_is_simultaneous_and_runs_once() {
        let mut old: Snapshot = serde_json::from_str(r#"{"settings":{"favorites":["362","361","331","337","379","376","393","349","306","3492","359","362"]}}"#).unwrap();
        assert_eq!(old.team_catalog_version, 0);
        old.migrate_catalog();
        assert_eq!(
            old.settings.favorites,
            ["368", "362", "361", "331", "380", "370", "337", "393", "379", "349", "359"]
        );
        let migrated = old.settings.favorites.clone();
        old.migrate_catalog();
        assert_eq!(old.settings.favorites, migrated);
        old.settings.favorites = vec!["362".into()];
        let mut reloaded: Snapshot =
            serde_json::from_str(&serde_json::to_string(&old).unwrap()).unwrap();
        reloaded.migrate_catalog();
        assert_eq!(reloaded.settings.favorites, ["362"]);
        let mut fresh = Snapshot::default();
        let defaults = fresh.settings.favorites.clone();
        fresh.migrate_catalog();
        assert_eq!(fresh.settings.favorites, defaults);
        fresh.settings.favorites = vec!["362".into()];
        fresh.migrate_catalog();
        assert_eq!(fresh.settings.favorites, ["362"]);
    }
    #[test]
    fn catalog_migration_does_not_rewrite_provider_matches_or_defaults() {
        let mut old: Snapshot = serde_json::from_str("{}").unwrap();
        old.matches = crate::provider::mock();
        let matches = serde_json::to_value(&old.matches).unwrap();
        let defaults = old.settings.favorites.clone();
        old.migrate_catalog();
        assert_eq!(serde_json::to_value(&old.matches).unwrap(), matches);
        assert_eq!(old.settings.favorites, defaults);
    }
}
