# Changelog

## 1.0.0 — 2026-11-09

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
