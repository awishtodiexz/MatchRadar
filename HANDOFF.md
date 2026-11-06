# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: 2026-11-06 13:22 (+02:00)
- Branch: main
- Recent: e273772 feat: unify club following and organize Teams settings | ea7f873 feat: add UEFA Champions League support | b4a2183 docs: record local window-recovery runtime evidence
<!-- snapshot:end -->

## Objective

MatchRadar 1.1.0 (Premier League + Champions League, unified following, window recovery) is committed, built locally as an unsigned NSIS installer, and published as a downloadable GitHub release.

## Next steps

1. Install `MatchRadar_1.1.0_x64-setup.exe` and run the packaged Windows acceptance: selector persistence, Teams groups at 320/390px, following a non-PL club, UCL Match Centre/Results, alerts and tray delivery while viewing the other competition, DPI/monitor/sleep-resume checks.
2. Verify UCL live/halftime summary shapes when a live UCL fixture is available.
3. Review signing, licensing and public-distribution decisions before a public release.

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
- v1.1.0 is packaged locally (unsigned, SHA-256 `ABCA3D48AB8379977ABB52C563D2BBFE852D28ED6FD12A35D192DCAEED8AF641`) and attached to https://github.com/awishtodiexz/MatchRadar/releases/tag/v1.1.0; no Actions artifact is used for the release asset.

## Commands

- `npm run verify:fast` — lint, 88 frontend tests, production build.
- `npm run verify:ui` — 28 Playwright journeys at 320/390px in both themes.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` — 107 Rust tests (use the Visual Studio developer environment with `TEMP` under `src-tauri/target`, as `build-local.ps1` does).
- `.\scripts\build-local.ps1` — local NSIS installer.
- `.\scripts\handoff.ps1 -Check` — verify handoff freshness.
- `.\scripts\handoff.ps1 -Check -Strict` — also fail on uncommitted work (use at session start).
- `git push origin main` — publish (requires user approval).
