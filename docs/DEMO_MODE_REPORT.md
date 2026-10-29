# Demo Mode 2.0: implementation and verification

## What is implemented

Enable **Settings → App → Demo data**. The home screen contains twelve explicitly synthetic Premier League fixtures, including first- and second-half games, half-time, a match starting in 15 minutes, a match tomorrow, completed high-scoring and goalless results, postponed, cancelled, suspended and unknown-status examples. The existing filters and match cards are used unchanged.

Open a match card for fictional Match Centre data. Live and completed examples contain timelines, team statistics, starting elevens and reserves. Events include goals, a penalty, an own goal, cards, a substitution, VAR and stoppage-time markers; the Brighton–Everton sample intentionally omits an away statistic. Upcoming and otherwise unavailable examples show an honest empty state. Player names and incidents are invented, not historical results. The existing model does not expose shirt numbers, formations or comparison bars.

Under **Settings → App → Demo controls**, advance the synthetic Manchester City–Manchester United fixture through scheduled, first half, half-time, second half and full-time. The control displays a virtual scenario time; reset returns to the initial stage. Progress is manual, transient, bounded and does not make a network request. It updates the card and open Match Centre from the same derived match. Fixture times are anchored once per native demo session; the same stage and anchor produce the same scenario. Starting another session reanchors the dates to keep them relevant.

## Architecture and isolation

The Rust demo module supplies the session fixture list. `src/demo/scenario.ts` derives simulation state in the frontend without writing scores to the native feed. Demo details are generated locally in `src/demo/summary.ts`; `useMatchSummary` does not request ESPN summaries in demo mode. The native poller does not send mock observations to notification planning. Demo IDs use a non-numeric `demo-` prefix; native and browser IDs are independently stable but differ, so scenario selection uses club IDs. Existing generation checks reject stale provider responses after mode switches. Club crest images may still request the existing ESPN CDN; their initials fallback works offline.

The real fixture cache, notification queue, sent IDs, baselines and real match-alert preferences remain in the persisted snapshot across demo transitions. Demo fixtures are projected for the UI without replacing the real feed, and demo bell preferences are stored separately. Notification submission is paused in demo; after returning to real mode, retained candidates must still be unexpired and their matches must be confirmed by a fresh scoreboard before delivery. A legacy snapshot that already replaced its real fixture list with synthetic data cannot recover that previously overwritten list; it is refreshed from ESPN when available. The native transition tests require Windows CI and packaged-app verification.

## Validation

- `npm.cmd run lint`: passed.
- `npm.cmd test`: 67 tests passed across 15 files. New coverage checks progression, reset, score/event consistency, stable identifiers, lineup substitutions, demo mode exit and absence of frontend IPC during simulation. Existing tests exercise tabs, filtering and navigation.
- `npm.cmd run build`: TypeScript and Vite production build passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: passed. Added native deterministic fixture and notification-suppression regression tests are **not executed**: the local Windows MSVC linker is unavailable. Windows CI must compile and run them.
- `git diff --check`: passed.
- Visual inspection at 320/390px, both themes, opacity and compact layouts was not completed: the computer-use helper reported `Computer Use native pipe is unavailable: failed to connect native pipe: The system cannot find the file specified. (os error 2)` twice. Automated DOM tests are not visual evidence.

## Windows acceptance checks

After Windows CI and packaging, test offline entry into demo; all filters and match details; progression/reset and repeated switching; visible synthetic warnings; dark/light, 70%/100% opacity and 320/390px in both window modes; keyboard tabs, scrolling, long names, reduced motion and fallback crests. Verify actual Windows notifications are never emitted for synthetic events. Test switching back with a pending real notification and with the network disconnected: the isolation limitations above remain unresolved. Native tray, DPI, persistence and notification delivery require their own packaged-app checks.

## Local checkpoint

Implementation and test checkpoint: `c29daab`. This report is a separate documentation checkpoint. No installer, push or release was produced.
