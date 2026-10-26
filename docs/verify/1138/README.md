# #1138 agent-level concurrency gate — live-stack verification evidence

probe = `drive-1138-agent-concurrency.mjs` (pure live stack + fake machine wire, zero daemon, zero LLM, zero browser — steps are only claimed, never executed; the provider points at an unreachable port; same family as #1065).
**12/12 PASS** (2026-10-11, isolated stack 8791/5273, scratch PACMAN_HOME with a fresh library).

## Criterion families and evidence files

| family | criterion | evidence |
|---|---|---|
| D write face | PATCH 0/51 → 400; 1 → persisted (REST record + SQLite row, double ground truth); an unset Agent reads null | `result.json` D1-D3, `agent-rows.json` |
| G gate judgment | A(cap=1) first step running → second step stays pending, never enters claim; same-batch B candidates still claim (candidate-level skip, no head-of-line blocking); other machines' claims are likewise blocked (the agent pool spans machines, and the machine gate being open still does not issue = the two gates each gate independently) | `result.json` G1-G5, `step-rows.json` |
| C slot-claim | A1 done → terminal state + finishStep team wake → the hung claim immediately takes A2 | `result.json` C1-C2 |
| R null-regression | PATCH null clears back to unlimited → new steps still claim while A2 is running (behavior with no limit set is completely unchanged) | `result.json` R1-R2 |

The "blocked" judgment shape of claim = the long-poll true shape: a hung claim does not return within the budget (`G4: {"hung":true}`, G5 still hung) — from the daemon's viewpoint that is exactly "claim issues no step"; after the wake the same hung claim returns A2 immediately (C1's `woken.body.step.step.id` = A2).

## Rerun recipe

```sh
# worktree lane: run both the stack and the script from the worktree path
VERIFY_REPO_ROOT=<worktree> node <worktree>/.claude/skills/verify-pacman/scripts/launch.mjs
node <worktree>/.claude/skills/verify-pacman/scripts/drive-1138-agent-concurrency.mjs
node <worktree>/.claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Unit tests / affected surfaces

`apps/server/test/agent-concurrency.test.ts` (red first, then green, 8/8: the cap is the gate / sub-pools do not head-of-line-block / null regression / slot-claim / cross-machine accounting / chief takes no slot / review meta accounting / PATCH write face); affected surfaces: 9 files, 103 tests + shared records 56 all green.
