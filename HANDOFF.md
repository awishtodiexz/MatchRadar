# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: 2026-11-06 11:21 (+02:00)
- Branch: main
- Recent: 7947927 docs: add strict handoff check and refresh snapshot | 88ae9ae docs: refresh handoff snapshot | 7498092 docs: add session handoff workflow
<!-- snapshot:end -->

## Objective

Start a planned major update to MatchRadar. Requirements are not written down yet; gather them before changing code.

## Next steps

1. Get the update described: goals, affected areas (UI, provider, native, packaging), and what must not regress.
2. Write a short plan and confirm scope before editing.
3. Work local-first; commit locally; push only when the user says so.

## Blockers

- The packaged app cannot be launched from the coding-agent sandbox; native runtime checks need the user.

## Decisions

- Local-first: edit and commit locally; push only when the user authorizes it.
- CI runs checks on pushes and PRs and packages installers only on `v*` tags or manual dispatch.
- Demo mode was removed; dated reports live in `docs/archive/`.
- HANDOFF is the cross-session state file; AGENTS.md documents how to read and update it.

## Commands

- `npm run verify:fast` — lint, 74 frontend tests, production build.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml` — 87 Rust tests.
- `.\scripts\build-local.ps1` — local NSIS installer.
- `.\scripts\handoff.ps1 -Check` — verify handoff freshness.
- `.\scripts\handoff.ps1 -Check -Strict` — also fail on uncommitted work (use at session start).
- `git push origin main` — publish (requires user approval).
