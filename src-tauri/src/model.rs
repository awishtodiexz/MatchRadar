use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;

/// A damaged or hand-edited save must not turn into unbounded memory use: keep
/// only plausible, bounded IDs.
fn bounded_sent_notifications<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    let values = Vec::<serde_json::Value>::deserialize(deserializer)?;
    Ok(values
        .into_iter()
        .filter_map(|value| value.as_str().map(str::to_owned))
        .filter(|id| !id.is_empty() && id.len() <= 200 && !id.chars().any(char::is_control))
        .take(1000)
        .collect())
}

/// Supported ESPN competitions. The slug is the stable provider key and the
/// storage key for per-competition status; it is not shown in the widget.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Competition {
    #[default]
    PremierLeague,
    ChampionsLeague,
}

impl Competition {
    pub const ALL: [Self; 2] = [Self::PremierLeague, Self::ChampionsLeague];

    pub const fn slug(self) -> &'static str {
        match self {
            Self::PremierLeague => "eng.1",
            Self::ChampionsLeague => "uefa.champions",
        }
    }

    pub const fn name(self) -> &'static str {
        match self {
            Self::PremierLeague => "Premier League",
            Self::ChampionsLeague => "Champions League",
        }
    }

    /// UCL fixtures are sparse, so its schedule window is wider than the EPL's.
    pub const fn lookahead_days(self) -> i64 {
        match self {
            Self::PremierLeague => 14,
            Self::ChampionsLeague => 30,
        }
    }
}

/// The persisted competition selector. The default preserves existing users on
/// the Premier League.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CompetitionView {
    #[default]
    PremierLeague,
    ChampionsLeague,
    Both,
}

impl<'de> Deserialize<'de> for CompetitionView {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = serde_json::Value::deserialize(deserializer)?;
        Ok(match value.as_str() {
            Some("championsLeague") => Self::ChampionsLeague,
            Some("both") => Self::Both,
            _ => Self::PremierLeague,
        })
    }
}

impl CompetitionView {
    #[cfg(test)]
    pub fn includes(self, league: Competition) -> bool {
        match self {
            Self::PremierLeague => league == Competition::PremierLeague,
            Self::ChampionsLeague => league == Competition::ChampionsLeague,
            Self::Both => true,
        }
    }
}

/// Per-competition source freshness. Aggregate snapshot fields remain for
/// compatibility with older saved state and are derived after every refresh.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct LeagueStatus {
    pub fixture_updated_at: Option<String>,
    pub updated_at: Option<String>,
    pub fixture_error: Option<String>,
    pub score_error: Option<String>,
    pub recent_updated_at: Option<String>,
    pub recent_error: Option<String>,
    pub recent_retry_at: Option<String>,
}

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
    /// Missing in saved Premier League state, which defaults to that competition.
    #[serde(default)]
    pub league: Competition,
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
    pub start_hidden: bool,
    pub reduced_motion: bool,
    pub theme: Theme,
    #[serde(deserialize_with = "opacity")]
    pub opacity: u8,
    pub competition_view: CompetitionView,
    pub reminders: bool,
    pub reminder_minutes: u32,
    pub starts: bool,
    pub goals: bool,
    // Read only to migrate preferences saved by older versions.
    #[serde(skip_serializing)]
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
            start_hidden: false,
            reduced_motion: false,
            theme: Theme::Dark,
            opacity: 96,
            competition_view: CompetitionView::PremierLeague,
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
    pub revalidate_pending: bool,
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
    #[serde(default)]
    pub league_status: HashMap<String, LeagueStatus>,
    pub updated_at: Option<String>,
    pub fixture_updated_at: Option<String>,
    pub error: Option<String>,
    pub refreshing: bool,
    pub settings: Settings,
    #[serde(deserialize_with = "bounded_sent_notifications")]
    pub sent_notifications: Vec<String>,
    pub expanded_size: Option<ExpandedSize>,
    // Missing in old caches means legacy; new snapshots explicitly start current.
    #[serde(default)]
    pub team_catalog_version: u32,
}
impl Default for Snapshot {
    fn default() -> Self {
        Self {
            revalidate_pending: false,
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
            league_status: HashMap::new(),
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
/// The subset of the snapshot the widget actually renders. Persistence keeps the
/// full `Snapshot`; sending details, results and notification state over IPC only
/// inflated every poll by >6x.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetSnapshot {
    pub matches: Vec<Match>,
    pub league_status: HashMap<String, LeagueStatus>,
    pub updated_at: Option<String>,
    pub fixture_updated_at: Option<String>,
    pub fixture_error: Option<String>,
    pub score_error: Option<String>,
    pub error: Option<String>,
    pub partial: bool,
    pub refreshing: bool,
    pub settings: Settings,
}
impl From<&Snapshot> for WidgetSnapshot {
    fn from(snapshot: &Snapshot) -> Self {
        Self {
            matches: snapshot.matches.clone(),
            league_status: snapshot.league_status.clone(),
            updated_at: snapshot.updated_at.clone(),
            fixture_updated_at: snapshot.fixture_updated_at.clone(),
            fixture_error: snapshot.fixture_error.clone(),
            score_error: snapshot.score_error.clone(),
            error: snapshot.error.clone(),
            partial: snapshot.partial,
            refreshing: snapshot.refreshing,
            settings: snapshot.settings.clone(),
        }
    }
}

impl Snapshot {
    // Older demo builds stored synthetic subscriptions and fixtures in the real fields.
    pub fn migrate_demo_state(&mut self) {
        // A legacy demo session must return to the live feed on upgrade. Keep
        // pending real notifications paused until a fresh score confirms them.
        if self.settings.mock {
            self.settings.mock = false;
            self.revalidate_pending |= !self.pending_notifications.is_empty();
            crate::refresh::mark_cached(self);
        }
        self.pending_notifications
            .retain(|event| !event.match_id.starts_with("demo-"));
        self.alert_baselines
            .retain(|id, _| !id.starts_with("demo-"));
        self.sent_notifications
            .retain(|id| !id.starts_with("demo-"));
        self.settings
            .match_alerts
            .retain(|id, _| !id.starts_with("demo-"));
        if self.matches.iter().any(|m| m.id.starts_with("demo-")) {
            self.matches.retain(|m| !m.id.starts_with("demo-"));
            self.updated_at = None;
            self.fixture_updated_at = None;
        }
    }

    /// Older saves stored freshness globally; copy it to the Premier League entry
    /// once so per-competition status starts from known values.
    pub fn migrate_competition_state(&mut self) {
        let has_legacy = self.fixture_updated_at.is_some()
            || self.updated_at.is_some()
            || self.fixture_error.is_some()
            || self.score_error.is_some()
            || self.recent_updated_at.is_some()
            || self.recent_error.is_some()
            || self.recent_retry_at.is_some();
        if !has_legacy {
            return;
        }
        let status = self
            .league_status
            .entry(Competition::PremierLeague.slug().into())
            .or_default();
        let fill = |target: &mut Option<String>, value: &Option<String>| {
            if target.is_none() {
                *target = value.clone();
            }
        };
        fill(&mut status.fixture_updated_at, &self.fixture_updated_at);
        fill(&mut status.updated_at, &self.updated_at);
        fill(&mut status.fixture_error, &self.fixture_error);
        fill(&mut status.score_error, &self.score_error);
        fill(&mut status.recent_updated_at, &self.recent_updated_at);
        fill(&mut status.recent_error, &self.recent_error);
        fill(&mut status.recent_retry_at, &self.recent_retry_at);
    }

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
    pub pin_changed: bool,
    pub compact_changed: bool,
}
impl SettingsEffects {
    pub fn between(old: &Settings, next: &Settings) -> Self {
        Self {
            pin_changed: old.always_on_top != next.always_on_top,
            compact_changed: old.compact != next.compact,
        }
    }
}
pub fn apply_settings(snapshot: &mut Snapshot, settings: Settings) -> SettingsEffects {
    apply_settings_at(snapshot, settings, chrono::Utc::now())
}
pub(crate) fn apply_settings_at(
    snapshot: &mut Snapshot,
    mut settings: Settings,
    now: chrono::DateTime<chrono::Utc>,
) -> SettingsEffects {
    settings.mock = false;
    settings
        .match_alerts
        .retain(|id, _| !id.starts_with("demo-"));
    crate::alerts::prepare_preferences(snapshot, &mut settings, now);
    settings.opacity = settings.opacity.clamp(70, 100);
    let effects = SettingsEffects::between(&snapshot.settings, &settings);
    snapshot.settings = settings;
    crate::delivery::cleanup(snapshot, now);
    effects
}
// Feed completion only updates feed fields, preserving preferences saved during I/O.
#[cfg(test)]
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

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn widget_snapshot_keeps_render_fields_and_drops_internal_state() {
        let snapshot = Snapshot {
            matches: crate::demo::mock(),
            recent_results: crate::demo::mock(),
            settings: Settings {
                favorites: vec!["359".into()],
                ..Settings::default()
            },
            ..Snapshot::default()
        };
        let value = serde_json::to_value(WidgetSnapshot::from(&snapshot)).unwrap();
        assert!(value.get("matches").is_some());
        assert!(value.get("settings").is_some());
        for internal in [
            "detailCache",
            "recentResults",
            "pendingNotifications",
            "alertBaselines",
            "sentNotifications",
        ] {
            assert!(value.get(internal).is_none(), "{internal} must stay local");
        }
    }

    #[test]
    fn legacy_demo_state_migrates_without_removing_real_preferences() {
        let mut snapshot: Snapshot = serde_json::from_str("{}").unwrap();
        let alert = MatchAlert {
            enabled: true,
            expires_at: "2099-01-01T00:00:00Z".into(),
        };
        snapshot
            .settings
            .match_alerts
            .insert("demo-1".into(), alert.clone());
        snapshot
            .settings
            .match_alerts
            .insert("123".into(), alert.clone());
        snapshot.matches = crate::demo::mock();
        snapshot.sent_notifications = vec!["demo-1:start".into(), "123:start".into()];
        snapshot.migrate_demo_state();
        assert_eq!(snapshot.settings.match_alerts.get("123"), Some(&alert));
        assert!(!snapshot.settings.match_alerts.contains_key("demo-1"));
        assert!(snapshot.matches.is_empty());
        assert_eq!(snapshot.sent_notifications, ["123:start"]);
        let restarted: Snapshot =
            serde_json::from_slice(&serde_json::to_vec(&snapshot).unwrap()).unwrap();
        assert_eq!(restarted.settings.match_alerts.get("123"), Some(&alert));
    }
    #[test]
    fn saved_demo_preference_returns_to_live_feed() {
        let mut snapshot: Snapshot = serde_json::from_str(r#"{"settings":{"mock":true}}"#).unwrap();
        let mut real = crate::demo::mock().remove(0);
        real.id = "123".into();
        snapshot.matches.push(real);
        snapshot.migrate_demo_state();
        assert!(!snapshot.settings.mock);
        assert_eq!(snapshot.matches[0].id, "123");
        assert!(snapshot.matches[0].score_stale);
    }
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
        apply_settings(&mut snapshot, next);
        assert!(!snapshot.settings.mock);
        assert_eq!(snapshot.updated_at.as_deref(), Some("new score time"));
        assert_eq!(snapshot.fixture_updated_at.as_deref(), Some("fixture time"));
    }
    #[test]
    fn settings_effects_identify_native_window_changes() {
        let original = Settings::default();
        let changes: [fn(&mut Settings); 12] = [
            |s| s.theme = Theme::Light,
            |s| s.opacity = 70,
            |s| s.competition_view = CompetitionView::Both,
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
            assert_eq!(
                effects.pin_changed,
                original.always_on_top != next.always_on_top
            );
            assert_eq!(effects.compact_changed, original.compact != next.compact);
        }
        assert_eq!(
            SettingsEffects::between(&original, &original),
            SettingsEffects {
                pin_changed: false,
                compact_changed: false
            }
        );
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
    fn legacy_state_defaults_to_premier_league_and_preserves_new_selection() {
        let legacy: Snapshot = serde_json::from_str(
            r#"{"settings":{},"matches":[{"id":"1","home":{"id":"359","name":"Arsenal","short":"ARS","logo":null},"away":{"id":"363","name":"Chelsea","short":"CHE","logo":null},"homeScore":null,"awayScore":null,"kickoff":"2026-11-07T15:00:00Z","status":"scheduled","detail":"Scheduled","competition":"Premier League"}]}"#,
        )
        .unwrap();
        assert_eq!(
            legacy.settings.competition_view,
            CompetitionView::PremierLeague
        );
        assert_eq!(legacy.matches[0].league, Competition::PremierLeague);
        assert!(legacy.league_status.is_empty());
        assert_eq!(
            serde_json::from_str::<Settings>(r#"{"competitionView":"bogus"}"#)
                .unwrap()
                .competition_view,
            CompetitionView::PremierLeague
        );
        let both = Settings {
            competition_view: CompetitionView::Both,
            ..Settings::default()
        };
        assert_eq!(
            serde_json::to_value(&both).unwrap()["competitionView"],
            "both"
        );
        assert!(CompetitionView::Both.includes(Competition::ChampionsLeague));
        assert!(!CompetitionView::PremierLeague.includes(Competition::ChampionsLeague));
        assert_eq!(
            serde_json::to_value(Competition::ChampionsLeague).unwrap(),
            "championsLeague"
        );
        assert_eq!(Competition::ChampionsLeague.lookahead_days(), 30);
        assert_eq!(Competition::PremierLeague.lookahead_days(), 14);
    }

    #[test]
    fn legacy_freshness_migrates_once_to_the_premier_league_entry() {
        let mut old: Snapshot = serde_json::from_str(
            r#"{"updatedAt":"2026-11-06T10:00:00Z","fixtureUpdatedAt":"2026-11-06T06:00:00Z","scoreError":"HTTP 500","recentUpdatedAt":"2026-11-06T09:00:00Z","recentError":"results down"}"#,
        )
        .unwrap();
        assert!(old.league_status.is_empty());
        old.migrate_competition_state();
        let status = &old.league_status[Competition::PremierLeague.slug()];
        assert_eq!(status.updated_at.as_deref(), Some("2026-11-06T10:00:00Z"));
        assert_eq!(status.score_error.as_deref(), Some("HTTP 500"));
        assert_eq!(
            status.recent_updated_at.as_deref(),
            Some("2026-11-06T09:00:00Z")
        );
        assert_eq!(status.recent_error.as_deref(), Some("results down"));
        // Later status wins: migration is fill-only and idempotent.
        old.league_status
            .get_mut(Competition::PremierLeague.slug())
            .unwrap()
            .updated_at = Some("later".into());
        old.migrate_competition_state();
        assert_eq!(
            old.league_status[Competition::PremierLeague.slug()]
                .updated_at
                .as_deref(),
            Some("later")
        );
    }

    #[test]
    fn catalog_migration_does_not_rewrite_provider_matches_or_defaults() {
        let mut old: Snapshot = serde_json::from_str("{}").unwrap();
        old.matches = crate::demo::mock();
        let matches = serde_json::to_value(&old.matches).unwrap();
        let defaults = old.settings.favorites.clone();
        old.migrate_catalog();
        assert_eq!(serde_json::to_value(&old.matches).unwrap(), matches);
        assert_eq!(old.settings.favorites, defaults);
    }
}
