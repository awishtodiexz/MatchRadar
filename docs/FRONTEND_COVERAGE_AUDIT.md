# Frontend coverage audit

## Count reconciliation

The 69 declarations at `3af34994` and `7d138a1` became 71 at `ad44153` when two Match Centre tests were added. Demo removal `4dfe1ab` removed 13 of the original tests and added one browser-shell test, leaving 59. `b53b9db` added five tests and `b752345` added one, yielding 65. Thus, relative to 69, **13 removed + 9 added = 65**; it is not a simple deletion of four tests. `ca43aa6` and `d302af4` did not change the count. The audit adds two focused tests, giving 67.

## Removed baseline tests

| Original file and test | Reason and classification | Equivalent coverage and action |
| --- | --- | --- |
| `src/demo/scenario.test.tsx` — generates deterministic ordered progression | Obsolete: simulated match progression was removed. | No production equivalent; do not restore. |
| Same — offers manual controls and updates open details without IPC | Obsolete: demo controls and simulated updates were removed. | Real Match Centre navigation is covered separately; do not restore demo behavior. |
| Same — covers fixture statuses and meaningful filters without real match IDs | Replaced: checks the removed synthetic fixture catalog. | Current grouping and filter tests cover production behavior; added exact membership assertions for all five views. |
| Same — keeps rich sample scores, events and lineups consistent | Obsolete: asserted artificial data generation and score/event consistency. | Real scores are authoritative and provider events need not sum to scoreboard scores; current UI and native provider tests cover their separate presentation. |
| Same — leaving demo clears simulation without sending synthetic data or losing settings | Obsolete: the mode switch was removed. | Preference persistence and ordered saves remain covered by `store.test.ts` and `controls.test.tsx`; native legacy-state migration requires Windows tests. |
| `src/demo/summary.test.tsx` — opens a complete fictional centre from the normal completed demo card without IPC | Coverage regression: fictional source and no-IPC assertion are obsolete, but the complete Results-to-details presentation remains useful. | Added a completed-match IPC-mocked integration test with provider-format goal, card, substitution, paired stats, starters and substitute. |
| Same — supports native demo IDs and deterministic optional event fields | Obsolete: synthetic ID and summary-generation behavior was removed. | Current Match Centre tests cover optional tabs and player groups; native provider tests cover event normalization. |
| `src/App.test.tsx` — labels browser demo data and opens match details | Replaced: demo label is obsolete; opening details still matters. | Browser and Results integration tests open details; current shell test verifies the desktop-only message. |
| Same — allows filtering to followed teams | Replaced: exercised the removed browser demo. | `usability.test.tsx`, browser campaign and the new exact-membership filter test cover followed clubs. |
| `src/controls.test.tsx` — does not relabel demo fixtures as live during a mode save or stale snapshot load | Obsolete: no demo/live switch remains. | Snapshot ordering and optimistic saves remain covered by `store.test.ts`; do not restore mode switching. |
| `src/store.test.ts` — isolates F03 freshness during an optimistic mode change and restores it on failure | Obsolete: its mode transition no longer exists. | Other store tests retain coverage of stale reads, failed saves, source freshness and preservation of later edits. |
| `src/useMatchSummary.test.tsx` — does not fetch summaries in demo mode | Obsolete: demo mode and its summary path were removed. | Current tests cover real on-demand fetch, retry, polling and cleanup. |
| Same — suppresses a late real response after switching into demo mode | Replaced: the switch no longer exists, but stale-response suppression remains important. | Current summary navigation test rejects an old response after changing matches; Results tests cover closing/reopening and out-of-order responses. |

## Other test changes

`fixtures.test.ts` and `freshness.test.ts` retained assertions and changed only the test-fixture import. `matchViews.test.ts` retained its original test and now also checks exact membership. `MatchCentre.test.tsx` removed the obsolete demo prop and gained stat, lineup and venue tests. `controls.test.tsx`, `store.test.ts`, `useMatchSummary.test.tsx`, `resultsIntegration.test.tsx` and `usability.test.tsx` were adjusted for the removed mode and current UI; their real-data, preference and async tests remain. `useRecentResults.test.tsx` gained slow/empty and out-of-order checks. The test fixture was moved from `src/demo/fixtures.ts` to `src/test-fixtures/fixtures.ts`; it is not imported by production code.

In browser coverage, `widget.spec.ts` replaced demo progression assertions with assertions that demo controls are absent while retaining theme checks. Upcoming copy/venue checks were updated; filter, keyboard, scroll, bells and narrow-layout tests remain. The new campaign and test-only bridge supply mocked desktop IPC without adding demo data to the application.

## Validation

`npm run verify:fast`: 67 frontend tests, lint and production build passed. `npm run verify:ui`: 21 browser tests passed; it was run outside the sandbox because sandboxed Windows child-process cleanup did not exit. These browser tests use mocked IPC and do not validate native ESPN transport or Windows notification delivery. No Rust code was changed in this audit.
