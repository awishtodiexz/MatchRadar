# Changelog

All notable changes to MatchRadar are documented here. This project follows semantic versioning.

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
