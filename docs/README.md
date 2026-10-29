# Documentation

Start with the [project README](../README.md) for installation and development. These documents describe the current product and its engineering boundaries:

- [Product](PRODUCT.md) — widget behavior and scope.
- [Architecture](ARCHITECTURE.md) — module responsibilities, persistence, IPC, refresh and notifications.
- [Data provider](DATA_PROVIDER.md) — ESPN observations, caching and licensing caveats.
- [Design system](DESIGN_SYSTEM.md) — themes, layout and accessibility conventions.
- [Windows validation](VALIDATION.md) — test evidence and packaged-app checklist. Older sections are dated checkpoints.
- [Roadmap](ROADMAP.md) — remaining product work.

Historical evidence is retained in place to preserve existing links:

- [v1 comprehensive audit](V1_COMPREHENSIVE_AUDIT.md) — baseline findings before subsequent reliability fixes; not a current defect list.
- [Match Centre plan](MATCH_CENTRE_EVOLUTION.md) and [evolution report](MATCH_CENTRE_EVOLUTION_REPORT.md) — implementation history and remaining native checks. Later follow-up notes supersede earlier checkpoint limitations.

Screenshots in `screenshots/` are actual browser renders. Home screens contain labelled demo data; the Match Centre image uses a recorded provider response through mocked IPC. They are not packaged Windows verification.
