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
- Match Centre Overview with venue/attendance facts, goal scorers, key-stat
  bars, last-five form (with team-perspective scores), per-team leaders, and a
  full-timeline call to action; the duplicate Latest feed was removed.
- Timeline merging ESPN commentary with key events, grouped by half, with team
  badges, icons and labels for goals, cards, substitutions, shots, corners and
  fouls; key-event filtering and clearly marked half-time section headings keep
  long timelines readable.
- Lineups with a horizontal two-team formation pitch, both formations, shirt
  number markers, home/away tabs, position groups, kickoff starters, substitutes,
  and paired substitutions with provider minutes. Player lists remain the
  accessible name source below the pitch.
- Flashscore-inspired detail hierarchy: centered score and LIVE/HALF-TIME/
  FULL-TIME clock, underlined tabs, split stat bars, and unified tab styling
  across fixtures, Settings, Match Centre and lineup teams.
- Stats tab groups all provider metrics under Overview, Attack, Passing,
  Defending and Discipline; percentage fields render as percentages and
  comparison bars grow from the center. Lime marks the side leading a stat,
  the other side is gray, and the leading value is lime; no team-color mapping.
- Stable 72px fixture rows with a fixed score/clock column, stable scrollbar
  gutter, and one-line truncated club names with full titles/accessible names.
- Compact stoppage-time clock labels (`90+2'`) that fit inside the live pill.
- Official MatchRadar mark used in the header, window/installer icon and
  favicon, with generated multi-size Windows ICO assets.
- Request-count diagnostics for manual refreshes.

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
- MatchRadar is tray-first: the window no longer adds a taskbar button, both the
  minimize and close controls hide it to the tray, clicking the tray icon toggles
  it, and Quit stays in the tray menu. Minimizing from Windows (Win+Down) also
  hides it.
- The score and status stack is centered on the crests instead of hanging below
  them, scroll regions reserve a symmetric gutter so content sits on the window
  centre, and the details freshness line shows on Overview only.
- The competition picker, menu and Match details header show the official ESPN
  league badges for the Premier League and Champions League, theme-aware and with
  the inline glyph kept as an offline fallback.
- Match alerts moved into a bell control in the Match details header with a small
  popover; the large alert panel was removed from Overview, Timeline and Lineups.
- Version is read from `package.json` in the UI; `npm run check:version` enforces
  agreement with `Cargo.toml` and `tauri.conf.json` in local builds and CI.
- Teams labels clarify that Following-only spans every competition and Other
  clubs are outside the Premier League.
- Windows CI skips documentation-only pushes and packages installers only for
  `v*` tags and manual dispatches.
- Launch at sign-in can start hidden in the tray, and `Ctrl+Shift+M` shows or
  hides the widget from anywhere.
- A resumed machine is detected within about half a minute and refreshes scores
  immediately instead of waiting for the next poll, so a woken laptop no longer
  shows stale results until the 30-minute idle delay expires.
- The Playwright suite runs an axe accessibility pass at 320 and 390px in both
  themes alongside the existing layout journeys, and now runs in CI.
- Network and storage work were tightened: gzip HTTP compression (about 12x
  smaller fixture and summary downloads), OS certificate roots, system proxy
  support, 96px crest/badge images instead of 500px assets, cached date
  formatters, and a widget-only IPC snapshot instead of the full 170KB state.
- Match-summary requests refresh at most every two minutes per match, use one
  in-flight request per match, and back off per match instead of blocking every
  summary for a minute after one failure.
- Polling backs off per competition, honours the reminder window so short
  reminders are not skipped, and persists routine score snapshots at most every
  five minutes instead of fsyncing the full state every minute. Retry-After is
  clamped to one hour.
- An unreadable state file with no usable backup now starts with defaults after
  preserving the damaged bytes, instead of preventing the app from launching.
- Results refresh quietly while open, only fetch the selected competition(s),
  and substitution rows without a team are assigned from the player list.
- Tray double-clicks no longer toggle twice, a conflicting Ctrl+Shift+M surfaces
  a message, and the diagnostic log rotates at 1 MB.
- The long-form `docs/` tree, `AGENTS.md`, `HANDOFF.md`, handoff scripts and site
  screenshots were removed; README and this changelog are the documentation.
