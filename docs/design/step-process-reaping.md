# Step process reaping — nothing a step started survives the step

Prior art: `docs/research/step-process-reaping-2026-11-24.md`. Three mechanisms exist industry-wide: kernel boundary (Linux cgroup / systemd scope, Windows Job Object), a reaper ancestor (Linux `PR_SET_CHILD_SUBREAPER`, tini), and a per-run marker env var + full-table process scan (GitHub Actions `RUNNER_TRACKING_ID`). macOS has neither cgroup nor subreaper, so the durable mechanism here is the marker + scan, layered over process-group kills.

## Identification

Every step gets `CAIRN_STEP_TREE=<stepId>.<uuid>` generated in `runClaimedStep` and injected into `opts.env`, so every descendant inherits it:

- session backends (`SessionOpts.env` → claude-code SDK env, acp `sessionEnv`/`runtimeChildEnv`, pi-host spawn env)
- workspace hooks (`setUpStepWorkspace` → `workspace.prepare` → `runWorkspaceHook` env)
- computer `shell`/`bash` calls (`createComputerDispatcher` looks up the marker by `call.stepId` → `HostComputerProvider.execute` request env)

Reaping combines three legs, already implemented in `ProcessTree` (`apps/daemon/src/process-tree.ts`): ppid-walk descendants, `pgid == rootPid` group members, and a full-table env-marker scan — Linux `/proc/*/environ`, macOS `ps -E` (KERN_PROCARGS2) on pids not already known. All step-root spawns are `detached: true` (non-win32) so each session root is a group leader and `kill(-pid)` + `pgid==root` legs actually fire (today claude-code is spawned non-detached, making its group legs dead code — fixed as part of this change; acp non-adapter spawns get the same).

`StepReaper` (new, in `process-tree.ts`) is the step-level variant: it has no single root, so it works purely off the marker scan — collect marker-holders with their start times, SIGTERM all, rescan during a ~3s grace (picks up mid-kill forks), then SIGKILL rounds until none alive.

Windows: Job Objects later (documented in the research doc); marker mechanism is a no-op there today.

## Ledger — surviving daemon restart

`StepJournalEntry.treeMarker?: string` is written into `step-<id>.json` (outbox dir) inside `journal.claim`. On `runMachine` boot, after journal init and before `recover()`, `reapStepLeftovers` scans every `step-*.json`, collects `treeMarker` values and reaps each — leftovers from the previous daemon run die before any step resumes. A `done`/`failed` journal file that failed to be removed is swept the same way. Marker values contain a random component, so a foreign process cannot collide.

## Order

Stop agent → reap tree → release step:

- `finishStepRun` awaits `reaper.reap()` after the session stream is sealed and the watchdog disarmed, before the done report; `failStep` awaits the same before the failed report, so the step is not reported finished/stopped/failed until its tree is dead.
- The same reap is registered as a `stepCleanup`, so every abnormal exit (claim abort, session open throw, unhandled error) reaps on the way out.
- Per-backend closes stay as today (ProcessTree on claude sessions, `adapterProcessGroups`, `killGroup`, `HostComputerProvider` per-call trees); the step reap is the catch-all for escaped grandchildren that those miss.
- `daemon stop` leaves in-flight steps running (existing semantics); each step's own reap still fires when it ends. `StopFailure`/`systemd stop` on Linux sweeps the whole unit cgroup — unchanged.

## Failure behavior

- **EPERM/ESRCH on kill**: logged, skip that pid, continue the loop (kill is best-effort; foreign processes are never signalled — membership is proven by the marker or the group/tree relation at collect time).
- **Pid reuse**: marker-holders are matched by env content, not remembered pids; a `pgid`/ppid member is re-collected from a fresh table each round. For members carried across rounds, the recorded start time is re-read and compared before signalling (`processStartTime`, shared with `services-runtime`).
- **TERM-ignoring**: grace expiry → SIGKILL rounds; reap returns only when no non-zombie member remains (bounded ~grace + 0.5s).
- **Marker invisible**: macOS hides env of Apple platform binaries (`/bin/sleep`) and any process that scrubs its env; such a process is caught only if it is still in the step's ppid chain or process group — accepted residual on macOS, fully covered on Linux via `/proc` for same-uid processes. Documented, matches the threat model (leaked dev servers/builds/browsers are unsigned).
- **Reap timeout/log**: every reap logs the marker and count; a reap that ends with survivors logs which pids remained.

## Deliberately out of scope

- Orb steps: `runStep` inside the orb gets the same code path for free (its own journal + reaper); orb `services-runtime` background services persist across the orb's steps intentionally — the boundary is VM teardown.
- Coordinator runtime tools: in-proc or relayed to a machine (covered on the machine side); MCP stdio connectors in `mcp-servers.ts` are team-level infra, not step-owned.
- `machine-loop.stop()` signalling in-flight steps: unchanged semantics, out of this change's scope.
