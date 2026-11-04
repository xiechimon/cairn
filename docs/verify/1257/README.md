# #1257 verification evidence: unclaimed hangs / quota holds / stream-cut reruns

Two-way evidence: `before-*.txt` = the actual failure outputs run on the old code (red); `after-*.txt` /
`a-*` / `b-*` / `c-*` = the passing outputs and live-stack captures on this change.

## Unit-test face (red first, then green)

- `before-classifier.txt` — the classifier module absent (the old code has no task-failure.ts).
- `before-quota-hold.txt` — the quota-hold tests 9/12 failing (the hold column / placement / claim gate unimplemented).
- `before-network-retry.txt` — the runner stream-cut retry tests 4/6 failing (the retry gate unimplemented).
- `before-sweep-hang.txt` — 14 failures on the old code after the sweep-hang semantics flipped (pending steps were still closed as failed).
- Full green state (run points in the PR body's Verified section): shared 355/355, server 999/999, daemon 743/743, web 483/483, lint/typecheck/spec:parse all pass.

## Live-stack face (verify-pacman custom probe)

Rerun recipe (see `.claude/skills/verify-pacman/changelog/2026-10-12-1257.md`):

```sh
VERIFY_PORT=8802 VERIFY_WEB_PORT=5282 node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1257-hang-retry.mjs   # same env prefix
```

Three legs (three stub LLM instances: ok / quota-first / cut-twice):

- **A waiting on a machine**: `a-board-waiting-machine.png` (the board's `等机器` chip) +
  `a-todo-record.json` (REST waitingOn) + `a-final.json` (the plan step done after the daemon returns + plan.md persisted).
- **B waiting on quota**: `b-board-waiting-quota.png` (the board's `等额度` chip) +
  `b-hold.json` (the step's holdReason/holdUntil/holdCount + the todo not landing in failed) +
  `b-final.json` (the backoff expires and the step is re-claimed automatically; the quota recovers and the run completes automatically).
- **C stream-cut rerun**: `c-final.json` (two mid-stream disconnects → the third attempt succeeds, step done) +
  `c-retry-evidence.json` (the daemon's retry lines).
