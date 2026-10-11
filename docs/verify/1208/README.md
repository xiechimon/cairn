# docs/verify/1208 — machine pin dispatch visibility

Ticket #1208. Custom probe `drive-1208-machine-pin.mjs` (pure live stack +
fake machine wire + chief tool relay, zero daemon, zero LLM). Two runs, two
stacks:

- `live-new/` — this branch (worktree
  `hp-pacman-t-0301-1208-machine-pin-dispatch`, ports 8791/5273): 11/11
  PASS. B1 shows the deliverable: detail machine row renders the re-assigned
  machine plus the `（任务钉选 verify-mea-1208）` suffix.
- `baseline-main/` — one-shot worktree at `origin/main` (ports 8793/5275),
  same probe with `--expect=old`: 11/11 PASS. Dispatch legs A/C/D pass on
  old code too (the ticket's premise "dispatch ignores todo.machineId" does
  not reproduce — the read side landed in #687, 2026-10-03). B1(old) pins
  the defect this branch fixes: the divergent machine row carries no hint
  of the task's pin.

Legs:

- A (premise, wire truth): todo pinned to mea → orchestrate thread pin = mea,
  prompt names the machine, the other machine's claim long-poll returns null,
  the pinned machine claims the chief step.
- A5 (the real divergence source): chief `run_builds` with explicit
  `machineId` re-pins the build to another machine (card #26's observed
  shape: mea online, local-repo clone fails, chief re-dispatches to the
  Mac — chief transcript quotes are in the PR body).
- C (honored control): `run_builds` without `machineId` → build inherits the
  todo pin; machine row shows the pinned machine with no suffix (zero noise).
- D (automatic control): REST start with no pins → build pin null; no
  suffix.
- B (browser): the three detail pages, screenshots 01/02/03.

Server-side dispatch behavior is additionally locked by
`apps/server/test/machine-pin.test.ts` (20/20 on unmodified code — see PR
Verified). Production evidence for the premise correction: card #26 DB rows
quoted in the PR body (build `01a12afd` pinnedMachineId=mea, plan step
machineId=mea).

Re-run recipe: `launch.mjs` (fresh stack) then
`node .claude/skills/verify-pacman/scripts/drive-1208-machine-pin.mjs`
(needs a fresh DB; `--expect=old` for a baseline stack via
`VERIFY_RUN_DIR`/`VERIFY_REPO_ROOT` pointing at an origin/main worktree).
