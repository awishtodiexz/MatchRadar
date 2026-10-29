# MatchRadar v1.0 — Comprehensive Product & Engineering Audit

Audit date: 28 October 2026. Audited application commit: `ac04df53b04f6201f20692453d38ebe87e7017fe`, branch `t3/build-matchradar-desktop-app`, existing [PR #1](https://github.com/awishtodiexz/MatchRadar/pull/1). Verdict: **NOT READY for public release**. The product is suitable for continued private Windows acceptance testing.

## 1. Executive Summary

MatchRadar has a coherent, distinctive widget interface, working native packaging, a useful provider normalization layer, and meaningful business-logic tests. Preserve its dark/light themes, small window, backend-owned polling, explicit demo labeling, and restrained feature scope. A redesign or framework replacement is unwarranted.

The release blockers concern trust: preferences can be lost following a damaged write; the frontend can discard a fresh score snapshot during a settings save; successful fixture data is thrown away when the accompanying scoreboard request fails; and failed native start/goal delivery has no effective retry. Public data/asset rights and a recorded Windows acceptance matrix also remain unresolved.

No P0 Critical issue was identified. This is not a security certification. Six P1 findings and the targeted P2 issues below warrant attention before declaring v1.0 complete. Several findings are proven control-flow defects; others explicitly require runtime verification. Passing tests establish a buildable implementation, not reliable end-to-end delivery.

### Scope, evidence, and working-tree safety

- Inspected all tracked source/configuration/test files, package manifests and lockfiles, workflow, README, AGENTS.md, and all existing product/engineering documents. Traced commands, polling, persistence, normalization, notification planning/delivery, settings queue, card actions, filters, and window lifecycle.
- The only pre-existing working-tree change was the requested AGENTS.md simplification (16 deleted lines). It was left untouched and uncommitted. No application implementation task remained active in the conversation; no subagents were created for this audit.
- This audit creates only this report. No application/configuration/workflow/dependency fixes, installer builds, commits, pushes, releases, or PR mutations were performed.
- Fresh local checks: `npm.cmd run lint`, `npm.cmd test` (**18 tests passed**), `node_modules/.bin/tsc.cmd --noEmit --incremental false`, and scoped `rustfmt --check --edition 2021` all passed. npm lockfile audit reported **0 known advisories**, with 10 production dependencies and 392 total dependency entries in its metadata. This is a point-in-time advisory result, not proof that dependencies are safe.
- Local Rust linking is known to be unavailable because MSVC `link.exe` is missing. The unchanged failing toolchain check was not repeated; no large toolchain was installed. Native test evidence comes from CI, not a local execution claim.
- Rechecked [Windows run 40696237715](https://github.com/awishtodiexz/MatchRadar/actions/runs/40696237715): all steps succeeded, logs confirm **18 frontend and 24 Rust tests**, frontend production build, Tauri build, and NSIS upload. Artifact `12818814851` is non-expired, **3,216,349 bytes**, and belongs to the audited head. [Installer artifact](https://github.com/awishtodiexz/MatchRadar/actions/runs/40696237715/artifacts/12818814851).
- Inspected historical [failed job 122721254581](https://github.com/awishtodiexz/MatchRadar/actions/runs/40660267548/job/122721254581): actual failure was Rust `E0277`, `FetchError` missing `Debug`. Current provider derives `Debug`, and current Rust tests pass. This historical failure is resolved, not an open finding. The abbreviated old SHA did not return runs through the connector; the job logs were the usable evidence.
- Re-inspected retained browser screenshots from the audited frontend: dark 390px home, light 320px home, and light 320px/460px compact Appearance at low opacity. These are earlier browser render artifacts, not newly captured native screenshots. Prior 48-case browser validation is documented in `docs/VALIDATION.md`; it replayed real CDN image bytes after sandbox browser connections were reset. No packaged Windows interactions or new browser/DPI performance measurements were performed in this audit.
- Ran a fresh, file-free reproduction against the actual `src/store.ts`, transpiled in memory with a mocked native boundary. A new fixture snapshot completing after a cosmetic save was discarded: expected match `new`; actual match `old`, with the old timestamp retained (F02).

File references below are relative to the repository and line numbers refer to this commit. Large compressed TSX/CSS lines may contain an entire component; named functions/selectors identify the affected code precisely.

## 2. Overall Product Assessment

| Dimension | Assessment | Evidence boundary |
| --- | --- | --- |
| Visual design | Strong small-widget identity; preserve it | Screenshots and CSS inspected; no new native DPI certification |
| UX | Core flows are discoverable; alert inheritance and focus need refinement | Source and existing interaction tests |
| Functional correctness | Useful foundation with specific state/data defects | One freshly reproduced store race plus traced native control flow |
| Reliability | Below public-release threshold | Single-file recovery, partial failure, and delivery gaps |
| Performance | Modest static bundle; native idle performance unknown | Asset sizes known; no CPU/RSS/startup benchmark |
| Security/privacy | Sensibly limited surface, but release assurance incomplete | CSP/capabilities inspected; npm advisory scan only |
| Maintainability | Reasonable ownership boundaries; compressed UI and large runtime module impede review | Actual source structure |
| Release readiness | NOT READY | Green installer CI plus unresolved P1 and Windows acceptance gates |

No numerical ratings are assigned: code inspection and a handful of screenshots do not justify precise product or performance scores.

## 3. What MatchRadar Already Does Well

- Charcoal/lime dark mode and pale/green light mode share semantic CSS tokens. Background alpha does not fade match text. Reduced motion is supported by both preference and media query (`src/styles.css:2,11,12,26`).
- Card details and bells are sibling buttons, with match-specific accessible names and `aria-pressed`; native minimize and hide are separate actions (`src/App.tsx:23,56`).
- Window defaults remain 390×700, minimum 320×460, compact off. Expanded logical dimensions are preserved separately; scaling is considered in physical-to-logical conversion (`src-tauri/src/model.rs`, `ExpandedSize`; `tauri.conf.json:1`).
- Rust owns network, preferences, cache, scheduling, and notifications. The browser demo is explicit and is not used to fill failed real feeds.
- Monthly fixture requests and daily score requests are separated. Requests have timeouts, stable-ID merging, and no overlapping poll execution (`main.rs:211`; `provider.rs:197,228,238,255`).
- Malformed individual fixtures are skipped, all-invalid responses fail, and a genuine empty events array succeeds. UTC minute timestamps are normalized, and UI times are localized.
- Cosmetic settings do not wake ESPN polling. Preference changes survive an in-flight feed result on the backend; mode generations prevent old live/demo requests crossing a mode round trip.
- Persistent sent IDs, per-match mute precedence, first-observation suppression, and score high-water tracking are meaningful improvements over naïve score-difference notifications (`alerts.rs:56`).
- Minimize permission, local-only content, no shell/filesystem frontend plugins, no analytics/accounts/secrets observed, and successful installer CI are good foundations.
- Tests exercise real pure business functions and several asynchronous frontend races. Keep these tests while expanding their failure-boundary coverage.

## 4. Critical and High-Priority Findings

Severity definitions: P0 Critical = immediate severe compromise or catastrophic failure; P1 High = release-blocking user trust/correctness issue; P2 Medium = material gap to resolve or explicitly accept; P3 Low = contained polish/maintenance improvement. Confidence describes the evidence, not severity. “Confirmed” may mean a deterministic code path, not a reproduced native failure.

### F01 — Non-atomic snapshot writes and destructive corruption recovery

**Category:** Reliability/persistence. **Severity:** P1 High. **Confidence:** Confirmed implementation defect; interruption frequency unmeasured. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** Yes, for file replacement/failure behavior.

`write_snapshot()` directly truncates and overwrites the one file containing preferences, cached fixtures, baselines, and sent IDs (`src-tauri/src/main.rs:36–40`). Startup treats any read/deserialize failure as a new installation (`main.rs:398–401`), then persists the default snapshot (`main.rs:426`). A partial write, incompatible field, or corrupted cache can therefore erase all preferences and overwrite the evidence needed for recovery. A successful settings command rollback cannot restore the prior disk bytes after a failed partial write.

**Impact:** Lost favorites, subscriptions, sizing, and deduplication state; repeat notifications after restart. **Recommendation:** Same-directory atomic replacement with a last-known-good backup, distinguish “missing” from “invalid,” preserve bad files, and recover preferences independently where practical. Test interrupted replacement, malformed JSON, one invalid field, disk full/access denied, and restart. A database is unnecessary.

### F02 — Settings saves can discard a fresh score snapshot

**Category:** Functional/state synchronization. **Severity:** P1 High. **Confidence:** Confirmed by fresh in-memory execution of the actual store. **Effort:** Small–Medium. **Regression risk:** Medium. **Native Windows verification:** Recommended after deterministic bridge tests.

`load()` accepts only the latest `loadVersion`; `save()` increments that same version before and after persistence (`src/store.ts:21–25,34–50`). Reproduction: load old data; start an opacity save; start the poll event's fresh snapshot read; complete the save; complete the fresh read. The version check drops the new match and timestamp, and save completion updates only settings. No compensating read occurs. The UI may lag until the next poll/event even though Rust is current.

**Impact:** Old scores, offline state, or update time can remain visible during ordinary appearance changes. **Recommendation:** Separate preference-write ordering from feed snapshot freshness; merge pending preference patches onto current feed data and reconcile after the queue drains. Add this inverse-order race to tests; the existing test protects old snapshots but not legitimate fresh feed data.

### F03 — Successful fixture refresh is discarded when the daily request fails

**Category:** Data/reliability. **Severity:** P1 High. **Confidence:** Confirmed control flow; not a newly observed ESPN outage. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** Helpful; deterministic HTTP integration tests are primary.

`poll()` fetches monthly fixtures, then uses `provider::scores(...).await?` before committing either result (`src-tauri/src/main.rs:255–281`). If the month succeeds and today times out/returns malformed JSON/429, the entire operation takes the error path and keeps the previous snapshot. With no cache, valid upcoming fixtures remain invisible. The reverse fallback exists for a failed month plus successful day, making partial success asymmetric.

**Impact:** “No cache” despite a working fixtures endpoint; stale schedules during partial outages. **Recommendation:** Track fixture and score results/freshness independently, commit validated fixture success, retain previous scores where needed, and display partial freshness accurately. Test all four success/failure combinations, including rate limits.

### F04 — Failed native start/goal delivery loses the event

**Category:** Notifications/reliability. **Severity:** P1 High. **Confidence:** Confirmed control flow. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** Yes.

`alerts::plan()` advances status/score baselines before delivery (`src-tauri/src/alerts.rs:117–130`). `notifications()` logs `show()` errors but only retains successful IDs; it does not retain failed candidates (`main.rs:190–207`). On the next identical live score, the updated baseline produces no goal/start candidate. Thus “only mark sent after success” does not actually provide a retry. Reminder candidates can recur while still inside their time window; starts/goals differ.

**Impact:** Transient native failures silently drop the very alerts a user subscribed to. **Recommendation:** Persist a small bounded pending-event queue with age limits and unified IDs, or commit delivery state using an explicit retryable plan/acknowledgment boundary. Distinguish delivery failure from permission denial. Test fail-once/succeed-next, restart with pending events, stale-event expiry, and duplicate eligibility. Avoid promising exactly-once delivery across OS/process crashes.

### F05 — Public-release Windows acceptance evidence is incomplete

**Category:** Release/stability. **Severity:** P1 High. **Confidence:** Needs Testing. **Effort:** Medium. **Regression risk:** Low for testing; fixes depend on results. **Native Windows verification:** Required.

`docs/VALIDATION.md` explicitly leaves OS behavior open. Current CI proves compilation/tests/installer upload, not Windows 10 and 11 notification permission behavior, autostart, minimize/taskbar/tray restoration, compact restart restoration, mixed-DPI monitors, sleep, or uninstall. User testing establishes earlier launch/fixtures and favorable theme feedback; it is not a recorded complete acceptance run for the audited head.

**Impact:** An installable build can still fail central desktop workflows in public use. **Recommendation:** Run a versioned acceptance matrix on this exact artifact, record OS/WebView2/build/DPI results and evidence, and gate release on failures. Do not build more installers solely to collect this evidence.

### F06 — Public data/asset rights and distribution terms are unresolved

**Category:** Product/security-adjacent release governance. **Severity:** P1 High for public distribution. **Confidence:** Needs Testing/review; no legal conclusion asserted. **Effort:** Medium, potentially Large if a provider change is needed. **Regression risk:** Low for review; Medium for provider replacement. **Native Windows verification:** No for rights review.

`docs/DATA_PROVIDER.md` and README expressly disclaim guaranteed ESPN access/licensing. The repository has no tracked LICENSE/third-party notices package, and the app loads provider-owned club crests. A public URL and private-use success do not establish permission to distribute a public data product. The custom competition mark is a good way to avoid bundling an official league logo, but does not settle data/crest rights.

**Impact:** Public release may depend on permissions or a licensed source that have not been established. **Recommendation:** Record the permitted use/attribution basis, dependency notices, project license choice, and provider fallback decision before public distribution. Obtain qualified rights review where necessary; retain the existing replaceable provider boundary.

## 5. UI / Visual Design Audit

The existing aesthetic is worth preserving. Screenshots show consistent hierarchy, contained cards, recognizable crests, understated green accents, and readable score emphasis in both themes. The light palette is deliberately designed rather than an inversion. No major redesign is recommended.

### F07 — Dense minimum-width cards and secondary typography need a targeted acceptance pass

**Category:** UI/readability. **Severity:** P2 Medium. **Confidence:** Confirmed truncation in retained screenshots; legibility across DPI Needs Testing. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** Yes.

At 320px, retained light-home screenshots truncate names such as Manchester United and Brighton; the new separate bell consumes another fixed slot (`src/styles.css:34–37`; `src/App.tsx:23`). Scores remain readable and details expose full names, so this is not wholesale clipping. Several labels still use 8–10px text; no bundled Inter font is present, so Windows commonly uses Segoe UI (`styles.css:2,44`). Test actual fallback metrics, long/localized time formats, and 125%/150% scaling. Adjust spacing or typography locally, preserve the 390×700 default, and consider a full-name tooltip. Do not enlarge the product by default without observed need.

### F08 — Theme/style overrides are accumulating

**Category:** UI maintainability. **Severity:** P3 Low. **Confidence:** Confirmed. **Effort:** Small–Medium. **Regression risk:** Medium because selectors are order-sensitive. **Native Windows verification:** Visual check recommended.

`src/styles.css:2–45` repeatedly overrides `.header`, `.badge`, `.group-title`, `.footer-actions`, compact rules, and theme exceptions, with most base rules on one line. Current screenshots look coherent; the issue is predictable future regressions. Consolidate into readable component sections with one effective declaration per selector and semantic tokens for remaining hardcoded warning/scrollbar colors. Capture equivalent states before consolidation; this is not a prerequisite for a visual redesign.

Transparency correctly applies to the panel background, with stronger card surfaces preserving legibility. At 70%, wallpaper influence is intentionally strong. Existing low-opacity screenshots show readable text, but they are not a contrast certification against arbitrary wallpapers. Loading skeletons and reduced-motion behavior are present. Detail cards honestly say events are unavailable. Competition artwork is original and consistent, while the registered-trademark symbol in the brand should be reviewed for appropriate public branding rather than assumed meaningful.

## 6. User Experience Audit

### F09 — Three match-alert states are compressed into a two-state control

**Category:** UX/notifications. **Severity:** P2 Medium. **Confidence:** Confirmed design ambiguity. **Effort:** Small. **Regression risk:** Low–Medium. **Native Windows verification:** Usability check recommended.

Missing override means team defaults; enabled means all match alerts; disabled means mute, including team alerts (`alerts.rs:59–65`; `App.tsx:23–32,44`). Both missing and muted states expose `aria-pressed=false`; tooltip/icon differences carry the distinction. Returning one match to inheritance requires resetting every match in Alerts. Team Goals can read “Off by default” while subscribed-match goals are deliberately on, despite the explanatory paragraph.

**Impact:** Users may believe an outline bell means absolutely no alerts, accidentally mute team notifications, or reset unrelated subscriptions. **Recommendation:** Provide a minimal per-match “Use team settings” action and explicit inherited/subscribed/muted description; name global switches “Followed-team …”. Preserve the direct bell shortcut and explicit goal opt-in.

### F10 — Navigation lacks focus transfer and announced active section

**Category:** UX/accessibility. **Severity:** P2 Medium. **Confidence:** Confirmed source gap; assistive-technology impact Needs Testing. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** Yes with keyboard/Narrator.

Opening details unmounts the focused card; opening Settings from the footer inserts controls earlier in document order without moving focus. Settings section buttons only change CSS class (`App.tsx:41,47–59`). There is no deliberate focus restoration or Escape/back navigation. Move focus to the new heading/back control, restore it on return, and expose active navigation with appropriate semantics. Use a real tab pattern only if its keyboard behavior is implemented; ordinary section buttons with announced state are also sufficient.

### F11 — Filtered empty state does not explain or reverse the filter

**Category:** UX/empty states. **Severity:** P2 Medium. **Confidence:** Confirmed. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** No, except final appearance.

`App.tsx:51,58` filters first, then displays generic “No matches to show right now.” This conflates a valid league schedule with zero followed-club matches or zero favorites. Show “No followed-team matches” and a one-click “Show all matches” when the unfiltered snapshot contains fixtures. Keep true empty schedule and provider failure separate.

### F12 — Some available controls can silently do nothing

**Category:** UX/feedback. **Severity:** P3 Low. **Confidence:** Confirmed source behavior. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** Partly.

Match bells remain enabled on completed/cancelled cards even though the planner cannot generate future alerts for them (`App.tsx:29`; `alerts.rs:75–115`). Browser minimize/hide and browser autostart are also callable-looking native-only controls, although window-control tooltips explain availability. Disable or explain completed-match subscription and native-only actions, and surface startup-state read failures instead of silently presenting Off (`App.tsx:37,45`). Avoid toasts for every cosmetic save.

## 7. Functional Bugs and Edge Cases

F02 is the principal reproduced frontend regression. The following concrete edge paths also need correction.

### F13 — Successful loads do not clear a prior store error

**Category:** Functional/feedback. **Severity:** P2 Medium. **Confidence:** Confirmed. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** No.

`src/store.ts:25–26` sets an error on load failure but successful load never clears it. Refresh success likewise does not explicitly clear the earlier error. Consequently `App.tsx:59` can keep an error banner after recovery. Clear errors by operation or track independent load/save/action errors, without accidentally hiding an outstanding save failure. Test fail-load/succeed-load and fail-refresh/succeed-refresh.

### F14 — Backend-normalized settings are not reconciled on save completion

**Category:** State/persistence compatibility. **Severity:** P2 Medium. **Confidence:** Likely visible divergence; normalization and client behavior are confirmed. **Effort:** Small–Medium. **Regression risk:** Medium. **Native Windows verification:** Recommended.

Rust rewrites match expiry and rejects unknown/expired overrides (`alerts.rs:11–31`), but `save_settings` returns `()` and the frontend sets `committed = next`, its submitted object (`store.ts:45–50`). The corresponding snapshot event can also be discarded by F02. A rejected/cleaned subscription can appear active until another valid load. Return/reconcile authoritative settings or arrange an explicit queue-drained snapshot read. Test actual normalization, not an echoing bridge mock.

### F15 — Postponed/cancelled pre-match fixtures can display a false score impression

**Category:** Football data/UI. **Severity:** P2 Medium. **Confidence:** Confirmed conditional code path; provider occurrence Needs Testing. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** No.

`provider.rs:90` accepts numeric zero scores independently of match status. `MatchRow` and `Detail` use a kickoff time only for `scheduled`; every other status displays score fields (`App.tsx:27,47`). A postponed pre-match fixture with ESPN's default `0` values therefore displays 0–0. Suppress unplayed scores for postponed/cancelled/unknown fixtures, retaining a known partial score for actually suspended games. Add representative fixtures and status matrix tests.

### F16 — Date context does not advance independently of data updates

**Category:** Functional/timezone. **Severity:** P2 Medium. **Confidence:** Likely. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** Yes for timezone/resume.

Hero date is generated during rendering; `groupFixtures` is memoized only on matches/favorites (`App.tsx:53,57`; `src/fixtures.ts:6`). Midnight or a timezone change does not itself invalidate groups. Group labels can remain Today/Tomorrow from the previous day until another snapshot/settings update. Use an economical local-day invalidation and resume/timezone reconciliation, not a busy per-second timer. UTC storage and existing grouping boundaries should remain.

## 8. Stability and Reliability Audit

### F17 — Slow persistence/notification work holds the authoritative snapshot lock

**Category:** Reliability/performance. **Severity:** P2 Medium. **Confidence:** Likely responsiveness risk; no freeze measured. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** Yes.

`save_settings` serializes/writes while holding `snapshot` (`main.rs:120–132`); `persist` does the same (`main.rs:42`); successful polling calls notification delivery under that lock (`main.rs:287–302`). Commands are synchronous, and every opacity input is queued as a whole-state write. Antivirus, slow disks, or native notification delays can block snapshot reads/settings. Keep short mutation locks, serialize disk writes on a bounded writer, and coalesce slider updates. Benchmark the actual problem before a broader async redesign.

### F18 — No explicit resume/monitor recovery or supervised poll-task failure path

**Category:** Reliability/platform. **Severity:** P2 Medium. **Confidence:** Needs Testing; absent handlers confirmed. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** Required.

Polling sleeps via Tokio without explicit resume detection (`main.rs:373`). The task handle is discarded at startup and multiple runtime locks use `unwrap()` (`main.rs:215,287,348,463` vicinity). A panicking/poisoned worker can stop updates without a dedicated health state. The window-state plugin helps restore a position if saved monitors exist, but no dedicated runtime display-disconnection handler is implemented. Do not assume a resumed timer necessarily waits its entire original duration: actual Windows behavior must be tested. Add targeted resume/display recovery and a visible worker-health error path if evidence warrants it.

### F19 — Rate-limit policy can be bypassed and long Retry-After is shortened

**Category:** Provider/reliability. **Severity:** P2 Medium. **Confidence:** Confirmed control flow. **Effort:** Small–Medium. **Regression risk:** Medium. **Native Windows verification:** No for logic; resume timing check useful.

Only numeric Retry-After is parsed (`provider.rs:217–221`); HTTP dates are ignored. Poll delay is capped at 3,600 seconds even when the provider requests longer (`main.rs:349–353`). Explicit Refresh wakes the sleep and starts another request regardless of a stored server deadline. Persist/enforce a boundedly represented not-before time, parse both header forms, and let Refresh explain the delay instead of evading it. Add injected-clock tests. These are real policy gaps, not a claim about ESPN's authorized rate limits.

### F20 — HTTP client construction failure cannot recover inside the running process

**Category:** Reliability. **Severity:** P3 Low. **Confidence:** Confirmed error path; occurrence unmeasured. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** Optional.

The client `Result` is constructed once before the loop (`main.rs:211–212`); an initial error is reused forever even after its cause is removed. Recreate a failed client after backoff while reusing successful clients. Test the failure branch through injection rather than manipulating the user's system TLS settings.

Startup also treats window restore, initial persistence, and tray initialization as fatal `?` paths. This is reasonable for indispensable setup, but degraded readable operation may be preferable when only old window metadata cannot be restored. Assess within F01/F05 rather than claiming a reproduced startup crash.

## 9. Performance and Resource Usage

Measured/read directly during this audit:

| Item | Result | Interpretation |
| --- | --- | --- |
| Retained production JS asset | 263,586 bytes | Static file size, not heap usage |
| Retained production CSS asset | 21,271 bytes | Static file size, not a paint benchmark |
| Latest installer artifact ZIP | 3,216,349 bytes | Includes NSIS artifact, not installed footprint/WebView2 |
| Fresh Vitest run | 18 tests, reported duration 1.40s | Test runner duration, not app startup |
| CI native tests | 24 passed | Correctness evidence only |
| Native startup, idle CPU, RSS, battery, image-decode cost | Not measured | No numeric claim justified |

Polling delays are response-completion plus 60/300/1,800 seconds, not exact wall-clock intervals. Roughly 60/12/2 daily-score requests per hour are upper-order cadence estimates, not measured traffic; monthly refresh adds one or two requests when due. Yesterday's live match can add a daily request. Hidden windows continue polling as required. Images use browser caching and finite candidates; there is no persistent image cache or measured cache hit rate.

### F21 — Broad frontend subscriptions and repeated sorting are unnecessary work

**Category:** Performance/maintainability. **Severity:** P3 Low. **Confidence:** Likely cost; slowdown unmeasured. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** Profile after change.

App and each `MatchRow` subscribe to the full Zustand state (`App.tsx:23–24,49`), the parent sorts before `groupFixtures` sorts again, and Teams repeatedly flattens/searches fixtures for logos (`App.tsx:39,42,51–53`). Every settings/poll update can revisit the whole list. Use narrow selectors, a single ordering pass, and a team-by-ID map. Do not add virtualization for a normal two-week EPL schedule without evidence.

### F22 — Resource/response bounds and log retention are incomplete

**Category:** Performance/security hardening. **Severity:** P2 Medium. **Confidence:** Confirmed missing bounds; exhaustion risk Likely. **Effort:** Small–Medium. **Regression risk:** Low–Medium. **Native Windows verification:** Disk/log check recommended.

The response body is read fully before parsing (`provider.rs:222`), and skipped fixtures are not counted in diagnostics. Persisted fixture/string/map sizes are not explicitly capped. `provider.log` is append-only (`main.rs:305–325`), with no rotation. Timeouts help latency but do not bound body memory. Add a reasonable response-size limit, bounded retained state, counts for rejected fixtures, and modest log rotation. There is no observed memory leak or disk incident; these are containment gaps, not measured failures.

The glow/orbit decoration is static; live dots do not run a constant animation. Skeleton/refresh animation respects reduced motion. These choices should be preserved. A release benchmark should measure visible/hidden idle CPU, process-tree RSS including WebView2, cold/warm startup, and a representative fixture list on one declared machine, then record methodology.

## 10. Football Data and Notifications

Provider flow: month requests cover yesterday through UTC today+14 inclusive, filtering normalized UTC kickoff dates (`provider.rs:238–253`); daily scores overwrite matching IDs (`provider.rs:228–237`). This is approximately a two-week window, not an exact local-time sliding 336-hour promise. The monthly fixtures are cached for six hours while daily scores refresh adaptively. There is no need to expand the window for this audit.

Known-positive checks: home/away by role; stable IDs; corrected Fulham/West Ham IDs; default/dark crest candidates; timestamp-without-seconds normalization; errors vs valid empty arrays; unknown enum fallback; and explicit mock data. No current wrong club crest or live fixture was independently observed in the installed audited build. Historical crest probes in docs are dated observations, not perpetual availability claims.

### F23 — First-party adapter boundary and integration coverage are incomplete

**Category:** Data architecture/testing. **Severity:** P2 Medium. **Confidence:** Confirmed. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** No for fixtures; real-provider smoke check useful.

The backend calls `provider::fixtures/scores/mock` directly; no provider interface or injected HTTP/scheduler seam exists. Unit tests call private normalizers and planners, but do not exercise real reqwest transport, partial HTTP failure, Retry-After deadlines, rolling-window reconciliation, or first-of-month/yesterday-live behavior. Monthly success with a missing event also lacks a deliberate policy distinguishing deletion from temporary provider omission. Introduce a small injectable transport/clock boundary and explicit merge/freshness policy, not a large provider framework. Tests should include suspended/abandoned/unknown statuses rather than infer all are mapped correctly. See F03/F15/F19 for concrete outcomes.

### F24 — Conservative notification suppression has material tradeoffs that need a clear contract

**Category:** Data/notification UX. **Severity:** P2 Medium. **Confidence:** Confirmed and partly intentional. **Effort:** Small for contract/tests, Medium for refinement. **Regression risk:** Medium. **Native Windows verification:** Yes.

New subscription observations, observations older than five minutes for goals/ten minutes for starts, first scheduled-to-live scores, and total-score rebound to an earlier high-water mark are suppressed (`alerts.rs:66–127`). This prevents historical/correction spam but can miss a legitimate goal at subscription time or after a correction. Restarts also inherit this freshness contract. Override cleanup uses kickoff+24h for terminal games and kickoff+30d otherwise (`alerts.rs:35–50`), which is safe for ordinary games but is not an event-finish timestamp or indefinite postponement policy.

Do not describe these as full event-stream notifications. Document “newly observed score updates,” preserve conservative defaults, and define acceptance cases for corrections, long suspensions, postponed kickoff changes, and follow/unfollow changes. Refine only with actual event evidence. Available goalscorers/events are not fetched; do not invent them.

## 11. Security and Privacy Audit

CSP is local-first (`tauri.conf.json:1`): no remote scripts, remote image access for ESPN, IPC-only frontend connections, and inline styles for the current styling strategy. Capabilities are scoped to main with hide/minimize/drag and autostart. No shell plugin, arbitrary filesystem frontend access, analytics SDK, login, secret API key, or remote-code path was observed. React text rendering avoids deliberate provider HTML injection. Native URL validation requires HTTPS, exact CDN host, no credentials/query/fragment, safe image path and extension (`provider.rs:14–43`); the frontend's secondary check is less restrictive but remains within the trusted CDN (`src/teams.ts:7–20`).

Custom Rust commands remain an important trust boundary: the capability list alone is not evidence that their Settings payloads are comprehensively validated. No active exploit was demonstrated. Favorites/reminder values and persisted nested fields deserve bounded validation as part of F01/F22, not gratuitous permission expansion.

### F25 — Supply-chain and public-release assurance are not automated

**Category:** Security/release. **Severity:** P2 Medium. **Confidence:** Confirmed configuration gap. **Effort:** Small–Medium. **Regression risk:** Low. **Native Windows verification:** Signing/install trust check required for the release decision.

CI uses mutable action major tags, no npm/Rust advisory gate, and Cargo commands without `--locked` (`.github/workflows/windows.yml:8–25`). Lockfiles exist and `npm ci` is good. Fresh npm audit found zero advisories; no fresh Rust advisory scan or complete transitive license review was performed, so Rust dependency security remains unassessed. No signing configuration is present and docs describe an unsigned installer; no signature inspection was performed in this audit.

Recommendation: Review/pin action revisions, enforce lockfile consistency, add economical advisory/license checks, and choose/document a Windows signing/reputation strategy before public release. Signing is a trust/distribution decision, not proof the app is secure. Externally loaded crests send ordinary network metadata to ESPN/CDN even though MatchRadar has no analytics; make that distinction clear in public privacy text. Do not equate “local-first” with “no external connections.”

## 12. Architecture and Code Quality

### F26 — Compressed UI and concentrated native runtime hinder safe changes

**Category:** Architecture/maintainability. **Severity:** P2 Medium. **Confidence:** Confirmed. **Effort:** Medium. **Regression risk:** Medium. **Native Windows verification:** Recheck affected flows only.

`src/App.tsx` is only 62 physical lines but embeds many controls and whole view branches on individual lines; “line count is small” would be misleading. `main.rs` holds commands, window application, disk writing, poll scheduling, delivery, setup, and tray behavior. `alerts.rs` is a positive extraction. TypeScript/Rust models are manually synchronized; `Snapshot` exposes native persistence metadata to a renderer whose type omits it. String statuses remain unrestricted in Rust.

Extract the existing Settings/MatchCard/Detail components and focused native persistence/poller services around current boundaries, with no behavior change in those tasks. Keep one authority for preferences and define the public IPC DTO explicitly. Schema round-trip tests are likely sufficient initially; a binding generator is optional, not a release prerequisite. Avoid a full architectural rewrite.

## 13. Testing and CI Assessment

### F27 — Passing component/pure tests leave critical integration boundaries untested

**Category:** Testing. **Severity:** P2 Medium. **Confidence:** Confirmed. **Effort:** Medium. **Regression risk:** Low for additions. **Native Windows verification:** Still required after tests.

The 18 frontend tests cover card navigation, filtering, bells, native-call wiring, save ordering, rollback, themes/compact, grouping, and crest candidates. The 24 Rust tests cover parsing, merge, serialization/defaults, logical sizes, migrations, pure alert planning, and one disk-failure context. They do not execute actual tray actions, window size/OS pin state, notification failure/retry, interrupted file recovery, or the full polling result matrix. Native mocks echo submitted settings instead of enforcing Rust normalization (`src/controls.test.tsx:18–32`); focus and real keyboard interactions are mostly simulated by `fireEvent` rather than verified end-to-end. App tests also share a module-level store across cases rather than systematically creating isolated stores (`App.test.tsx:6–26`).

Prioritize F01–F04 regression tests over increasing coverage percentage. Add deterministic injected HTTP/clock and delivery sinks, test both themes/viewport widths in a small repeatable browser suite, and retain a separate packaged OS matrix. Add hooks/accessibility linting only where it protects real behavior; current ESLint config does not include React hooks rules.

### F28 — Every push/PR event can perform duplicated full packaging

**Category:** CI/efficiency. **Severity:** P2 Medium. **Confidence:** Confirmed trigger configuration; duplicate run count not measured here. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** No.

Workflow triggers both `push` and `pull_request` without branch/path filters or concurrency cancellation (`windows.yml:2`). An ordinary PR branch push can launch two Windows build/test/package jobs; superseded commits need not be cancelled. Frontend build is also run explicitly and again by Tauri's `beforeBuildCommand`. Separate fast validation from one intentional packaging checkpoint and deduplicate superseded runs while retaining native tests. Do not weaken checks or remove the installer artifact gate. No workflow change was made during the audit.

### F29 — Documentation mixes old evidence with current behavior

**Category:** Documentation/release. **Severity:** P3 Low. **Confidence:** Confirmed. **Effort:** Small. **Regression risk:** Low. **Native Windows verification:** No, except supplying honest results.

README still says “pin and eye” (`README.md:16`), ROADMAP still lists compilation and testing date ranges as future work (`docs/ROADMAP.md:3`), and VALIDATION contains older 16-test and “CI must execute” text next to the newer update section. PR #1's body still highlights `1de5fbc`/19 Rust tests rather than `ac04df5`/24. These are documentation defects, not evidence current CI failed. Update status once with commit-qualified evidence and keep pending OS checks separate. No document except this audit was changed.

## 14. Accessibility Assessment

Preserve accessible button names, native checkbox inputs, labels for search/range/select, visible focus styles, tabular numerals, semantic group headings, and sibling card actions. Contrast-sensitive low-opacity text overrides and reduced-motion rules are intentional positives.

F07/F09/F10 are the main accessibility refinements: tiny labels/truncated names, inherited-vs-muted announcement, and navigation focus/state. Card bells are 30×32 CSS pixels and footer/window actions approximately 30×30; they are not inherently inaccessible solely because they are below a 44px touch preference. Verify focus clipping near the shell's overflow boundary, label-triggered checkboxes, scrolling to offscreen controls, Windows text scaling, high contrast/forced colors, and Narrator announcement. No WCAG conformance claim or blanket contrast failure is justified without measurements. System high-contrast support is not explicitly implemented.

## 15. Release Readiness and Remaining Risks

**Verdict: NOT READY for public release.** The latest private installer is a usable acceptance-test artifact; green CI and favorable user theme feedback are real progress.

Required gates:

1. Resolve F01–F04 or present an explicit, evidence-based release decision accepting any residual risk. Silent preference loss, stale live scores, and lost subscribed alerts should not be ordinary accepted behavior.
2. Complete F05 on Windows 10 and Windows 11, including minimum width, 125%/150% scaling, bright/dark wallpaper, offline/reconnect, subscription/mute restart, taskbar/tray, compact dimensions, autostart, and uninstall. Record exact artifact SHA/OS/WebView2 versions. Monitor disconnection and sleep/resume are essential desktop checks, even if their fixes are conditional on observed failure.
3. Resolve F06 public-use rights and F25 distribution/security decisions. No public release should be published as part of this audit.
4. Cover partial failures and bounded rate-limit recovery; reconcile frontend authoritative state. Keep documentation current and describe score-update notification limitations honestly.

Not implemented, rather than hidden bugs: detailed scoring events/goalscorers/statistics, a formal interchangeable provider interface, deterministic native demo transitions, explicit sleep/resume handling, dedicated runtime monitor recovery, HTTP-date Retry-After, and automatic updates. System theme selection is optional and absent; dark/light selection exists. Rich analytics, multiple competitions, an account system, and a database are not needed for v1.0. Events/statistics can remain explicitly unavailable if the release scope is revised to match; they should not be represented as delivered original requirements.

## 16. Master Table of All Findings

“Native” means OS verification for the fix or acceptance evidence, not that this audit performed it. Full evidence, impacts, recommendations, and qualifications are in each finding above.

| ID | Category / finding | Severity | Confidence | Effort | Regression risk | Native |
| --- | --- | --- | --- | --- | --- | --- |
| F01 | Reliability: non-atomic state and destructive recovery | P1 High | Confirmed | Medium | Medium | Yes |
| F02 | State: fresh snapshot discarded during save | P1 High | Confirmed/reproduced | Small–Medium | Medium | Recommended |
| F03 | Data: successful fixtures discarded on daily failure | P1 High | Confirmed | Medium | Medium | Helpful |
| F04 | Alerts: failed delivery loses start/goal | P1 High | Confirmed | Medium | Medium | Yes |
| F05 | Release: incomplete Windows acceptance | P1 High | Needs Testing | Medium | Low | Yes |
| F06 | Release: unresolved public data/asset rights | P1 High | Needs Testing/review | Medium–Large | Low–Medium | No |
| F07 | UI: dense small window and tiny labels | P2 Medium | Confirmed / Needs Testing for DPI | Small | Low | Yes |
| F08 | UI: layered style overrides | P3 Low | Confirmed | Small–Medium | Medium | Recommended |
| F09 | UX: alert inheritance/mute ambiguity | P2 Medium | Confirmed design issue | Small | Low–Medium | Recommended |
| F10 | Accessibility: focus and section state | P2 Medium | Confirmed gap | Small | Low | Yes |
| F11 | UX: unexplained filtered empty state | P2 Medium | Confirmed | Small | Low | No |
| F12 | UX: no-op/inapplicable controls | P3 Low | Confirmed | Small | Low | Partly |
| F13 | State: recovered errors remain visible | P2 Medium | Confirmed | Small | Low | No |
| F14 | State: normalized settings not reconciled | P2 Medium | Likely visible divergence | Small–Medium | Medium | Recommended |
| F15 | Data/UI: unplayed fixtures can look 0–0 | P2 Medium | Confirmed conditional path | Small | Low | No |
| F16 | Time: stale local date context | P2 Medium | Likely | Small | Low | Yes |
| F17 | Reliability: blocking work under state lock | P2 Medium | Likely runtime impact | Medium | Medium | Yes |
| F18 | Platform: resume/monitor/worker recovery | P2 Medium | Needs Testing | Medium | Medium | Yes |
| F19 | Provider: Retry-After bypass/cap/date gaps | P2 Medium | Confirmed | Small–Medium | Medium | Optional |
| F20 | Reliability: failed client never rebuilt | P3 Low | Confirmed path | Small | Low | Optional |
| F21 | Performance: broad subscriptions/repeated work | P3 Low | Likely cost | Small | Low | Profile |
| F22 | Hardening: response/state/log bounds | P2 Medium | Confirmed gap | Small–Medium | Low–Medium | Recommended |
| F23 | Architecture/testing: provider/clock integration seam | P2 Medium | Confirmed | Medium | Medium | No |
| F24 | Alerts: suppression tradeoffs | P2 Medium | Confirmed/intentional | Small–Medium | Medium | Yes |
| F25 | Security/release: supply-chain/signing assurance | P2 Medium | Confirmed gap | Small–Medium | Low | Signing check |
| F26 | Maintainability: compressed UI/runtime concentration | P2 Medium | Confirmed | Medium | Medium | Affected flows |
| F27 | Testing: missing boundary/failure coverage | P2 Medium | Confirmed | Medium | Low | Yes |
| F28 | CI: duplicated packaging opportunities | P2 Medium | Confirmed configuration | Small | Low | No |
| F29 | Docs: stale status and evidence | P3 Low | Confirmed | Small | Low | No |

No P0 finding is asserted. Multiple classifications in a confidence cell deliberately separate proven source behavior from untested frequency/native impact.

## 17. Top 10 Recommended Improvements

1. **Protect saved state first (F01):** atomic replace, backup, explicit corruption recovery and fault tests.
2. **Make feed snapshots authoritative during preference writes (F02/F14):** reproduce both race orderings and reconcile normalized settings.
3. **Commit partial provider success (F03):** separate fixture and score freshness/failure handling.
4. **Separate notification planning from acknowledgment/retry (F04):** bounded persistent pending events, no historical replay.
5. **Record the actual Windows acceptance matrix (F05/F18):** use the already-built artifact, especially restart/notifications/DPI.
6. **Settle public distribution rights and assurance (F06/F25):** provider/crests, notices/license, signing and dependency review.
7. **Enforce server-directed retry deadlines (F19):** both Retry-After forms and manual-refresh feedback.
8. **Clarify per-match inheritance and filtered empty states (F09/F11/F13):** small UI changes with high trust value.
9. **Improve keyboard focus/state announcements (F10) and validate small text (F07):** retain the current design.
10. **Reduce accidental build/review cost (F08/F26/F28/F29):** deduplicate CI and make existing components/services readable before adding features.

## 18. Quick Wins vs Larger Investments

| Small, bounded tasks | Medium investments | Optional/later |
| --- | --- | --- |
| Clear recovered load errors | Atomic state/backup recovery | Rich events/goalscorers |
| Explain filtered empty schedule | Feed-result/freshness reconciliation | Additional competitions |
| Announce active settings/focus | Notification plan/ack retry boundary | Licensed-provider adapter after rights decision |
| Per-match reset to inheritance | Inject HTTP/clock for poller tests | Automatic updater with signing strategy |
| Fix postponed score presentation | Windows acceptance and corrective fixes | Generated IPC bindings if maintenance warrants |
| Refresh stale documentation | Persistence coalescing/lock narrowing if measured | Virtualization only after profiling |
| CI concurrency/trigger deduplication | Explicit provider interface during replacement | System-theme mode |

Small visual work should not displace F01–F04. No large frontend dependency, database, or broad redesign is indicated by the evidence.

## 19. Proposed Phased Improvement Roadmap

### Phase 1 — Critical bugs and reliability

**Relative effort:** Medium overall, delivered in independent focused changes. **Release blockers:** F01–F04; rate-limit compliance F19 should be included before public launch. **Dependencies:** Test seams for persistence, snapshots, HTTP, and delivery.

- Task A: Atomic snapshot repository. Touch native persistence plus fault tests; preserve current schema, recover corrupted file without overwriting it, and verify Windows replacement semantics. Acceptance: old state survives failed write; backup recovery retains favorites/bells.
- Task B: Store reconciliation. Touch store plus bridge tests; reproduce the proven race, retain newest feed data and pending preferences, and reflect backend-normalized settings. Acceptance: both old and new response orderings pass, with no extra ESPN request.
- Task C: Partial provider results/deadlines. Touch poller/provider seams plus tests. Acceptance: valid future fixtures survive daily failure, stale scores remain marked, numeric/date retry deadlines survive Refresh.
- Task D: Delivery acknowledgment. Touch alerts/delivery persistence plus injected sink tests. Acceptance: fail-once succeeds later exactly once within the documented process/retry contract; expired events do not replay after restart.

### Phase 2 — High-impact UX and UI improvements

**Relative effort:** Small–Medium. **Dependencies:** Stable state contract from Phase 1. **Release significance:** F09/F10/F11/F13 are targeted trust/accessibility work; typography polish is conditional on Windows evidence.

- Task E: Alert state clarity, single-match inheritance reset, and team-alert labels. Preserve current bell appearance and two themes.
- Task F: Recovery/empty-state messages, postponed score treatment, focus transfer/return, and active section announcement. Include keyboard and both-theme 320px checks.
- Keep 390×700 and compact-off defaults; only adjust dimensions if actual testing demonstrates a problem.

### Phase 3 — Performance and maintainability

**Relative effort:** Medium, selectively scoped. **Dependencies:** Correctness tests from Phases 1–2. **Release blockers:** Response bounds and worker recovery if verified failures exist; broad refactors are not automatic gates.

- Task G: Profile first, then narrow subscriptions and coalesce writes where justified; add response bounds/log rotation. Record native startup/idle/process-tree memory with declared hardware.
- Task H: Extract existing view components/native services and consolidate CSS without behavior changes. Deduplicate CI packaging/concurrency and enforce lockfile/advisory checks in a separate small workflow task.

### Phase 4 — Final Windows testing and release preparation

**Relative effort:** Medium, with unknown corrective effort until testing. **Dependencies:** Phases 1–2 fixes in one validated installer; rights review can run before them. **Release blockers:** F05/F06 and unresolved high-impact OS defects.

- Task I: Execute Windows 10/11 acceptance, permissions/toasts, both subscription paths, minimize/tray/quit, compact/restart, auto-start, offline/resume, monitor disconnect, 100%/125%/150%, and uninstall. Record exact artifact and outcomes in one authoritative document.
- Task J: Public-use rights/license/notices/signing decision, refreshed README/PR evidence, known limitations and privacy/network disclosure. Verify the final artifact once; do not package after every styling change.

### Phase 5 — Optional future enhancements

**Relative effort:** Variable; excluded from the v1.0 release-critical queue. Add properly sourced event details, deterministic demo transitions, system theme, or more competitions only after correctness/rights decisions. A provider replacement becomes mandatory only if public-use review requires it; it is otherwise an optional evolution. No account, telemetry, SaaS shell, or speculative analytics expansion is recommended.

## 20. Final Recommendations

Keep the product identity and architecture. Fix observable state and failure-boundary defects before adding functionality. Use the current successful installer for the outstanding acceptance matrix; this audit does not justify an expensive new build by itself.

**Recommended first implementation task:** F01, a small native snapshot persistence/recovery service with atomic replacement, a backup, non-destructive corruption handling, and deterministic fault tests. It protects all other work and reduces the cost of testing notification/restart changes. F02 is the best next narrow task and has an already demonstrated reproduction.

Release only after the high-priority fixes, public-use review, and exact-artifact Windows evidence support a revised verdict. Current status remains **NOT READY for public release; suitable for private acceptance testing**. All recommendations await user review; no fixes were implemented during this audit.
