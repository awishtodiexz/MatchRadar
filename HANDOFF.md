# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: 2026-11-07 18:27 (+02:00)
- Branch: main
- Recent: ef18713 feat: redesign match details for 1.2.0 | 312fc23 chore: add version checks, release tooling and refresh diagnostics | 33fb413 release: MatchRadar 1.1.0
<!-- snapshot:end -->

## Objective

MatchRadar 1.2.0 match-detail refinement is built locally as an unsigned installer (3,418,597 bytes, SHA-256 7DE87EBC...): no duplicate Latest feed, header alert popover, inline live clock, and substitution minutes in lineups. It is not published or pushed.

## Next steps

1. Install `MatchRadar_1.2.0_x64-setup.exe` and run packaged Windows acceptance: Overview/Timeline/Lineups at 320/390px, live status pill, compact alerts, selector persistence, Teams groups, following a non-PL club, UCL Results, alerts/tray while viewing the other competition, DPI/monitor/sleep-resume checks.
2. Verify UCL live/halftime summary shapes when a live UCL fixture is available (Premier League live/halftime was observed on 7 November).
3. Decide whether to push `main` and publish 1.2.0, and review signing, licensing and public-distribution decisions.

## Blockers

- The packaged app cannot be launched from the coding-agent sandbox; native runtime checks need the user. No live UCL fixture was available to verify live/halftime summaries.

## Decisions

- Local-first: edit and commit locally; push only when the user authorizes it.
- CI runs checks on pushes and PRs and packages installers only on `v*` tags or manual dispatch.
- Demo mode was removed; dated reports live in `docs/archive/`.
- HANDOFF is the cross-session state file; AGENTS.md documents how to read and update it.
- UCL reuses the same provider/normalizer with competition configuration; each match stores its league, detail-cache keys are `slug:id`, and per-competition status lives under `leagueStatus` with legacy aggregate fields derived from it. Existing saves default to the Premier League.
- ESPN event IDs are globally allocated; the stored competition keeps attribution and cache isolation explicit without rewriting legacy match IDs.
- ESPN team IDs are identical for clubs in both competitions (verified against the real PL/UCL team feeds), so favorites remain one ID list and need no mapping. Match bells stay independent.
- Teams groups Followed clubs, Premier League clubs (static catalog plus any PL fixture participant), and a collapsed Other clubs list for discovered non-PL sides; search spans all groups.
- v1.1.0 remains the published release (unsigned, SHA-256 `ABCA3D48AB8379977ABB52C563D2BBFE852D28ED6FD12A35D192DCAEED8AF641`); v1.2.0 is built locally with SHA-256 `7DE87EBC7DC26F6A1DFAAD255A74E41DE344CFADC579DC696DA25965947C963B` and not published.
- Match details merge commentary only with a clock, require provider period or derive it from half text/clock, extract scorers/formation/jersey/subs, and show substitution minutes from provider substitution events with safe defaults for older caches.
- Match alerts live behind a header bell popover; Overview no longer duplicates Timeline with a Latest feed. Version 1.2.0 is local-only.
- The UI reads its version from `package.json`; `npm run check:version` enforces Cargo/Tauri agreement in `verify:fast`, local builds and CI. `scripts/release-local.ps1` builds, hashes and optionally publishes the local asset.
- Manual refresh measured 5 scoreboard requests; a 60s debug-build sample held at ~101 MB working / ~9 MB private with stable threads. These are short debug measurements, not packaged-release numbers.

## Commands

- `npm run verify:fast` — lint, 90 frontend tests, production build.
- `npm run verify:ui` — 28 Playwright journeys at 320/390px in both themes.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` — 108 Rust tests (use the Visual Studio developer environment with `TEMP` under `src-tauri/target`, as `build-local.ps1` does).
- `.\scripts\build-local.ps1` — local NSIS installer.
- `.\scripts\handoff.ps1 -Check` — verify handoff freshness.
- `.\scripts\handoff.ps1 -Check -Strict` — also fail on uncommitted work (use at session start).
- `git push origin main` — publish (requires user approval).
