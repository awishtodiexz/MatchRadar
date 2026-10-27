# Data provider

The ESPN scoreboard is an unofficial source: `https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard`. The adapter requests a date range using `dates=YYYYMMDD-YYYYMMDD`, normalizes home/away roles and UTC kickoff timestamps, maps statuses, restricts logo hosts, and discards malformed fixtures. It makes no licensing or availability assumptions. Direct endpoint access failed in the development environment, so range behavior must be validated against current responses. Do not use sample fixtures to fill gaps in the live feed.
