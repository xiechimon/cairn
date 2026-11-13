# #1065 verification evidence index — zombie claims: claim binds to the request's liveness

Probe = `.claude/skills/verify-pacman/scripts/drive-1065-zombie-claim.mjs` (**pure live stack** — no daemon / no browser / no LLM: dead machine A = a child process whose claim long-poll is SIGKILLed, live machine B = the probe's own process claiming; the step does not need to be executed, the claim ownership is the assertion face). Run date 2026-10-09; dual-stack comparison: after = this branch's worktree (8791/5273), before = a throwaway `origin/main` worktree (8793/5275, `git worktree add --detach` + corepack install).

**Conclusion: after the claiming side of the claim long-poll dies, the server-side waitWake no longer claims new steps on behalf of the dead machine; the live-machine path behaves unchanged.**

| leg | checks | pinned fact (red names the break point) |
|---|---|---|
| before (origin/main) | 1/4 red | A's claiming process SIGKILLed → new step enqueued → wake wakes the zombie waiter first in insertion order → **the step lands on the dead machine** (DB row machineId=dead machine, status=claimed), live machine B gets nothing (step=null) — the ticket phenomenon reproducible as an assertion |
| after (this branch) | 4/4 green | same scenario, same order: A's waiter is removed with the connection break (request signal abort) → the step stays pending → live machine B takes it through the wake path (machineId=B); the dead machine claims zero; claim returns immediately on abort |

Ground-truth artifacts (this directory): `before-result.json` / `after-result.json` (per-item checks + real machineId values) + `unit-before-summary.txt` / `unit-after-summary.txt` (unit tests 4 failed → 6 passed) + `rerun-1025-run1/run2-result.json` (the #1025 probe run back-to-back twice, 13/13 x2 — the rerun no longer hits the zombie-claim window, and also covers a live machine taking and executing steps through the **real daemon** full chain: the live-side artifact of the two-way acceptance). Mechanism diagram `zombie-claim.drawio.svg` (editable source `zombie-claim.drawio`).

## Rerun recipe

```sh
# stack (if the ports collide, bump VERIFY_PORT/VERIFY_WEB_PORT — do not kill the neighbor lane)
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/launch.mjs
# minimal-scenario probe (red reproduction on old code: point VERIFY_REPO_ROOT at an origin/main throwaway worktree stack)
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-1065-zombie-claim.mjs
# back-to-back noise rerun (#1025 probe x2, fresh DAEMON_HOME per run)
env -u http_proxy -u https_proxy -u all_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY NO_PROXY='*' \
  DAEMON_HOME=/tmp/pacman-1025-r1-<new-suffix> node .claude/skills/verify-pacman/scripts/drive-1025-plan-first-round.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Reading the results

- **The before leg's 1/4 is an expected red**: the only PASS is the scenario-prerequisite self-check that "process A really was SIGKILLed"; the three reds = the three faces of the ticket phenomenon (dead machine claims the step / the step lands on the dead machine / the live machine gets nothing).
- **The after leg's waiter removal does not depend on a DB bit**: the probe keeps both machine rows online=true at all times — the criterion binds to the request's liveness (connection break → node-server abort Request signal), not to machine.online (SSE onAbort and the claim long-poll race asynchronously, and tryClaim does not consume it anyway).
- **Abort propagation window**: the probe leaves 1s between the kill and the enqueue; even if the removal lags, the signal recheck at the claimStep exit is the second gate (the race where wake fires first and abort arrives second is pinned by unit test #2).
