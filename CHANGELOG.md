# Changelog

Notable changes to MatchRadar. The format follows [Keep a Changelog](https://keepachangelog.com/),
and versions use semantic versioning.

## Unreleased

## [1.2.0] — 2026-11-07

### Added

- Match Centre Overview now shows goal scorers with minutes and teams, compact key stats (possession, shots, on target, corners), and the venue instead of only a venue and event count; the duplicate Latest feed was removed.
- Timeline merges ESPN's full commentary with key events, groups by half/period, drops untimed boilerplate, and labels goals, cards, substitutions, shots, corners and fouls with team badges.
- Lineups use home/away tabs and show formation, shirt numbers, position groups, substitutes, and on/off markers with the provider's substitution minute; the Starting XI is labelled as the kickoff lineup.
- Match details follows the Flashscore pattern: centered score with a centered LIVE/HALF-TIME/FULL-TIME clock, underlined section tabs, and comparison bars on supported statistics.
- Fixture rows use a stable scrollbar gutter, a fixed centered score/clock column and a uniform 72px height across All/Live/Following/Upcoming/Results; list team names truncate to one line with full names retained in the title/accessible label.
- All tab strips (fixture filters, Settings, Match Centre and lineup teams) use the Flashscore underline pattern.
- Lineups add an explicit Substitutions list pairing each player on with the player they replaced and the provider minute, plus compact ↑/↓ markers in the player rows.
- `scripts/release-local.ps1`: builds the installer, prints its SHA-256 and, with `-Publish`, creates a GitHub release from the local asset after requiring a clean tree and unused tag.
- Request-count diagnostics for manual refreshes and a documented [local release process](docs/RELEASING.md).

### Changed

- The live minute moved out of the score line: cards show a compact clock pill beside the scores, and Match details shows a LIVE/HALF-TIME/FULL-TIME status pill beside the competition.
- Match alerts moved into a bell control in the Match details header with a small popover; the large alert panel was removed from Overview, Timeline and Lineups.
- Version is read from `package.json` in the UI; `npm run check:version` enforces agreement with `Cargo.toml` and `tauri.conf.json` in local builds and CI.
- Teams labels clarify that Following-only spans every competition and Other clubs are outside the Premier League.

## [1.1.0] — 2026-11-06

### Added

- UEFA Champions League support alongside the Premier League: a persisted
  Premier League / Champions League / Both selector, chronological Both view
  with PL/UCL card tags, competition-scoped live counts, a 30-day UCL fixture
  window, per-competition results and detail caches, and followed-team/match
  alerts that keep monitoring both leagues regardless of the selected view.
  Existing Premier League saves, favorites and notification state migrate
  unchanged; the selector defaults to the Premier League.
- Unified club following across competitions: ESPN uses the same team IDs for a
  club in the Premier League and Champions League, so following Arsenal once
  covers both. Settings → Teams now groups **Followed clubs**, **Premier League
  clubs**, and a collapsed **Other clubs** list (discovered UCL sides), with
  search across all groups and focus retained when a club moves.
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
