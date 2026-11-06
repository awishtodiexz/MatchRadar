# Handoff

<!-- snapshot:start -->
## Snapshot
- Updated: 2026-11-06 11:15 (+02:00)
- Branch: main
- Recent: 7498092 docs: add session handoff workflow | a99d3ac docs: tighten README and changelog | 3f3a897 docs: tighten agent guide
<!-- snapshot:end -->

## Objective

Keep project state and documentation current across sessions without relying on chat history.

## Next steps

1. Push the four local commits (docs cleanup, agent guide, README/CHANGELOG, handoff workflow) to origin/main and confirm CI.
2. Start the next feature in a fresh thread using AGENTS.md and HANDOFF.md.

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
- `git push origin main` — publish (requires user approval).
