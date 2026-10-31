# Orb runner verification (#2275)

## What

Worker steps execute through a per-step Unix socket relay. The host retains the machine credential and creates backends lazily. Coordinator steps (`kind === 'chief'`) execute on the host. The container receives the socket, the matching daemon build read-only, and a read-only bare Git seed snapshot. The seed contains only the source's default HEAD branch, without tags, other branches, their unreachable commit objects, untracked files, host Git configuration or Git hooks. `--no-local` forces Git transport rather than copying the local object database. Workspace preparation defaults to `/work`, fetches with step credentials, and disables host credential fallback.

Set `CAIRN_EXECUTOR=orb` to select the existing nspawn provider. Set `CAIRN_ORB_PROXY_URL` to the egress relay provisioned by orb-host; HTTP and HTTPS proxy variables are passed explicitly to the worker.

After exec returns or throws, the host closes the relay and waits for an in-flight finish report. If upstream accepted that report, no second report is sent. Otherwise, the host replays an awaiting-upload journal through `resumePendingUpload`, including checkpoint artifacts. Without a pending upload, it journals and reports `done(failed)` with the exit error. An unreachable host report remains journaled for restart recovery. The run's stop registration remains available during host reporting.

This deliberately replaces the issue's original “host reports nothing” requirement. Measured source in `apps/server/src/services/builds.ts` retains abandoned steps that already heartbeated while their machine remains online. Relying on that sweep would leave a crashed orb's step claimed indefinitely. The host therefore keeps the token and reports the failure. Server sweep code is unchanged.

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

Before implementation, the four focused files produced 31 failures and 75 passes. The two additional checkpoint-size cases also failed before implementation. A further regression proved that a local single-branch clone still copied the private branch's commit object; it failed before adding `--no-local`. The seed-mount assertion passed immediately against the existing exec path: it closes a test gap rather than changing that path. The final checks below supersede the initial implementation's check results.

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

## Review

The initial implementation had two Claude Sonnet 5.5 security reviews. The subsequent independent behavior review returned BLOCK, identifying the seven findings tracked above. This fix round adds regressions before implementing the behavior corrections. No fresh other-vendor review of this fix round has been performed, and no PR was opened or pushed.

## Risk

Agent code inside an orb runs as the same UID as the worker. It can call `token(stepId)` on the relay or inspect worker memory. Credentials returned by the token endpoint are step-scoped and issued by the live server; their authorization remains live server-side. The machine credential remains on the host, but this design is not credential isolation from agent code. Keeping credentials out of worker files does not prevent same-UID access to them in memory or through the relay.

Native `machinectl bind`, release unmounts, base-image dependencies, egress routing, cancellation of a real systemd-run workload, and agent UID mapping were not exercised on macOS. Git ownership checks on `/seed` still require native-host verification. A failed host report remains recoverable in the journal, but no guarantee of progress during a continuing upstream outage is made. The current TLC properties cover bounded safety rather than eventual post-crash completion.
