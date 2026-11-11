# One harness: router, durable threads, engines

Status: proposal for the owner's review. Nothing here is built. It records the owner's direction from 2026-11-11 and the questions a design must answer before code. It sits beside `docs/design/ai-native-actions.md`.

## Problem

The Coordinator is a durable pi session with cairn's own context and memory handling (`apps/server/src/coordinator/runtime/`: stored conversations, compaction, rewind sync, input receipts). A thread is not. A step runs directly on whichever runtime the machine enabled (`MACHINE_RUNTIMES` in `packages/shared/src/records/machine.ts`: `pi`, `claude-code`, `gemini`), so a thread on `claude-code` has none of that handling, and memory, approvals, cost and the action journal would each have to be built once per runtime.

## The owner's rule

Every agent cairn starts runs on the same harness. Claude Code, Codex and similar tools are engines that harness dispatches work to and manages. They are never what a thread runs on. The outer layer uses an inexpensive model and does simple work itself; harder work opens an engine, which plans for itself.

## Three roles

| Role | Model | Owns | Does not |
|---|---|---|---|
| Router (the Coordinator) | Inexpensive, fast | Understanding the request, reading state, settings and interface actions, choosing where work goes | Work that needs judgment, and verifying an engine's result |
| Thread (a durable pi session) | Mid-range | One piece of work from start to finish: its context, its memory, its history, the decision to do a step itself or dispatch it | Running on an engine |
| Engine (Claude Code, Codex, others) | Strong | One dispatched job: it plans and executes, then returns its result, cost and exit state | Memory, approvals, or anything that outlives the job |

Context and memory belong to the thread. An engine is replaceable and leaves when its job ends, so changing engines loses nothing.

## Three risks the design must close

1. Who decides simple or hard. An inexpensive model is least reliable exactly when judging its own limits. The decision is by rule first: anything that edits files, runs commands or takes several steps opens an engine; questions, status and settings stay with the router. A thread may escalate mid-work, handing its progress to an engine, instead of failing first.
2. Loss at the handoff. An engine sees only what it is given. It receives the owner's original words and the source material, never a cheaper model's paraphrase. The Coordinator's routing rules already require this for task text ("the body is the user's own words"); the same rule applies to every dispatch.
3. Who accepts the result. A weaker model cannot verify a stronger one. Acceptance is the owner's for anything that matters, or an independent check (tests, a second model), never the router's opinion alone.

An engine plans for itself. When the plan includes an action that cannot be undone (send, submit, pay, delete), the plan is shown to the owner first; this is the confirm-once class in `docs/design/ai-native-actions.md`.

## State and failure behavior

| Path | Reads or writes | On failure |
|---|---|---|
| Router handles a request itself | Reads state; writes through registry actions | A refused action returns its typed error to the owner; nothing is dispatched |
| Router opens a thread | Creates the thread's durable session with the owner's original message and attachments | Creation failure is reported in the conversation; no half-created thread is left |
| Thread does a step itself | Appends to its own session; compaction as the Coordinator does today | A failed turn is recorded and can be retried from the same state |
| Thread dispatches to an engine | Writes a dispatch record: engine, input, workspace, budget, stop handle | An engine that cannot start is reported to the thread, which may choose another engine; the owner is told when none can |
| Engine runs | Streams progress into the thread; returns result, cost and exit state | A crash, timeout or exhausted quota ends the dispatch with that state; the thread keeps everything received so far and never switches model on quota exhaustion without the owner |
| Owner stops a thread | Stops the engine through its handle, then the thread | A stop the engine does not acknowledge is retried and surfaced; the thread is not marked stopped until it is |
| Result comes back | Thread records it and raises it for acceptance | A result that fails its check stays open with the reason; it is not marked done |

## Open questions for the owner

- Where a thread's durable session runs and is stored: the server, as the Coordinator's is, or the machine that does the work.
- The dispatch tool's contract: input, workspace, budget, progress events, cost reporting, the stop handle.
- How subscriptions and model routing map to engines, and which model source and billing the thread's own turns use.
- Migration of threads that run directly on `claude-code` today.
- Whether the router and a thread are the same harness with different models and tools, or two configurations of one runtime.

## Order of work

1. Thread as a durable pi session with the Coordinator's context and memory handling, doing its own steps. No engines yet.
2. The dispatch contract and one engine behind it.
3. Routing rules for self or dispatch, and mid-work escalation.
4. Acceptance checks and the confirm-once step for plans with irreversible actions.

Each step changes persisted state or the step protocol and needs its own design review. Anything that touches `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts` or `apps/daemon/src/backend/command-gate.ts` is owner-routed.
