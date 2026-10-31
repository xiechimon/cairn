# Orb runner verification (#2275)

## What

Worker steps execute through a per-step Unix socket relay. The host retains the machine credential and creates backends lazily. Coordinator steps (`kind === 'chief'`) execute on the host. The container receives the socket, the matching daemon build read-only, and a read-only bare Git seed snapshot. The seed contains only the source's default HEAD branch, without tags, other branches, their unreachable commit objects, untracked files, host Git configuration or Git hooks. `--no-local` forces Git transport rather than copying the local object database. Workspace preparation defaults to `/work`, fetches with step credentials, and disables host credential fallback.

Set `CAIRN_EXECUTOR=orb` to select the existing nspawn provider. Set `CAIRN_ORB_PROXY_URL` to the egress relay provisioned by orb-host; HTTP and HTTPS proxy variables are passed explicitly to the worker.

After exec returns or throws, the host closes the relay and waits for an in-flight finish report. If upstream accepted that report, no second report is sent. If the orb attempted `done` but upstream rejected it, the host replays the awaiting-upload journal through `resumePendingUpload`, including checkpoint artifacts. If the orb never sent `done`, a checkpoint alone cannot claim completion: the host journals and reports `done(failed)` with `orb exited with code N`, including exit code 0. Signal termination uses 128 plus the signal number. An unreachable host report remains journaled for restart recovery. The run's stop registration remains available during host reporting.

This deliberately replaces the issue's original “host reports nothing” requirement: **approved by ian 2026-10-31**. Measured source in `apps/server/src/services/builds.ts` retains abandoned steps that already heartbeated while their machine remains online. Relying on that sweep would leave a crashed orb's step claimed indefinitely. The host therefore keeps the token and reports the failure. Server sweep code is unchanged.

The host starts a heartbeat watchdog when dispatching orb exec. Every validated orb heartbeat refreshes it before upstream forwarding, even if upstream is slow or unreachable. The host timeout is defined once as `ORB_HEARTBEAT_TIMEOUT_MS = 120_000`, matching the server-only `BUILD_ABANDONED_STEP_MS`; `orbHeartbeatTimeoutMs` injects a shorter deadline for tests. On timeout, the host closes the relay, aborts exec, stops the container through the provider and reports `done(failed)` with `orb heartbeat timeout`. A completion already in flight is awaited; an accepted completion suppresses host reporting. A later completion cannot overtake the timeout. Accepted completion and exec termination clear the watchdog.

The relay accepts exactly one connection during a step socket's lifetime. It uses a fixed 16 MiB input buffer, disconnects oversized or invalid worker frames, and limits queued output to 16 MiB. Transcript JSON and session content each have a 4 MiB UTF-8 checkpoint limit before any host write. Rate-limit reports use `claudeRateLimitReportSchema`, replace the supplied machine identity with the host claim's machine identity, normalize seconds/milliseconds, cap reset times at eight days, and allow at most one report per 30 seconds per step, including rejected upstream attempts. A stop sends the worker a frame and aborts exec after a five-second grace period if it has not returned.

## Proof

Tests use real Unix sockets, fake upstream MachineApi implementations, fake backends, and local Git repositories. The compiled-worker process test runs pi against a stub LLM, exercises a shell tool and setup/resume hooks, and completes two steps with session reuse. It simulates container mounts; it does not launch nspawn.

Round-two failure modes and regression names:

| Finding | Tests |
| --- | --- |
| 1. Crash leaves a claim stuck; rejected completion cannot retry | `OOM after a worker heartbeat is failed by the online host`; `retries a rejected finish report over the same connection`; `worker exit replays a rejected journaled finish with its checkpoint artifacts`; `a stop after worker crash still reaches the run while host completion is pending`; `worker exit waits for an in-flight finish report without replacing or duplicating it`; `an unreachable host failure report remains journaled for replay`; six preparation/exec failure cases |
| 2. Machine-wide rate-limit poisoning | `validates rate-limit reports before forwarding`; `binds rate-limit machine identity and caps reset timestamps` (seconds and milliseconds); `throttles rate-limit reports per step even after upstream rejection` |
| 3. Unbounded input, checkpoints and extra connections | `disconnects an oversized complete frame` (ASCII and multibyte); `destroys a socket when an unterminated frame exceeds the byte limit`; `accepts exactly one connection for the lifetime of a step socket`; `disconnects a non-reading worker when queued output exceeds the frame budget`; `disconnects invalid worker frame` (eight cases); `rejects oversized checkpoint transcript before writing host files`; `rejects oversized checkpoint sessionContent before writing host files` |
| 4. Stop is advisory | `a worker ignoring stop is aborted after the grace period`; existing stop-during-preparation coverage |
| 5. Agent-code credential boundary | Documented below; this is a boundary clarification, not an isolation claim |
| 6. Unrelated seed branches | `mounts a private bare snapshot with committed objects and no host working files or config` now creates another Thread branch and a tag, then asserts that the seed has only `refs/heads/main` and cannot resolve the other branch's private commit object |
| 7. Missing seed bind assertion | `exec exposes only the socket, read-only build and read-only project seed` now supplies a real local repository and asserts the exact `/seed/project/repo` read-only mount |

Before implementation, the four focused files produced 31 failures and 75 passes. The two additional checkpoint-size cases also failed before implementation. A further regression proved that a local single-branch clone still copied the private branch's commit object; it failed before adding `--no-local`. The seed-mount assertion passed immediately against the existing exec path: it closes a test gap rather than changing that path. The round-two checks below supersede the initial implementation's check results. Follow-up results are recorded separately below.

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS; 1,346 files, one pre-existing informational suggestion |
| `pnpm typecheck` | PASS; five workspace packages |
| `pnpm spec:parse` | PASS; 1,418 web tests in 207 files and 67 integration files |
| `pnpm exec vitest run apps/daemon/test/orb-{relay,step,seed,runner,provider,workspace,worker-process}.test.ts --maxWorkers=1` | PASS; 133 tests in seven files, including the compiled-worker process probe |
| `pnpm exec vitest run --changed --project @xiechimon/cairn-cli --project @xiechimon/cairn --maxWorkers=1` | PASS; 212 tests in 21 files |
| `pnpm --filter @cairn/web e2e:affected` | PASS; no web surface selected |
| `.claude/skills/verify-step-claim/scripts/run.sh` | PASS; four properties, 685,236 distinct states each |
| `pnpm prepush` | PASS; 20 checks |

Final test verification uses one worker. An earlier run concurrent with lint/typecheck hit two five-second test timeouts and the compiled probe's sixty-second second-turn wait; all seven orb files subsequently passed with one worker, without increasing those deadlines.

The existing bounded TLC safety model is unchanged. Orb crash fallback uses the same claimed-step failure and journal replay operations already represented by `FinishSession`, `FinishStepOwnedCheck` and `FinishStepApply`. It creates no new executor or claim, and preserves a journaled result when replaying. The new real-socket tests exercise orb exit, retry and stop timing that the model does not distinguish. TLC does not establish liveness, cancellation deadlines or native container behavior.

## Follow-up verification (2026-10-31)

Measured failure modes and regression names in `apps/daemon/test/orb-watchdog.test.ts`:

| Failure mode | Test |
| --- | --- |
| Exit without completion | `orb exits mid-step with code %i and reports exactly one failed done` (0, 1, 137) |
| Signal exit loses its status | `signal termination reports 128 plus the signal number exactly once` (a real child exits on SIGTERM, yielding 143) |
| Live orb stops heartbeating or never connects | `silent orb is killed and reports exactly one heartbeat timeout, connected=%s` (false, true) |
| Slow upstream hides a healthy orb | `every received heartbeat refreshes the watchdog before upstream responds` |
| Normal completion gains a host duplicate or a stale timer | `normal orb done suppresses the host fallback and clears the watchdog` |
| Completion and timeout race | `orb done racing the watchdog is awaited without a second report`; `a done sent after the watchdog cannot replace its failure report` |
| Checkpoint incorrectly substitutes for completion | `an awaiting-upload checkpoint without done still fails on %s` (exit, timeout) |

The first focused run produced seven failures and two passes before implementation. Two subsequent checkpoint-only regressions failed because the host reported success without receiving `done`; they preceded the completion-attempt guard. Socket traffic, host completion payloads, abort signals and provider stop calls are exercised at runtime with fake timers and a fake nspawn command runner. Native Linux container termination remains unverified on macOS.

Measured follow-up checks (working tree based on `aea85afb2`):

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS; 1,347 files, one existing informational suggestion |
| `pnpm typecheck` | PASS; five workspace packages |
| `pnpm spec:parse` | PASS; 1,418 web tests in 207 files and 67 integration files |
| `pnpm exec vitest run apps/daemon/test/orb-{relay,step,seed,runner,provider,workspace,worker-process,watchdog}.test.ts --maxWorkers=1` | PASS; 145 tests in eight files, including 12 new watchdog cases |
| `pnpm --filter @cairn/web e2e:affected` | PASS; no web surface selected |
| `pnpm exec vitest run --changed --project @xiechimon/cairn-cli --maxWorkers=1` | PASS; 229 tests in 21 files on Node 24.14.0 |
| `pnpm prepush` | PASS; 20 checks on Node 24.14.0 |

The eight-file run used the shell's initial Node 26.8.1. Lint, typecheck, spec parsing and affected e2e were also run through `fnm exec --using 24.14.0`, matching `.nvmrc`.

## Review

The initial implementation had two Claude Sonnet 5.5 security reviews. The subsequent independent behavior review returned BLOCK, identifying the seven findings tracked above. This fix round adds regressions before implementing the behavior corrections. No fresh other-vendor review of this fix round has been performed, and no PR was opened or pushed.

## Risk

Agent code inside an orb runs as the same UID as the worker. It can call `token(stepId)` on the relay or inspect worker memory. Credentials returned by the token endpoint are step-scoped and issued by the live server; their authorization remains live server-side. The machine credential remains on the host, but this design is not credential isolation from agent code. Keeping credentials out of worker files does not prevent same-UID access to them in memory or through the relay.

Native `machinectl bind`, release unmounts, base-image dependencies, egress routing, cancellation of a real systemd-run workload, and agent UID mapping were not exercised on macOS. Git ownership checks on `/seed` still require native-host verification. A failed host report remains recoverable in the journal, but no guarantee of progress during a continuing upstream outage is made. The current TLC properties cover bounded safety rather than eventual post-crash completion.

## Local Project delivery fix (2026-10-31)

Measured failure: local workspaces inside an orb have the read-only seed as their origin, so normal finalization cannot deliver commits to the original host repository. Local worker finalization now creates a bundle of exactly `refs/heads/<conversationBranch(conversationId)>` and calls `deliverBundle(stepId, filename)` over the real step relay. GitHub Projects continue through `WorkspaceManager.push` with the existing credential path.

For each local step, the host creates a unique 0700 directory and mounts it writable at `/run/cairn/outbox`, with release after exec. The directory is removed after relay shutdown on success and failure. The worker removes its bundle after the delivery attempt. Only a filename matching the bounded bundle-name schema crosses the relay; the repository path and Thread identity come from the host claim. The new method retains the existing allowlist, step binding and 16 MiB frame limit, rejects extra arguments and cancellation flags, and is unavailable without a host local-delivery configuration.

The host opens the outbox file without following symlinks, requires a regular file with one link, and enforces a 64 MiB cap. It copies the bounded contents into a private host temporary directory before running Git, preventing subsequent worker edits from replacing the verified input. `git bundle verify` must succeed and `git bundle list-heads` must return exactly the claimed Thread branch. Fetch uses one explicit branch refspec without force, tags, ref mapping or a FETCH_HEAD write. Divergence fails; a host branch already containing the delivered commit succeeds without changing its ref. Git refuses delivery into a checked-out host branch. Delivery errors become ordinary failed-step reports with the Git rejection reason. Relay shutdown waits for in-flight delivery before removing the outbox.

Measured runtime regressions in `apps/daemon/test/orb-delivery.test.ts` use real temporary Git repositories, a real Unix relay socket, the actual worker and runner finalization, and a fake backend that creates a real commit:

| Test | Coverage |
| --- | --- |
| `local orb step delivers a new commit and releases its per-step outbox` | Host branch hash and file contents match the worker commit; no push to seed; 0700 writable outbox mount and cleanup |
| `github orb step delivers a new commit and releases its per-step outbox` | Existing real push path delivers the commit |
| `local-rejected orb step delivers a new commit and releases its per-step outbox` | Checked-out host branch rejects delivery, normal failed step reports the reason, outbox is removed |
| `relay rejects %s delivery without changing host refs` | Nine cases: extra ref, another Thread branch, oversized file, traversal, absolute path, symlink, invalid bundle, wrong step, extra argument; complete host ref list remains unchanged |
| `host bundle delivery preserves %s push semantics` | Three cases: fast-forward, divergence and already-contained commit |

The initial focused run failed ten cases and passed the GitHub control before implementation. The final focused orb run passes 178 tests in nine files, including these 15 delivery cases and the compiled-worker process probe. The mount assertion in `orb-runner.test.ts` now includes the ephemeral outbox.

Checks run with `fnm exec --using 24.14.0`:

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS; 1,369 files, one existing informational suggestion |
| `pnpm typecheck` | PASS; five workspace packages |
| `pnpm spec:parse` | PASS; 1,418 web tests in 207 files and 67 integration files |
| `pnpm exec vitest run apps/daemon/test/orb-{delivery,relay,step,seed,runner,provider,workspace,worker-process,watchdog}.test.ts --maxWorkers=1` | PASS; 178 tests in nine files |
| `pnpm --filter @cairn/web e2e:affected` | PASS; no web surface selected |
| `pnpm exec vitest run --changed --project @xiechimon/cairn-cli --maxWorkers=1` | PASS; 286 tests in 22 files |
| `pnpm prepush` | PASS; 20 checks |

Native Linux nspawn mounts and UID mapping remain unverified on macOS; the tests simulate mount placement while exercising real Git delivery and socket traffic. No push or PR was performed for this fix.
