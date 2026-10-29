# UX polish and interaction consistency

## Scope and findings

Starting point: local `8825c4b` (67 frontend tests and 21 browser tests). The available recording shows an older build; all findings below were reproduced against the current code. Browser checks use test-only mocked IPC and blocked external crest requests, so initials are visible and they are not native Windows verification.

1. **Open match score fallback:** a newer snapshot updated Details, but a later snapshot omitting that match reverted to the originally selected score. A regression test reproduced the reversal. Details now retains the latest observation, marks an omitted live match as saved, and accepts a later confirmed update.
2. **Focus after disappearing controls:** resetting one match, muting an ended subscribed match, resetting all match bells, and clearing a no-results club search removed the focused control and left focus on the document body. Focus now moves respectively to the alert heading, Alerts panel, or search input. Regression tests verify keyboard focus and Escape behavior.
3. **Ended alerts:** an ended match without an override claimed existing alerts could be muted or reset, although no such actions were available. Copy now reflects inherited, subscribed, and muted states. No notification eligibility or persistence logic changed.
4. **Details refresh and partial information:** retrying with cached details inserted a skeleton above existing content, moving it. A skeleton now appears only on an initial empty load, while the region reports busy state. An unavailable summary previously repeated two unavailable messages; it now shows one error and Retry. A single event now uses singular grammar. Details retain the existing match header and available-data-only tabs.

## Scenario walkthrough

The following distinct checks passed. “Browser” means scripted Edge/Playwright with a test-only bridge; “unit” means Vitest with controlled data. They are not manually operated native-app checks.

| # | Scenario | Outcome / evidence |
| --- | --- | --- |
| 1 | All fixtures view | Cards visible; browser `widget` |
| 2 | Live filter | Matching cards and pressed state; browser `widget` |
| 3 | Following filter | Matching cards and pressed state; browser `widget` |
| 4 | Upcoming filter | Scheduled cards; browser `widget` |
| 5 | Results filter | Completed cards; browser `widget` |
| 6 | Following-only empty and recovery | Explanation and Show all; browser `campaign` |
| 7 | Scheduled details | Venue, pre-match text and no empty tabs; browser `widget` and `ux-polish` |
| 8 | Live details | Score, status and details visible; browser `ux-polish` |
| 9 | Halftime details | Halftime status and details visible; browser `ux-polish` |
| 10 | Completed details, inherited alerts | Ended copy and no unavailable opt-in action; browser `ux-polish` and unit `usability` |
| 11 | Completed subscribed/muted alerts | Only applicable actions and copy; unit `usability` |
| 12 | Initial summary loading | Skeleton and alerts remain reachable; browser `ux-polish` |
| 13 | Failed summary | One error and Retry; browser `ux-polish` |
| 14 | Cached summary refresh | Data stays visible without an inserted skeleton; unit `MatchCentre` |
| 15 | Cached scoreboard failure | Saved live status, cards and Retry; browser `ux-polish` |
| 16 | Match score update and temporary omission | Latest score retained and marked saved, then reconfirmed; unit `usability` |
| 17 | Rapid details navigation | Prior response cannot replace the current match; unit `useMatchSummary` |
| 18 | Results close/reopen with out-of-order response | Newer result retained; unit `useRecentResults` |
| 19 | Results error with prior cache | Existing result data retained; unit `useRecentResults` |
| 20 | Keyboard match bell | Space enables; Details state matches; browser `ux-polish` |
| 21 | Explicit mute and return to team defaults | State and bell synchronize; browser `ux-polish` |
| 22 | Followed-team goals and match overrides | Team preference and inherited state remain distinct; browser `ux-polish` |
| 23 | Reset one alert with another retained | Other preference preserved and focus retained; unit `usability` |
| 24 | Reset all match alerts | Focus stays in Alerts and Escape returns to Settings; browser `ux-polish` and unit `usability` |
| 25 | Search no results and clear | Focus returns to search; browser `campaign` and unit `usability` |
| 26 | Settings tabs | Teams, Appearance, Alerts and App accessible; browser `campaign` |
| 27 | Settings keyboard tabs | Arrow and End navigation, Escape and focus restoration; browser `ux-polish` |
| 28 | Toolbar pin | Pressed state, tooltip and Appearance preference agree; browser `ux-polish` |
| 29 | Toolbar following-only | Pressed state agrees with Teams setting; browser `ux-polish` |
| 30 | Source freshness | SCORES CHECKED shown; saved/error states remain distinct; browser `ux-polish`, unit `freshness` |
| 31 | Details focus and home scroll | Escape restores originating card and scroll; browser `widget` |
| 32 | Timeline, Stats and Lineups | Tabs and keyboard Home navigation; browser `campaign` and `widget` |
| 33 | Long lineup text | Scrolls into view in each layout matrix; browser `campaign` |
| 34 | 320/390 widths, dark/light, compact/expanded, 70%/100% opacity | Matrix checks settings/detail horizontal overflow and fixed footer; browser `campaign` |
| 35 | Browser-only controls | Minimize and startup disabled with descriptions; unit `usability` |
| 36 | Offline/empty/loading distinction | Empty schedule, failed update and startup skeleton distinct; unit `usability` |

The scheduled, live, halftime and completed screenshots were revisited after changes at 320px light compact and 390px dark expanded. Representative 320px and 390px settings and Home captures at 70%/100% were inspected. Captures live in ignored `verification/artifacts/browser` and are regenerated by the suite; they are not approved visual baselines. Reduced-opacity browser backgrounds are not a bright-wallpaper contrast test.

## Verification and limits

- `npm run verify:fast`: 74 frontend tests passed, plus lint and production frontend build.
- `npm run verify:ui`: 28 browser tests passed. Run outside the sandbox for Windows preview-server process cleanup.
- The real-data changes and previous Results/Live behavior were retained; no Rust, native persistence, F01–F04 notification logic, demo mode, or dependencies were added or changed.
- Browser/mock tests do not prove native IPC, persisted state across an installed-app restart, OS notification display, tray/background behavior, autostart, wallpaper contrast, DPI scaling, monitor recovery or sleep/resume. Those remain Windows integration checks. Local Rust compilation was not attempted in this frontend-only campaign; the prior report documents missing MSVC `link.exe`.
- No push, merge, CI trigger, installer build or release was performed in this campaign.

## Local checkpoint

- `909267b` — match-state retention, alert and search focus, details loading/error copy, and browser walkthrough.
