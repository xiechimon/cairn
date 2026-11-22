# Runtime-outdated hold: park once, resume on the reported update

Status: fix for the 2026-11-21 incident — bundled Claude Code 2.1.278 was rejected by a model that needs ≥2.1.280; tasks retried the same failure three times, parked as `automatic retries exhausted`, and never came back after the desktop app updated to a build bundling 2.1.330. The Coordinator's `message_thread` then dead-ended on `machine api 409: Task parked`, and it misdiagnosed the old runtime as the user's `~/.local/bin/claude`.

## Who meets it

You run a task and the run dies because Cairn's built-in agent runtime is too old for the model it called — e.g. `API Error: 400 Claude Code 2.1.278 does not support this model; version 2.1.280 or newer is required`. The task card shows **Task parked: Cairn's built-in Claude Code 2.1.278 is too old — this model needs Claude Code 2.1.280 or newer. Update Cairn, then retry.** Retrying is pointless until the runtime changes, so the hold is not a retryable failure and does not spend the retry budget (`automatic-retry.md`). When you update Cairn and the Runner reports its new bundled version, the held task resumes by itself — no Rerun click, no Coordinator round-trip. If you or the Coordinator press resume first, that works too: a resumed task starts a fresh failure episode.

## The rule

- A step failure matching `runtimeUpdateRequired` (shared `task-failure.ts`, `runtime_outdated`) is a **hold**: `parkFailedBuild` writes the parked reason and stops unstarted steps at once, on the first failure. Already landed.
- The hold's release condition lives in the build's `errorMessage`: `runtimeUpdateRequired(errorMessage)` still parses inside a `… Last error:` trailer, so rows parked before this change (e.g. `automatic retries exhausted (3)` over a runtime error) are holds too. No new column.
- **Resume trigger**: `POST /api/machine/presence` and `POST /api/machine/enroll` already persist the daemon's `claudeCode` report into `machine.claudeCodeReport` (`bin.version` is the bundled-or-override binary the runner actually executes — never the owner's `~/.local/bin`). After the report is stored, `resumeRuntimeHeldBuilds(deps, teamId)` scans the team's `failed` todos and restarts each hold whose requirement is satisfied.
- **Satisfied** means: the hold names a runtime matching `/claude/i` (the only runtime with a version uplink), **every** online registered machine in the team with `claudeCodeReport.installed === true` reports `bin.version` ≥ required, and at least one does. The all-online clause stops a resume → fail-on-stale-runner → re-hold loop in mixed-version fleets; a machine with no version vote (orb executor, uninstalled, old daemon without `bin`) does not block or release the hold.
- **Once per task**: a task that already carries a `runtime-resume-*` receipt on any of its builds is never auto-resumed again — a hold whose reported runtime satisfies it but whose run still fails would otherwise loop silently at presence cadence. A person or the Coordinator can still resume it.
- **One resume path**: `applyBuildStepAction(action: 'restart', origin)` is the single function a parked build resumes through — person (UI Rerun), Coordinator (`message_thread`), and the version-report release (`origin: 'runtime'`, new `StepActionOrigin`, `triggerSource: 'retry'`).
- **Gate split**: `origin === 'retry'` keeps `assertAutomaticRetryAllowed` — the automatic sweep still cannot unpark. Person, Coordinator and runtime origins use `assertParkedBuildIdle` — a deliberate resume proceeds once the parked build's steps have settled. Resuming a parked build opens a fresh episode (`retryAttempt 0`) and writes no `Automatic retry k/3` row; a Coordinator restart of a merely-failed (unparked) build still continues the episode at `+1`.
- In `restartFailedBuild`'s reuse path the build's `errorMessage` is cleared before `enqueueStep`, so the parked gate inside `enqueueStep` no longer refuses non-person resumes.

## State

| Field | Where | Meaning |
|---|---|---|
| `build.errorMessage` | `build` column (existing) | Hold predicate: `runtimeUpdateRequired(errorMessage) → {runtime, current, required}` |
| `build.retryAttempt` | `build` column (existing) | `0` on any parked-build resume; `+1` only for non-person restarts of unparked failures |
| `machine.claudeCodeReport.bin.version` | `machine` column (existing JSON) | The bundled/override Claude Code version the Runner last reported |
| `build.triggerSource` | `build` column (existing enum) | `user` person resume, `chief` Coordinator resume, `retry` runtime-release resume |

## Readers and writers

- `parkFailedBuild` (retry-parking.ts) — writes the hold on the first runtime_outdated failure; unchanged.
- `assertAutomaticRetryAllowed` — still parks lazily and throws 409 on parked, but only `origin: 'retry'` callers (the sweep) reach it; its parked-runtime message now names the built-in runtime and the update fix.
- `assertParkedBuildIdle` — the resume gate for person/coordinator/runtime origins.
- `restartFailedBuild` — retryAttempt assignment and the `Automatic retry` transcript row keyed on whether the row was parked.
- `resumeRuntimeHeldBuilds` (new `runtime-holds.ts`) — called from the presence and enroll routes; per hold calls `applyBuildStepAction` with `origin: 'runtime'`, then writes one system row (`Resumed automatically: …`) into the resumed conversation via the client-message receipt.
- `enqueueStep` — unchanged gate; reuse path now enqueues after `errorMessage` is cleared.

## Behavior on each path

| Event | Effect |
|---|---|
| Step fails with a runtime-too-old error | Held at once: parked reason + Coordinator notice carrying `runtimeUpdate` JSON; zero retry budget spent |
| Presence/enroll reports `bin.version` ≥ required on every online claude-installed machine | Each satisfied hold restarts (`origin: 'runtime'`, `triggerSource: 'retry'`, `retryAttempt: 0`) + one `Resumed automatically` row |
| Report below required, or an online installed machine still below it, or runtime names ≠ claude | Nothing; hold waits for the next report, a Rerun, or the Coordinator |
| Coordinator `message_thread` on a parked task | Resumes (fresh episode, `triggerSource: 'chief'`) instead of `409 Task parked` |
| Coordinator restart of an unparked failed task | Unchanged: continues the episode at `retryAttempt + 1` |
| Sweep / schedule / `origin: 'retry'` launch on a parked task | Unchanged: 409, `Task parked: <runtime reason>` when the error names a runtime update |

## Out of scope

Other managed runtimes (pi, gemini, devin, antigravity) emit no "version X or newer" rejection we have measured, and none reports a runtime version upstream — their holds stay until a person or the Coordinator resumes. Holds naming a non-claude runtime are never auto-resumed.

## Trust boundary and bounds

- The hold predicate (`build.errorMessage`) and the release vote (`claudeCodeReport.bin.version`) are both machine-reported. A machine can only act inside its own team's authority and can already claim and run steps; a false report can spend one automatic resume per task, which is bounded by the once-per-task receipt. This is the accepted trust model of the machine protocol, not a new grant.
- The parked-error scan is bounded: rows must pass `retryIsParked` first, and `runtimeUpdateRequired` reads at most the first 8 KiB, so a huge machine-written `errorMessage` cannot stall the presence path.
- `runtime-resume-<buildId>` occupies an unreserved client-message id; a caller who deliberately writes that id on their own build only disables auto-resume for their own task.

## Tests — one per path

`apps/server/test/runtime-hold.test.ts` (red on the pre-change tree):

1. A runtime-outdated failure holds at `retryAttempt 0` with no automatic retry; a satisfying presence report resumes it — `queued`, fresh episode, `triggerSource 'retry'`, `Resumed automatically` row.
2. A report below the requirement leaves the hold parked.
3. A second online installed machine still on the old version keeps the hold parked until it also reports the new version.
4. A legacy `automatic retries exhausted (3)` row whose last error is the runtime rejection resumes the same way.
5. A hold naming a non-claude runtime is not resumed by a claude report.
6. A Coordinator restart of a parked task succeeds and opens a fresh episode (`triggerSource 'chief'`, `retryAttempt 0`); the `origin: 'retry'` sweep path still refuses.

`retry-backoff.test.ts` re-baselines the coordinator-parks-at-cap case: the restart after the park now resumes with a fresh episode instead of throwing 409.
