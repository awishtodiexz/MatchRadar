# Match Centre evolution report

## Completed local checkpoint
- Premier League-only summary endpoint verified against upcoming/completed actual responses. Reduced deterministic captures exclude odds/news/media.
- Native on-demand summary command validates fixture identity, bounds response size, normalizes and deduplicates chronological provider events (including period and display clock), exposes match statistics only after kickoff, and returns player rosters where supplied.
- Details-only Overview, Timeline, Stats and Lineups section buttons appear only with useful data. Team context and full provider event text retain scoring, substitution and card information without fabricating facts. Score/status remain authoritative scoreboard values; existing bell controls remain independent.
- Separate bounded 24-entry detail cache with persisted F01 snapshots, backward-compatible defaults, malformed-entry skipping, offline fallback, independent async serialization, conservative TTLs and error cooldown. No networking while holding the scoreboard snapshot lock. Cache writes preserve notification/settings state.
- Mounted active Details refresh once per minute; navigation cancels subsequent refresh timers and ignores late responses. Reopening uses the native cache. In-flight HTTP requests may complete after navigation but cannot update the old screen.
- All, Live, Following, Upcoming and Results views operate only on the existing fixture window. Existing Following-only preferences remain an additional visible filter; Show all resets both filters. Home card CSS was not changed.
- Numeric and HTTP-date Retry-After parsing added; existing polling/backoff and F01–F04 notification architecture retained. No new notification categories or per-alert summary fetches.

## Validation
Local lint, 51 frontend tests and TypeScript/Vite build passed. Rust formatting passed. Added four Rust tests for captured normalization, missing/zero statistics, duplicate/order handling and legacy/cache roundtrip plus an HTTP-date parsing test. Native Rust compilation/tests remain UNEXECUTED because MSVC link.exe is absent. Existing 60-test Windows evidence predates this checkpoint and cannot validate these changes.

Frontend tests cover stale responses during rapid navigation, demo suppression, failure/retry, conditional sections, explicit zero values, player names and all fixture views. All 45 earlier frontend tests remain passing. No tests use the network. No dependency, permissions or workflow changes. Persisted new fields default safely for old state. No accounts, secrets, telemetry, bundled provider imagery or additional competitions.

## Deferred and limitations
This is substantial implementation progress, not completion of every requested phase. Live/halftime summary schema, explicit VAR/own-goal/penalty variants and correction payloads still need representative verification. Event type/text remain provider-supplied; rosters list players and starters without claiming formation analytics. Results covers only already-cached fixtures; no historical expansion. Cache transport concurrency/cooldown fault-injection tests, exhaustive corrupted-entry validation and full UI matrix remain outstanding. Summary cache currently serializes all detail requests with one lock; this bounds work but switching matches can wait for an earlier request's timeout. Completed summaries use the same 15-minute TTL as scheduled summaries. A shared provider-wide deadline, jitter, manual-refresh deduplication improvements, notification enrichment and optional extensions were not implemented. No visual screenshots or packaged Windows runtime tests were performed for the new centre.

## Windows acceptance checklist
1. Compile all Rust tests and native app before accepting this checkpoint; do not infer success from rustfmt.
2. Open a real upcoming and completed Premier League fixture; verify data identity, no season stats labelled match stats, events and lineups against ESPN. Test live/halftime when available.
3. Inspect dark/light, 70/100% opacity, 320/390 widths, compact/expanded, long player names and many events. Verify one content scroller, fixed footer, keyboard focus, screen-reader labels and reduced motion.
4. Rapidly switch matches, return Home, toggle demo/live and refresh scores. Confirm independent bells and Back scroll restoration, no summaries requested just by browsing Home, and no summary update replacing scoreboard scores.
5. Reopen cached details offline and after restart; exercise summary HTTP errors/rate limits and persistence failures. Verify old state/settings/subscriptions/deduplication records survive.
6. Recheck context-menu/selectable-input behavior, tray/window controls, native notifications and DPI scaling. Successful submission is not proof of OS display.

## Local commits
Checkpoint SHAs are reported in the conversation after commit. No push, release or installer build is authorized or performed. Earlier README/presentation and AGENTS edits remain preserved outside the evolution checkpoint.
