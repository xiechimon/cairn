# #1192 — biome lint warnings cleared + warning cap gate

## TL;DR

The CI Lint step (`biome ci .`) only red-failed on errors; warnings
accumulated without pushback (27 in 2026-09 → 53 in 2026-10-11,
with #1180 alone shipping 7 in `apps/server/src/services/skill-import.ts`).
This PR removes the 53 warning backlog, then adds a new CI step that
pins a warning cap at 0 and refuses to grow it.

## Commits

| SHA       | Subject                                          | Effect            |
| --------- | ------------------------------------------------ | ----------------- |
| `a704ac17` | chore(1192): biome autofix clears 35 of 53       | -35 warnings      |
| `da2f165a` | chore(1192): clear 18 remaining biome warnings    | -18 warnings      |
| `0b51a6d9` | ci(1192): add lint-warning-cap gate pinned at 0 | gate in CI       |
| _this_     | docs(1192): record verification evidence         | closes #1192     |

## Files of interest

- `scripts/lint-warning-cap.mjs` — pure-stdlib gate (CLI: `--check` /
  `--write` / `--base <sha>`; env `LINT_WARNING_BASE_SHA` for CI).
- `scripts/lint-warning-baseline.json` — frozen cap (`maxWarnings: 0`),
  shape mirrors `scripts/ui-debt-baseline.json`.
- `.github/workflows/ci.yml` — new step "Lint warning cap gate (#1192)"
  in the `check` job, sitting right after the existing `Lint (biome ci)`
  step; same base-sha fetch pattern as the lane-file and ui-debt gates.

## Evidence

- `before.txt` — biome summary on `origin/main` (53 warnings, 1 info),
  with per-rule breakdown.
- `after.txt` — biome summary on this branch tip (0 warnings, 0 errors;
  info unchanged).
- `gate.txt` — positive (PASS at 0/0) and negative (FAIL when a
  scratch unused-import warning is added under `scripts/`) evidence
  for the new gate, plus the baseline file contents.
- `tests.txt` — `pnpm typecheck` and `pnpm test` (vitest, 2945 tests
  across 284 files, ~190-215s) on the branch tip, both green.

## What the gate is NOT

- It does not promote warnings to errors (#1192 out of scope).
- It does not touch info diagnostics.
- It does not refactor files just to clear a warning — the clearing
  commits were strictly behavior-preserving (the autofix pass + targeted
  `biome-ignore` markers, one inline type-shape adjustment on
  `apps/web/src/resources/machine-detail-page.tsx` to keep `t()`'s
  `n: string | number` constraint).

## How a future PR lowers the cap

1. Land the clearing commit(s) on a branch off this one.
2. On that branch, run `node scripts/lint-warning-cap.mjs --write` —
   the in-tree baseline updates to the lower count.
3. Open the PR; the CI step runs with the base sha from the PR and
   compares the branch's baseline to the base's baseline — D3
   prevents the branch from raising the cap above the base's number.
4. On merge, the next PR's base already carries the lower cap.

## Source pointers

- Issue body & Agent Brief: `gh issue view 1192 --comments` (REST:
  `GET repos/xiechimon/pacman/issues/1192`).
- Ratchet templates used as the format reference:
  `scripts/ui-debt-gate.mjs` (per-face css / bare-control cap),
  `scripts/lane-file-gate.mjs` (root-file leakage).

closes #1192