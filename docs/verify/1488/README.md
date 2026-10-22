# #1488 evidence: a step deleted by reset stops on its next heartbeat

Base = `29e60bb7` (origin/main).

`resetTodo` deletes a claimed step in the same call that signals its stop, so the daemon's pull of the stop finds nothing. Before this change the runner also swallowed every heartbeat error. The agent ran to the end, spending tokens, holding a slot, and pushing to the old branch.

- Server (`heartbeatStep`, `apps/server/src/services/machines.ts`): 410 when the step row no longer exists; 404 stays for a step this machine does not hold.
- Daemon (`runStep`, `apps/daemon/src/runner.ts`): on 410 the run delivers a stop to itself (discard false). The session is interrupted, the step ends as stopped, and commit and push are skipped. A 404 keeps running, because after a release #1483 lets the same machine's run carry the new claim. Network errors are ignored as before.

| file | source | result |
|---|---|---|
| `old-leg-server.txt` | machines.ts from origin/main | 2 failed: the heartbeat after a reset, and for an unknown id, answers 404 |
| `new-leg-server.txt` | this branch | 2 passed (410 after reset, 200 while held, 404 for another machine's step) |
| `old-leg-daemon.txt` | runner.ts from origin/main | 1 failed: on heartbeat 410 the run never ends (`Test timed out in 5000ms`) |
| `new-leg-daemon.txt` | this branch | 8 passed: 410 → `done(stopped)`, no commitAll / push; 404 and a network error → keeps running |
| `server-suite.txt` | this branch, whole server suite (includes #1486, #1487) | 125 files, 1956 passed, 1 skipped |
| `daemon-suite.txt` | this branch, whole daemon suite | 87 files, 945 passed |
| `verify-step-claim.txt` | TLA+ model of the step lifecycle | P1-P4 PASS, 685,236 states each, matching `expected.txt` |

The model needs no change. It has one task, one build and one step, and never deletes the step. The 410 fires only for a deleted step, and on a 404 the daemon does what it did before. The script's list of covered files changed since `sync-commit` is at the end of `verify-step-claim.txt`.
