# cairn eval suite

The system-level change gate and daily real-task eval suite. Design and rationale: `docs/design/eval-gate.md`, `docs/design/eval-real-tasks.md`.

- `suite.json` — suite manifest (dataset name, repeats per kind, expected counts, budgets; currently v2: 28 runtime × 3 + 20 lane × 1 + 2 canary × 1 = 106 trials).
- `tasks/runtime/*.json` — deterministic Coordinator-turn replays: a world seed, a request, a scripted model response list, expected outcomes.
- `tasks/lane/<id>/task.json` — real Devin-CLI tasks harvested from Cairn's git history (`parentCommit` -> `fixCommit`), each declaring the user-symptom prompt and hidden regression test checks.
- `tasks/canary/*.json` — trivially-known outcomes; a flipped canary means the suite itself is broken.
- `harness/` — boots the stack under test (in-server Coordinator + `fauxProvider`), materializes isolated `parentCommit` snapshots (`snapshot.ts`), and runs `devin -p` + overlaid regression tests (`lane.ts`).
- `scorers/` — deterministic check functions only; no LLM judge.
- `run.ts` — one arm: `node --import tsx eval/run.ts --arm <name> [--exam <dir>] [--out <file>] [--offline] [--require-langfuse]`.
- Daily host execution — `scripts/ops/eval-daily.mjs` + `scripts/ops/install-eval-daily.sh` (`docs/ops/eval-daily.md`) run the suite daily on a macOS host via `launchd` outside GitHub Actions; repository variable `EVAL_ENABLED` gates only the CI merge-gate job in `.github/workflows/ci.yml`.
- `compare.ts` — paired verdict: `node --import tsx eval/compare.ts base.json cand.json <baseSha> <candSha>`.
- `harvest.ts` — owner-run: sealed `coordinator_turn_snapshot` rows -> dataset items (`HARVEST_UPLOAD=1` to push).
- `harvest-git.ts` — git-history curator & verifier: `--scan` lists candidate `fix(` commits; `--verify [id]` checks baseline, nop (parent fails), and oracle (patched parent passes).

Everything under `eval/` is `humanQueue.evalConfig` in `packages/shared/merge-gate-paths.json`: a change cannot rewrite its own exam. At run time the exam is read from the merge-base checkout.
