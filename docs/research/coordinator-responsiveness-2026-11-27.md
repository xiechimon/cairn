# Coordinator Chat Responsiveness: Prior Art & Design Analysis

- Date: 2026-11-27
- Workstream: `coord-feel`

## 1. Baseline & Measured Problem

Observed on Cairn production (`mac-mini 8787`, screenshot `~/Pictures/cairn-review/coordinator-feel/interject-1.jpg`):

1. **Silent initial wait (~25 s, measured)**: A user question requiring project/task lookups produced only a status line ("Looking through the project") for ~25 s before emitting one final answer.
2. **Queued interjection (~40 s, measured)**: Sending an interjection ("Did you hear my last message?") mid-work resulted in the Coordinator finishing and replying to the first question (~40 s) before addressing the interjection in a second bubble.
3. **Composer Enter-while-running merge (measured)**: Pressing `Enter` while a turn was running left the sent text inside the composer, causing the next message typed immediately afterwards to merge with it into a single bubble.

Codebase root causes inspected (measured):

- `COORDINATOR_SYSTEM_PROMPT` (`apps/server/src/services/chief.ts`) instructs the model to "say nothing when there is nothing new" with no ack-first or mid-turn progress guidance, and allows inline work for tasks taking "a few minutes".
- `notify_user` (`apps/server/src/services/chief-tools.ts`) was framed for event turns (`[wake:…]`), deduplicated without `toolCallId`, and unconditionally called `notifyChiefMessage` (which creates in-app/desktop notifications).
- `runCoordinatorTurn` (`apps/server/src/coordinator/runtime/turn.ts`) delivers mid-tool steers at `postTools` via `pi-durable`, but injects no runtime reminder to answer interjections immediately or break silence after consecutive tool calls; `SUBAGENT_TIMEOUT_DEFAULT_SEC` was 120 s.
- `createTurnMirror` (`apps/server/src/coordinator/runtime/mirror.ts`) did not reset its local `streamed` buffer when an earlier assistant text row committed in a multi-round turn; `liveTextStore` (`apps/web/src/api/live-text.ts`) only tracked a single pending `handoff` rather than ordered per-bubble handoffs.
- `useChiefSurface` (`apps/web/src/chief/use-chief-surface.ts`) returned `Promise.resolve()` from `onSend`, deferring composer clearing to a microtask during which concurrent SSE renders could overwrite `fullDraftRef.current` with a stale `draftProp`, and `composer-wire.ts` overwrote `fullDraftRef.current` unconditionally on every render.

## 2. Prior Art Summary

| System | Channel & Message Semantics | Mid-Turn Input & Loop Continuation | Silence / Progress Mechanism | Latency / Trade-off |
|---|---|---|---|---|
| **Grok Bot** ([weisu.io](https://weisu.io/articles/decoding-grok-bot/message-mechanism), measured) | Explicit `SendMessage` tool (`type`: `text \| attachment \| widget \| cursor-agent \| secret-request`) is the sole user-visible channel; plain assistant text is internal thinking. | Calling `SendMessage` continues the tool loop so progress updates and follow-ups flow inside the same run; `<system_reminder>` carries runtime steering. | Middleware counts consecutive tool calls without `SendMessage` and injects a reminder after **6** tool calls. | Guarantees clean separation between thinking and speech, at the cost of an extra tool round-trip per reply (~1–2 s extra latency) and losing token-by-token TTFT streaming if plain text is hidden. |
| **OpenHands Software Agent SDK** ([example 18](https://github.com/OpenHands/software-agent-sdk/blob/main/examples/01_standalone_sdk/18_send_message_while_processing.py), measured) | Conversation event stream renders user and agent messages sequentially. | `Conversation.send_message()` appends a user event while `conversation.run()` runs in a background thread; `Agent.step()` reads newly appended events at the next step boundary without aborting ongoing work. | Natural per-step visibility across event stream. | Preserves in-flight work cleanly; responsiveness depends on keeping each step/tool round short so step boundaries arrive quickly. |
| **Claude Code** ([interactive-mode docs](https://code.claude.com/docs/en/interactive-mode), measured) | Streamed assistant text + tool progress rows in terminal/UI. | Plain `Enter` while working queues input shown in gray and injects at the next tool boundary within the same turn; `Ctrl+Enter` / `Ctrl+X Ctrl+S` (`chat:sendNow`) moves backgroundable work to background and reads immediately; `Esc` aborts. | Status indicator + immediate backgrounding option (`Ctrl+Enter`). | Balances non-destructive tool completion with immediate interruption/backgrounding when tasks run long. |
| **Codex CLI & Responses WS** ([turn_input.rs](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn_input.rs), measured) | Unified turn-input admission (`turn/steer` vs queue) + Responses WS `response.steer`. | Input admission returns immediately without blocking on hooks/sampling; active generation aborts cleanly (`response.incomplete: steered`) or steers between steps. | Streaming deltas from active generation + explicit steer admission state. | Sub-second admission latency; relies on short tool calls or clean abort points. |
| **Amp / ChatGPT / Claude.ai** (measured/inferred) | ChatGPT & Claude.ai use streamed assistant bubbles; Amp defaults `Enter` to steer at next tool boundary (`Ctrl+O` queue, `Esc Esc` hard interrupt, inferred from search summary). | Amp steers into next tool boundary; ChatGPT Deep Research/o3 uses mid-turn "Update" steering; Claude.ai web queues or requires explicit Stop. | Brief acknowledgement / progress updates when long lookups run. | Familiar human chat cadence when ack streams immediately before heavy lookups. |

## 3. Architectural Comparison for Cairn

| Approach | First-Reply Latency | Interjection Latency | Prompt-Cache Invariance | Complexity & Parity Risk |
|---|---|---|---|---|
| **A. Pure Grok (`SendMessage`-only, hide assistant text)** | +1 extra LLM round-trip before/after tool calls (slower TTFT; loses token streaming). | Slower by 1 tool round-trip per answer. | High if reminders are deterministic. | High churn: breaks `barge-in.ts`, `mirror.ts` streaming, Runner parity, and `CHIEF_TOOL_COUNT = 47`. |
| **B. Pure Prose-Before-Tool (prompt only)** | Best TTFT (1st token in 1 LLM call). | Dependent on model compliance; models often stay silent across 5–10 tool calls or ignore interjections until original task finishes. | Native `pi-durable` append-only. | Fragile under long tool chains (silence drift) without runtime reminders or mid-turn tool option. |
| **C. Hybrid (Chosen): Prose-Before-Tool + Generalised `notify_user` + Runtime Responsiveness Extension** | **Fastest (<= 3 s p50)**: 1-sentence ack streams inline in Round 1 (0 extra round-trips), or via `notify_user` mid-turn. | **Fast (<= 5 s p50)**: `postTools` steer or Round 2+ barge-in + `<system_reminder>` directs Coordinator to answer interjection first before resuming work; `subagent` default timeout lowered to 30 s and >30 s work delegated to `create_todo`. | **100% preserved**: `coordinatorResponsivenessExtension` replays any previously injected `<system_reminder>` at its exact index when unchanged, keeping `messages[0..frozen-1]` byte-identical. | Low risk: reuses `notify_user` (`CHIEF_TOOL_COUNT` stays 47), preserves `barge-in` and `[wake:…]` event turns, and fixes multi-bubble streaming + composer clearing in one path. |
