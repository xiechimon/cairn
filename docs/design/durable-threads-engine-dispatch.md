# Durable threads and engine dispatch

Status: design for the owner's review. Nothing here is built. It answers the open questions in the proposal on PR #3924 (`docs/design/durable-threads-and-engines.md`, not on main) and the live engine view beside it. Research: [durable-threads-engine-dispatch-2026-11-11.md](../research/durable-threads-engine-dispatch-2026-11-11.md). Evidence is **Observed** on `origin/main` `7299c658e` unless marked **Proposed**.

## Answers

**Where it runs.** In the server process, one pi-durable sqlite per thread at `join(dataDir, 'threads', threadId + '.sqlite')`. The daemon never opens that file. pi-durable is one writer per storage (Observed, installed README). The Coordinator already uses this split: `coordinatorStoreDir` is `join(dataDir, 'coordinator')`, opened only by `openCoordinatorHarness` (`apps/server/src/coordinator/index.ts`, `runtime/harness.ts`, `runtime/thread-harnesses.ts`). A machine going offline must not take the thread's context with it. File edits and commands stay on the daemon, behind `apps/daemon/src/backend/command-gate.ts`.

**What it persists.** The store holds the thread's own entries, agent document, compaction, submissions, and `docs["pi.usage"]` for the thread's own turns only. Product truth stays in `server.db`, mirroring `coordinator_conversation`, `coordinator_entry`, `coordinator_input`, and `chief_summary`: a `thread_conversation` row, an entry map onto the existing transcript rows, and one `engine_dispatch` row per job. Memory stays in `agent_memory` and is injected per request, as `runtime/volatile.ts` does, never stored as a user entry. Engine scrollback is a bounded blob on the dispatch row, not model context.

**Dispatch tool.** `dispatch_engine`, a server tool on the thread harness, same placement as Coordinator tools. Input is the engine id, the owner's original words and cited sources (never a model paraphrase), the workspace ref, and a budget. It commits the dispatch row before any daemon start. The tool result is the exit state, a bounded result text, and the usage rows. Progress is not fed back into the model unbounded.

**Output, cost, stop.** Output is the tool result plus the existing transcript upload. Cost from the engine is reported the way `recordStepUsage` writes `token_usage` today (`apps/server/src/services/coordinator-steps.ts`), keyed to the dispatch and the build. It is not added to the thread's `pi.usage`. Stop writes `stop_pending` and sends `stopSignal` (`apps/server/src/services/builds.ts` `requestStop`, `machine-wake-hub.ts`), then the daemon `deliverStop` (`apps/daemon/src/machine-loop.ts`). The thread is not marked stopped until that ack, or until the dispatch is `stop-unacked` after retries.

**Subscriptions and routing.** The thread's own turns use a new `thread` route use, resolved like `coordinator` in `ROUTE_USES` (`packages/shared/src/records/routing-rule.ts`), on a server-held connection. Until the owner sets one, it uses the coordinator binding. Engines keep today's gates: `capabilityCandidates` (`apps/server/src/services/step-route.ts`), `hasActiveClaudeSubscription` (`claude-subscriptions.ts`), Claude rate and login checks, and Codex login on the machine for `CODEX_MODEL` (`packages/shared/src/capability-routing.ts`). `MACHINE_RUNTIMES` (`packages/shared/src/records/machine.ts`) means which engines that machine can run, not which harness the thread runs on. `pi` in that list remains the Codex-via-pi engine (`apps/daemon/src/backend/pi.ts`). A quota end is `quota`. Nothing switches model or engine on quota exhaustion.

**Migration.** An in-flight claimed step finishes on its current engine. The next turn opens a pi session seeded from the product transcript, not from `sdkTranscriptPath` (`apps/daemon/src/backend/claude-code.ts`), which is machine-local and already fails across machines (`resumeMissNote` in `apps/daemon/src/runner.ts`). `step.sessionId` becomes the engine session id inside the dispatch, not the thread id. `chief_thread.sessionRuntime` is the Coordinator and is left alone.

## States

Thread: `absent -> opening -> idle`. An own turn is `idle -> running -> idle`, or `running -> failed` with the entries kept. A dispatch is `idle -> dispatching -> idle`. `opening` failure returns to `absent` with no row.

Dispatch: `admitted -> starting -> running -> settling -> done | failed | stopped | quota | unavailable`. `stop-requested` overlays `starting` or `running`, then `stop-acked` (terminal `stopped`) or `stop-unacked`. A crash after `admitted` resumes from the row; it does not insert a second row (`requestId` is the dispatch id).

View: `closed -> live-view` (read-only) while `running`. `takeover-requested -> takeover-held -> released` only from `live-view`. After the process exits, `live-view -> scrollback`. If the process has no PTY, or redaction cannot scan a chunk, `live-view -> transcript-fallback`. Phone is always `transcript-fallback`.

## Paths that read or write

| State | Writes | Reads | On failure |
| --- | --- | --- | --- |
| Thread store | Server thread runner only, under a lease of the same shape as `coordinator_lease` | Server runner; a read-only open for transcript rebuild | Open or lease failure reports in the conversation and leaves no `thread_conversation` row. A crash mid-turn resumes on the same request id. The daemon opening the file is a defect, not a fallback. |
| `thread_conversation` and entry map | Mirror after each committed thread entry, in the product transaction | Web transcript, migration seed, rewind | Mirror failure retries. The UI shows the last mirrored entry and a lag flag. It does not reread the live store from the web. |
| `engine_dispatch` | `dispatch_engine` inserts `admitted` before start. Daemon updates `starting`, `running`, usage, and exit. `requestStop` sets `stop-requested`. | Thread tool wait, status line, view gateway, `recordStepUsage` | Start failure sets `unavailable` and returns that to the thread, which may pick another eligible engine. No half-started row is deleted. A duplicate start with the same dispatch id returns the existing row. |
| Usage | Daemon finish path, same shape as today's done body | `token_usage` by build and model; dispatch row holds the slice | Missing usage on a `done` exit is `failed`, not zero-cost success. Thread `pi.usage` is not updated from engine rows. |
| Stop handle | `requestStop`, `stopSignal`, daemon `deliverStop`, engine `stop()` (`claude-code.ts`, `acp.ts` `session.cancel`) | `stop_pending`, dispatch status | No live session: retry, then `stop-unacked`. The thread stays `dispatching` until ack or that terminal state. Pending work with no process stops immediately, as `requestStop` does today. |
| View channel | Open looks up the dispatch and seals a capability only after the caller's team and user own that thread, the same order as `ownedComputer` before seal (`computer-screen.ts`). Viewer upgrade checks the capability. Machine upgrade checks `findMachineByToken` | Web socket, daemon socket | A foreign dispatch id is 404 and seals nothing. A bad capability or wrong machine token is 401. Machine disconnect revokes the channel. The engine keeps running. Caps follow `COMPUTER_SCREEN_MAX_FRAME_BYTES` in `packages/shared/src/protocol/computer-screen.ts` and the channel limits in `computer-screen.ts`. |
| Scrollback | Daemon appends redacted chunks onto the dispatch blob, ring-buffered at 1 MiB | View open replays the blob, then the live pipe. A finished dispatch reopens from the blob | Append failure switches that viewer to the transcript. It does not stop the engine and does not store unscanned bytes. |
| Takeover lease | Explicit request only. Granted only if the engine stdin pause succeeds | Daemon, before any viewer byte is written to the PTY. Server does not pipe viewer-to-machine without a lease | Pause failure refuses the lease. No input is forwarded. Release restores engine stdin. A lease does not bypass `command-gate.ts` for agent-originated commands. |
| Redaction | One stateful redactor, the same tail hold as `credentialSafeEvents` (`apps/daemon/src/credential-output.ts`), before the machine socket and before the blob. `redactSecrets` (`packages/shared/src/secret-redaction.ts`) runs on the releasable prefix, not on each chunk alone | Viewer, scrollback, transcript upload | A secret split across two chunks is withheld until the tail can be judged, then redacted in one piece. A chunk that cannot be scanned is dropped. The viewer falls back to the transcript. Raw bytes are not forwarded. |
| Phone transcript | Existing transcript rows and `transcriptDelta` | `apps/web/src/detail/transcript.tsx`. `phone-tabs.tsx` has no terminal | Missing rows show the status line and a gap, not a blank terminal. |

`stepRuntimeFor` (`apps/server/src/services/dispatch-eligibility.ts`), `step_route.harness`, and `enabledRuntimes` keep deciding engine eligibility. They must not choose the thread harness.

## Live view

The precedent is the computer-screen pairing: capability-sealed viewer socket, machine token on `/api/machine/...`, binary frames, TTL, disconnect invalidation (`apps/server/src/services/computer-screen.ts`, `packages/shared/src/protocol/computer-screen.ts`). Do not reuse a computer channel. That pipe is bidirectional once paired, and view input is an RFB filter (`apps/daemon/src/computer/view-input.ts`). An engine view is a different scope.

The PTY is the `pty.fork` pattern in `apps/daemon/src/computer/control-pty.ts`. Claude Code today is spawned with pipes (`stdio: ['pipe', 'pipe', 'ignore', 'pipe']` in `claude-code.ts`), so a TTY is a new spawn mode. Structured result, cost, and stop still come from the SDK or ACP parsers, never from scraping the PTY. If the SDK cannot run on a PTY without losing `usage()` or `stop()`, the view is the transcript fallback. Do not invent a terminal around pipe bytes.

Default is read-only. Takeover is a lease, like computer `control`, and it pauses the engine's own input first. The thread's one-line status is the dispatch state, above the view.

## Migration of `claude-code` threads

Today a step runs on `stepRuntimeFor(provider)`: `gemini`, else `claude-code` when the provider is a backend runtime, else `pi` (`dispatch-eligibility.ts`). Resume is `session.action: 'continue'` against a machine-local session id. A miss starts a new session and says so.

Proposed cutover, one way for new turns, two way for an unfinished step:

1. Claimed steps already running stay on that engine until they exit. Do not attach a PTY mid-process.
2. The following user turn creates the thread store if absent and seeds it from product transcript rows, capped the way Coordinator seed is capped. It does not read `~/.claude` jsonl.
3. Later engine jobs pass `step.sessionId` only as the engine resume id inside the dispatch. A miss is `unavailable` to the thread, which may start a fresh engine job. It is not a new thread.
4. `enabledRuntimes` is not migrated. A machine with only `claude-code` still runs that engine. The thread harness does not move onto it.

## Risks

- A second writer on the thread sqlite corrupts it. The daemon must not open it. One-way for a store that was double-opened; restore from the product mirror and re-seed.
- PTY plus SDK stdin is two input paths. Takeover that does not pause the SDK lets the model and the owner type at once.
- Subscription tokens already move through `openClaudeSubscription`. They must not appear in the PTY, the scrollback, or the pi entries. This crosses the machine boundary and the credential surface, so implementation is owner-routed.
- pi-durable 1.5.0 is experimental. Pin the version; do not share `server.db` with a `pi_` prefix (Coordinator research already rejected that).
- Seeding from the product transcript drops engine-only tool nuance. That is accepted. Reading the jsonl to recover it is rejected because it is machine-local and secret-bearing.
- Copying the computer-screen bidirectional pipe would make "read-only" a daemon convention. The server must not pipe viewer input without a lease.

## Decisions for the owner

Recommended, not taken:

1. Thread-turn billing follows the coordinator connection until a `thread` route is set. Confirm the account. This spends money on every thread turn.
2. Finish in-flight Claude steps rather than killing them at cutover. Reject if those sessions should be abandoned.
3. Takeover may type into a subscription CLI. Confirm that owner keystrokes during takeover are allowed to spend that subscription. The alternative is view-only, specified above as the default until the lease exists.

Codex stays `apps/daemon/src/backend/pi.ts` as the engine. A switch to `codex exec` is a later owner decision, not this contract.

## Order

Each step is its own implementation PR, tests first, owner-routed because the dispatch and the view cross `routes-machine.ts`, `services/machine*.ts`, or `command-gate.ts`. This document changes none of them.

1. Thread store, mirror, own turns, no engines. Tests: lease, failed open, failed turn retry, verbatim seed, no daemon open.
2. `dispatch_engine`, one engine, usage, stop. Tests: row before start, usage not in `pi.usage`, stop ack, quota does not switch model.
3. Read-only view, scrollback, redaction, phone transcript. Tests: foreign dispatch seals nothing, 401, no viewer-to-PTY bytes, a secret split across two chunks is redacted, phone has no frames.
4. Takeover lease, only after the owner accepts decision 3.
