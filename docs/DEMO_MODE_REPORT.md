# Demo Mode 2.0: implementation and verification

## What is implemented

Enable **Settings → App → Demo data**. The home screen contains twelve explicitly synthetic Premier League fixtures, including first- and second-half games, half-time, a match starting in 15 minutes, a match tomorrow, completed high-scoring and goalless results, postponed, cancelled, suspended and unknown-status examples. The existing filters and match cards are used unchanged.

Open a match card for fictional Match Centre data. Live and completed examples contain timelines, team statistics, starting elevens and reserves. Events include goals, a penalty, an own goal, cards, a substitution, VAR and stoppage-time markers; the Brighton–Everton sample intentionally omits an away statistic. Upcoming and otherwise unavailable examples show an honest empty state. Player names and incidents are invented, not historical results. The existing model does not expose shirt numbers, formations or comparison bars.

Under **Settings → App → Demo controls**, advance the synthetic Manchester City–Manchester United fixture through scheduled, first half, half-time, second half and full-time. The control displays a virtual scenario time; reset returns to the initial stage. Progress is manual, transient, bounded and does not make a network request. It updates the card and open Match Centre from the same derived match. Fixture times are anchored once per native demo session; the same stage and anchor produce the same scenario. Starting another session reanchors the dates to keep them relevant.

## Architecture and isolation

The Rust mock provider supplies the session fixture list. `demoScenario.ts` derives simulation state in the frontend without writing scores to the native feed. Demo details are generated locally in `demoMatchSummary.ts`; `useMatchSummary` does not request ESPN summaries in demo mode. The native poller does not send mock observations to notification planning. Demo IDs use a non-numeric `demo-` prefix; native and browser IDs are independently stable but differ, so scenario selection uses club IDs. Existing generation checks reject stale provider responses after mode switches. Club crest images may still request the existing ESPN CDN; their initials fallback works offline.

**Isolation is not yet complete.** The existing native mode transition clears the current feed, pending notification candidates and alert baselines, and demo match-bell preferences are saved in the shared settings map. This implementation does not change that established F04 behavior or claim to preserve pending real alerts across a demo transition. A safe follow-up must separate real and demo feed/alert state and test restart, pending delivery and switching semantics in Windows CI before treating strict isolation as complete. Switching back triggers a real refresh; offline restoration of the previous live fixture list is therefore not guaranteed. Sent notification IDs and ordinary user settings are not intentionally reset by the new simulation control.

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
