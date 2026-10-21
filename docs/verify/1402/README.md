# #1402 evidence index

#1402 (bootstrap P1, the verify-pacman CLI `vp.mjs`) landed in two segments: #1411 (segment 1, squashed into
main as `e1b051a`) and the branch `claude/bootstrap-p1-seg2` (segment 2). `docs/verify` is add-only (ADR 0015):
every file below stays as first committed, and corrections go into `evidence-notes.txt` and `rerun-notes.txt`.

The round of each segment 1 entry comes from the #1411 branch history (`refs/pull/1411/head`): the commit that
first added it. "Named in #1411" says whether the #1411 body names that directory; the body covers four of
the unnamed ones only with the range `20261020-2331*` to `20261020-2334*`.

Legs:

- **pre-fix leg**: the behavior before a fix. That is a probe in its pre-fix mode (`--expect=old` / `--expect=before`), a seeded regression, or `vp.mjs` before a round's fix.
- **post-fix leg**: the same check after the fix, or the probe in its post-fix mode.
- **plain**: a drive that shows a feature works through `vp.mjs`, with nothing to compare.

## Segment 1 (#1411): run directories

| Directory | Round, commit | Leg | What it is | Named in #1411 |
|---|---|---|---|---|
| `2026-10-20T20-37-51-922Z-capture-board/` | 1, `4ab0d89` | plain | First `vp.mjs capture /app --name board`, before `vp.mjs` stamped directories with local time | yes |
| `20261020-203718-api-key/` | 1, `4ab0d89` | plain | `drive api-keys create`, PASS (6 checks; `03-keys-once.png` shows a scratch key's plaintext) | yes |
| `20261020-203724-new-task/` | 1, `4ab0d89` | plain | `drive board-new-task new-task`, PASS | yes |
| `20261020-203728-search/` | 1, `4ab0d89` | plain | `drive search`, PASS | yes |
| `20261020-203735-theme/` | 1, `4ab0d89` | plain | `drive theme persist`, PASS | yes |
| `20261020-203942-search/` | 1, `4ab0d89` | pre-fix (seeded regression) | Negative control 1: the todo row's `data-row-kind` renamed in `search-panel.tsx`, stack relaunched; `drive search` FAIL, 1 of 2 checks, `99-error.png`. Transcript `negative-control.txt`, seed in `rerun-notes.txt` | no |
| `20261020-204008-search/` | 1, `4ab0d89` | post-fix (reverted) | Negative control 1 after the revert and a relaunch: PASS, 2 of 2. Transcript `positive-control.txt` | no |
| `20261020-restart-combo/` | 2, `0ef923f` | plain | `drive failed-send restart-combo` (tsx case), PASS | yes |
| `20261020-neg3-search-seeded/` | 3, `3b13142` | pre-fix (seeded regression) | Negative control 2: result-row title cut to four characters; `drive search` FAIL, `99-error.png` | yes |
| `20261020-neg3-search-reverted/` | 3, `3b13142` | post-fix (reverted) | Negative control 2 after the revert: PASS, plus `capture-board/` | yes |
| `20261020-chip-word/` | 3b, `2e54c01` | plain | `drive phase-chip-words`, 16/16 (`vp-cli-4.txt`) | yes |
| `20261020-233153-api-keys-create/` | 4, `f44b920` | post-fix | `drive api-keys create` without `VERIFY_EVIDENCE_DIR`, in a directory `vp.mjs` opened | yes |
| `20261020-233157-chief-unread-unread-badge/` | 4, `f44b920` | post-fix (probe mode `--expect=new`) | The registry's new default argument, 13/13 | yes |
| `20261020-233213-review-modal-empty-review/` | 4, `f44b920` | post-fix (probe mode `--expect=after`) | `drive review-modal empty-review`, 16/16 | no (range only) |
| `20261020-233218-skill-import-import-rollback/` | 4, `f44b920` | post-fix (probe mode `--expect=new`) | `drive skill-import import-rollback`, 7/7 | no (range only) |
| `20261020-233246-chief-unread-unread-badge/` | 4, `f44b920` | pre-fix (probe mode `--expect=old`) | `-- --expect=old`, the argument the case used to get by default: 8/11, 3 FAIL, as the pre-fix mode does on fixed code | no (range only) |
| `20261020-233320-review-modal-empty-review/` | 4, `f44b920` | pre-fix (probe mode `--expect=before`) | `-- --expect=before`: 3 FAIL, then timed out; no `result.json` (transcript `vp-cli-5.txt`) | yes |
| `20261020-233415-chief-floating-window-a0-live/` | 4, `f44b920` | registry finding | `drive chief-floating-window`: `POST .../agents` 400 without `machineId` (`result-a0-live.json`); the case is stale since | no (range only) |
| `20261021-012147-machine-stale-sweep-stale-sweep/` | 5, `25ad6eb` | post-fix | Evidence lands in the directory `vp.mjs` printed; fresh stack, all checks pass. The pre-fix leg (evidence beside the printed directory) is only in `vp-cli-6.txt` | yes |
| `20261021-012705-glass-journeys-board/` | 5, `25ad6eb` | registry finding | Board journey FAIL on the removed board title (`fail-board.png`); `glass-journeys/board` is stale since | yes |
| `20261021-012912-glass-journeys-all/` | 5, `25ad6eb` | registry finding | glass.mjs run directly on its own stack: board FAIL, the other five journeys PASS (`evidence-notes.txt` explains the name) | no (named in `evidence-notes.txt`) |
| `20261021-041337-search-search/` | 6, `7d32c45` | post-fix | Evidence in the main checkout, plus two captures into the same run (`capture-board/`, `capture-board-2/`) | yes |
| `20261021-041352-glass-journeys-create-task/` | 6, `7d32c45` | post-fix | Glass create-task through `vp.mjs`, with the `--out` that `vp.mjs` passed, PASS | yes |
| `20261021-glass-create-task-out/` | 6, `7d32c45` | post-fix | Glass create-task with `--out` given after `--`; `vp.mjs` opened no directory of its own, PASS (`vp-cli-7.txt`) | no |
| `20261021-041833-search-project-line/` | 6b, `e73f219` | plain | `drive search project-line` (#1418's probe, registered in #1411), 12/12 (`vp-cli-8.txt`) | no |
| `20261021-060201-review-modal-empty-review/` | 7, `3d5d2a9` | post-fix | `-- --focus=hunkless` keeps the post-fix `--expect=after`, ALL PASS (`vp-cli-9.txt`) | yes |

Pre-fix legs kept only as transcripts:

- Round 5, before its fix: `unassigned-build` and `gate-actor` answered 400, and stale-sweep wrote its evidence beside the printed directory (`vp-cli-6.txt`).
- The self-test red legs of every round are in `vp-cli-3.txt`, `vp-cli-5.txt` and the `vp-selftest-*.txt` files.

## Segment 1 (#1411): text files

- Transcripts per round: `vp-cli.txt` (round 1), `vp-cli-2.txt` (2), `vp-cli-3.txt` (3, self-test red and green), `vp-cli-4.txt` (chip-word), `vp-cli-5.txt` (4), `vp-cli-6.txt` (5), `vp-cli-7.txt` (6), `vp-cli-8.txt` (project-line), `vp-cli-9.txt` (7).
- Self-test: `vp-selftest-ci.txt` (the first CI run, before install), `vp-selftest-node24.txt`, and `vp-selftest-r5.txt` to `vp-selftest-r12.txt`. Mutations: `vp-selftest-r6-mutations.txt` and `vp-selftest-r7-mutations.txt`.
- Gates: `gates.txt`, then `gates-2.txt` to `gates-12.txt`.
- Negative and positive controls: `negative-control.txt`, `positive-control.txt`, `negative-control-2.txt`.
- Notes added after a run: `evidence-notes.txt`, `rerun-notes.txt`.
- `inventory.json` is the `drive-inventory` workflow's classification of the scripts.
- `pr-gate-1411-run7-7e1c42e.json` and `pr-gate-1411-run8-a72dd46.json` are pr-gate verdicts on #1411.

## Segment 2 (`claude/bootstrap-p1-seg2`)

| File or directory | What it is |
|---|---|
| `seg2-failure-modes.txt` | Failure modes, written before the tests (committed with them in `c3f22bc`) |
| `seg2-selftest.txt` | Self-test red at `c3f22bc` (54/66, the 12 new cases red against main's `vp.mjs` and registry); green 66/66 at `87480f0` and `2ddff26` on Node 22 and Node 24 |
| `seg2-mutations.txt` | 27 mutations of the new rules, each run in a scratch copy, all caught; the runner is the appendix |
| `seg2-live.txt` | Three features driven with only `vp.mjs --help` and the maps' drive lines (api-keys, search, theme), the fresh-stack and own-stack refusals, a glass journey on its own stack, the add-only guard against a real sibling worktree (`--dry-run`), and `archive` and `links` |
| `20261021-135240-api-keys-create/` | Live, plain: `drive api-keys create`, 6/6 (`03-keys-once.png` shows a scratch key's plaintext; the stack's home was deleted by cleanup) |
| `20261021-135246-search-search/` | Live, plain: `drive search search`, 2/2 |
| `20261021-135250-theme-persist/` | Live, plain: `drive theme persist`, 2/2 |
| `20261021-135320-glass-journeys-create-task/` | Live, plain: `drive glass-journeys create-task` on its own stack after cleanup, 3/3 |
| `gates-seg2.txt` | lint, typecheck, spec:parse, the feature-map staleness gate, the registry gate, `vitest --changed origin/main`, `e2e:affected` and the self-test, at `87480f0` and at `2ddff26` |
| `seg2-reviews.txt` | `/code-review` twice (args, shortstat, result) and `/simplify` (what it changed and what it skipped) |

The negative control the ticket asks for (acceptance 3) is segment 1's: `20261020-203942-search/` with
`20261020-204008-search/`, and `20261020-neg3-search-seeded/` with `20261020-neg3-search-reverted/`.
