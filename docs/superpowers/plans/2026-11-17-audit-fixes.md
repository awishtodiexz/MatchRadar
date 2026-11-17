# Audit follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the 2026-11-17 bug-audit follow-ups: a clippy-clean Rust backend, honest Results-view copy, and a README note that unblocks builds on machines with a locked `%TEMP%` tree.

**Architecture:** Three independent, behavior-preserving changes. The Rust task is lint-driven — clippy is the failing test, and the existing 182-test suite (especially the reminder-window regression test) is the semantic guard. The copy task is test-first. The README task is doc-only, gated by prettier.

**Tech Stack:** Rust (src-tauri), React 19 + TypeScript (src), Markdown README, PowerShell.

**Spec:** `docs/superpowers/specs/2026-11-17-audit-fixes-design.md`

## Global Constraints

- No app behavior changes beyond the two Results strings named in Task 2.
- Fixtures-window copy ("Next 14 days") is untouched; `controls.test.tsx:168` and `shortcutsAndMarkers.test.tsx:62` pin it.
- No dependency version changes (the advisory chain is intentionally unfixable; see spec).
- Every task ends with its own gate green: Task 1 with `cargo clippy --all-targets` at 0 warnings, `cargo test` 182 pass, `cargo fmt --check` clean; Task 2 with the full vitest suite; Task 3 with `npx prettier --check .`.
- If `cl : Command line error D8050` appears during any Rust step, this machine's `%TEMP%` is locked: rerun with `$env:CARGO_TARGET_DIR='C:\Users\yoedy\AppData\Local\Temp\opencode\matchradar-cargo'` (already built, reuses cache). Same class of failure as Task 3's README note describes.
- One topic per commit; no comments added to code; keep the surrounding style exactly.

## Review Focus

1. **Dead-field removal must not orphan references** — `Applied.failed`/`Applied.retry_after` are read in exactly one place each (refresh.rs tests, lines ~344 and ~510); `main.rs` uses only the granular fields. Any other reference would fail `cargo clippy --all-targets`.
2. **Collapsing the nested `if` in `alerts.rs` must not move the `planned_reminder_kickoff` recording** — it must stay inside the `subscribed || reminders` condition; `enabling_kickoff_reminders_inside_the_window_still_alerts_once` (alerts.rs tests) fails if it drifts.
3. **The copy change must not break the two pinned fixtures assertions** — covered by running the whole vitest suite, not just the new test.
4. **README commands must run verbatim from the repo root** — the note's PowerShell snippet is the fix it documents; it gets executed as its own verification.
5. **Prettier formats Markdown** — the README edit must keep `npx prettier --check .` green; do not hand-wrap lines differently from prettier's style.

---

### Task 1: Rust clippy clean-up

**Files:**
- Modify: `src-tauri/src/refresh.rs` (struct `Applied`, its construction, two test assertions)
- Modify: `src-tauri/src/alerts.rs:100-130`
- Modify: `src-tauri/src/provider.rs:339`
- Modify: `src-tauri/src/main.rs:388-395`

**Interfaces:**
- Consumes: none.
- Produces: `Applied` without `failed`/`retry_after` — internal to `refresh.rs`; no other module reads them (`main.rs` uses `fixture_failed`/`score_failed`/`fixture_retry_after`/`score_retry_after`).

- [ ] **Step 1: Baseline the lint failure**

Run: `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets`
Expected: exactly 4 warnings — dead fields `failed`/`retry_after` (refresh.rs:12), collapsible `if` (alerts.rs:106), immediately-dereferenced reference (provider.rs:339), manual `!Range::contains` (main.rs:394).

- [ ] **Step 2: Remove the dead fields**

In `refresh.rs`: delete `pub failed: bool,` and `pub retry_after: Option<u64>,` from `Applied`, delete the two matching initializers in `apply_league`'s return, and update the two test assertions:

```rust
// was: assert_eq!(applied.failed, !(fixture_ok && scores_ok));
assert_eq!(applied.fixture_failed || applied.score_failed, !(fixture_ok && scores_ok));
// was: assert_eq!(applied.retry_after, Some(600));
assert_eq!(applied.score_retry_after, Some(600));
```

- [ ] **Step 3: Collapse the nested `if` in `alerts.rs`**

Replace `if within_reminder_window { if subscribed || snapshot.settings.reminders { … } }` with a single guard — the reminder push *and* the `planned_reminder_kickoff = reminder_kickoff.clone();` line stay inside:

```rust
if within_reminder_window && (subscribed || snapshot.settings.reminders) {
```

- [ ] **Step 4: Fix the two idiom nits**

`provider.rs:339` — `bounded(&detail, 200)` becomes `bounded(detail.as_str(), 200)`.
`main.rs:394` — `minutes < 0 || minutes >= 360` becomes `!(0..360).contains(&minutes)`.

- [ ] **Step 5: Verify the gates**

Run: `cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets` → 0 warnings.
Run: `cargo test --locked --manifest-path src-tauri/Cargo.toml` → 182 pass (see Global Constraints for the D8050 escape hatch).
Run: `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` → clean.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/refresh.rs src-tauri/src/alerts.rs src-tauri/src/provider.rs src-tauri/src/main.rs
git commit -m "fix: clear clippy warnings (dead Applied fields, collapsed if, ref and range idioms)"
```

### Task 2: Results-view copy

**Files:**
- Modify: `src/App.tsx:434` and `src/App.tsx:939`
- Test: `src/listStates.test.tsx` (extend, mirroring its existing Results-view rendering pattern)

**Interfaces:**
- Consumes: none.
- Produces: none (rendered strings only).

- [ ] **Step 1: Write the failing test**

Add one test to `src/listStates.test.tsx`, mounting the app the same way the file's existing Results-view tests do, with a completed-match history that satisfies `listComplete`, asserting the list-end text:

```tsx
expect(container.querySelector('.list-end')?.textContent).toMatch(
  /That’s every recent result/,
);
```

and, in a second render with empty history and the Results view open, asserting the empty message:

```tsx
expect(screen.getByText(/were found recently\./)).toBeTruthy();
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/listStates.test.tsx --configLoader runner`
Expected: FAIL — both strings still say "14 days".

- [ ] **Step 3: Change the two strings in `src/App.tsx`**

Line 434: `No completed ${competitionMatchesLabel} were found in the previous 14 days.` → `No completed ${competitionMatchesLabel} were found recently.`
Line 939: `That’s every result${settings?.followedOnly ? ' for followed clubs' : ''} from the last 14 days` → `That’s every recent result${settings?.followedOnly ? ' for followed clubs' : ''}`

- [ ] **Step 4: Run the whole frontend suite**

Run: `npm test`
Expected: PASS — all tests including the new one (287 existing + 1). Confirms the pinned fixtures-window assertions are untouched.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/listStates.test.tsx
git commit -m "fix(ui): stop claiming a 14-day results window the backend exceeds"
```

### Task 3: README note for the locked-%TEMP% trap

**Files:**
- Modify: `README.md` (Development section, after the "Rust tests need the Visual Studio C++ environment…" paragraph, ~line 101)

**Interfaces:**
- Consumes: none.
- Produces: none.

- [ ] **Step 1: Add the note**

Append this paragraph to the Development section (keep prettier's line wrapping):

```markdown
If security software locks files in your temporary directory, `npm run build` can fail with
`[vite:esbuild-transpile] remove …esbuild-…: Access is denied`, and `cargo test` with
`cl : Command line error D8050`. `scripts\build-local.ps1` avoids both by redirecting `%TEMP%`
into the ignored `src-tauri\target\.build-temp` directory before it builds. To run the checks
individually, do the same redirect in your shell first:

```powershell
$env:TMP = Join-Path (Get-Location) 'src-tauri\target\.build-temp'
$env:TEMP = $env:TMP
New-Item -ItemType Directory -Force -Path $env:TMP | Out-Null
```
```

- [ ] **Step 2: Verify the note's commands run verbatim**

Run the snippet in a fresh shell from the repo root, then `npm run build`.
Expected: build succeeds (exit 0).

- [ ] **Step 3: Verify formatting**

Run: `npx prettier --check .`
Expected: PASS (prettier checks Markdown; re-run with `--write README.md` if it flags the new block).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: unblock builds on machines with a locked temp directory"
```
