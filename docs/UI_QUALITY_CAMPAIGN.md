# UI quality campaign

## Scope and evidence

Local branch `feature/premier-league-match-centre`, starting at `7d138a1`, with pre-existing uncommitted `AGENTS.md`, lineup and statistics changes preserved. The Edge/Playwright browser used the production frontend in explicit Demo Data mode, a fixed 29 October 2026 clock, London timezone, reduced motion and blocked external HTTPS requests. These were **scripted browser interactions**, not a manual native-app walkthrough. The computer-use native pipe and browser access host were unavailable, so the requested manual exercise remains outstanding. The browser uses initials when external crests are blocked.

## Exercised scenarios

The campaign and existing Verification Lite suite passed these distinct browser scenarios:

1. Home with labelled demo data.
2. All fixtures filter.
3. Live filter.
4. Following filter.
5. Upcoming filter.
6. Results filter.
7. Inherited team-default bell.
8. Explicitly subscribed bell.
9. Explicitly muted bell and reset to team defaults.
10. Match card opens Details independently of its bell.
11. Details Overview.
12. Timeline with fictional events.
13. Paired Stats.
14. Grouped Lineups and a long player name.
15. Keyboard Home within Match Centre tabs.
16. Escape returns focus to the match card.
17. Scroll position restoration on return home.
18. Club search with no matches and clearing search.
19. Settings tab keyboard End navigation.
20. All four Settings sections in compact and expanded layouts.
21. Following-only empty state after unfollowing clubs.
22. Show all matches recovers from the filtered empty state.
23. Simulation progression through first half, half-time, second half and full-time.
24. Full-time simulation appears in Results and its penalty appears in Timeline.
25. Simulation reset returns to the scheduled state.
26. Upcoming match shows an unavailable timeline and omits empty tabs.
27. Dark/light appearance switching and 70%/100% opacity controls.
28. Narrow Settings and Details overflow and fixed footer visibility.

The existing deterministic frontend tests separately exercise stale summary responses, switching to demo while a real response is pending, settings-save ordering, and unavailable/retry states. Those are mocked IPC tests, not browser or native network verification.

## Visual review

The scripted matrix captured Home, App settings, Timeline, Stats and Lineups at 320px and 390px, dark and light, compact and expanded, 70% and 100% opacity. Eight combinations each exercised both opacity settings; horizontal overflow and footer reachability were checked. The full set is in ignored artifacts under `verification/artifacts/browser/campaign-visual-*` and is overwritten by subsequent Playwright runs; these are not approved visual baselines. Four reviewed captures are retained here: [320 dark compact Stats](screenshots/ui-campaign/320-dark-compact-stats.png), [320 light compact Home](screenshots/ui-campaign/320-light-compact-home.png), [390 dark expanded Timeline](screenshots/ui-campaign/390-dark-expanded-timeline.png), and [390 light expanded Lineups](screenshots/ui-campaign/390-light-expanded-lineups.png). These are browser demo captures with offline crest fallbacks, not Windows app screenshots.

Representative captures inspected directly: 320px dark compact Stats at 70%, 320px light compact Home at 70%, 320px dark compact App settings at 100%, 320px light expanded Stats at 100%, 390px dark expanded Timeline at 100%, 390px dark compact Home at 100%, 390px light expanded Lineups at 100%, and 390px light expanded App settings at 70%. They retain the established MatchRadar styling and show expected scrolling. The matrix does not substitute for inspection over a real bright wallpaper, Windows text scaling, high DPI or the native WebView.

A further direct review covered 320px dark expanded Timeline at 100%, 320px light expanded Home at 70%, 390px light compact Stats at 70%, and 390px dark compact Lineups at 70%. In these captures the visible columns, names and controls remain within the panel; content below the fixed footer requires the intended details scroll. The reduced-opacity dark capture was rendered against the browser's background and does not establish contrast over arbitrary desktop wallpaper.

The remaining four width/theme/size/opacity combinations were also inspected: 320px dark expanded Stats at 70%, 320px light compact Timeline at 100%, 390px dark expanded Home at 70%, and 390px light compact Lineups at 100%. Across the 16 representative combinations the fixed footer remains visible and no horizontal clipping is evident in the inspected frames. Compact Match Centre shows limited content before scrolling. A subsequent scripted check scrolled the long lineup name into view and verified a nonzero details scroll position in each combination; manual wheel and keyboard scrolling still need inspection. These observations are not a contrast measurement.

## Findings and changes

No new product defect was confirmed in this campaign. Two exploratory test failures were test-locator errors: an ambiguous `App`/`Appearance` tab match, and an exact text locator that included a nested status label. Both locators were corrected; the screenshots showed the expected app state. They are not counted as application fixes.

The earlier uncommitted fixes present at campaign start remain: a missing-team lineup now reports “Lineup unavailable”, and real ESPN possession/shots/corners use the correct leading-value accent. Their existing regression tests remain in place. This campaign added `verification/browser/campaign.spec.ts` for the additional journeys and visual matrix; it did not modify the app's approved card layout or native reliability code.

## Verification and remaining work

- First completed scripted walkthrough: 9 tests passed. The initial failures described above were corrected.
- Second scripted walkthrough, including existing Verification Lite and the additional lineup-scroll assertion: `npm run verify:ui` passed 19 tests in 16.2 seconds.
- `npm run verify:fast`: lint, TypeScript and production build passed; 71 frontend tests passed.
- Real/demo native notification isolation, persistence, native window sizing, tray, sleep/resume and DPI remain subject to Windows CI and packaged-app testing. The local machine lacks MSVC `link.exe`; native tests were not run.
- **Not completed:** 20 manually operated browser scenarios and a manual second walkthrough, because the interactive browser host is unavailable. Scripted checks and screenshot review are useful evidence but do not satisfy that manual requirement. No claim of exhaustive visual or accessibility correctness is made.
