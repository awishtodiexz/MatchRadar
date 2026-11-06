# MatchRadar — coding-agent guide

MatchRadar is a Windows 10/11 Premier League desktop widget built with Tauri 2,
Rust, React, TypeScript, Vite, Tailwind CSS, and Zustand. Keep it a compact,
premium, dark-by-default widget with optional light mode, and stay within the
requested v1.0 scope.

## Repository map

- `src/App.tsx`: widget, settings, details, native event subscriptions.
- `src/store.ts`, `src/types.ts`: Zustand snapshots, native commands, UI models.
- `src/fixtures.ts`, `src/test-fixtures/fixtures.ts`: grouping/ordering, test data.
- `src/teams.ts`: supported club IDs, validated crest candidates.
- `src/styles.css`: shared visual styling.
- `src-tauri/src/main.rs`: commands, polling, persistence, notifications, lifecycle.
- `src-tauri/src/window.rs`: sizing, off-screen recovery, settings rollback.
- `src-tauri/src/provider.rs`: ESPN requests, normalization, merging, tests.
- `src-tauri/src/model.rs`: native models and defaults.
- `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json`: native config.
- `.github/workflows/windows.yml`: validation; installer on `v*` tags/manual dispatch.

Read `docs/ARCHITECTURE.md`, `docs/DATA_PROVIDER.md`, `docs/DESIGN_SYSTEM.md`,
and `docs/PRODUCT.md` before changing behavior. `docs/archive/` holds dated
reports; treat them as history, not current behavior.

Rust owns networking, persisted preferences, caching, notifications, and
background refresh. React consumes normalized snapshots; do not add a second
authoritative preference store or make polling depend on a mounted component.

## Current state

- Tray, single-instance, window-state, autostart, and notification integration
  exist, but their presence does not prove packaged Windows behavior.
- Provider detail data is best-effort. Off-screen window recovery is implemented
  in `window.rs` (startup, focus/scale events, 30-second watchdog) but still needs
  packaged Windows validation after monitor removal; sleep/resume and
  score-correction handling also need validation.
- Demo mode has been removed; legacy demo records are migrated or filtered.
- The rules below are requirements, not evidence of completed features. Do not
  infer completion from plugins, roadmaps, docs, or a passing build.

## Session handoff

- Start by reading `HANDOFF.md` and running `.\scripts\handoff.ps1 -Check`
  (add `-ExecutionPolicy Bypass` if scripts are blocked). If it reports stale,
  refresh it before working.
- Before finishing a session that changed state, run
  `.\scripts\handoff.ps1` with `-Objective`, `-Next`, and `-Blocker`, then commit
  `HANDOFF.md` with the change.
- Keep HANDOFF short: no secrets, logs, or duplicated architecture. It records
  current state and next steps; details belong in `docs/`.

## Code conventions

- Keep TypeScript strict. Model optional data explicitly; avoid `any`, unchecked
  casts, and non-null assertions at external boundaries.
- Keep `src/types.ts` in sync with Rust serialization: camelCase, nullability,
  defaults. Preserve saved-state compatibility with serde defaults or migrations.
- Use functional components, stable team/match IDs, focused Zustand
  subscriptions, and effect/listener cleanup. Extract distinct responsibilities
  instead of growing giant components or speculative layers.
- Return contextual Rust errors for provider, IPC, and persistence failures.
  Avoid panics on external data. Keep snapshot locks short and outside awaits.
- Format touched code and follow nearby conventions; avoid unrelated rewrites.

## Tauri 2 and Windows

- Use current Tauri 2/plugin APIs and official documentation; no Tauri 1 patterns.
- Scope capabilities to required commands/windows. Preserve CSP; avoid
  unrestricted filesystem, shell, or remote-content access.
- Preserve close-to-tray, explicit Quit, single-instance restoration, and polling
  while hidden. Preserve automatic recovery when no monitor shows a usable part
  of the widget; visible-monitor recovery and persisted window behavior still
  need packaged testing, not just plugin configuration.
- Surface command failures in the UI. Browser previews do not validate native IPC.

## UI and accessibility

- Preserve branding: rounded glass surfaces, widget-first layout, no dashboard
  chrome, no remote scripts.
- Use semantic theme variables in `src/styles.css`: charcoal/lime in dark mode,
  pale surfaces/dark green accents in light mode. Keep scores tabular; do not
  fork layouts per theme.
- Inspect at 390px and the 320px minimum width. Keep one intended scroll region
  per view; avoid nested scrollbars and document overflow.
- Keep text readable over bright wallpapers at 70% and 100% opacity. Fade
  backgrounds, never text. Use proportional crests with initials fallbacks.
- Preserve keyboard navigation, visible focus, accessible names, and reduced
  motion. Avoid continuous decorative animation.
- Distinguish loading, empty schedules, stale cache, and failures. Show only
  available data; render kickoff times in the user's local timezone.

## Provider, security, and performance

- Treat ESPN as unofficial, untrusted, and replaceable. Keep response shapes out
  of UI components; normalize stable IDs and UTC timestamps.
- Never fill live-data gaps with fictional fixtures.
- Skip malformed individual fixtures; distinguish valid empty responses from
  invalid payloads or HTTP errors. Keep cached fixtures when requests fail.
- Retain monthly fixture and single-day score queries; do not reintroduce
  unsupported date-range requests.
- Keep fixture caching separate from score refresh, deduplicate by match ID, and
  preserve timeouts, non-overlapping requests, backoff, and Retry-After handling.
- Log query, status, and normalization diagnostics without secrets or response dumps.
- Test notification deduplication, delayed updates, and corrections. The first
  observed score of an already-live match must not trigger a goal alert.
- Avoid busy loops, redundant requests/renders, and unbounded retained data.
  Measure before claiming performance gains; prefer small dependencies.
- No telemetry, accounts, embedded secrets, or unnecessary services. Document
  provider and crest licensing limits.

## Build and validation

Use Node 22, npm, stable Rust, and the Windows prerequisites in `README.md`.
Retain `package-lock.json` and `src-tauri/Cargo.lock`. Run commands from the
repository root; use `npm.cmd` if PowerShell blocks npm.

| Purpose | Command |
| --- | --- |
| Install locked dependencies | `npm ci` |
| Browser preview | `npm run dev` |
| Native development | `npm run tauri dev` |
| Lint + tests + frontend build | `npm run verify:fast` |
| Browser UI journeys | `npm run verify:ui` |
| Rust formatting | `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` |
| Rust tests | `cargo test --locked --manifest-path src-tauri/Cargo.toml` |
| Local NSIS installer | `.\scripts\build-local.ps1` |
| Quick installer (skip install/tests) | `.\scripts\build-local.ps1 -SkipInstall -SkipTests` |

`scripts/build-local.ps1` loads the Visual Studio developer environment, keeps
MSVC temp files in `src-tauri/target/.build-temp`, runs the checks, builds the
installer, and prints its path and SHA-256. It requires the VS Build Tools C++
workload. Builds are incremental after the first run.

- Start focused: frontend changes need relevant tests, lint, and build; Rust
  changes need `cargo fmt` and relevant tests; IPC/model changes need both.
- Add behavioral regression tests for fixes: provider success/empty/malformed/
  HTTP errors, deterministic scheduling, notification state transitions. Do not
  replace missing coverage with claims based on existing tests.
- Visually inspect UI changes with the preview or `verify:ui`. Documentation-only
  edits need path, command, and diff review, not compilation.
- Reserve full installer packaging for installer/native validation, requested
  artifacts, and release checkpoints, not every edit.
- The coding-agent sandbox cannot launch the packaged app (WebView2 and app-data
  access are blocked). Use the Playwright harness for UI checks and ask the user
  for packaged runtime results.
- CI runs lint, frontend tests/build, Rust formatting/tests on pushes and PRs,
  and packages installers only on `v*` tags or manual dispatch. Do not disable
  checks to save build time.

## Debugging and evidence

- Reproduce the failure and inspect real logs/responses. Trace the boundary:
  provider, normalization, cache, IPC, UI, or packaging.
- Fix the cause; do not hide errors, weaken tests, or substitute fixtures.
  Inspect the failed job and commit SHA before addressing CI failures.
- Separate automated tests, browser inspection, native development, and packaged
  Windows testing. Installer success requires the intended commit's successful
  run and a downloadable, non-expired artifact.
- CI cannot prove notification delivery, autostart, tray interactions,
  sleep/resume, monitor recovery, or 125%/150% scaling. Report what was checked,
  what remains, and never declare v1.0 complete from compilation alone.

## Git and documentation

- Inspect status/diff before editing and committing. Stage only intended files.
  Work locally; commit locally; push only when the user authorizes it.
- Do not force-push, discard work, merge, publish releases, or change repository
  visibility without authorization.
- Never commit dependency directories, build artifacts, credentials, logs, or
  temporary files. Retain manifests and lockfiles.
- Update docs when behavior, setup, configuration, persistence, provider
  assumptions, or validation procedures change. Put dated evidence in
  `docs/archive/` and keep current docs current.
