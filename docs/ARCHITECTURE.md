# Architecture

The Tauri process owns a normalized snapshot, preferences, a local JSON cache and a single asynchronous refresh loop. React reads snapshots through commands and refreshes on native events. The window can be hidden while the process continues running. The ESPN adapter validates each fixture independently, and failed requests preserve the previous snapshot. Settings and notification identifiers are persisted together.

The poller targets 60 seconds for live fixtures, five minutes when a fixture is within a day and 30 minutes otherwise. Fixture snapshots use monthly queries refreshed every six hours; daily score updates are merged by stable match ID. Manual refresh forces both. Failure delays grow exponentially; numeric Retry-After is honored up to one hour. Failures leave the previous snapshot intact and write diagnostic details to `provider.log`. The implementation has not yet been tested against actual sleep/resume or rate-limit responses.
