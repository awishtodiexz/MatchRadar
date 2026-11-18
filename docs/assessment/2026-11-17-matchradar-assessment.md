# MatchRadar assessment and implementation roadmap

Date: 2026-11-17
Scope: repository at `0ae3db5` (`main`, 2 commits past tag `v1.0.0`)
Status: assessment only. No application code was changed.

## Executive summary

MatchRadar is not an early alpha in code quality terms. It is a release-candidate-quality
Windows Tauri widget with unusually strong defensive engineering: provider output is
validated and bounded, each competition fails independently, notifications are durably
queued with retries, persistence is atomic with backup recovery, and keyboard/ARIA
support is thorough. The frontend test suite passes (31 files, 287 tests).

The gaps are concentrated in **distribution, single-provider dependency, delivery
confidence, and schema evolution**, not in core reconciliation logic. No high-severity
correctness bug was found in the refresh, merge, persistence, or alert-planning paths.
The most important finding is that the product is one unofficial ESPN schema change away
from an outage, and has no auto-updater or signed installer to push a fix to users.

Measured verification status in this environment:
- `npm test`: PASS (287 tests)
- `npm run lint`, `npm run check:version`, `npm run format:check`: PASS (as part of `verify:fast`)
- `npm run build`: FAIL locally, five attempts across default, approved, and freshly
  isolated temp directories, with
  `[vite:esbuild-transpile] remove ...\esbuild-*. Access is denied.` An installer dated
  2026-11-15 exists locally and a release was published on 2026-11-12, so this is a local
  environment regression, not a source error. The build is unverified here until reproduced
  on a clean machine. Rust tests also could not run (`cl.exe` D8050, a toolchain error).

## What is strong

- Provider parsing rejects malformed, unbounded, or cross-team data and keeps cached
  fixtures on partial failures (`src-tauri/src/provider.rs:78-162`, `346-385`).
- Per-competition status, retry deadlines, and host-wide rate limiting are separated
  (`src-tauri/src/refresh.rs:132-233`, `src-tauri/src/scheduling.rs`).
- Durable notification queue with dedup, expiry, backoff, and persistence-before-submit
  (`src-tauri/src/delivery.rs`, `src-tauri/src/alerts.rs`).
- Atomic state writes with `.bak` recovery and archiving of corrupt files
  (`src-tauri/src/persistence.rs:15-252`).
- Large layer of browser journeys, accessibility checks, and a render benchmark
  (`verification/`), plus a Windows CI workflow (`.github/workflows/windows.yml`).
- Empty, partial, checking, rate-limited, and offline states are explicit in the UI
  (`src/App.tsx:354-466`, `src/freshness.ts`).

## Findings register

Severity: P0 blocks production confidence, P1 should be fixed before growth, P2 is
structural debt, P3 is an enhancement.

| ID | Sev | Category | Finding and evidence | Impact | Phase |
|----|-----|----------|----------------------|--------|-------|
| F01 | P0 | Distribution | No auto-updater. `README.md:73` states it explicitly; release is a manual local `gh release create` in `scripts/release-local.ps1:70-72`. | Security and correctness fixes reach users only when they notice a release and reinstall. | 0 |
| F02 | P0 | Distribution | Installer is unsigned, so Windows SmartScreen warns (`README.md:73`, `scripts/release-local.ps1:67`). | Installation friction and trust loss; blocks unattended deployment. | 0 |
| F03 | P0 | Release pipeline | CI builds the installer and uploads it as an artifact (`.github/workflows/windows.yml:56-63`) but never creates a GitHub Release. Publication depends on a clean local `main`, a checked-build stamp, and `gh` (`scripts/release-local.ps1:46-72`). | The installer is reproducible in CI, but publishing is manual and tied to one machine. | 0 |
| F04 | P0 | Provider risk | One unofficial, undocumented source for everything: ESPN scoreboard and summary endpoints (`src-tauri/src/provider.rs:417-422`, `src-tauri/src/details.rs:1629-1633`). There is no provider abstraction or fallback. | Any schema change or endpoint removal is an outage for scores, details, and results. Parsing fails safe but cannot recover functionality. | 1 |
| F05 | P1 | Notifications | Plugin 2.8.0 documents that `show` returns once the payload is prepared, on a background task, and errors only when the notification cannot be prepared (`tauri-plugin-notification-2.8.0/src/desktop.rs:115-120`); the code comment agrees (`src-tauri/src/main.rs:305`). `submit_due` records an ID as sent on `Ok(())` (`src-tauri/src/delivery.rs:335-343`). | A goal alert the OS never displays is treated as sent and suppressed for the life of the 1000-entry sent-ID buffer (`delivery.rs:339-342`), not literally forever. Users cannot tell "requested" from "delivered". The settings copy already hedges this (`SettingsPanel.tsx:219-221`). | 2 |
| F06 | P1 | Data loss | Poll snapshots are written at most every five minutes (`src-tauri/src/main.rs:72-85`); a clean tray Quit also flushes (`main.rs:918-924`). Settings and results writes are immediate. | A crash can lose up to five minutes of newly queued notifications and baseline updates. Impact is bounded: startup marks live scores stale and pauses alert planning until a fresh score confirms them (`src-tauri/src/refresh.rs:29-35`), and reminders can be re-planned from durable kickoff times. | 3 |
| F07 | P1 | Performance | Polling only: 60s live, 300s matchday, 1800s idle (`src-tauri/src/scheduling.rs:42-71`). Every poll downloads full JSON; no conditional requests (ETag/If-None-Match). | Up to a minute of score latency and avoidable bandwidth/battery cost. The benchmark (`verification/bench/render.bench.spec.ts`) measures rendering, not feed latency. | 3 |
| F08 | P2 | Data model | No general snapshot schema version. There is one single-purpose `team_catalog_version` that gates the team-ID remap (`model.rs:337,461-489`); the other two migrations are data-shape heuristics with no version gate (`model.rs:406-459`, `main.rs:806-808`). | Each new persisted field still needs a hand-written, idempotent migration; a missed case surfaces as silently wrong cached state. The existing pattern works but does not scale by itself. | 4 |
| F09 | P2 | Maintainability | Monolithic modules: `main.rs` 1074 lines, `details.rs` 1678 lines, `model.rs` 843 lines. | High cost to reason about concurrency and normalization; risky changes. | 4 |
| F10 | P2 | Scope | Only two competitions, hardcoded in `Competition::ALL` (`src-tauri/src/model.rs:29`). `fixture_window` spans a 2-day lookback plus 15/31 lookahead days, a 17/33-day UTC window total (`model.rs:45-51`, `provider.rs:505-510`). | No path to more leagues or longer fixture horizons without code changes. | 5 |
| F11 | P2 | Platform | Windows-only packaging (`src-tauri/tauri.conf.json`, `bundle.targets: ["nsis"]`). | Most of the Tauri addressable market is unreachable. | 5 |
| F12 | P3 | Privacy/ops | Diagnostics are local only (`SettingsPanel.tsx:195-214`); no opt-in crash reporting. | Provider schema drift and rare crashes are hard to detect before users report them. | 6 |
| F13 | P3 | UX | No quiet hours or global mute; alerts are per-match bell plus three global toggles (`SettingsPanel.tsx:429-505`). | Night matches can wake a user; no scheduled silence. | 2 |
| F14 | P3 | Memory | `previousScores` map in `src/App.tsx:85,187-208` is never pruned; `scoreChanges` is only time-filtered on read. | Slow unbounded growth in very long-running sessions. Small entries; low impact. | 4 |
| F15 | P2 | Environment (not a product defect) | Local production build fails with an esbuild temp-file `Access is denied` error, reproduced five times: default temp dir, approved temp dir, a brand-new isolated temp dir, `--configLoader runner`, and plain `npx vite build`. An installer dated 2026-11-15 exists in `target/release/bundle/nsis`, so this machine built successfully two days ago. | Blocks local `verify:fast`, Playwright, and Rust tests; the latter also hit a separate `cl.exe` D8050 toolchain error. Both are local environment regressions, not application findings. | 0 |

## Prioritized, phased roadmap

Each phase ends in a verifiable state. Acceptance criteria are written so a reviewer can
run a command or observe behavior, not accept a claim.

### Phase 0 — Trustworthy verification and release baseline (P0)

Goal: a clean checkout can build and a tag can produce a complete release without manual
work on a single machine.

Work:
1. Diagnose F15 on a clean Windows checkout: identify the process or policy holding the
   esbuild temp file; either fix it or add a documented fallback to `verify:fast`.
2. Move release publication into CI: on `v*` tags, create the GitHub Release, attach the
   NSIS installer, and write release notes with SHA-256 (supersedes F03).
3. Add code signing to the Windows build, or record an explicit accepted-risk decision
   with a removal date for SmartScreen messaging (F02).
4. Add an in-app update check that links to the latest release; auto-install is optional
   and can follow signing (F01).

Acceptance criteria:
- On a fresh Windows checkout, `npm ci && npm run verify:fast` completes with exit code 0,
  with no environment variables or manual cleanup needed.
- Pushing a `v*` tag produces a GitHub Release with one `.exe` asset and matching SHA-256
  in the notes within 20 minutes, with no local command.
- A signed installer passes Windows SmartScreen without the "More info" path, or the
  accepted-risk decision is committed with an owner and a date.
- The widget shows the current version and a "Update available" link when a newer
  release exists; a test covers both the up-to-date and update-available states.

### Phase 1 — Provider resilience (P0)

Goal: an ESPN schema change or outage degrades visibly but does not become a silent,
unrecoverable product failure.

Work:
1. Introduce a provider boundary: a trait or interface that returns validated `Match`,
   `MatchSummary`, and result data. Move all ESPN URL construction and JSON parsing behind
   it (F04). Keep the current types as the normalized domain.
2. Add contract tests over recorded fixtures for each endpoint. Assert that the
   normalized output shape is stable, and that a deliberately changed schema produces a
   typed "provider format changed" error rather than an empty success.
3. Surface a distinct UI state for provider-format failure, separate from a network
   failure. Keep cached data visible with the existing partial/offline banners.
4. Add conditional HTTP (ETag/If-None-Match) at the boundary to reduce bandwidth.

Acceptance criteria:
- A test that feeds a mutated ESPN payload to the adapter fails with
  `ProviderError::SchemaChanged` and leaves the previously cached fixtures intact.
- A stub second provider can be added in a test with no changes outside the adapter
  module; the assertion is that `apply_league` receives the same normalized types.
- A replay of the existing `tests/fixtures/*.json` set produces byte-identical normalized
  snapshots across runs.
- Two consecutive polls against a mock that returns `304 Not Modified` issue zero full
  JSON body reads; the count is asserted in a test.

### Phase 2 — Notification confidence and quiet hours (P1)

Goal: users can tell what was actually delivered, and can silence alerts on a schedule.

Work:
1. Replace the "success means sent" assumption (F05). Where the OS exposes delivery
   confirmation, use it; otherwise record state as `requested` and say so in the UI.
   Keep the durable retry queue unchanged.
2. Add a quiet-hours setting (start/end time, days) enforced in `alerts::plan` before a
   candidate is created (F13).
3. Retire an undeliverable notification after its existing expiry without replaying it;
   keep a counter in diagnostics for "requested, unconfirmed".

Acceptance criteria:
- With the notification plugin returning `PermissionDenied`, no candidate is marked
  `sent`; after the cooldown the same candidate is retried, proven by `delivery_tests`.
- With quiet hours 22:00-07:00, a fixture kicking off at 02:00 produces no reminder,
  start, or goal candidates in `alerts::plan` at 01:59 and does produce them at 07:01.
- The test-notification UI says "requested, not confirmed" when the platform cannot
  confirm display.

### Phase 3 — Freshness and efficiency (P1)

Goal: reduce score latency and close the crash-loss window without increasing load.

Work:
1. Measure current provider-observed goal-to-display latency using the existing
   `provider.log` diagnostics and a small A/B harness; record the baseline before changes.
2. Evaluate a push path for live scores. If the provider has no push API, shorten the
   live poll adaptively (for example 30s when a match is live, 300s pre-match) and keep
   the existing rate-limit gate authoritative.
3. Flush alert baselines and pending notifications on a crash-safe cadence: lower the
   periodic persist interval for notification state specifically, without fsyncing the
   whole snapshot more often (F06).
4. Prune `previousScores` when matches leave the cache window (F14).

Acceptance criteria:
- A recorded A/B run reports median goal-to-display latency and HTTP requests per hour
  for before and after; latency does not regress and request count does not increase by
  more than 5%.
- A simulated crash after a goal is confirmed but before a scheduled persist loses no
  alert baseline in a Rust test that reloads from disk.
- `previousScores` contains only IDs present in the current `allMatches` set after a
  test that swaps the fixture list twice.

### Phase 4 — Data model and module structure (P2)

Goal: make future schema changes safe and the largest modules reviewable.

Work:
1. Add `schema_version: u32` to `Snapshot` and a single migration chain that runs at
   load. Convert the existing `migrate_*` calls into steps in that chain (F08).
2. Split `main.rs` into `commands/`, `runtime/` (poll, delivery, watchdogs), and `setup/`.
   Split `details.rs` into fetch/cache, normalization, and parsing modules (F09).

Acceptance criteria:
- A snapshot serialized by v1.0.0 loads through the full migration chain and equals the
  expected current-version snapshot in a test.
- An unknown future `schema_version` produces a clear recovery error and preserves the
  original file, matching the current corruption policy.
- No production source file exceeds 400 lines without a recorded exception.

### Phase 5 — Reach and configurability (P2)

Goal: support more platforms and more competitions without forking the data path.

Work:
1. Add macOS and Linux targets: bundle configuration, tray/menu parity, global shortcut
   parity, and CI jobs (F11).
2. Make the competition list data-driven behind the provider adapter, with a settings UI
   to add or remove competitions (F10). Keep the two current leagues as defaults.
3. Add settings export/import so a user can move preferences between machines.

Acceptance criteria:
- The existing browser journeys pass in CI on `windows-latest`, `macos-latest`, and
  `ubuntu-latest`; platform-specific tray tests are skipped only with an explicit reason.
- Adding a third competition requires changing one provider adapter registration and
  passes the existing fixtures test without touching UI code.
- Export produces a versioned JSON file that re-imports to an identical `Settings`
  object in a unit test.

### Phase 6 — Observability (P3)

Goal: detect provider drift and crashes before users report them.

Work:
1. Make the existing "Copy diagnostics" report the source of truth for an opt-in,
   privacy-preserving telemetry payload: version, provider status, error categories,
   no club names, match IDs, or free-form text (F12).
2. Add an explicit opt-in in Settings, default off, with a payload preview.

Acceptance criteria:
- A payload-inspection test asserts that no field equals a club name, match ID, or
  raw provider error message.
- Opting out stops all emissions immediately, verified by a test counting sends.

## Dependencies and risks

- Phase 1 is a prerequisite for Phase 5: more competitions are not worth adding while
  the single provider boundary is untested.
- Phase 0 signing may require a commercial certificate; if that is not available, record
  the accepted risk rather than blocking the rest of the roadmap.
- Phase 3 push support depends on whether ESPN exposes a usable live feed. If not, the
  adaptive-poll fallback is the plan and the acceptance criteria still apply.
- The local build failure (F15) must be resolved before any acceptance criterion that
  runs `npm run build` can be verified in this environment.

## Verification of findings (two passes)

### Pass 1 — source and command checks

| ID | Check | Result |
|----|-------|--------|
| F01 | Grepped `src/`, `src-tauri/`, and scripts for `updater`, `checkForUpdates`, `releases/latest`; checked `Cargo.toml` | Confirmed. Only README links to the releases page. |
| F02 | Read `README.md:73`, `release-local.ps1:67`, `tauri.conf.json` bundle block | Confirmed. Notes say "Unsigned Windows x64 installer"; no signing config. |
| F03 | Read the whole workflow and release script; grepped for `gh release` | Confirmed, wording corrected. CI builds and uploads the installer; it does not publish a Release. |
| F04 | Grepped all `http(s)://` literals in `src-tauri/src/*.rs` | Confirmed and refined. Three ESPN hosts, no other provider. |
| F05 | Read `tauri-plugin-notification` 2.8.0 source in the cargo registry plus `delivery.rs:335-343` | Confirmed, wording corrected. Dispatch-only semantics documented by the dependency. |
| F06 | Grepped every `persist*` call; read `main.rs:72-85`, `806-808`, `872`, `918-924`, `refresh.rs:29-35` | Confirmed, impact narrowed. |
| F07 | Grepped for conditional-request and push tokens; read `scheduling.rs:42-71` | Confirmed. No conditional requests, no push transport. |
| F08 | Grepped for version and migration tokens; read `model.rs:306-338` | Confirmed in pass 1; precision corrected in pass 2. |
| F09 | Line counts over `src-tauri/src/*.rs` | Confirmed. `main.rs` 1074, `details.rs` 1678, `model.rs` 843. |
| F10 | Read `Competition::ALL`, `lookahead_days`, `fixture_window` | Confirmed in pass 1; precision corrected in pass 2. |
| F11 | Read `tauri.conf.json` bundle targets and CI jobs | Confirmed. NSIS only; one Windows job. |
| F12 | Grepped dependencies and README; read diagnostics code | Confirmed. No analytics or telemetry. |
| F13 | Read `Settings` in `types.ts`/`model.rs` and the Alerts settings section | Confirmed. No quiet-hours fields or UI. |
| F14 | Grepped every `previousScores` occurrence | Confirmed. Only `get` and `set`; no deletion. |
| F15 | Reproduced build failure four ways; checked the existing installer's timestamp | Confirmed as an environment issue. |

### Pass 2 — attempts to falsify, with direct checks

| ID | Attempted disproof | Outcome |
|----|--------------------|---------|
| F01 | Look for any runtime `fetch`, `api.github`, semver comparison, or update token in all of `src/` | No matches. Also confirmed the `invoke_handler` in `main.rs:996-1005` exposes eight commands, none update-related. Stands. |
| F02 | Verify the shipped installer's signature directly with `Get-AuthenticodeSignature` | `Status: NotSigned`. The GitHub release notes also say "Unsigned Windows x64 installer" and describe the SmartScreen bypass. Stands, with hard evidence. |
| F03 | Query GitHub for the release (`gh release view v1.0.0`) | Release exists and was published 2026-11-12 with the installer asset. This proves publication happened, but the workflow has no release step, so it was done locally. The corrected finding stands: the installer is reproducible in CI, publication is not. |
| F04 | Enumerate every production network call, not just URL literals: `.get(`/`.send(` in Rust and `fetch(` in TS | All HTTP goes to the three ESPN hosts; TS has no `fetch` at all (it uses Tauri `invoke`). Stands. |
| F05 | Read the rest of plugin `show()` on Windows (`desktop.rs:161-168`) and the test that encodes "sent" | Windows path is `notification.show()?; Ok(())` after preparing a background dispatch. `delivery_tests.rs:109-110` asserts `sent_notifications == sink.calls`, proving the design equates an API call with delivery. Stands, stronger than before. |
| F06 | Locate any other full-snapshot persist call and check recovery behavior | Only startup, quit, and the 300-second periodic timer. Settings and results use `write_snapshot` directly, so those are immediate. Recovery marks live scores stale. Stands with bounded impact. |
| F07 | Check for any header injection or streaming/push client in dependencies | No conditional-request tokens; `reqwest` has no websocket feature; no EventSource. Stands. |
| F08 | Check whether `team_catalog_version` is a general schema version | It is not: it gates only the team-ID remap (`migrate_catalog`). The other two migrations are data-shape heuristics. Corrected to be precise. |
| F09 | Re-count lines | Confirmed. |
| F10 | Read `fixture_window` arithmetic exactly | Window is `(today-2, today+lookahead+1)`: a 2-day lookback plus 15/31 lookahead days, 17/33 days total. Corrected to be precise. |
| F11 | Look for per-platform Tauri config files | Only `tauri.conf.json`, with `bundle.targets: ["nsis"]`. Stands. |
| F12 | Check for any telemetry dependency or network egress from diagnostics | None. The diagnostics feature only writes to the clipboard. Stands. |
| F13 | Look for a global mute or time-based setting | `Settings` has three boolean alert toggles and per-match bells; no time fields. Stands. |
| F14 | Look for a `.delete()` or `.clear()` on `previousScores` | None. Stands. |
| F15 | Build with a brand-new isolated temp directory; run a targeted Rust test | Build failed for the fifth time with the same esbuild error in the fresh temp dir. The Rust test failed for a different reason: `cl.exe` D8050 (toolchain), not a test assertion. Both are environment issues. Reclassified as "Environment (not a product defect)". |

Net result of two passes: 0 findings retracted; 5 corrected for precision (F03, F05, F06, F08, F10); 1 reclassified as an environment note (F15); 9 confirmed exactly as first written.

## Verification not performed

- Playwright journeys and the full Rust suite could not run: the former needs a successful
  production build, the latter hit a `cl.exe` toolchain error in this environment.
- No finding depends on those runs. Each was checked by source reading, a dependency's
  own source, or a command that was actually executed.
