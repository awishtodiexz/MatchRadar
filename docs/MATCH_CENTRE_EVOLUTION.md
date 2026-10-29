# Match Centre evolution

## Milestones
1. Verify Premier League summaries; normalize bounded event, statistic and roster data with captured fixtures.
2. On-demand native detail cache and Details-only accessible tabs; independent scoreboard authority and navigation-safe refresh.
3. Compact All/Live/Following/Upcoming/Results views using existing fixture data.
4. HTTP-date Retry-After and conservative source cooldowns; retain F01–F04 notification logic.
5. Regression validation, architecture/provider updates and packaged-Windows acceptance report.

Baseline: c894a1d; 45 frontend and 60 previously CI-passed Rust tests. Pending README/screenshots, AGENTS edit and organization extractions are preserved on feature/premier-league-match-centre. Local MSVC linker is unavailable. No pushes or installer builds.

Verified 29 October 2026: eng.1 monthly scoreboard and summaries 401879268 (completed), 401879250 (upcoming). Upcoming boxscore statistics are season totals, not match statistics. keyEvents and rosters are absent/empty for some upcoming matches. No live/halftime match was available in this probe. Full responses retained only temporarily; checked-in reduced fixtures omit odds, articles, media and links.

Integration hardening completed locally: deterministic summary cache/transport boundaries, navigation/visibility guards, accessible section tabs, 213 browser states, and a monotonic provider retry gate. See MATCH_CENTRE_EVOLUTION_REPORT.md for current evidence and Windows blockers.
