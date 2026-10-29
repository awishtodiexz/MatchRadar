# Match Centre evolution — integration and hardening report

## Status

The implementation on `feature/premier-league-match-centre` has passed the available frontend and browser checks. **Windows-native compilation and the full Rust suite remain unverified.** No push, GitHub workflow, installer build, merge or release was performed. This is ready for an authorized Windows CI validation cycle, not native runtime acceptance.

Initial checkpoints reviewed: `816a03f` (delivery tests moved unchanged) and `acaa89a` (Match Centre and fixture views). The pending README, changelog, screenshot and AGENTS.md proposals are preserved separately. The hardening checkpoint SHA is reported in the conversation and available in the local Git log.

## Verified data and scope

On 29 October 2026, actual ESPN `eng.1` scoreboard requests returned no fixtures for `dates=20261029` and 38 for `dates=202610`, all scheduled or full-time. Summary `401878764` (25 October, completed) contained 27 key events, two roster groups and 28 statistics per team. Upcoming summary `401879250` (31 October) contained no key events and four season statistics per team. **No live or halftime fixture was observable.**

Checked-in reduced recordings `tests/fixtures/summary-completed.json` (`401879268`, completed Arsenal–Leeds) and `summary-upcoming.json` (`401879250`) are genuine earlier captures, not recordings of live/halftime play. They omit odds, articles, images and outbound links. Browser rendering used these recorded data through a controlled SDK IPC mock. Clock/visibility/error and unusually long-text inputs are explicitly synthetic stress cases, not football facts. Unit tests never call ESPN.

Only Premier League requests are supported. No selectors, standings, other competitions or historical-window expansion were added. Results browses the existing fixture cache, not a historical archive. Provider ownership and redistribution permissions remain unresolved; captures confer no licensing rights.

## Completed integration fixes

| Confirmed issue | Fix and regression evidence |
| --- | --- |
| Repeated summary requests during cooldown could keep extending it | Check the existing deadline before invoking transport, without advancing it; deterministic cache/deadline tests |
| A clock moving backward could keep a cached summary fresh indefinitely | Negative ages require revalidation; controlled-clock test |
| Malformed/oversized persisted detail entries could survive shallow validation | Validate identifiers, timestamps, collection/string bounds, event clock/period, and deduplicate/bound restored entries; corrupt-entry test |
| Retry or status-effect changes cleared useful visible details | Retain same-match data during retry; mark it saved on IPC failure; never retain it for another ID/demo mode; frontend tests |
| Detail polling continued while the document was hidden | Suspend timers while hidden; reconcile on visibility return; deterministic frontend test |
| Summary response shape accepted an empty competition array | Require matching identity, a nonempty competition list and status object; malformed-response tests |
| Missing event clocks were silently ordered as zero | Skip malformed clock/period entries; retain explicit provider stoppage-time labels |
| Cosmetic section buttons lacked tab keyboard semantics | Selected tab/panel relations, roving tab stop, Arrow keys, Home/End; unit and actual browser key tests |
| An empty timeline message appeared while loading | Loading skeleton and source error remain separate from a valid unavailable-data state |
| Alert panel pushed football sections below the compact view | Match Centre precedes the unchanged match-alert panel in the single Details scroll region |
| Unbroken provider names/text overflowed a 320px row | Scoped wrapping/min-width rules for lineup, event and statistic content; browser stress verification |
| Manual Refresh could bypass provider backoff and enqueue a duplicate during a fetch | Coalesce active refreshes and enforce a monotonic request gate; deterministic gate tests |
| Explicit Retry-After values above one hour were shortened | Keep the server delay; chunk only timer sleeps, including extreme headers, without shortening the deadline |

The summary transport now reuses its HTTP client and has a small injectable result/clock boundary. Production still uses Rust HTTP requests with a 15-second timeout and a four-megabyte streaming body limit. HTTP failures include query identity/status in diagnostics, without response dumps. The 24-entry cache reuses active summaries for 60 seconds and other summaries for 15 minutes. It persists through F01, retains valid data offline and does not create notifications or change scoreboard scores. The cache lock serializes concurrent requests; simultaneous fresh requests share one result. Different matches may wait behind an earlier request for up to its timeout.

## Tests and validation

- **57 frontend tests passed** across 11 files; all 45 original regression tests remain in the suite.
- ESLint and TypeScript/Vite production build passed; no dependencies, native capabilities or workflows changed.
- Rust formatting and diff checks passed.
- `rustc --test --emit=metadata` successfully type-checked the dependency-free scheduling module and its three tests. This does not execute those tests or compile the Tauri application.
- Full Rust tests and native Cargo compilation were **not executed** because the MSVC linker remains unavailable. No large toolchain was installed. There are 75 Rust test declarations in the current source; this is a static count, not a passing result. Earlier successful CI runs do not validate these new changes.
- Summary tests cover captured parsing, season-stat suppression, duplicate/order handling, missing/zero values, malformed JSON/HTTP/identity/shape, timeout/offline fallback, freshness/cooldown recovery, restart seeding, future timestamps, cache bounds, corrupt entries and concurrent request deduplication. A new F01 disk recovery test verifies cached details, preferences and pending/sent notification records survive backup restoration; it remains unexecuted until native validation.
- Frontend additions cover rapid navigation, mismatched native IDs, cached-data retry/failure, demo transitions, active timer cleanup, visibility suspension, supported sections and keyboard tab behavior.

## Browser verification

The shared preview supplied real UI screenshots but its matrix evaluation timed out after 15 seconds, followed by a missing-element error. The matrix was completed in an isolated headless Edge session using the actual Vite app, controlled SDK responses and recorded Premier League data. It performed no Windows API or ESPN operation.

**213 states passed:** 208 combinations covering 320/390px, compact 460px/expanded 700px, Dark/Light, 70/100% opacity, five Home filters, four supported Details sections and four Settings tabs; plus long unbroken player/event strings and summary loading/error/unavailable states. No document overflow, hidden footer, nested content scroll regions, overflowing reviewed rows or page exceptions were detected. The sampled scored cards remained **86px** high. Home filter changes made zero summary requests. Foreground opacity remained 1.

Actual Edge key events verified Enter into Details, focus on the heading, ArrowRight/End section selection, Escape back and originating-card focus restoration. Reduced-motion emulation disabled the loading shimmer. Representative screenshots and the matrix JSON are temporary evidence in `%TEMP%/matchradar-centre-hardening/`, not committed product assets. These checks do not validate WebView2, native window dimensions, Windows DPI/text scaling, Narrator or OS notification display.

## Preservation and compatibility

F01 persistence, F02 store ordering, F03 refresh merging, F04 planning/delivery, native settings models and match-card production code are unchanged from the initial checkpoint. Detail cache defaults maintain old snapshot compatibility. New summary observations never feed goal/start baselines. Cosmetic settings do not wake the poller; detail refresh remains independent and stops on navigation/visibility loss. No new state authority, database, credentials or remote scripts were introduced.

## Remaining limitations

- Windows CI must compile/run the complete Rust suite, including async cache tests, and package the native app before this branch can be accepted.
- Actual live/halftime summaries, corrected provider event payloads, explicit VAR/own-goal/penalty variants and lineups near kickoff need observations when available. Synthetic status changes cannot establish those schemas.
- Native HTTP/OS behavior is not proven by the injectable transport tests. Test actual timeouts, 429 headers and sleep/resume on Windows.
- Cooldowns are process-local; restarting the app does not persist a provider deadline. Summary and scoreboard cooldowns are separate. No retry jitter or notification enrichment was added.
- The cache serializes different-match requests, and non-active summaries retain a 15-minute TTL. These are conservative choices, not measured performance guarantees.
- A browser size/opacity matrix is not a Windows DPI, accessibility text-scaling or wallpaper-contrast certification. Narrator remains untested.

## Packaged Windows acceptance checklist

1. Run all frontend and Rust gates on this exact branch head in Windows CI, then build/install the NSIS artifact. Record commit, OS, WebView2 and scaling versions. Do not reuse an earlier installer as evidence.
2. Open genuine upcoming and completed fixtures; compare teams, event identity/order, stoppage time, zero/missing statistics and starters against the provider. Repeat with live/halftime data when available.
3. Browse Home without opening Details and confirm no summary calls. Open, close and rapidly switch matches; verify deduplication, late-response suppression, visibility pause and no scoreboard-score replacement.
4. Test both themes/opacity endpoints at 320/390px, compact/expanded, 125%/150% DPI and text scaling, long names, many events and reduced motion. Verify fixed chrome and one content scroller.
5. Verify keyboard tabs, Escape/back focus and scroll restoration, Narrator names, independent bells, input selection/copy/paste and static-surface context-menu suppression.
6. Simulate summary/scoreboard timeouts, malformed responses, 429 numeric/HTTP-date headers and repeated manual refreshes. Preserve cache/error freshness; confirm no requests before the cooldown expires.
7. Reopen details offline and after restart. Exercise persistence failure/corruption recovery in a test profile; verify favorites, themes, sizing, subscriptions, pending queue, sent IDs and baselines survive.
8. Recheck tray/minimize/restore, autostart, sleep/resume, monitor changes and native notification submission/retry. Successful API submission does not prove OS display or exactly-once delivery.
