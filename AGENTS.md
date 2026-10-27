# MatchRadar development

- Preserve the small, dark, widget-first interface. Do not add dashboard chrome or remote scripts.
- Rust owns network access, persisted settings and background refresh. The UI consumes normalized snapshots.
- Never display sample fixtures as live data. Label demo mode clearly.
- Keep provider data untrusted; skip malformed individual fixtures and preserve cached data on failures.
- Use local time only for presentation; keep timestamps in UTC. Maintain reduced-motion and keyboard access.
- Test business logic and document platform features that have not been verified in a packaged Windows build.
