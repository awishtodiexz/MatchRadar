# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: 2026-11-06 11:57 (+02:00)
- Branch: main
- Recent: 85e46d0 docs: refresh README presentation | def6223 feat: recover the widget when it is off-screen | 38d4d44 chore: normalize line endings and finish repo metadata
<!-- snapshot:end -->

## Objective

Add off-screen window recovery so the widget returns to a visible display after monitor removal or DPI/resolution changes.

## Next steps

1. Run packaged Windows acceptance for recovery: disconnect a secondary monitor, restore from tray, mixed DPI, and negative-origin monitors.
2. Get the remaining major-update requirements described before any further feature work.
3. Push only when the user authorizes it; no installer was built for this change.

## Blockers

- The packaged app cannot be launched from the coding-agent sandbox; native runtime checks need the user.

## Decisions

- Local-first: edit and commit locally; push only when the user authorizes it.
- CI runs checks on pushes and PRs and packages installers only on `v*` tags or manual dispatch.
- Demo mode was removed; dated reports live in `docs/archive/`.
- HANDOFF is the cross-session state file; AGENTS.md documents how to read and update it.
- No update requirements were supplied, so the session implemented the documented off-screen recovery gap rather than inventing a product feature.

## Commands

- `npm run verify:fast` — lint, 74 frontend tests, production build.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` — 96 Rust tests (use the Visual Studio developer environment with `TEMP` under `src-tauri/target`, as `build-local.ps1` does).
- `.\scripts\build-local.ps1` — local NSIS installer.
- `.\scripts\handoff.ps1 -Check` — verify handoff freshness.
- `.\scripts\handoff.ps1 -Check -Strict` — also fail on uncommitted work (use at session start).
- `git push origin main` — publish (requires user approval).
