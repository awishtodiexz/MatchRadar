# Product

MatchRadar is a personal, widget-first football companion for the Premier League and Champions League. Live fixtures lead the match list, followed clubs receive priority, and the details view only presents information available from the feed. The app defaults to dark mode, offers an optional light theme, and has no account or telemetry.

A compact competition selector in the competition bar switches between Premier League, Champions League, and Both; the choice persists and defaults to the Premier League for existing users. Both merges fixtures chronologically and tags each card PL or UCL. The Champions League looks 30 days ahead because its league phase is sparse; the Premier League keeps its 14-day window.

The header's minus control minimizes to the Windows taskbar; X hides to the system tray. Settings, Always on top, Following only, and Refresh live in the footer. Compact view is a separate Appearance preference that changes the native window size, with the expanded dimensions retained for restoration. These behaviors require packaged Windows runtime checks in addition to automated coverage.

The Match Centre adds Details-only Overview/Timeline/Stats/Lineups sections for either competition when supported by verified summary data. All/Live/Following/Upcoming/Results views apply to the selected competition(s). Results uses a separate recent 14-day cache per competition; it is not a long-term historical archive. Older saved demo preferences migrate to live data. Browser verification uses test-only fixtures and mocked desktop IPC.
