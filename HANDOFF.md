# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: 2026-11-06 12:51 (+02:00)
- Branch: main
- Recent: b4a2183 docs: record local window-recovery runtime evidence | 1444f11 docs: pair the widget and Match Centre screenshots | 4582bf5 docs: refresh README presentation
<!-- snapshot:end -->

## Objective

Premier League + Champions League support: competition selector, per-competition polling/results/details and cross-competition alerts are implemented and locally verified against real ESPN data.

## Next steps

1. Run packaged Windows acceptance for both competitions: selector persistence across restart, UCL Match Centre and Results, alerts and tray delivery while viewing the other competition, DPI/monitor/sleep-resume checks.
2. Verify UCL live/halftime summary shapes when a live UCL fixture is available.
3. Push only when the user authorizes it; no installer was built for this change.

## Blockers

- The packaged app cannot be launched from the coding-agent sandbox; native runtime checks need the user. No live UCL fixture was available to verify live/halftime summaries.

## Decisions

- Local-first: edit and commit locally; push only when the user authorizes it.
- CI runs checks on pushes and PRs and packages installers only on `v*` tags or manual dispatch.
- Demo mode was removed; dated reports live in `docs/archive/`.
- HANDOFF is the cross-session state file; AGENTS.md documents how to read and update it.
- UCL reuses the same provider/normalizer with competition configuration; each match stores its league, detail-cache keys are `slug:id`, and per-competition status lives under `leagueStatus` with legacy aggregate fields derived from it. Existing saves default to the Premier League.
- ESPN event IDs are globally allocated; the stored competition keeps attribution and cache isolation explicit without rewriting legacy match IDs.

## Commands

- `npm run verify:fast` — lint, 82 frontend tests, production build.
- `npm run verify:ui` — 28 Playwright journeys at 320/390px in both themes.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` — 107 Rust tests (use the Visual Studio developer environment with `TEMP` under `src-tauri/target`, as `build-local.ps1` does).
- `.\scripts\build-local.ps1` — local NSIS installer.
- `.\scripts\handoff.ps1 -Check` — verify handoff freshness.
- `.\scripts\handoff.ps1 -Check -Strict` — also fail on uncommitted work (use at session start).
- `git push origin main` — publish (requires user approval).
