# MatchRadar — coding-agent guide

MatchRadar is a Windows 10/11 football desktop widget using Tauri 2, Rust,
React, TypeScript, Vite, Tailwind CSS, and Zustand. Preserve its small, premium
dark-by-default interface with optional light mode and stay within the requested
v1.0 scope.

## Architecture and repository map

- `src/App.tsx`: widget, settings, details, and native event subscriptions.
- `src/store.ts`: Zustand snapshots and native commands; `src/types.ts`: UI models.
- `src/fixtures.ts`: grouping and ordering; `src/test-fixtures/fixtures.ts`: browser/test data.
- `src/teams.ts`: supported club IDs and validated crest candidates.
- `src/styles.css`: shared visual styling.
- `src-tauri/src/main.rs`: commands, polling, persistence, notifications, and lifecycle.
- `src-tauri/src/provider.rs`: ESPN requests, normalization, merging, and tests.
- `src-tauri/src/model.rs`: native models and defaults.
- `src-tauri/tauri.conf.json` and `src-tauri/capabilities/default.json`: native configuration.
- `.github/workflows/windows.yml`: Windows validation; installer packaging on `v*` tags and manual dispatches.

Read relevant context in `docs/ARCHITECTURE.md`, `docs/DATA_PROVIDER.md`,
`docs/DESIGN_SYSTEM.md`, and `docs/PRODUCT.md` before changing behavior.
Rust owns networking, persisted preferences, caching, notifications, and background
refresh. React consumes normalized snapshots; do not add another authoritative
preference store or make polling depend on a mounted component.

## Implementation versus requirements

The repository contains tray, single-instance, window-state, autostart, and
notification integration. Their presence does not prove packaged Windows behavior.
Provider event/statistics details are not fully implemented; dedicated monitor-disconnection recovery is not implemented, and
sleep/resume and score-correction handling still need validation and hardening.

The rules below are engineering requirements, not a declaration of completed
features. Record observed results and remaining gaps in the relevant docs; do not
infer completion from old roadmap text, configured plugins, or a passing build.

## React, TypeScript, and Rust conventions

- Keep TypeScript strict. Model optional data explicitly; avoid `any`, unchecked
  casts, and non-null assertions at external boundaries.
- Synchronize `src/types.ts` with Rust serialization, including camelCase names,
  nullability, and defaults. Preserve saved-state compatibility with serde defaults
  or an explicit migration.
- Use functional components, stable team/match IDs, focused Zustand subscriptions,
  and effect/listener cleanup. Extract helpers or components for distinct
  responsibilities rather than expanding giant components or speculative layers.
- Return contextual Rust errors for provider, IPC, and persistence failures.
  Avoid panics on external data. Keep snapshot locks short and outside network
  awaits; deliberate async synchronization may serialize refresh operations.
- Follow nearby conventions and format touched code. Avoid unrelated rewrites.

## Tauri 2 and Windows integration

- Consult current official Tauri 2/plugin documentation when changing native APIs
  or permissions; do not introduce Tauri 1 patterns.
- Scope capabilities to required commands/windows. Preserve CSP and avoid
  unrestricted filesystem, shell, or remote-content access.
- Preserve close-to-tray, explicit Quit, single-instance restoration, and polling
  while hidden. Treat visible-monitor recovery and persisted window behavior as
  requirements to test, not guarantees supplied by a plugin.
- Surface command failures in the UI. Browser previews do not validate native IPC.

## Premium UI and accessibility

- Preserve branding, rounded surfaces, dark-by-default glass, and the widget-first layout.
  Do not add dashboard chrome or remote scripts.
- Reuse semantic theme variables in `src/styles.css`. Preserve charcoal/lime in
  dark mode and pale surfaces/dark green accents in light mode. Keep spacing
  consistent and scores tabular; do not duplicate layouts for each theme.
- Inspect at 390px and the configured 320px minimum width. Keep headers compact,
  controls accessible, and one intended content scroll region per view; avoid
  nested Teams scrollbars and document overflow.
- Keep text readable over bright wallpapers, including settings and details.
  Inspect both themes at 70% and 100% panel opacity; fade backgrounds, never text.
  Use proportionate crests with initials-based fallbacks, not emojis.
- Preserve keyboard navigation, visible focus, accessible names, and reduced
  motion. Avoid continuous decorative animation.
- Distinguish loading, empty schedules, stale cache, and failures. Show only
  available events/statistics; present kickoff times in the user's local timezone.

## Provider, security, and performance

- Treat ESPN as unofficial, untrusted, and replaceable. Keep its response shape
  outside UI components; normalize stable IDs and UTC timestamps.
- Never fill live-data gaps with fictional fixtures; demo mode has been removed.
- Skip malformed individual fixtures; distinguish valid empty responses from
  invalid payloads or HTTP errors. Preserve cached fixtures when requests fail.
- Retain monthly fixture and single-day score queries unless actual responses
  justify a change. Do not reintroduce unsupported date-range requests.
- Keep fixture caching separate from live-score refresh, deduplicate by match ID,
  and preserve timeouts, non-overlapping requests, backoff, and Retry-After handling.
- Log query, HTTP status, and normalization diagnostics without secrets or
  unnecessary response dumps.
- Test persistent notification deduplication, delayed updates, and corrections.
  The first observed score of an already-live match must not generate a goal alert.
- Avoid busy loops, redundant requests/renders, and unbounded retained data.
  Measure before claiming performance improvements; prefer small dependencies.
- No telemetry, accounts, embedded secrets, or unnecessary external services.
  Document provider and crest licensing limitations.

## Development and proportional validation

Use Node 22, npm, and stable Rust with the Windows build prerequisites in
`README.md`. Retain `package-lock.json` and `src-tauri/Cargo.lock`.
Run commands from the repository root; use `npm.cmd` if PowerShell blocks npm.

| Purpose | Command |
| --- | --- |
| Install locked dependencies | `npm ci` |
| Browser preview | `npm run dev` |
| Native development | `npm run tauri dev` |
| Frontend lint | `npm run lint` |
| Frontend tests | `npm test` |
| TypeScript and frontend build | `npm run build` |
| Fast Rust check | `cargo check --manifest-path src-tauri/Cargo.toml` |
| Rust tests | `cargo test --manifest-path src-tauri/Cargo.toml` |
| Windows NSIS installer | `.\scripts\build-local.ps1` (loads VS dev shell, checks, installer) |
| Direct installer build | `npm run tauri build` (requires the MSVC environment already loaded) |

- `scripts/build-local.ps1` loads the Visual Studio developer environment, keeps
  MSVC temp files inside `src-tauri/target/.build-temp`, runs lint/frontend
  tests/build, Rust formatting/tests, and prints the installer path and SHA-256.
  It requires the Visual Studio Build Tools C++ workload.

- Start with focused checks. Validate frontend changes with relevant tests, lint,
  and frontend build; Rust changes with relevant Rust checks/tests. Check both
  sides for IPC/model changes. Expand coverage when impact crosses subsystems.
- Add behavioral regression tests for fixes: provider success/empty/malformed/HTTP
  errors, deterministic scheduling, and notification state transitions. Do not
  replace missing coverage with claims based only on existing provider tests.
- Visually inspect UI changes. Documentation-only edits need path, command, and
  diff review, not compilation; do not test implementation trivia.
- Iterate with frontend previews, `cargo check`, focused tests, and native debug
  runs. Reserve full Tauri packaging for installer or native integration validation,
  requested artifacts, and release checkpoints—not every edit.
- Batch related fixes before pushing: CI runs checks on pushes and PRs and
  packages installers only on `v*` tags or manual dispatch. Do not disable
  checks to save build time. Report missing prerequisites instead of repeating
  unchanged failing builds.

## Debugging and verification evidence

- Reproduce the failure and inspect actual logs/responses. Trace the failing
  boundary: provider, normalization, cache, IPC, UI, or packaging.
- Fix the cause; do not hide errors, weaken tests, or substitute fixtures.
  Inspect the failed job and commit SHA before addressing CI failures.
- Distinguish automated tests, browser inspection, native development, and packaged
  Windows testing. Installer success requires the intended GitHub commit's
  successful run and a downloadable, non-expired installer artifact.
- CI cannot prove notification delivery, autostart, tray interactions, sleep/resume,
  monitor recovery, or 125%/150% scaling. Report exactly which runtime checks were
  performed and which remain; never declare v1.0 complete from compilation alone.

## Git safety and documentation

- Inspect status/diff before editing and committing. Preserve unrelated work,
  stage intended files only, and continue the existing task branch/PR.
- Commit/push within user authorization. Proposal-only work stays uncommitted
  until approved. Do not force-push, discard work, merge, publish releases, or
  change repository visibility without authorization.
- Never commit installed dependency directories, build artifacts, credentials,
  logs, or temporary files; retain dependency manifests and lockfiles.
- Update relevant docs when behavior, setup, configuration, persistence, provider
  assumptions, or validation procedures change. Keep this guide durable; detailed
  build evidence and remaining limitations belong in project documentation.
