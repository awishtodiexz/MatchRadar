# Validation and Windows runtime checks

For the real-data campaign, current test results, request observations and remaining checks, see the [archived real data quality report](archive/REAL_DATA_QUALITY_REPORT.md). Browser verification uses a test-only IPC bridge and does not verify a native installation.

Demo mode has been removed; earlier demo references below describe historical checks. Browser checks now use test-only mocked IPC.

For the latest feature-branch evidence and acceptance checklist, see the [archived Match Centre integration report](archive/MATCH_CENTRE_EVOLUTION_REPORT.md). Earlier sections below are historical checkpoints and do not validate later commits.

## Current status — 6 November 2026

- `main` at `40c9f05`: Windows validation run [42179795144](https://github.com/awishtodiexz/MatchRadar/actions/runs/42179795144) passed in 3m47s. Installer packaging is skipped on branch pushes and runs for `v*` tags or manual dispatches.
- MSVC build tools are available locally. `scripts/build-local.ps1` passes lint, 74 frontend tests, the production build, Rust formatting, 87 Rust tests, and produces `MatchRadar_1.0.0_x64-setup.exe` (about 3.35 MB; the SHA-256 changes on each rebuild).
- The packaged app cannot be launched from the coding-agent sandbox (WebView2 and app-data access are blocked there), so tray, notifications, autostart, DPI, sleep/resume and monitor recovery still require manual Windows checks.
- Version 1.0.0 exists as a private GitHub release with the CI-built installer.

> Sections below are dated checkpoints. Statements about unavailable MSVC, demo mode, or unbuilt installers describe those dates, not current status.

## Match detail redesign — 7 November 2026

Real ESPN summaries drove the redesign: the live Arsenal–Hull City summary had only six keyEvents (including delay markers) but 42 commentary entries; the completed Leeds–Tottenham summary had 40 keyEvents and 118 commentary entries. Broader summaries also expose scorer participants, formations, shirt numbers, formation places and substitution flags. MatchRadar now merges unique commentary with keyEvents, requires a clock before placing a commentary event, derives halves from the provider period/text/clock, and extracts scorers with own-goal/penalty flags.

Verified in the running debug build at 390px and 320px: the Overview shows scorers with minutes/teams, possession/shots/on-target/corners, latest events and venue; Timeline groups first/second half with labeled shots, corners, fouls, cards and goals; Lineups switch by team and show formation, shirt numbers and substitutes; the live minute moved to a status pill (LIVE/HALF-TIME/FULL-TIME) and cards use a clock pill above the score; Match alerts is a compact row. No horizontal overflow was observed, and scorer data matched the provider.

Automated checks: 108 Rust tests, 90 frontend tests, 28 Playwright journeys, lint, production build, Rust formatting and the version check pass. `scripts/build-local.ps1` produced `MatchRadar_1.2.0_x64-setup.exe` (3,414,514 bytes, SHA-256 `28BE82B06B5FECFD3B74E4972B8132F6794ABA5CD29FCD2731A41999F3BF10CA`) locally; it has not been installed or published. This is not packaged Windows acceptance.

### Refresh measurements — 6 November 2026

Three manual refreshes from the running debug build (real ESPN data, both competitions) each issued **5 scoreboard HTTP requests**: one Premier League fixture month, one PL score day, two Champions League fixture months (its 30-day window crossed November/December) and one UCL score day. Manual refreshes deliberately force both competitions; ordinary polling keeps fixture queries to six-hour intervals per competition.

After those refreshes, the debug process was sampled every five seconds for 60 seconds: working set **101.1–101.2 MB**, private memory **9.0–9.1 MB**, thread count settling from 33 to 29. This is a debug build including WebView2, not the packaged release; it is a short stability check, not a long soak or installer measurement. Release packages should be re-measured after installation.

## Release 1.1.0 local installer — 6 November 2026

`v1.1.0` was packaged locally with `.\scripts\build-local.ps1`, not from a GitHub Actions artifact. The script passed locked dependency installation, lint, **88 frontend tests**, the production frontend build, Rust formatting and **107 Rust tests**, then compiled the release binary and produced `MatchRadar_1.1.0_x64-setup.exe` (3,381,075 bytes, SHA-256 `ABCA3D48AB8379977ABB52C563D2BBFE852D28ED6FD12A35D192DCAEED8AF641`). The installer is unsigned and was not executed or installed in the coding sandbox; packaged runtime behavior still needs the [Windows checklist](#packaged-windows-acceptance-checklist).

## Off-screen window recovery — 6 November 2026

`src-tauri/src/window.rs` recovers the widget when no attached monitor shows a usable part of it (at least 64×48 physical pixels). Recovery runs after window-state restoration, on focus and scale-factor changes, and from a 30-second watchdog, because Windows can remove a display without delivering a window event. It centers on the primary work area (or a monitor that still overlaps), skips hidden/minimized windows, and pins oversized widgets to the work area's top-left. Placement is a pure function; the Tauri wrapper only reads monitors and applies the result.

Nine deterministic unit tests cover fully lost, sliver, usable, spanning, detached-primary, oversized, taskbar-inset, no-monitor and idempotent cases. `cargo test --locked` passed 96 tests with the Visual Studio developer environment and `TEMP` redirected under `src-tauri/target`; a plain shell still reproduces the documented MSVC `D8050` temp-directory failure. `cargo fmt --check` and `npm run verify:fast` (74 tests, lint, production build) pass. No installer was built for this change.

The native window path was also exercised on this machine, outside the packaged app. The sandbox blocks WebView2's default profile and app-data writes, so the debug binary was built with a test-only `appDirectoriesOverride` pointing at `src-tauri/target/.build-temp/appdata` and launched with `WEBVIEW2_USER_DATA_FOLDER` inside the workspace. Using `SetProcessDpiAwarenessContext` and Win32 `GetWindowRect`/`SetWindowPos` against the running 390×700 window:

- Moved to `(12000, 12000)`: the watchdog returned it to `(757, 161)`, centered in the 1920×1080 work area, without a restart.
- Placed at `(1720, 100)` with 200 physical pixels visible: unchanged after 34 seconds (no false positive).
- Placed at `(1900, 100)` with a 20-pixel sliver visible: recovered to `(757, 162)`.

The test instance was stopped, the temporary app-data directories were removed, and the normal debug binary was rebuilt. This validates the placement arithmetic, monitor enumeration, watchdog cadence and Win32 integration on Windows 11, but not tray restore, physical monitor removal, mixed-DPI layouts or the packaged installer.

Packaged Windows checks: move the widget to a secondary display, disconnect that display, and confirm the widget reappears centered on the primary within 30 seconds; repeat with the app hidden to tray, then show it. Change display scale, resolution and arrangement; test negative-origin (left/above) monitors; and confirm taskbar space is respected. Verify that intentionally edge-docked windows with a usable visible patch are not moved, and that focus/scale events do not cause placement loops at mixed DPI.

## Champions League — 6 November 2026

Direct ESPN probes verified the `uefa.champions` routes: monthly scoreboards returned 36 events for `202610` and `202611`, the daily query for `20261106` returned a valid empty schedule, and `summary?event=401915418` returned 22 key events, two boxscore teams and two rosters. Date ranges still return HTTP 400, so monthly fixture queries were retained.

A local debug build (embedded frontend, workspace app-data override and isolated WebView2 profile because the coding sandbox blocks `%APPDATA%` and the default WebView2 profile) fetched 10 Premier League and 18 Champions League fixtures in one cycle, with independent `eng.1` and `uefa.champions` status entries. Captures at 390px and the 320px minimum showed the Premier League, Champions League and Both layouts; Both used `PL`/`UCL` card tags and a single chronological list. Opening Results through the WebView2 debug protocol fetched 18 UCL and 20 PL completed matches, each retained under its own status key. Three completed UCL summaries requested through the app's own `get_match_details` IPC returned 16–28 events, 56 statistics and 45–46 players each, correctly attributed to `championsLeague`.

Automated checks passed: `cargo fmt --check`, 107 Rust tests, lint, 82 frontend tests, the production build, and 28 Playwright journeys at 320/390px in both themes. This was a debug build with test-only path overrides, not the packaged installer. No live UCL fixture was available, so live/halftime summary shapes remain unverified; notification delivery, tray behavior, DPI and sleep/resume still require packaged Windows checks.

## Verification Lite

The subsequent targeted demo/live isolation change adds native regression tests for persisted pending alerts, separate demo preferences, restart, expiry, score corrections, synthetic event suppression and rapid mode changes. `verify:fast` passed 69 frontend tests and `verify:ui` passed seven Edge tests; Rust formatting passed. Local `cargo check --locked` stopped because MSVC `link.exe` is unavailable, so those new native tests and packaged notification behavior still require Windows CI and runtime verification.

Run `npm ci`, then use these commands from the repository root (`npm.cmd` if needed in PowerShell):

- `npm run verify:fast`: existing ESLint, all frontend tests, and TypeScript/production build. Stops on failure.
- `npm run verify:ui`: builds the frontend and runs seven Playwright journeys against a local production preview in installed Microsoft Edge. Covers all fixture filters, independent bells, Match Centre tabs and keyboard navigation, back-navigation scroll/focus restoration, both themes, unavailable details, and 320/390px overflow. The server is started and stopped by Playwright; port 1420 must be free.

Browser tests fix time, locale and timezone, disable motion, block external HTTP and use test fixtures. No native IPC or notifications are sent. Failure screenshots and traces are saved under ignored `verification/artifacts/browser/`; inspect a trace with `npx playwright show-trace <path-to-trace.zip>`. There are no automatically accepted screenshot baselines. Stable behavioral assertions and failure screenshots keep the suite small; pixel comparisons can be added later for a demonstrated regression.

The existing Windows workflow remains responsible for Rust compilation/tests and builds the installer on version tags and manual dispatches. Browser coverage does not certify native notifications, tray/autostart, window sizing, sleep/resume, monitor handling or DPI. Existing F01–F04/provider/store/cache regression tests are retained rather than duplicated.

Future improvement workflow: identify a concrete issue, reproduce or measure it, make one focused change, run the relevant verification tier, compare the outcome, and retain it only when the intended result improves without regressions. Record meaningful evidence in the relevant change description. Stop when the bounded issue is resolved; do not introduce a campaign engine or change tests to conceal failures.

Local evidence on 29 October 2026: `verify:fast` passed (69 tests in 15 files, ESLint and production build); `verify:ui` passed all seven tests in 4.6 seconds, plus its build. Node v26.12.1 locally; CI uses Node 22. No installer or GitHub run was triggered. The test package is a development-only dependency and the browser harness is outside the bundled `src` tree.

## Recording interaction follow-up — 29 October 2026

The supplied 58.7-second recording shows unwanted browser context menus on Home at approximately 00:46–00:48 and Details at 00:50, plus selected static event text at 00:52–00:54. A shell-scoped context-menu handler now preserves editing/copy menus only on form controls, editable content and explicitly copyable diagnostics. CSS prevents static surface selection while retaining those exceptions. No pointer-down, keyboard, clipboard or native notification behavior changed. The recorded muted/subscribed/team-default transitions match their indicators and existing tests; no bell redesign or additional layout changes were justified.

Frontend lint, all 45 tests, TypeScript/production build and diff checks passed. Two new tests exercise context-menu cancellation across views, nested SVG targets, input editing, selects, textareas, editable descendants and copyable errors. An isolated headless Edge fixture using the actual before/after stylesheet reproduced static text selection and confirmed its suppression with input/editor/error copying preserved; this was a DOM/CSS check, not a packaged-app test. No additional flickering, clipping or scrolling defect was confirmed from the reviewed frames. Verify actual WebView2 right-click and keyboard context menus, input select/copy/paste, keyboard focus and Narrator on Windows. No installer build was requested for this follow-up.

## UI/UX refinement — 29 October 2026

Final card-spacing follow-up: the intermediate 83px live-card measurement below describes the first refinement, not the final layout. The final cards return to centered side-by-side team/result groups, with status confined to the result column, 10px vertical padding, a 7px team-row gap and a separate 32px bell target. Browser measurements in both themes were 86px for scored cards; scheduled cards measured 73px at 390px and 83px at 320px when names wrapped. Card widths were 346px and 284px respectively. This preserves the latest spacing correction; native Windows rendering still needs testing.

These frontend changes are based on `fa67850` and preserve F01–F04. No Rust source, persisted model, provider query, notification delivery code, native capability, workflow or dependency changed. The pending AGENTS.md edit remains untouched. No new installer, push or GitHub run was requested during visual iteration; the earlier `fa67850` installer does **not** contain this UI pass.

Confirmed issues addressed: the league live count used the filtered list; no-followed-match results looked like an empty league schedule; match defaults/mute were hard to distinguish and an individual override could not be reset; view focus and tab selection/keyboard behavior were missing; read/refresh errors survived successful recovery; Windows startup-read failures could disappear on tab changes. Existing saves, normalization, request ordering and partial-source freshness tests remain in the suite. Saved scores keep neutral styling, and a failed scoreboard with no confirmed live observations says Live unavailable.

Local checks pass: ESLint, 43 frontend tests, TypeScript and production Vite build, plus diff checks. Tests cover the above behavior, separate card/bell actions, per-match reset preserving other overrides, native-only action feedback, compact preference preservation, midnight/resume date reconciliation and the existing F02/F14 races. No native Rust tests were rerun for these frontend-only changes; the unchanged Rust implementation previously passed all 60 tests in Windows run [40835349853](https://github.com/awishtodiexz/MatchRadar/actions/runs/40835349853). That run is not validation of this new UI.

Browser evidence uses explicitly labelled demo fixtures. The shared preview supplied baseline screenshots and measurements, but repeated screenshot requests later timed out (`Preview automation snapshot timed out after 15000ms`). An isolated headless Edge session captured the final views using the existing browser and built-in DevTools protocol; no browser package was installed. The review harness, PNGs, comparison HTML and JSON reports are temporary local artifacts under `matchradar-ui-refinement` in the session's temporary directory, not app dependencies or tracked source.

- 96 layout states: Dark/Light × 320/390px × expanded 700px/compact 460px × 70/100% panel opacity × Home, Teams, Appearance, Alerts, App and Details.
- 12 additional states: both themes at 320×460 with emulated device pixel ratios 1.25/1.5 across Home, Appearance and Details. These are browser pixel-density checks, **not** real Windows DPI or text-scaling verification.
- 24 enlarged-text stress states: both themes, all six views, 320px width, font/line-height growth of 25%/50%. This synthetic text stress is not a substitute for Windows accessibility text scaling.
- No document overflow, hidden footer, or more than one content scroll region was found in these matrices. The layout matrix found no clamped team names for the supplied fixtures; full-name titles remain available. Footer targets measured 32px, and shell foreground opacity stayed 1 while background alpha changed.
- Actual browser key events verified Enter into details, Escape back to the originating card, Tab to the selected settings section, Arrow navigation/selected state, and Escape restoration to Settings. Tests additionally cover Home/End and wrapping. Narrator remains untested.
- Browser locale overrides verified 12-hour `en-US` and 24-hour `en-GB` kickoffs with long Wolverhampton/Brighton names at 320px. Filtered-empty results retained the league-wide live count. A separate Tauri SDK IPC mock verified the actual status/timestamp footer during a partial failure; this was controlled sample data and performed no OS notification, native resize or provider operation.

At 390px, measured Settings content starts at y=162 instead of y=199 (37px/approximately 19% less space above the content). The subheader is 64px instead of 92.5px; live cards are 83px instead of 94px (approximately 12% shorter). Controls were not stretched to fill short sections. Modeled sRGB contrast for muted light-theme text at 70% panel opacity over a solid black backdrop improved from approximately 4.43:1 to 4.79:1; this is a palette calculation, not a measured Windows/wallpaper contrast certification.

Compact investigation found no confirmed native sizing defect: `ExpandedSize::compact()` already targets 460 logical pixels, `save_settings()` applies native resize only on compact-preference changes, expanded dimensions are retained, and startup reapplies compact size after window-state restoration. CSS cannot shrink a browser/native outer window. Manual resizing remains allowed while compact is enabled. Without a runtime reproduction, the tall compact screenshot cannot establish which path caused it. Do not add tab-driven resizing or override saved user dimensions to mask it.

Before accepting a new Windows installer, test the actual outer-window size before/after compact toggles, failed-save rollback, expanded restoration, restarting in compact, and moving between different-DPI monitors. Verify both themes at 320/390px, actual 125/150% display/text scaling, keyboard/Narrator focus and tab announcements, tray-opened Settings, native startup feedback, and notification preference/reset behavior with real deliveries. Tab changes must keep native dimensions unchanged. Short Settings sections intentionally retain unused space in an expanded fixed-size window to avoid disruptive resize jumps.

## F01–F04 consolidated reliability validation

This integration preserves the audit baseline in `archive/V1_COMPREHENSIVE_AUDIT.md`; its findings describe the pre-fix `ac04df5` implementation. The combined changes cover atomic snapshot replacement/recovery (F01), independent feed/settings ordering and Rust normalization (F02/F14), partial provider results with source freshness (F03), and a bounded durable submission queue (F04). No public-release readiness is implied.

Local integration checks: ESLint, all 30 frontend tests, TypeScript/Vite production build, Rust formatting, workflow YAML validation, and diff checks pass. Native Rust tests were attempted with the locked dependencies but remain unexecuted locally because MSVC `link.exe` is unavailable. No local MSVC installation or Windows installer build was performed. The Windows workflow must run the complete Rust suite and Tauri packaging for the pushed commit before native build success is claimed; report the exact successful run and artifact separately.

Integration regressions cover source timestamps/errors/stale-score flags arriving during saves, mode-transition freshness isolation and rollback, F03/F04 provider-to-notification interactions, and F01 backup restoration of freshness, pending events, retry timing, settings, baselines, sent IDs, and expanded dimensions. Rust `Option` crest/score values are represented as nullable in the UI types. The pending AGENTS.md edit is intentionally excluded from the reliability commits.

The workflow runs once for PR updates targeting `main`, for pushes to `main`, or manually; PR concurrency cancels superseded runs. All lint/test/build/package/upload gates remain enabled, with locked Rust tests and Rust formatting checks added. This avoids the previous duplicate branch-push/PR packaging pair; it does not establish Windows runtime behavior.

For the exact consolidated installer, record Windows version, commit/run, WebView2 version, DPI, and observed result:

- Quit before copying real `state.json` and `.bak` elsewhere. Restart/restore with saved favorites, match subscriptions, compact/expanded dimensions, theme, and sent IDs. In an isolated test profile, verify damaged-primary backup recovery preserves fresh-source fields and pending events, leaves a `.corrupt-*` diagnostic, and fails visibly when neither primary nor backup is valid. Exercise Windows sharing/antivirus locks and constrained storage without using the only copy of real preferences.
- Confirm fixtures remain visible during scoreboard-only failures, scores update during fixture-only failures, both-source failure preserves cache, and saved scores have no confirmed-live indicator. Source timestamps must not advance on failed requests; valid empty schedules remain distinct from outages.
- Change sliders/toggles rapidly while updates arrive. New scores/errors/source freshness must remain visible, normalized settings must win after acknowledgment, and failed saves must roll back only affected preferences. Cosmetic saves must not issue ESPN requests.
- Verify followed-team and independent match subscriptions, overlapping eligibility, explicit mute, reminders, starts, goals, first-observation suppression, corrections, expiry, and restart deduplication. Keep the app hidden to tray during notification/retry checks. Controlled sink tests simulate submission/storage failures; the normal live UI does not provide failure injection or force real football transitions.
- Exercise actual Windows notification settings/Focus Assist, offline recovery, restart/crash boundaries, and sleep/resume. Plugin 2.8.0 hides late OS delivery errors: a sent ID acknowledges plugin background dispatch, not OS acceptance/display. A crash before acknowledgment persistence can duplicate a submission. See `ARCHITECTURE.md` for retry/expiry bounds.
- Repeat taskbar/tray restoration, pinning, compact sizing, dark/light/opacity, crest fallback, 320px/390px, mixed-monitor and 125%/150% DPI checks from the acceptance list below. No new visual-layout or native runtime pass was performed during this reliability integration.

Remaining public-release blockers include recorded Windows 10/11 acceptance, F19 provider retry-deadline handling, unresolved ESPN/data/crest distribution rights, and release dependency/signing/third-party-notice review. CI success produces a testable private installer; it does not resolve these blockers or mark v1.0 complete.

## Match-bell usability update

Targeted coverage adds separate accessible card actions, match override persistence, mute/reset behavior, compact compatibility, independent eligibility for unfollowed clubs, shared event deduplication, first-observation and offline suppression, score corrections, and conservative expiry. Local frontend lint, 18 tests, and production build pass. The 48-case browser layout matrix was rerun at both themes, 320px/390px, 70%/100% opacity, and expanded/compact views. Local Rust checking remains blocked by missing MSVC `link.exe`; Windows CI must execute the native regression tests before claiming they pass.

On the new packaged Windows build, subscribe to a match with no followed clubs and verify reminder, start, and goal toasts; repeat with overlapping team alerts and verify one toast per event. Turn the bell off and verify team alerts are also muted for that match, then reset to team defaults in Alerts. Restart to check preferences/deduplication. Enable a bell mid-match and reconnect after an outage to check historical-event suppression. Test bell keyboard focus/activation separately from details, and confirm the footer filter matches Teams settings. Browser mocks and CI cannot verify Windows notification permissions or actual delivery.

## Evidence boundary

The user installed and launched an earlier Windows build and observed real fixtures. That does not verify the revised native controls, compact sizing, theme persistence, or notifications in this change. Do not mark v1.0 complete solely because CI builds an installer.

For the current UI changes, frontend lint, the production TypeScript/Vite build, and 16 Vitest/React Testing Library tests passed locally. Coverage includes native minimize wiring, toolbar/settings synchronization, rapid-save races, failed-save rollback, theme/compact serialization through a mocked native bridge, unchanged update timestamps, mode-transition data isolation, fixture grouping, and crest validation/fallbacks. The mocked bridge is not Windows runtime verification.

Rust formatting and native JSON checks passed. Local `cargo check --locked` and `cargo test --locked` were attempted but could not run to completion because MSVC `link.exe` is missing. The new Rust tests cover theme migration, opacity bounds, settings refresh effects, in-flight mode changes, logical compact dimensions, favorite-ID migration, persistence failures, and crest normalization. Execution and native compilation must be confirmed by Windows CI for the intended commit.

A temporary headless Edge harness inspected the built frontend in 48 combinations: Dark/Light, 320px/390px, 70%/100% opacity, and home, Teams, Appearance, details, compact Appearance, and compact home. It checked horizontal overflow, one scroll surface, footer visibility, opaque foreground content, and page errors; representative screenshots were visually reviewed. Compact browser checks used a 460px viewport and do not prove native resizing. The harness and screenshots are local temporary artifacts, not application dependencies.

Direct ESPN HTTP probes verified the scoreboard and teams response shapes and all 23 catalog crest PNGs. Direct CDN requests from the sandboxed headless browser returned `ERR_CONNECTION_RESET`; visual crest inspection therefore replayed the real CDN image bytes fetched through Node. The normal image-error fallback was also exercised. This is not proof of native WebView image delivery; check it in the installed build.

## Packaged Windows acceptance checklist

Install the installer from the successful GitHub run for the intended commit, following `README.md`. Record the commit, OS version, display scale, theme, opacity, and observed result for each check:

- Minus minimizes to the taskbar and restores from it; X hides to the tray. Tray Show / Hide, Settings, Quit, and second-instance restoration work.
- Pin changes the actual always-on-top state; eye immediately filters matches. Both match their Settings controls and survive restart.
- Theme, opacity, compact mode, and favorites persist. Legacy favorites retain the originally selected clubs after the one-time ID correction.
- Compact mode shrinks the actual native window and restores the saved expanded size, including after restarting while compact. Dragging and resizing remain usable at 125%/150% scaling.
- Both themes remain readable over bright/dark wallpapers at minimum opacity. Home, Teams, Appearance, Alerts, and details stay inside 320px/390px windows; only the intended content pane scrolls.
- Cosmetic changes do not change the last-updated time or trigger ESPN requests; explicit Refresh does. Allow for independent scheduled updates when observing this.
- Real fixture and settings crests display, including Fulham and West Ham. A failed crest falls back gracefully, and cached fixtures remain visible offline.
- Notifications, autostart, sleep/resume, and monitor changes are tested separately. Event/statistics details and deterministic demo transitions remain outside the implemented functionality.

Automated build results and artifact URLs should be reported for their exact commit. No release CPU or memory measurements have been made.

## Match Centre integration hardening

The local hardening checkpoint passed 57 frontend tests, lint, TypeScript/build and Rust formatting. A dependency-free scheduling metadata compile succeeded; the full native suite (75 test declarations, not a passing count) remains unexecuted without MSVC link.exe. A 213-state browser matrix and actual browser keyboard/reduced-motion checks passed using recorded fixtures through an IPC mock. See the [archived Match Centre report](archive/MATCH_CENTRE_EVOLUTION_REPORT.md) for exact coverage and the Windows checklist. No Windows installer was built for this checkpoint, and prior installer evidence does not validate it.

## Rich demo and recent-results follow-up

Local lint, 62 frontend tests, TypeScript/production build, Rust formatting and diff checks passed. New tests cover the complete fictional centre through normal card navigation without native IPC, native/browser demo identities, optional event fields, real-results view with empty regular fixtures, on-demand summary loading, historical-source failure and stale-response suppression. New Rust tests cover supported month queries, recorded older results with no today/yesterday matches, the 14-day boundary, empty success, source-isolated partial failure/recovery, cache timing and serialization compatibility. These new native tests remain unexecuted locally because link.exe is unavailable; no installer/CI build was triggered.

Windows checks: enable Demo Data, select Results, open Brighton–Everton and inspect all four sections; verify the fictional-data label and absence of ESPN detail requests/native match alerts. Disable demo and open Results: confirm previous-14-day completed games, independent source timestamp, native six-hour cache reuse, offline results after restart, Retry/backoff and on-demand summaries. Check rapid mode/match switching, saved favorites/preferences, unchanged cards and notification behavior. Previous browser visual evidence does not validate the new native history command.
