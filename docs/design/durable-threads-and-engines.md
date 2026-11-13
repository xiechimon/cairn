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

## The engine view

Owner decisions on 2026-11-12 and 2026-11-13. When a thread has dispatched work to an engine, the run has no card of its own: its events are the thread's own conversation, and one tail line where the work ends carries the run's cost, model choice, raw output and takeover.

- Default view: the engine's structured event stream rendered with cairn's own conversation components (reply text, the plan checklist, read, edit and run rows, the running row). It is the same family as the thread itself and works on the phone.
- Nothing is lost silently. An event type the adapter does not know renders as a generic row that names the type and opens its raw content. An engine that waits for input the adapter cannot map shows that it is waiting and offers takeover. Every unknown type is counted and reported, and each adapter is tested by replaying recorded streams per engine version.
- A read-only raw output view (the engine's plain text log) is always available from the tail line.
- A real terminal (a pseudo-terminal streamed to a maintained terminal component in the browser) is built later, for takeover and for engines in an interactive screen. It replaces the raw output view when it exists. It crosses the machine and command boundary, so it is owner-routed and needs its own design.
- A thread's header carries the title and one status line only. Code changes, documents and pull requests are results: a compact card in the conversation that opens the result, never a control in the header. Most tasks have no code changes.

## Commands and working habits belong to cairn

Owner question on 2026-11-12: pi has no `/loop`, `/goal`, todo list and similar commands that other harnesses ship. The answer is that cairn does not wait for the harness to grow them and does not borrow an engine's. The runtime already extends pi through extensions (`apps/server/src/coordinator/runtime/server-runtime.ts` installs the Coordinator tools, volatile context, compaction and telemetry), and the web already has a slash menu (`apps/web/src/overlay/slash-menu.tsx`). Each habit is built once at that layer, so it behaves the same whichever engine does the work, survives a restart, and shows in the interface.

| Habit | What it is in cairn | Built on |
|---|---|---|
| Loop: repeat until a condition holds | A schedule bound to the thread that wakes it with the same instruction, with a stop condition and a cap | The scheduler and the wake mechanism |
| Goal: keep working toward a stated outcome | A goal stored on the thread, shown in its header area, checked at the end of each turn; the thread continues or reports why it stopped | Thread state and the goal line the web already renders |
| Todo: a visible plan that is ticked off | A plan tool the thread calls to set and update steps; the conversation renders it as the checklist | A thread tool and the checklist block |
| Plan first, then act | A mode on the thread: propose, wait for approval, then run | The approval mechanism in `docs/design/ai-native-actions.md` |
| Compact, clear, rewind | Already handled by the runtime's compaction and rewind sync | Existing |
| Sub-agents | A thread opening another thread, or dispatching to an engine | The dispatch contract above |

Rules:

- Each habit is one action in the registry proposed in `docs/design/ai-native-actions.md`, so the slash menu, the thread's tools and the CLI are generated from the same definition. A command the owner can type is a tool the agent can call.
- State lives on the thread, not in the engine's session. An engine may have its own todo or loop; the thread does not depend on it, and the adapter maps the engine's plan events onto the thread's checklist where they exist.
- A new habit needs its states and failure behavior written down first (what happens when the wake fails, the cap is reached, the goal cannot be checked), because it is persisted state.

## Model and effort follow the task's difficulty

Owner rule on 2026-11-12: when work is dispatched, the model and the reasoning effort are chosen from how hard the task is, not fixed per role.

What exists: a task request carries a difficulty (`easy`, `standard`, `hard` in `packages/shared/src/records/task-request.ts`), capability routing ranks models by it (`packages/shared/src/capability-routing.ts`), and a routing rule or an agent can pin a thinking level (`thinkingLevel` in `packages/shared/src/records/routing-rule.ts` and `agent.ts`). Missing: effort is not derived from difficulty, the difficulty is set once at intake, and the three roles above do not share one table.

Proposal:

| Difficulty | Who does it | Model tier | Effort |
|---|---|---|---|
| Easy (a question, a status read, one setting, one small edit) | The router or the thread itself | Inexpensive | Low |
| Standard (a few steps, one file or one tool chain) | The thread, or one engine | Mid-range | Medium |
| Hard (many files, unclear cause, irreversible actions, anything that failed once) | An engine, with an independent check on the result | Strong | High |

- The difficulty is decided by rule first (the risk list in this document), then by the owner's explicit setting, which always wins.
- It can only be raised during the work: a failed attempt, a check that does not pass or a plan that grows moves the task up one level and the next dispatch uses the higher row. It is never lowered silently.
- The chosen model, effort and the reason are recorded on the dispatch and shown on the run's tail line, so the owner sees why a task cost what it did.
- Effort maps to whatever each engine calls it (thinking level, reasoning effort); an engine that has no such control ignores it and the dispatch record says so.
- A run still never switches model because a quota ran out; that pauses the work, as today.

## Open questions for the owner

- Where a thread's durable session runs and is stored: the server, as the Coordinator's is, or the machine that does the work.
- The dispatch tool's contract: input, workspace, budget, progress events, cost reporting, the stop handle.
- How subscriptions and model routing map to engines, and which model source and billing the thread's own turns use.
- Migration of threads that run directly on `claude-code` today.
- Whether the router and a thread are the same harness with different models and tools, or two configurations of one runtime.

## Decisions taken on 2026-11-12

Decided on 2026-11-12: proposed by Claude at ian's delegation and confirmed by ian the same day.

- **Phases stay on the task.** A task's phase still changes only through the server's transition table; the thread is the session that does the work. The plan, build, review and verify steps become dispatches inside the thread. The confirm phase appears only in plan-first mode or when the plan contains an action that cannot be undone. The merge gate applies only when the output is code.
- **Billing of a thread's own turns.** They use the Coordinator's connection until a separate `thread` route is set, and the cost shows in the thread. This answers the billing half of the third open question above.
- **Cutover.** A Claude Code step that is running at the switch runs to its end. This answers the migration question above.
- **The engine view.** It is read-only first. Takeover is built last, and once it exists it may spend ian's own subscription quota.

## Order of work

1. Thread as a durable pi session with the Coordinator's context and memory handling, doing its own steps. No engines yet.
2. The dispatch contract and one engine behind it.
3. Routing rules for self or dispatch, and mid-work escalation.
4. Acceptance checks and the confirm-once step for plans with irreversible actions.

Each step changes persisted state or the step protocol and needs its own design review. Anything that touches `apps/server/src/routes-machine.ts`, `apps/server/src/services/machine*.ts` or `apps/daemon/src/backend/command-gate.ts` is owner-routed.
