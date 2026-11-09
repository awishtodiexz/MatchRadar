# Changelog

Notable changes to MatchRadar. The app is currently version **1.0.0**; unreleased
sections describe fixes on `main` since the last build.

## Reliability review fixes (unreleased)

- Serialized background saves with preference/notification writes, preventing older
  snapshots from replacing acknowledged settings. Startup resets only proven
  corrupt state after archiving both copies; read/recovery failures preserve saves.
- Final matches bypass live/pregame summary caches and reconcile every minute
  until the provider confirms final details.
- Results and opened match scores prefer the most recent individual score
  confirmation, including corrected history and partial provider responses.
- Daily-score rate limits now pause subsequent competition requests on the shared
  host, including HTTP 429 responses without Retry-After.
- Fixed possession values at or below 1%, defensive midfielder grouping, and
  missing off-times for substitutes who subsequently leave the pitch.

## Match Overview and numbered lineups (unreleased)

- Live match details now use a one-minute cache, matching live score polling.
- Removed the repeated status headline from Overview. It now shows compact,
  chronological goals, cards and substitutions grouped by half, with verified
  running/period scores when incidents reconcile with the scoreboard.
- Removed the statistics preview and repeated commentary link from Overview;
  the four tabs keep their own purpose. Card incidents show type and reported
  reason, and substitutions label players on/off.
- Goal events use black-and-white football icons in Overview and Commentary.
- Added referee, stadium/city, capacity and attendance rows; unavailable fields
  are marked explicitly rather than guessed.
- Added match-specific extended statistics (including xG, chances, shot locations,
  duels and recoveries), precise percentages and a category selector. Optional
  feed failures retain the base summary and label any saved extended metrics.
- Commentary keeps longer descriptions, stoppages and pre/post-match context,
  merges duplicate provider IDs, and supports event-type and ordering filters.
- Form and team leaders are available in an expandable supporting section,
  opened initially before kick-off.
- Lineups use shirt numbers throughout. Removed player photos, external portrait
  lookups, retries, counters, toggles and the extra image-host permission.

## Missed goal alert fix (unreleased)

- A newly confirmed goal is also reported when the same daily scoreboard update
  marks full-time. Old results and later edits to finished scores remain excluded.
- Enabling or re-enabling a match bell now keeps tracking from a recent confirmed
  score instead of silently consuming the next goal as a new baseline.
- Preserved suppression of historical goals, stale observations, score corrections
  and duplicate deliveries, including across restarts.

## Notification click fix (unreleased)

- Alert banners carry their match ID and register click handling before delivery.
  A click restores and focuses the widget, opening that match's Overview even
  when the active competition or followed-club filters hide it.
- Acknowledged pending destinations survive webview startup; overlapping clicks
  retain the latest destination. Expired matches show an availability message.
- Windows clicks are supported while the banner remains on screen; the current
  plugin does not report clicks from Notification Centre.

## Local UI overhaul (unreleased)

- Unified the charcoal/lime and light themes with shared spacing, typography,
  section bands, tabs, controls and flatter fixture rows.
- Replaced the repeated match headings with one scoreboard, a compact score
  strip on scroll and sticky Overview, Stats, Lineups and Commentary navigation.
- Commentary orders the full provider feed newest first, with an optional
  key-events filter.
- Lineups show a selected-team vertical pitch with shirt numbers and names;
  incomplete formation data falls back to the player list.
- Overview and full statistics share percentage formatting.
- Restyled Settings and loading, empty, saved-data and error states to match.
- Added an explicit coach-availability row. Match feeds without coaches are labelled.
- Fixed scored penalties being misidentified as red cards and used provider
  position codes to arrange formation lines.

## 1.0.0 build — 2026-11-08

- Removed the duplicate visible team/statistic header from Match Centre Stats while retaining accessible column names.
- Build tags are commit-specific, target the exact main commit and record the installer SHA-256, so a rebuild does not move an existing tag.

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
- Live match-summary requests refresh at most once per minute per match, use one
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
- README and this changelog are the user-facing documentation.
