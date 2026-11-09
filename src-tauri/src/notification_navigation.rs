//! Keep activation pending until the webview acknowledges it. Events alone can
//! be lost while the window is hidden or its listeners are still starting.
use crate::model::{Match, Snapshot};
use serde::Serialize;
use std::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    request_id: u64,
    match_id: Option<String>,
    #[serde(rename = "match")]
    fixture: Option<Match>,
}
#[derive(Default)]
struct Pending {
    sequence: u64,
    target: Option<Target>,
}
#[derive(Default)]
pub struct Navigation(Mutex<Pending>);

impl Navigation {
    pub fn activate(&self, match_id: Option<&str>) {
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        pending.sequence += 1;
        pending.target = Some(Target {
            request_id: pending.sequence,
            match_id: match_id
                .filter(|id| {
                    !id.is_empty() && id.len() <= 32 && id.bytes().all(|c| c.is_ascii_digit())
                })
                .map(str::to_owned),
            fixture: None,
        });
    }
    pub fn get(&self, snapshot: &Snapshot) -> Option<Target> {
        let mut target = self
            .0
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .target
            .clone()?;
        target.fixture = target.match_id.as_ref().and_then(|id| {
            snapshot
                .matches
                .iter()
                .chain(snapshot.recent_results.iter())
                .find(|m| &m.id == id)
                .cloned()
        });
        Some(target)
    }
    pub fn acknowledge(&self, request_id: u64) {
        let mut pending = self.0.lock().unwrap_or_else(|e| e.into_inner());
        if pending
            .target
            .as_ref()
            .is_some_and(|target| target.request_id == request_id)
        {
            pending.target = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn activation_survives_reads_until_acknowledged() {
        let navigation = Navigation::default();
        let snapshot = Snapshot::default();
        navigation.activate(Some("401879244"));
        let target = navigation.get(&snapshot).unwrap();
        assert_eq!(target.match_id.as_deref(), Some("401879244"));
        assert!(target.fixture.is_none());
        assert!(navigation.get(&snapshot).is_some());
        navigation.acknowledge(target.request_id);
        assert!(navigation.get(&snapshot).is_none());
    }
    #[test]
    fn acknowledging_an_older_click_keeps_the_new_destination() {
        let navigation = Navigation::default();
        let snapshot = Snapshot::default();
        navigation.activate(Some("1"));
        let old = navigation.get(&snapshot).unwrap();
        navigation.activate(Some("2"));
        navigation.acknowledge(old.request_id);
        assert_eq!(
            navigation.get(&snapshot).unwrap().match_id.as_deref(),
            Some("2")
        );
    }
    #[test]
    fn activation_can_resolve_a_recent_result_outside_the_current_fixtures() {
        let navigation = Navigation::default();
        let mut fixture = crate::demo::mock().remove(0);
        fixture.id = "123".into();
        let snapshot = Snapshot {
            recent_results: vec![fixture],
            ..Snapshot::default()
        };
        navigation.activate(Some("123"));
        assert_eq!(
            navigation.get(&snapshot).unwrap().fixture.unwrap().id,
            "123"
        );
    }
    #[test]
    fn test_and_invalid_destinations_open_the_app_without_a_match() {
        let navigation = Navigation::default();
        for id in [
            None,
            Some(""),
            Some("123:goal"),
            Some("https://example.org"),
        ] {
            navigation.activate(id);
            assert!(navigation
                .get(&Snapshot::default())
                .unwrap()
                .match_id
                .is_none());
        }
    }
}
