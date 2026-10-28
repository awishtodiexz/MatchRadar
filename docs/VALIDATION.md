# Validation and Windows runtime checks

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
