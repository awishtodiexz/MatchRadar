# Real data quality campaign

## Recording and scope

The available recording is the 59-second attachment from 29 October 2026. Sampled frames show an older, explicitly labelled sample-data build, light and dark settings, a test-notification request, a browser context menu, and sparse match details. It predates the current filter tabs and does not establish how the current Live or Results views behave, whether a Windows notification appeared, or whether real ESPN data loaded. The requested Live and Results cases were reproduced against the current code using deterministic test data and a test-only IPC bridge.

## Findings and changes

- The Live empty state previously prioritized the active filter over source health. It could say no live matches when scores failed or had never been checked. It now distinguishes a confirmed quiet league, followed-club filtering, unavailable live status, and cached live scores awaiting confirmation. The league count remains independent of following filters. A failed or never-confirmed scoreboard no longer implies a confirmed zero in the league status.
- Scheduled details now show a verified provider-supplied venue when present and use short pre-match copy. Unavailable fields and sections stay absent. Existing crests, local kickoff, competition, match bells and the Details-only tabs remain. Summary cache deserialization defaults the new optional venue to null for old state.
- Results investigation found no new reproducible native cache defect: requests are serialized, six-hour successes are reused, failure cooldowns retain cache, and stale frontend responses are ignored after leaving the view. Added frontend tests cover a delayed empty success and a late response after closing and reopening; the existing tests cover failed refresh with retained data. The native recent-results tests cover partial/failure retention and UTC date boundaries, but were not executable locally in this campaign.
- The test-notification command reports whether the plugin call was accepted; its UI asks the user to check Windows if nothing appears. The plugin's Windows submission path cannot prove OS display. No notification-delivery behavior was changed.

## ESPN observations

Six successful, read-only requests were made: two each for `eng.1/summary?event=401879268` and `401879250`, and one each for `eng.1/scoreboard?dates=20261029` and `dates=202610`. Two initial sandboxed summary requests failed to connect and were retried outside the sandbox. The day response contained zero events; the month response contained 38 events (30 `post`, eight `pre`). These are point-in-time observations of an unofficial API, not guarantees.

The completed summary supplied provider-written event text, clock and period, team statistics and rosters. The reduced recorded fixture contains goals, yellow cards and substitutions, with 11 starters and nine non-starters per team. Event ordering remains period/clock-based and preserves provider stoppage-time labels. Scores continue to come from the scoreboard, not inferred event text. The scheduled summary supplied `gameInfo.venue.fullName` but no roster entries or officials; its four team-stat fields were pre-match season totals and are excluded from match stats. Both sampled venues were available. Live/halftime summary shapes and referee availability were not verified in this campaign. Source data and crest licensing remain unresolved for distribution.

## Request and cache behavior

Code review shows a 15-second provider client timeout and non-overlapping scoreboard refresh. Ordinary score polling targets 60 seconds for live matches, five minutes near kickoff, and 30 minutes otherwise; it requests today and, only when a cached match from yesterday is still live, yesterday. Fixture refresh requests one or two months, normally no more often than six hours. Manual refresh requests fixtures and scores but cannot bypass the failure deadline. Numeric and HTTP-date Retry-After are recognized. Results request one or two months on demand, use a separate six-hour successful cache and at least five-minute failure cooldown, and never enter notification planning. Summaries are requested on opening details, with 60-second active and 15-minute other-match cache lifetimes; summary requests are serialized and cached entries are bounded. These are code-path observations, not a measured background traffic trace or proof of hidden-window behavior.

## Verification

- `npm run verify:fast`: lint and build passed; 65 frontend tests passed.
- `npm run verify:ui`: 21 Edge/Playwright tests passed with test-only IPC; 320px and 390px, both themes, compact/expanded views, scrolling, focus and pre-match venue were exercised. Representative scheduled-details screenshots were inspected in both themes. The browser runner required unsandboxed execution for Windows child-process cleanup.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed. Local `cargo test` and `cargo check` cannot compile because MSVC `link.exe` is unavailable; the new Rust venue and captured-response tests have not run. The previously started Windows CI for starting commit `4dfe1ab` passed its Rust tests, but does not validate this campaign's later commit.
- No new native build or installer workflow was started, and no push, merge, or release was performed during this campaign. A Windows workflow started before this request was already running. Browser mock results do not establish real IPC, provider delivery, wallpaper contrast, OS notification display, tray, startup, sleep/resume, monitor recovery, or DPI scaling.

## Remaining Windows release-candidate checks

Run Rust checks/tests and package the intended commit on a Windows machine with MSVC prerequisites. Exercise actual ESPN live and empty/error responses, Results loading and cache recovery, scheduled/completed details, notification visibility and permission/settings failures, tray/background polling, startup, sleep/resume, monitor changes, and 125%/150% scaling. Inspect both themes at 70%/100% opacity over bright and dark wallpapers. Validate live summary fields when a real live fixture is available. Verify an installer artifact against its exact commit before release.

## Local checkpoints

- Starting demo-removal checkpoint: `4dfe1ab`.
- UI, venue and regression-test checkpoint: `b53b9db`. Native verification remains outstanding as described above.
- Followed-club empty-state checkpoint: `b752345`.
- Nullable summary venue contract checkpoint: `ca43aa6`.
