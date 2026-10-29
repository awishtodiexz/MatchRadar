# Changelog

Notable changes are recorded here. MatchRadar reports version **1.0.0**, which remains a release candidate rather than a public release.

## Unreleased — 1.0.0 release candidate

- Built a Tauri Windows widget with dark and light themes, compact mode, tray controls, favorites, filtering, and match details.
- Added an on-demand Match Centre with provider-supported timeline, statistics and lineups; a labelled fictional demo and separately cached recent Results make it testable outside matchday.
- Added ESPN Premier League fixture and score integration, separate refresh and freshness tracking, offline cache, and labelled demo data.
- Added followed-team and per-match alerts, persistent deduplication, and bounded retries for notification submissions.
- Hardened state persistence with atomic replacement, validated backups, and corruption recovery; reconciled optimistic settings independently of feed updates.
- Preserved successful fixture or score responses when the other source fails and distinguished saved scores from confirmed live data.
- Refined navigation, keyboard focus, date groups, match cards, alert controls, and loading, empty, and error states.
- Suppressed browser context menus and accidental selection on static surfaces while retaining input and diagnostic text interaction.
- Added frontend and Rust regression tests and a Windows CI workflow that builds and uploads an NSIS installer.

See [validation notes](docs/VALIDATION.md) for build evidence and outstanding native runtime checks.
