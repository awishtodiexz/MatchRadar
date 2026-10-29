# Match Centre polish and demo isolation: checkpoint

## Implemented

- Match Centre statistics are paired by provider statistic name, with home and away columns, tabular values and a dash for missing values. A subtle accent marks the higher value for selected comparable measures; it does not judge fouls or cards. Lineups group supplied position codes and place unknown positions in an honest fallback group. The provider model currently has no verified formation, shirt number or player-linked incident fields, so these are not fabricated.
- Fictional players have natural names and varied positions. The detail view uses one concise fictional-data notice alongside the global demo indicator.
- Frontend demo fixtures, summary generation, scenario logic and their tests moved to `src/demo/`. The native fixture generator and its test moved from `provider.rs` to `src-tauri/src/demo.rs`. The ESPN adapter no longer owns synthetic fixture data. Shared match components remain in `src/components/`.

## Isolation is not complete

These moves are an organizational boundary, **not** a production exclusion mechanism. There is currently no supported demo-disabled build: both the native binary and frontend bundle still include demo code and data. A saved demo preference can still activate it. The existing mode switch clears real pending notification candidates and baselines, and demo match-bell preferences use the shared settings map. Switching back while offline does not guarantee restoration of the prior live fixture feed. Do not use this checkpoint as a public-release configuration.

Completing isolation requires a jointly configured frontend/native build gate, conservative legacy-state migration, independently retained real feed and notification state, transient demo alert overrides, and regression tests for in-flight mode switches and restarts. Those changes affect F01–F04 persistence and delivery guarantees and need native compilation and Windows CI. They have not been implemented in this checkpoint.

## Validation and remaining checks

- Frontend lint, production TypeScript/Vite build, and 69 frontend tests passed locally. Added tests cover paired missing/zero statistics and unknown positions.
- Rust formatting passed. The native generator move and existing native tests have not been compiled or run locally: MSVC `link.exe` is unavailable. Windows CI is required before treating the move as verified.
- Visual checks were unavailable: the computer-use native pipe and browser access host were unavailable. Check both themes, 320/390px, compact/expanded, opacity, long names, focus, reduced motion and scrolling in a browser and packaged Windows application.
- Demo controls and normal frontend build remain available through the existing `npm run dev`, `npm run tauri dev` and `npm run build` commands. No demo-disabled build command is supplied because it would be misleading.
- Native notification delivery, persisted-state recovery, mode transitions, tray and DPI behavior need packaged Windows testing. No installer or release was created.

## Checkpoint commits

See the local Git history for the checkpoint containing this report. The pending `AGENTS.md` edit was not included.
