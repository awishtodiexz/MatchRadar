# Changelog

## 1.0.0 — 2026-11-12

Initial public release.

### Widget

- Frameless, always-on-top Windows widget with compact and expanded views, dark and light themes, adjustable opacity, and tray-first controls.
- Premier League, Champions League, and combined fixture lists with live scores, one-line 12-hour kick-off times, and a persisted competition choice.
- Recent results covering the previous 14 days, with independent per-competition fetches and caches.
- Honest status: a `CHECKING LIVE` state for competitions not yet checked, recovery from a failed first load, and a footer that shows when updates resume while ESPN is rate limiting requests.

### Match Centre

- A match header with crests on soft rings, a dominant score or kick-off time with a status chip (`Kick-off · Today`, live, full-time, postponed), and the beaten side dimmed after full-time.
- Overview: a compact incident timeline by half with stoppage-time ordering and VAR/key-event labels; match information listing only the facts ESPN supplied; form as one row per team with a W/D/L record; team leaders as a head-to-head per category.
- Statistics with comparison bars and accessible sticky headers, formation lineups with keyboard navigation, and filtered commentary with clear counts and empty-filter recovery.
- Explicit postponed, cancelled, suspended, abandoned, forfeit and unknown states. Champions League knockout ties show leg and aggregate.

### Following and alerts

- Follow clubs across both competitions, with reminders, match-start alerts, optional goal alerts, per-match mute, and notification click-through.
- Reminders survive provider outages and are re-planned after preference changes; newer goals supersede older pending scores; delayed kick-offs get a bounded start-alert grace period, and matches past kick-off but still listed as scheduled are checked every minute.
- Forfeits and abandoned matches never trigger goal alerts.

### Reliability

- Independent fixture and score refreshes with failure backoff; one failed source does not erase the other competition or block the other source.
- Defensive ESPN parsing: unplayed fixtures never report 0–0, shootout and disallowed goals are excluded from scorers, suspended matches are rechecked, provider text and response sizes are bounded, and crest URLs must match the club.
- Atomic local persistence with validated backup recovery, corruption handling, and a durable notification retry queue. Quitting from the tray saves fixtures, alert baselines and freshness first.
- Off-screen and hidden-window recovery, restored-size handling, sleep/resume refresh and placement recovery, and bounded global-shortcut retry.

### Platform

- Tauri 2, Rust, React and TypeScript. Settings and cache stay on your device; live scores and match details are fetched from ESPN. No account, API key, analytics or telemetry.
- Windows 10/11 x64 NSIS installer. Unsigned; no auto-updater.
- MIT licensed.
