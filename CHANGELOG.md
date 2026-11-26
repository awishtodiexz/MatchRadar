# Changelog

All notable changes to MatchRadar are documented here. This project follows semantic versioning.

## [1.0.3] - 2026-11-26

### Fixed

- Correct live match and fixture recovery across UTC midnight, postponed or cancelled fixtures, and matches that disappear while open in Match Centre.
- Announce kickoff and the first goal when ESPN first reports a match live with a non-zero score.
- Preserve repeated commentary events, order mixed commentary and key events safely, and parse scorers, own goals, initials, and assist text correctly.
- Keep predictor percentages summing to 100 and bound malformed match scores.
- Keep scheduled matches in the ticker through the kickoff confirmation grace period.
- Stop background detail and results polling while the widget is hidden in the tray or started hidden.
- Recover transient detail-cache and notification persistence failures instead of leaving stale or unsent state on disk.
- Prevent notification queue overflow from consuming alert baselines and flush acknowledgement or backoff saves after queue drains.
- Trigger reminders immediately when a match bell is enabled inside the reminder window.
- Keep manual refresh retries available after errors and separate the spinner from the cooldown state.
- Correct inverted form scores, `CF-L` and `CF-R` lineup rows, null-score finished matches, unchecked-competition empty states, and the duplicate local timezone badge.
- Close floating card menus on scroll and keep form tooltips inside narrow layouts.
- Disable Settings controls while settings are unavailable and hide the dead Retry button in browser preview mode.
- Restore ticker window size safely when resize fails and handle Windows DPI changes without clipping.
- Defer startup loading until native event listeners are registered and wake polling reliably after system resume.

### Changed

- Reduce persistence churn by batching live match-detail writes, writing first, final, and recovered details immediately, and pruning dead detail-cache entries before truncation.
- Reduce render and formatting work in match cards and previews.

### Internal

- Added 57 regression tests across Rust and React.
- Expanded browser, accessibility, concurrency, persistence, and benchmark verification.

## [1.0.2] - 2026-11-25

### Fixed

- Finished ticker matches now show final scores instead of stale kickoff times.
- Postponed and cancelled matches no longer present old kickoff times as current.
- Scoreless terminal matches expose their real status instead of a misleading score.
- Pre-match lineup copy now says lineups appear when announced.
- Team-code fallbacks no longer duplicate codes when crest images are unavailable.
- Settings saves now recover correctly after a failed reconciliation read.
- Refresh state remains consistent after backend mutex recovery.
- Windows startup rewrite failures are written to the durable provider log.

### Changed

- Background polling, notification, shortcut, window, and resume tasks are supervised.
- Notification delivery avoids redundant persistence writes while preserving retry durability.

### Security

- Removed the unused asset protocol from the Content Security Policy.
- Replaced broad Tauri permissions with the specific capabilities the widget uses.

## [1.0.1] - 2026-11-25

### Fixed

- Restore ticker mode after relaunch and return to the remembered expanded window size.
- Preserve ticker exit, list, Settings, and Match Centre focus reliably across refreshes and notification navigation.
- Show penalty shootout tallies and winners correctly on cards and in copied scores.
- Keep a failed refresh retryable while preventing successful repeated clicks from becoming silent no-ops.
- Rotate `provider.log` correctly on Windows when a previous rotated log already exists.
- Prune stale score-tracking state and bound match-detail metadata during long-running sessions.
- Version persisted snapshots and refuse to overwrite state created by a newer MatchRadar version.
- Harden snapshot recovery, atomic writes, notification queuing, alert expiry, and score freshness handling.
- Preserve cached fixtures, results, details, and user preferences across partial provider failures.
- Correct numerous accessibility, keyboard navigation, empty-state, compact-layout, and reduced-motion behaviors.

### Changed

- Reduce match-card rendering work and expose the rendering benchmark as `npm run verify:bench`.
- Improve Results, ticker, match-detail, and notification-navigation behavior across both competitions.
- Release tooling now reports installer provenance, checksum, tag state, and Authenticode signature status before publishing.
- CI and the local build now include formatting, strict Clippy, frontend, Rust, browser, accessibility, and native Windows acceptance coverage.

### Internal

- Added replayed ESPN scoreboard contract tests and expanded persistence, notification, ticker, reliability, motion, and browser journey coverage.
- Added a native Windows acceptance checklist and release documentation.

## [1.0.0] - 2026-11-12

- Initial public Windows release.
