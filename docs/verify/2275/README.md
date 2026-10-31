# Orb runner verification (#2275)

## What

Worker steps execute through a per-step Unix socket relay. The host keeps the machine credential and creates backends lazily. Coordinator steps (`kind === 'chief'`) execute on the host. The container receives the socket, the matching daemon build read-only, and a read-only bare Git seed snapshot. Workspace preparation defaults to `/work`, fetches with step credentials, and disables host credential fallback.

Set `CAIRN_EXECUTOR=orb` to select the existing nspawn provider. Set `CAIRN_ORB_PROXY_URL` to the egress relay provisioned by orb-host; HTTP and HTTPS proxy variables are passed explicitly to the worker.

## Proof

The tests use real Unix sockets, fake upstream MachineApi implementations, fake backends, and local Git repositories. The compiled-worker process probe runs pi against a stub LLM, exercises a shell tool and setup/resume hooks, and completes two steps with session reuse. It simulates container mounts; it does not launch nspawn.

Failure modes covered:

- Every allowed method forwards the bound step's body unchanged; forbidden methods, another step and unissued upload URLs fail with typed errors before reaching upstream.
- Binary skill responses, upstream ownership errors, tool cancellation, pending-call shutdown and duplicate completion are checked over the socket.
- The worker creates no host backend; exec arguments and environment contain no machine credential or daemon state paths.
- A scripted worker sends one completion and leaves credential sentinels out of runtime files.
- Coordinator steps stay on the host. Capacity, lifecycle notes, stop during preparation, steer acknowledgement and journal checkpoints retain coverage.
- Container death produces no host completion or artifact upload. Relay loss interrupts the worker session.
- Stale sockets are reclaimed; active listeners remain intact.
- A bare seed omits untracked files, host configuration, hooks and credentialed origin configuration. Non-Git sources fail before a bind is constructed.
- Workspace seeding leaves the seed unchanged and fetches with the step credential.

Measured final checks:

| Command | Result |
| --- | --- |
| `pnpm lint` | PASS; 1,346 files checked, one pre-existing informational suggestion |
| `pnpm typecheck` | PASS; five workspace packages |
| `pnpm spec:parse` | PASS; 1,418 web tests in 207 files, 67 integration files |
| `pnpm exec vitest run --changed --project @xiechimon/cairn-cli --project @xiechimon/cairn --maxWorkers=4` | PASS; 522 tests in 58 files |
| `pnpm exec vitest run apps/daemon/test/orb-provider.test.ts` | PASS; 21 tests in one file |
| `pnpm --filter @cairn/web e2e:affected` | PASS; no web surface selected |
| `pnpm prepush` | PASS; 20 checks |

The initial unscoped related run also selected browser integrations and was interrupted. The final related run is scoped to daemon/server tests. Git test windows now start before their commits, socket cleanup is awaited, and real process fixtures have explicit integration time budgets.

TLC command: `.claude/skills/verify-step-claim/scripts/run.sh`.

```text
P1_SingleExecutorPerMachine: PASS, 685236 distinct states
P2_OnlyHolderResultApplied: PASS, 685236 distinct states
P3_NoClaimAfterClose: PASS, 685236 distinct states
P4_AcceptedStopReachesWorkers: PASS, 685236 distinct states
```

The machine claim, recover and stop dispatch algorithms are unchanged. The host backend is now lazy, and orb execution hands heartbeat responsibility to the worker after session registration. The existing bounded TLC safety model is unchanged; its pass does not establish liveness or native container behavior.

## Review

Two fresh Claude Sonnet 5.5 `/security-review` runs reviewed the Codex implementation. Round one identified raw host seed exposure and stale-socket recovery failure. Both were fixed after adding failing regressions. Round two returned PASS with no remaining confirmed security findings. The reviewer read source in full but inspected test titles rather than test bodies, and did not execute tests.

## Risk

- Existing `sweepAbandonedBuildSteps` in `apps/server/src/services/builds.ts` retains stale steps that previously heartbeated while their enrolled host is online. Therefore automatic post-crash release while the host remains online is not established by this daemon change, despite the issue's assumption. No server lease policy was changed.
- Native `machinectl bind`, release unmounts, base-image dependencies, egress routing and agent UID mapping were not exercised on macOS. Git ownership checks on `/seed` still require native-host verification.
- A rejected in-flight completion remains in the private host journal for the existing restart recovery path; the relay does not retry that completion itself.
- No PR was opened or pushed. This Risk section is retained for the eventual PR handoff.
