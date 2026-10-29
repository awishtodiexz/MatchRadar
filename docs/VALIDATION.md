# Validation and Windows runtime checks

## F01–F04 consolidated reliability validation

This integration preserves the audit baseline in `V1_COMPREHENSIVE_AUDIT.md`; its findings describe the pre-fix `ac04df5` implementation. The combined changes cover atomic snapshot replacement/recovery (F01), independent feed/settings ordering and Rust normalization (F02/F14), partial provider results with source freshness (F03), and a bounded durable submission queue (F04). No public-release readiness is implied.

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
