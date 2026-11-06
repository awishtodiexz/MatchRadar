# Changelog

Notable changes are recorded here.

## Unreleased

- Added `scripts/build-local.ps1` for local installer builds: it loads the Visual Studio developer environment, keeps MSVC temp files inside the ignored target directory, runs the checks, and prints the installer path and SHA-256.
- Windows CI now skips documentation-only pushes and builds/uploads the installer only for `v*` tags and manual dispatches.
- Archived dated reports under `docs/archive/` and removed obsolete demo-mode and Match Centre plan documents.

## 1.0.0 — 2026-11-05

Private release for repository collaborators.

- Built a Tauri Windows widget with dark and light themes, compact mode, tray controls, favorites, filtering, and match details.
- Added an on-demand Match Centre with provider-supported timeline, statistics and lineups, plus separately cached recent Results.
- Added ESPN Premier League fixture and score integration, separate refresh and freshness tracking, and an offline cache.
- Added followed-team and per-match alerts, persistent deduplication, and bounded retries for notification submissions.
- Hardened state persistence with atomic replacement, validated backups, and corruption recovery; reconciled optimistic settings independently of feed updates.
- Preserved successful fixture or score responses when the other source fails and distinguished saved scores from confirmed live data.
- Refined navigation, keyboard focus, date groups, match cards, alert controls, and loading, empty, and error states.
- Suppressed browser context menus and accidental selection on static surfaces while retaining input and diagnostic text interaction.
- Added frontend and Rust regression tests and a Windows CI workflow that builds and uploads an NSIS installer.

See [validation notes](docs/VALIDATION.md) for build evidence and outstanding native runtime checks.
