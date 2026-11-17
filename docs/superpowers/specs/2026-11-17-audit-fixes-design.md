# Audit follow-ups — design

Date: 2026-11-17
Scope: the actionable items from the 2026-11-17 bug audit (`main` @ `0ae3db5`).
Status: approved shape — the TEMP-handling approach was picked in conversation
(README note, not self-redirecting scripts); everything else was stated as
implementation calls with no objection.

## Intent and why

The two-pass bug audit found no product bugs, but left three small verifiable
gaps and one documented dead end. This change closes them so the next audit
starts from a clean floor:

- `cargo clippy` is not warning-clean (4 nits, one of them dead struct fields).
- The Results view claims a 14-day window the backend exceeds
  (`recent_result` keeps kickoffs in `[today−15, today+1]`).
- Contributors on machines with a locked `%TEMP%` tree lose days to an
  esbuild `Access is denied` failure that the repo's own `build-local.ps1`
  already works around silently.

## Goals

1. `cargo clippy --all-targets` reports zero warnings.
2. Results-view copy contains no falsifiable day count.
3. The README Development section explains the locked-`%TEMP%` failure mode
   and the redirect that fixes it, for both `npm` and `cargo` paths.
4. All existing gates stay green: 287 vitest, 182 cargo tests, `cargo fmt`,
   eslint, prettier (README included).

## Non-goals

- No app behavior changes beyond the two Results strings.
- No dependency changes: the `picomatch`/`tinyglobby` ReDoS advisories flag
  every published version (`*`), so there is nothing patched to pin. The
  chain is dev-only; revisit when upstreams ship fixes.
- No restructuring; no new modules.

## Anti-goals

- Do not add wrapper scripts that mask machine-level problems (rejected
  approach; docs chosen instead).
- Do not touch the fixtures-window copy ("Next 14 days" matches
  `lookahead_days` exactly and is pinned by
  `controls.test.tsx:168` and `shortcutsAndMarkers.test.tsx:62`).
- Do not weaken or skip the reminder-window regression test
  (`enabling_kickoff_reminders_inside_the_window_still_alerts_once`) while
  collapsing the nested `if` in `alerts.rs`.

## Approaches

1. **Locked `%TEMP%` trap** — (a) README note, chosen: matches how the repo
   already routes cargo around the problem, zero behavior change; vs (b) a
   Node wrapper wired into `verify:fast`/`verify:ui` that self-redirects
   `TMP`/`TEMP`: rejected as a new moving part in everyone's dev path that
   would mask problems the docs surface.
2. **Results copy** — (a) de-number the strings ("recent results"), chosen:
   the true window is a date range, not a round number, so any number is
   falsifiable; vs (b) state the exact window ("last 15 days"): rejected as
   pedantry that invites day-counting.
3. **Advisory chain** — (a) wait for patched upstreams, chosen: no patched
   version exists; vs (b) npm override: rejected — an override pins to an
   equally flagged version, pure churn.

## Left to the builder

Exact README wording within the decided content, and the exact placement of
the new Results-copy assertions inside `src/listStates.test.tsx` (mirror the
file's existing Results-view rendering pattern).
