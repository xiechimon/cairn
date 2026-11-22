# cairn eval suite

The system-level change gate. Design and rationale: `docs/design/eval-gate.md`.

- `suite.json` — suite manifest (dataset name, repeats per kind, expected counts, budgets).
- `tasks/runtime/*.json` — deterministic Coordinator-turn replays: a world seed, a request, a scripted model response list, expected outcomes.
- `tasks/lane/<id>/task.json` + `repo/` — real Devin-CLI tasks over a fixture repository.
- `tasks/canary/*.json` — trivially-known outcomes; a flipped canary means the suite itself is broken.
- `harness/` — the glue that boots the stack under test (in-server Coordinator + `fauxProvider`) and runs `devin -p` for lane tasks.
- `scorers/` — deterministic check functions only; no LLM judge.
- `run.ts` — one arm: `node --import tsx eval/run.ts --arm <name> [--exam <dir>] [--out <file>] [--offline]`.
- `compare.ts` — paired verdict: `node --import tsx eval/compare.ts base.json cand.json <baseSha> <candSha>`.
- `harvest.ts` — owner-run: sealed `coordinator_turn_snapshot` rows → dataset items (`HARVEST_UPLOAD=1` to push).

Everything under `eval/` is `humanQueue.evalConfig` in `packages/shared/merge-gate-paths.json`: a change cannot rewrite its own exam. At run time the exam is read from the merge-base checkout.
