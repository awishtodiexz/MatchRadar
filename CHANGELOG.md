# Changelog

Notable changes to MatchRadar. All local builds remain version **1.0.0** until
the first public release; the sections below describe the complete local feature
set.

## [1.0.0] — 2026-11-07

### Added

- Tauri Windows widget with dark and light themes, compact mode, tray controls,
  favorites, filtering, and match details.
- ESPN Premier League fixture and score integration with independent refresh and
  freshness tracking, offline cache, and clear labels for unconfirmed scores.
- On-demand Match Centre with provider-supported Overview, timeline, statistics,
  lineups, and a separately cached recent Results view.
- Followed-team and per-match alerts, persistent deduplication, and bounded
  retries for notification submissions.
- UEFA Champions League support alongside the Premier League: a persisted
  Premier League / Champions League / Both selector, chronological Both view
  with PL/UCL card tags, competition-scoped live counts, a 30-day UCL fixture
  window, per-competition results and detail caches, and followed-team/match
  alerts that keep monitoring both leagues regardless of the selected view.
- Unified club following across competitions: ESPN uses the same team IDs for a
  club in the Premier League and Champions League, so following Arsenal once
  covers both. Settings → Teams groups **Followed clubs**, **Premier League
  clubs**, and a collapsed **Other clubs** list, with search across all groups.
- Automatic off-screen window recovery after display removal, DPI/resolution
  changes, or restore, covered by deterministic unit tests.
- `scripts/build-local.ps1` for unsigned local NSIS builds and
  `scripts/release-local.ps1` for guarded local releases.
- Match Centre Overview with goal scorers, key stats, venue, and an event count;
  the duplicate Latest feed was removed.
- Timeline merging ESPN commentary with key events, grouped by half, with team
  badges and labels for goals, cards, substitutions, shots, corners and fouls.
- Lineups with home/away tabs, formation, shirt numbers, position groups,
  kickoff starters, substitutes, and paired substitutions with provider minutes.
- Flashscore-inspired detail hierarchy: centered score and LIVE/HALF-TIME/
  FULL-TIME clock, underlined tabs, split stat bars, and unified tab styling
  across fixtures, Settings, Match Centre and lineup teams.
- Stats tab groups all provider metrics under Overview, Attack, Passing,
  Defending and Discipline; percentage fields render as percentages and
  comparison bars grow from the center for both teams.
- Stable 72px fixture rows with a fixed score/clock column, stable scrollbar
  gutter, and one-line truncated club names with full titles/accessible names.
- Compact stoppage-time clock labels (`90+2'`) that fit inside the live pill.
- Official MatchRadar mark used in the header, window/installer icon and
  favicon, with generated multi-size Windows ICO assets.
- Request-count diagnostics for manual refreshes and a documented
  [local release process](docs/RELEASING.md).

### Changed

- State persistence uses atomic replacement, validated backups, and corruption
  recovery; optimistic settings reconcile independently of feed updates.
- Successful fixture or score responses are preserved when the other source
  fails.
- Navigation, keyboard focus, date groups, match cards, alert controls, and
  loading, empty, and error states were refined.
- Browser context menus and accidental selection are suppressed on static
  surfaces while input and diagnostic text remain usable.
- The live minute moved out of the score line: cards show a compact clock beside
  the scores, and Match details centers the score with a live status beneath it.
- Match alerts moved into a bell control in the Match details header with a small
  popover; the large alert panel was removed from Overview, Timeline and Lineups.
- Version is read from `package.json` in the UI; `npm run check:version` enforces
  agreement with `Cargo.toml` and `tauri.conf.json` in local builds and CI.
- Teams labels clarify that Following-only spans every competition and Other
  clubs are outside the Premier League.
- Windows CI skips documentation-only pushes and packages installers only for
  `v*` tags and manual dispatches.
- Documentation is split into current reference and dated reports under
  `docs/archive/`; AGENTS.md, README, and validation notes describe the
  local-first workflow.

See the [validation notes](docs/VALIDATION.md) for build evidence and outstanding
native runtime checks.
