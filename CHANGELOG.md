# Changelog

Notable changes to MatchRadar. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions use semantic versioning.

## Unreleased

### Added

- UEFA Champions League support alongside the Premier League: a persisted
  Premier League / Champions League / Both selector, chronological Both view
  with PL/UCL card tags, competition-scoped live counts, a 30-day UCL fixture
  window, per-competition results and detail caches, and followed-team/match
  alerts that keep monitoring both leagues regardless of the selected view.
  Existing Premier League saves, favorites and notification state migrate
  unchanged; the selector defaults to the Premier League.
- Automatic off-screen window recovery: after display removal, DPI/resolution
  changes or restore, a widget with no usable monitor area is re-centered on the
  primary work area. Runs at startup, on focus/scale events, and every 30 seconds
  while running; placement is covered by deterministic unit tests.
- `scripts/build-local.ps1` for local installer builds: loads the Visual Studio
  developer environment, keeps MSVC temp files inside `src-tauri/target`, runs
  the checks, and prints the installer path and SHA-256. Supports `-SkipInstall`
  and `-SkipTests`.

### Changed

- Windows CI skips documentation-only pushes and packages the installer only for
  `v*` tags and manual dispatches.
- Documentation is split into current reference and dated reports under
  `docs/archive/`; obsolete demo-mode reports and the superseded Match Centre
  plan were removed.
- `AGENTS.md`, README, and validation notes now describe the local-first
  workflow, tag-gated packaging, and current build prerequisites.

## [1.0.0] — 2026-11-05

Private release for repository collaborators.

### Added

- Tauri Windows widget with dark and light themes, compact mode, tray controls,
  favorites, filtering, and match details.
- On-demand Match Centre with provider-supported timeline, statistics, and
  lineups, plus a separately cached recent Results view.
- ESPN Premier League fixture and score integration with independent refresh and
  freshness tracking, offline cache, and clear labels for unconfirmed scores.
- Followed-team and per-match alerts, persistent deduplication, and bounded
  retries for notification submissions.
- Frontend and Rust regression tests and a Windows CI workflow that builds and
  uploads an NSIS installer.

### Changed

- State persistence uses atomic replacement, validated backups, and corruption
  recovery; optimistic settings reconcile independently of feed updates.
- Successful fixture or score responses are preserved when the other source
  fails.
- Navigation, keyboard focus, date groups, match cards, alert controls, and
  loading, empty, and error states were refined.
- Browser context menus and accidental selection are suppressed on static
  surfaces while input and diagnostic text remain usable.

See the [validation notes](docs/VALIDATION.md) for build evidence and outstanding
native runtime checks.
