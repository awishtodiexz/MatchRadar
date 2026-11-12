# Changelog

## 1.0.0 — 2026-11-09 (updated 2026-11-12)

### Match Centre redesign (2026-11-12)

- New match header: crests on soft rings, a dominant score or kick-off time with a status chip (`Kick-off · Today`, live, full-time, postponed), and the beaten side dimmed after full-time.
- Overview rebuilt as quiet cards: match information lists only the facts ESPN supplied, form shows one row per team with the latest result outlined and a W/D/L record, and team leaders read as a head-to-head per category with the higher figure highlighted.
- Leader values such as `Matches: 10, Goals: 9` are reduced to the stat itself, with appearances shown as context.

### Reliability update (2026-11-12)

- Live polling: a match whose kickoff has passed while ESPN still lists it as scheduled is checked every minute, so the start alert and early goals are no longer missed during a 30-minute idle wait.
- Match outcomes: abandoned matches are no longer shown as full time or counted as results; forfeits keep their awarded score as a result, are labelled as forfeits, and never trigger goal alerts.
- Suspended matches appear with in-progress games and in the Live view, after matches being played, and are rechecked at the matchday rate.
- Refresh feedback: while ESPN is rate limiting requests, the footer shows when updates resume instead of silently doing nothing.
- Quitting from the tray saves the latest fixtures, alert baselines and freshness before exiting.

### Improved build (2026-11-10)

### App

- Match Centre improvements: stoppage-time event ordering, VAR/key-event labels, accessible sticky statistics headers, clearer commentary counts and empty-filter recovery, lineup keyboard navigation, and explicit postponed/cancelled/unknown states.
- Widget and status polish: correct `CHECKING LIVE` state for unchecked competitions, honest failed-first-load recovery, scroll reset when changing views, clearer Both-competitions card descriptions, and one-line 12-hour kickoff times.
- Champions League knockout context: optional leg and aggregate fields, surfaced in match details.

### Data and reliability

- ESPN robustness: unplayed fixtures no longer report 0–0, shootout/disallowed goals are excluded from scorers, suspended previous-day matches are refreshed, provider identities and text are bounded, and crest URLs must match the club.
- Notifications: reminders survive provider outages, are re-planned after preference changes, newer goals supersede older pending scores, and delayed kickoffs get a bounded start-alert grace period.
- Native Windows: improved hidden-window recovery, restored-size handling, start-in-tray semantics, sleep/resume placement recovery, and bounded shortcut retry.
- QA: new reliability journeys, damaged-timestamp resilience, corrected Results pending state, and CI failure-artifact upload.

### Initial release (2026-11-09)

Initial release.

### App

- Frameless, always-on-top Windows widget with compact and expanded views, dark and light themes, adjustable opacity, and tray-first controls.
- Premier League, Champions League, and combined fixture lists with live scores, kick-off times, and a persisted competition choice.
- Follow clubs across both competitions, with reminders, match-start alerts, optional goal alerts, per-match mute, and notification click-through.
- Match Centre with an Overview timeline, match information, statistics, formation lineups, and filtered commentary.
- Recent results covering the previous 14 days, with independent per-competition fetches and caches.

### Reliability

- Independent fixture and score refreshes and failure backoff; one failed source does not erase the other competition or block the other source.
- Atomic local persistence with validated backup recovery, corruption handling, and a durable notification retry queue.
- Reschedule-aware reminder deduplication, bounded provider response reads, and off-screen window recovery with sleep/resume refresh.

### Platform

- Tauri 2, Rust, React and TypeScript. Settings and cache stay on your device; live scores and match details are fetched from ESPN. No account, API key, analytics or telemetry.
- Windows 10/11 x64 NSIS installer. Unsigned; no auto-updater.
