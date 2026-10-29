# Repository refactor report

## Baseline and safety

Started on `feature/premier-league-match-centre` at `d7c2592`, after Match Centre, rich demo and recent-results commits. Another worktree exists at the project root; it was not modified. The pre-existing README, changelog, screenshots and AGENTS.md changes were inventoried. README/changelog/screenshot proposals were incorporated and updated as part of the explicitly requested local presentation overhaul; the pending AGENTS.md edit is preserved and excluded from commits. No reset, stash, force-push, merge, release or visibility change was performed.

## Actual structural changes

- Moved the Rust summary test module from `src-tauri/src/details.rs` into the adjacent `src-tauri/src/details_tests.rs`. The child module retains private access; production function bodies and test assertions remain unchanged. Rust compilation must be verified by Windows CI.
- Moved `src/MatchCentre.test.tsx` next to its component as `src/components/MatchCentre.test.tsx`, adjusting only import/mock paths. Vitest discovery and assertions remain intact.
- Added this report and a [documentation index](README.md). Historical audit and evolution reports remain at their original locations; the index labels them as historical so old findings are not mistaken for the current state. This avoids breaking existing links and the pending AGENTS.md instructions.
- Added ignore rules for local environment secrets and generated coverage/Vite cache. Existing manifests, lockfiles, capabilities and workflow remain intact.

No independent project files were deleted. The former test path was removed only as part of its verified relocation. No unfamiliar or untracked assets were classified as disposable. No tracked dependency folders, build outputs or logs were found in the Git inventory. Retaining the audit, fixtures and dated evidence is deliberate.

## Presentation and documentation

The proposed README and changelog were preserved and updated for Match Centre, rich demo, recent results and the actual HTTP-date handling. Dark/light screenshots are real browser renders with labelled demo data. The new timeline screenshot shows an actual browser-rendered interface with a recorded completed-match response supplied via mocked IPC; it is not a live or packaged-Windows capture. The product and roadmap docs no longer say events or recent results are unavailable, or suggest additional competitions. Provider and asset rights remain unestablished; no software license or release is invented.

## Repository map

```text
.github/workflows/          Windows validation and packaging
src/                       React shell, state, hooks, shared types and colocated tests
src/components/            Cards, Match Centre, settings, shared controls and centre tests
src-tauri/src/             Rust models, provider, cache, scheduling, notifications and tests
src-tauri/capabilities/    Tauri permissions
src-tauri/icons/           Application icon
src-tauri/Cargo.toml       Native manifest and lockfile beside it
tests/fixtures/            Reduced provider response fixtures
docs/                      Product, architecture, provider, design and validation
  screenshots/             Attributed browser captures
README.md                  Product and development entry point
CHANGELOG.md               Unreleased changes
```

Configuration stays at the root where Vite, TypeScript, Tailwind, ESLint and npm expect it. No dependency or application behavior changed for organization. A browser check did find a literal question mark in the demo warning; its punctuation was corrected and the visible label is covered by a regression assertion. Larger moves of the state store, native lifecycle and historical reports were deferred: they would increase integration risk or invalidate the pending AGENTS.md map without a demonstrated benefit. A separate visual redesign, additional abstraction layers and speculative asset deletion were also avoided.

## Validation and remaining work

The move-only comparison confirmed the summary production section and all extracted test bodies are identical apart from indentation. Frontend lint, all 62 frontend tests, TypeScript and Vite production build passed. Rust formatting and `git diff --check` passed. Native Rust compilation and tests for this revision remain unexecuted locally because MSVC `link.exe` is unavailable. The prior 75-test Windows CI success predates recent results and this test move. No installer build was performed.

No frontend styles or layouts were changed. Browser preview at 390px covered dark and light Home and the fictional Match Centre timeline; the README captures were also inspected and are described accurately. Verify both themes and Match Centre in the next packaged Windows build, and run the complete Rust suite to validate Rust module resolution and recent-result persistence. See [Windows validation](VALIDATION.md) and the [Match Centre report](MATCH_CENTRE_EVOLUTION_REPORT.md) for the remaining native acceptance checks.
