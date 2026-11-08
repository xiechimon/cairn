# Model rejection retry storm: verification

## Scope and evidence limits

This extends #3083, rather than reverting its citation retry cap. Read-only task #122 / issue #3302 did not inspect the SDK and marked its auto-retry explanation as inference. The current installed SDK does not retry the original sanitized 404 in an actual HTTP replay. Adding a misleading upstream 503 diagnostic makes that SDK start auto-retry, which the new synchronous bridge guard prevents.

Live SQLite was inspected with `mode=ro`. Aggregates confirm 2,644 model-not-found build errors, with the largest citation groups at 1,863, 615, 78 and 78. The two largest groups stopped before #3083 merged. There are 23 matching builds after merge time, but that is not a deployment timestamp. The latest sampled error already has citation parking. Historical daemon logs and deployment timestamps were not established, so this does not prove a citation-cap regression or an SDK cause for the historical build count.

The citation route is team configuration: `routing_rule` where `use=citation_check`, `provider=relay-186`, `modelId=glm-5.3`. Its migration provenance joins the old checker in `legacy_agent_backup`, with the same provider and model. The rule takes precedence over `session`. No live configuration was changed, and no real relay request was made.

## Threshold

The historical rolling-hour query counted builds with an actual failed step, excluding model-not-found errors. Counts 1/2/3 occurred 74/15/3 times; longer bursts reached 28. N=3 allows those short clusters and the existing citation three-attempt budget, while parking on the fourth failed build. These data do not establish that every longer sequence was illegitimate.

The runtime counts distinct failed builds, not failed steps, in `(now - 1 hour, now]`. It uses step completion time, falling back to build creation time for legacy rows: 108 of 2,832 failed steps in the inspected database had no completion timestamp. Once parked, waiting an hour does not autonomously reopen the task. Human-directed recovery remains possible after fixing routing.

## Tests first

| Seam | Observed red before its fix | Current assertion |
| --- | --- | --- |
| Installed pi SDK over HTTP | Misleading 503 diagnostic emitted 1 auto-retry event | Original and mixed-diagnostic rejection each make 1 HTTP request, with 0 retry events |
| Daemon runner | Scripted rejection reached 4 SDK retry events | Stop on the first error, retain the model-naming cause |
| Server model fallback | Rejected model step became pending | Failed step, no fallback and no subsequent claim |
| Todo retry sweep | First rejected-model failure became queued | Still failed, 1 build, present in Needs you |
| Same-build enqueue | Automatic enqueue succeeded after parking | Rejected before inserting a step |
| Queued-message drain | Stopping a pending peer let an after-stop queued message reopen the parked build | Remains parked; queued text is retained with the same clear error |
| PR pollers | Six regressions reproduced managed CI/review/conflict wakes, legacy collaborator feedback, a rejection during intake, and a deferred cap overwriting the reason | Both pollers recheck fresh parking state before mutation; the cap notice cannot replace it |
| Claimed siblings | Seven regressions reproduced ordinary failure, quota fallback, successful completion and stopping erasing parking or advancing the task | A shared terminal-outcome barrier records the sibling step result without changing the parked build or todo |
| Watched todo re-orchestration | Failure enqueued 1 Coordinator step | 0 Coordinator steps, visible structured notice |
| Rolling-hour breaker | Fourth failure retained only its ordinary error | Parked at 4, no automatic new build |
| Legacy timestamps | Null completion timestamps escaped the count | Legacy failed builds count using creation time |
| Notice durability | Injected notice-write failure left a parking receipt behind | Transaction rolls back the receipt and can retry |
| Coordinator visibility | Plain system string failed the existing notice schema | Existing `chief_notice` shape, confirmed visible in the real app |
| Unsupported-model spellings | Local model lookup, hyphenated response and mixed quota diagnostic were misclassified | Terminal model class takes precedence |
| Citation scheduler | Already fixed by #3083; no current red claimed | Existing 6 cap, dead-model, scheduler and persistence regressions pass |

## Commands and results

```sh
pnpm exec vitest run \
  apps/server/test/needs-you.test.ts \
  apps/server/test/model-fallback.test.ts \
  apps/server/test/research-citation-retry-cap.test.ts \
  apps/server/test/thread-message.test.ts \
  apps/server/test/chief-wake-atomic.test.ts \
  apps/daemon/test/pi-model-rejection.test.ts \
  apps/daemon/test/runner-quota-breaker.test.ts \
  packages/shared/test/task-failure.test.ts
```

Result: 8 files, 172 tests passed. Additional PR-poller and queue regressions passed:

```sh
pnpm exec vitest run apps/server/test/pr-wakes.test.ts apps/server/test/loop-feedback.test.ts
pnpm exec vitest run apps/server/test/composer-queue-stop.test.ts apps/server/test/chief-queue-steer-stop.test.ts apps/server/test/queued-cancel-release.test.ts
```

Results: 95 and 60 passed respectively, for 327 related tests across 13 files. A final combined invocation of these same 13 files also passed all 327 tests.

| Command | Result |
| --- | --- |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed, all packages including integration |
| `pnpm spec:parse` | Passed: 1,581 web tests collected and 70 integration files parsed |
| `pnpm prepush` | Passed, 23 checks |
| `pnpm exec vitest run --changed` | First invocation exceeded the command timeout |
| `env -u PI_CACHE_RETENTION pnpm exec vitest run --changed` | 9,332 passed, 11 failed, 1 expected failure, 1 skipped; 656 files |
| Rerun the 6 failing Vitest files with `umask 022` and `PI_CACHE_RETENTION` unset | 101 passed, 1 skipped; the broad-run failures were timeouts and mode expectations under inherited umask 0077 |
| `pnpm --filter @cairn/web e2e:affected` | 1,556 passed, 4 failed, 21 skipped |
| `pnpm --filter @cairn/web e2e:affected apps/web/e2e/activity-page.spec.ts apps/web/e2e/chief-home-follow-send.spec.ts apps/web/e2e/gallery-snapshots.spec.ts` | 52 passed; the 2 gallery baseline tests still fail |

No gallery baseline was rewritten. The cause of the gallery differences was not established, and the full e2e suite is not claimed green. CI on the PR head remains authoritative.

The six-file Vitest rerun was:

```sh
(umask 022; env -u PI_CACHE_RETENTION pnpm exec vitest run \
  apps/server/test/migration-0115-oracle.test.ts \
  apps/server/test/trajectory-reflect.test.ts \
  apps/server/test/unread-notifications.test.ts \
  apps/server/test/verify-dispatch.test.ts \
  apps/daemon/test/config-state.test.ts \
  apps/daemon/test/orb-transport.test.ts)
```

## Live app

An isolated verify-cairn server and web app were launched on ports 8794 and 5276, with a fresh scratch data directory. A synthetic machine enrolled over HTTP, claimed a real session step, and reported the sanitized model rejection through the machine completion API. Reporting it twice leaves 1 build, a failed step, 1 parking notice in the Coordinator thread, and a Needs you item. The route included a fallback model; it was not dispatched. Credentials were held only in the probe process and are absent from the evidence files.

The installed pi SDK HTTP test is separate from this live-app probe: the live app used a synthetic machine completion report, not a real daemon or model provider. The screenshots are real app pages without fixture mode. The test host label is masked.

- [Light screenshot](retry-final/light.png)
- [Dark screenshot](retry-final/dark.png)
- [Sanitized API/SQLite result](retry-final/result.json)

Live: isolated server machine API, SQLite rows and real app task/Coordinator surfaces; production evidence was read-only.
Mocked: machine completion and local HTTP provider errors; no real provider call.
Not covered: live relay availability, historical SDK logs, deployment timing, production rollout, and the outstanding local gallery differences.
