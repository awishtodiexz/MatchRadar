# Data provider

The app no longer includes demo mode; historical references to demo data below describe older versions. Provider failures do not substitute fictional fixtures.

The ESPN scoreboard is an unofficial source: `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard`. On 28 October 2026, a date-range request returned HTTP 400; a single-day request (`dates=20261031`) returned HTTP 200 with eight events, and a monthly request (`dates=202610`) returned HTTP 200 with 38 events. These observations are not a provider guarantee.

The adapter fetches the current and, when needed, next calendar month for a two-week fixture window, at most every six hours unless the user refreshes. It separately requests today's scoreboard at the adaptive live polling cadence (and yesterday if a cached match from that day is still live). Matches are merged by provider ID, with the daily score taking precedence. ESPN timestamps without seconds are normalized to UTC. An empty events array is a successful empty schedule; errors preserve the existing snapshot and include the query and status in `provider.log` in the app data directory. Malformed individual fixtures are skipped. The source is unofficial, may change, and carries no licensing or availability guarantee. Demo data is never used to fill gaps in the live feed.

## Independent fixture and scoreboard refresh (F03)

Monthly and daily requests produce separate validated outcomes: no valid response, valid data (including an empty array), or valid partial batch data plus an error. A failed second month/day request no longer discards the first successful response. Batch requests stop after HTTP 429 or an explicit Retry-After; a fixture rate-limit response also defers daily requests. Existing adaptive polling, numeric Retry-After and exponential backoff remain; broader F19 deadline/date-header behavior is unchanged.

`fixtureUpdatedAt` advances only when every requested fixture-month query succeeds. `updatedAt` remains the last fully successful daily-score batch time; fixture-only success does not advance it. `fixtureError` and `scoreError` retain each source's last failure until a successful response from that source; skipping a cached source neither confirms it nor clears its error. `partial` and the aggregate error distinguish partial updates from a completely failed refresh. These fields have backward-compatible defaults in persisted snapshots.

Complete monthly responses reconcile missing upcoming fixtures; partial/failed months retain unseen cached fixtures. Active cached matches are retained as saved observations when absent from new fixtures, within the existing yesterday-through-next-14-days UTC window. For an unchanged kickoff, a monthly scheduled/unknown placeholder does not erase known progress; new kickoff/team metadata and explicit postponed/cancelled/final statuses take precedence. Valid daily updates then override by stable match ID. Both-source failure preserves cached fixture values and timestamps, marking unconfirmed active scores as saved.

Only active matches present in successful daily response data are shown as confirmed scores. Other active observations carry `scoreStale`, appear under saved/mixed live headings, and do not advance live notification baselines. Restored active matches also start as saved until a new daily response confirms them; restoring cache never advances source times. Scheduled reminders keep their existing behavior. Partial daily batches can confirm returned matches without falsely advancing the whole scoreboard batch timestamp. F04 delivery retries are independent of provider polling; see `ARCHITECTURE.md`.

| Fixtures | Scores | Result |
| --- | --- | --- |
| Success | Success | Reconcile fixtures, apply scores, advance both source times |
| Success | Failure | Keep new fixtures and appropriate known progress, advance fixture time only, show partial failure/saved scores |
| Failure | Success | Retain cached schedule, merge daily updates, advance scoreboard time only, show fixture failure |
| Failure | Failure | Retain cache and source times, show failure and retain backoff |

Deterministic Rust tests cover these result combinations, empty-cache fixture success, saved live data, rescheduling/cancellation, empty schedules, multi-query partial results, malformed responses, UTC boundaries/deduplication, and numeric Retry-After propagation. The consolidated Windows workflow passed the Rust suite in [run 40846643935](https://github.com/awishtodiexz/MatchRadar/actions/runs/40846643935). Frontend tests cover partial status labels and saved-score presentation; see [validation notes](VALIDATION.md) for the limits of this evidence.

## Club identities and crests

On 28 October 2026, the monthly scoreboard returned `team.logo`, while the league teams and individual team endpoints returned `team.logos[].href` with default and, often, dark variants. The normalizer accepts trusted image URLs from either shape and uses the canonical ESPN soccer image path for numeric team IDs if needed. In dark mode the frontend first tries ESPN's dark crest variant so navy artwork stays visible, then the normalized/canonical image, then initials on load failure. Light mode starts with the standard image. Candidates are deduplicated and finite. No extra per-fixture HTTP requests are added to polling.

The previous static catalog contained incorrect IDs: Fulham was `376` (Southampton) instead of `370`, and several other clubs were similarly mismatched. The corrected catalog uses ESPN IDs, merges additional fixture teams by ID, and includes crests even for clubs without a current fixture. Legacy saved favorites are migrated once from the old catalog mapping to preserve the clubs users selected; fresh selections are not remapped. Some supported clubs may be outside the current Premier League season and therefore have no fixtures.

Direct HTTP checks returned 200 and `image/png` for all 23 canonical crest URLs in the corrected catalog, including Fulham `370` and West Ham United `371`. This verifies asset availability at the time of the probe, not perpetual availability or Windows WebView delivery. Keep the image-error fallback. These are externally loaded ESPN/provider-owned assets, not bundled artwork or a grant of redistribution rights. Review licensing before public distribution or replacing the provider. The competition shield is original MatchRadar artwork, not the official Premier League logo.

## Match-summary observations (29 October 2026)

Verified `eng.1/summary?event=401879268` (completed) and `401879250` (upcoming). Reduced response fixtures in `tests/fixtures/summary-*.json` retain events, team statistics and rosters, omitting articles, odds, assets and outbound links. Event text is provider-supplied; no goalscorer is inferred. Events deduplicate by provider event ID and sort by period/clock seconds, retaining stoppage-time display strings. Upcoming boxscore season totals are deliberately excluded. Live/halftime summary responses were not available for verification. Provider-owned text/data retain their licensing limitations; these test captures establish no redistribution permission.

On-demand summaries are independently cached and bounded, never requested by card rendering or notifications. Numeric and RFC2822 HTTP-date Retry-After are now parsed for both scoreboards and summaries. Broader scoreboard manual-refresh cooldown hardening is still outstanding.

## Integration verification

A new probe on 29 October 2026 returned zero fixtures for `20261029`; the October monthly feed contained 38 scheduled/completed fixtures. Completed summary `401878764` had 27 key events and two rosters with 28 statistics per team; upcoming `401879250` had zero events and only four season-stat fields per team. No live/halftime fixture was available. Reduced recorded test fixtures remain clearly completed/upcoming data; no live schema is inferred from replay.

Summary client reuse, streaming response limits, cache validation/offline recovery and fixed cooldown behavior are covered by deterministic injected-result tests. The poller now honors its backoff despite manual wakes and retains explicit Retry-After values above an hour. Timer sleeps are chunked without reducing the actual deadline. No new provider routes, fixture-window changes or summary requests for notifications were introduced. Full native tests still require Windows CI.

## Recent Results verification — 29 October 2026

`dates=20261028` and `dates=20261029` each returned zero events. `dates=202610` returned 20 completed matches dated October 15–29. `tests/fixtures/recent-scoreboard.json` contains a reduced, genuine three-event subset with identifiers, kickoff, status and teams/scores; it omits external images, odds and news. Deterministic tests use this recording, never the network. Captured provider data does not establish distribution rights.

Recent results use one or two supported monthly queries on demand, a separate six-hour successful cache and independent failure cooldown. The upcoming fixture window and daily scoreboard queries remain unchanged. Summary requests still occur only after a match card opens. Native compilation/runtime of this revision needs fresh Windows validation; previous successful 75-test CI predates it.
