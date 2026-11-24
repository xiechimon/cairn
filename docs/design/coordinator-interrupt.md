# Coordinator instant barge-in interrupt (speed + prompt-cache invariant)

Supersedes explicit Coordinator `Cmd+Enter` queuing and queued-message editing in `docs/design/coordinator-queue-and-withdraw.md`.

## For a newcomer

Someone who installed Cairn today opens the home screen and types in the Coordinator chat box. They do not need to know any shortcuts or modes (`Enter` vs `⌘↵`, "steer" vs "queue"): if they send a message and immediately send a correction or follow-up while the Coordinator is still thinking or streaming a reply, the Coordinator drops the unfinished draft at once and answers only the updated request in one reply (or answers both if they asked two separate questions). It asks for no new account, payment, or key, stores the user's messages in the existing local `chief_message` / `coordinator_input` / `pi-durable` conversation store, and if the Coordinator is paused on a provider quota outage the messages wait safely in the outage strip with `撤回` until quota returns.

## Why

Measured on the live `verify-cairn` stack before this change (sending `"今天是星期几"`, then `"说错了，明天是星期几"` 650 ms later while streaming):

- **Slow pickup (1,438 ms to model, 1,559 ms to first token)**: `runCoordinatorTurn` polled `steerPoll` and `stopPoll` every `STOP_POLL_MS = 1,000 ms`, and `pi-durable`'s `whenBusy: 'steer'` never aborted an in-flight text generation — it waited for Generation 1 to finish streaming its full answer before placing M2.
- **Two replies instead of one**: Generation 1 committed `"今天是星期二，..."`, M2 sat as a hollow bubble and jumped below Answer 1 when placed at the `final` boundary, and Generation 2 then wrote `"明天是星期三。"`.
- **Redundant UI & protocol**: Coordinator carried a second send mode (`Cmd+Enter` / touch long-press `mode: 'queue'`), `QUEUED_HOLD`, `PATCH .../messages/:mid`, a 120 s edit-lock timer, and `"插进这一轮 · ⌘↵ 排队"` placeholder copy — none of which solved a real Coordinator problem once barge-in handles both corrections and follow-ups in one path.

## Scenario table

| Situation | What the user sees | What the system does | Wait & cost |
|---|---|---|---|
| Idle send (`Enter`) | Message appears immediately; Coordinator replies. | Normal turn; unchanged. | Normal TTFT; warm cache hit. |
| Correction mid-stream (no tool running): M1 `"今天是星期几"` -> M2 `"说错了，明天是星期几"` | M1 partial vanishes immediately when M2 hits the server; M2 appears solid right below M1; **one** reply `"明天是星期三。"` streams directly under M2. | `steerChiefMessage` fires instant in-process signal (0 ms poll); `runCoordinatorTurn` fences `mirror`, emits `resetLive: true`, clears `terminal-claims` shield, calls `root.abort(context)` (~5 ms), appends `UserEntry(M2)` in the **same** `pi-durable` conversation, starts Generation 2 with `[System, ...History, User(M1+volatile), User(M2)]`. | Model sees M2 in <30 ms; TTFT of new answer immediately after; **100% prompt-cache prefix hit** through M1; aborted partial tokens are the only sunk cost. |
| Two separate questions mid-stream: M1 `"1+1等于几？"` -> M2 `"另外2+2等于几？"` | Same instant reset; **one** reply answering both questions. | Same single barge-in path; `<talking>` prompt instructs the model to treat consecutive user messages as one turn (answer only replacement on correction; answer all on separate questions). | Same <30 ms pickup + full prefix cache hit. |
| 3+ rapid bursts (M1, M2, M3 in <500 ms) | All 3 user bubbles in order; single reply at the end. | Each arrival aborts the uncommitted generation (often before HTTP send) and appends `UserEntry(Mk)`; final generation sees `[M1, M2, M3]`. | Zero extra HTTP calls if aborted in `prepare`; 100% cache hit otherwise. |
| Busy inside a tool (`create_todo`, `ask_user`, `computer_act`, read tools) | M2 shows as a subtle steering bubble (with `撤回` until read); tool finishes undisturbed; Coordinator reads M2 right after the tool returns. | `inToolRound` or `live.tools.length > 0` blocks barge-in; M2 submits with `whenBusy: 'steer'` and is placed at `pi-durable`'s `postTools` boundary. | Zero aborted side effects; tool finishes once; cache intact. |
| Round 2 text stream after a completed tool | Same instant barge-in on Round 2's uncommitted text; completed tool call/result stays in history. | Round 1 `AssistantEntry(toolUse)` + `ToolResultEntry` remain committed and cached; Round 2 partial is aborted; Round 3 sees `[..., ToolResult, User(M2)]`. | <30 ms pickup; zero tool re-execution; 100% cache hit through `ToolResult`. |
| User presses `Esc` (Stop) | Turn stops in <50 ms (was up to 1,000 ms). | `stopChiefTurn` fires instant in-process `stop` signal; `root.abort(context)` ends the step as `stopped`. | Instant stop; no second generation starts if stop wins during barge-in. |
| Provider quota outage (`held`) | Outage banner + `QueueTabs` strip showing held messages with `撤回`. | Server parks steps on quota; `QueueTabs` renders `held` items only (no `Cmd+Enter` queue, no edit mode). | Zero cost until quota recovers; folded on resume. |
| Daemon-hosted Coordinator (e.g. `claude-code` on a Runner) | Message steers immediately over the daemon wake hub (`machineHub.steerSignal`); existing receipt protocol applies. | Unchanged daemon steer contract (`steer_pending` -> `fetchSteer` -> `ackSteer`); `mode: 'queue'` removed from Coordinator composer so every send steers immediately. | Existing daemon transport latency; no queue tab. |

## State machine & persisted state

### In-server turn states (`runCoordinatorTurn`)

- **`setup`**: Claimed step `S1` opens `root`, configures model/instructions, submits initial `UserEntry(M1)` (`requestId = initialId`). Immediately triggers `scheduleSteerDrain()` upon entering `generating` so messages sent during setup are picked up at 0 ms.
- **`generating`**: `live.run !== undefined`, `live.tools` empty, `live.run.afterRun === undefined`, `!inToolRound`.
  - On `signal('steer')` (or fallback poll): pull pending `coordinator_input` batch -> enter **`barge_in`**.
  - On `afterResponse` with `stopReason === 'toolUse'` and ≥1 `toolCall`: synchronously set `inToolRound = true` -> enter **`tool_round`** (closes the race window between `streamResponse` returning `toolUse` and `startToolRound` committing).
  - On `signal('stop')`: abort `root`, return `{ status: 'stopped' }`.
- **`barge_in`** (serialized by `bargeIn` promise):
  1. `await deps.inputs?.barrier()` so `M1`'s `consumed` receipt and `T1`'s `coordinator_run` binding are durable in SQLite before abort.
  2. Read `live = await harness.snapshot(LiveDoc, root.id, context)`. Re-check `!inToolRound && live?.run !== undefined && live.run.afterRun === undefined && (live.tools?.length ?? 0) === 0`. If no longer eligible (e.g. tool round started), fall through to **`tool_round`** steer (`whenBusy: 'steer'`).
  3. Record `superseded.add(activeRequestId)` and `lastBargeInTaskId = live.run.taskId`.
  4. Fence live streaming: `mirror.suppressTask(live.run.taskId)` -> `await mirror.drain()` (waits for any in-flight `transcriptDelta` of `T1` to finish) -> `await api.resetLive?.(stepId)` (clears `terminal-claims` shield, clears server `convHub` text/thinking buffer, broadcasts `activity { phase: 'thinking', resetLive: true }` so browsers clear `liveTextStore`).
  5. `await root.abort(context)` — cancels provider HTTP `AbortSignal` immediately, converts any committed partial to `AssistantEntry(stopReason: 'aborted')`, ends `live.run`, waits until `root` is idle.
  6. If `stopping !== null`: release unsubmitted steer inputs (`api.inputs.release`) and exit as `stopped`.
  7. Submit `M_next` into the now-idle `root`: `root.submit({ type: 'input', content, requestId })` (no `whenIdle: 'reject'`). Update `activeSubmission`, `activeRequestId`, and `lastBargeInEntryId = entryId`. Return to **`generating`**. (If multiple steers arrived concurrently, the loop immediately catches the next one before `T2` sends HTTP.)
- **`tool_round`**: `inToolRound === true || (live.tools?.length ?? 0) > 0`.
  - On `signal('steer')`: submit with `whenBusy: 'steer', whenIdle: 'reject'` so `pi-durable` delivers at `postTools` without aborting tools.
  - On `afterTools` / next `beforeRequest`: `inToolRound = false`, return to **`generating`**.
- **`settling`**: Main loop awaits `activeSubmission.wait(context)` and any in-flight `steerTask` / `bargeIn`. Superseded submissions' `unanswered (reason: 'aborted')` settlements are ignored; the final active submission determines `done` vs `failed`. `mirror.flush` passes `stoppedEntry` only from entries strictly after `lastBargeInEntryId`, so a late `Esc` stop during `T2` never resurrects `T1`'s discarded partial.

### Paths that read or write state

| State | Writers | Readers |
|---|---|---|
| `coordinator_input` (SQLite) | `steerChiefMessage` (`pending`), `pullCoordinatorInput` (bind `conversationId`), `input-receipts` (`consumed` / `released`) | `turn.ts` (`api.steer`), `input-replay.ts`, `task-reply-context.ts`, `chief-turns.ts` |
| `coordinator_run` (SQLite) | `input-receipts` (`bindRun` for both `T1` and restarted `T2`, both bound to `stepId = S1`) | `input-replay.ts` |
| `pi-durable` entries | `root.submit` (`UserEntry(M1)`, `UserEntry(M2)`), `GenerationTask` (`AssistantEntry(aborted)` for `T1`, `AssistantEntry(stop)` for `T2`) | `pi-durable` `deriveContext()` (skips `stopReason: 'aborted'`), `mirror.ts` (skips `stopReason: 'aborted'`), `turnUsage` (sums all usage) |
| Live SSE buffer & shield | `mirror.ts` (`transcriptDelta`, `resetLive`), `events.ts` (`publishActivity({ resetLive: true })`), `terminal-claims.ts` (`discardShield`) | Browser `sse.ts` -> `liveTextStore` / `liveThinkingStore` |
| In-process signal | `steerChiefMessage`, `stopClaimedChiefStep` -> `signalCoordinator(threadId, 'steer' \| 'stop')` | `server-runtime.ts` per-instance listener map -> active `runCoordinatorTurn` |

## Prompt-cache invariance proof

1. **Same `pi-durable` conversation**: Barge-in never forks, reseeds, or resets the conversation; `ensureProviderSessionId` (`prompt_cache_key`) stays identical.
2. **Same system prompt & tools**: `volatile.instructions(rootKey, ...)` freezes the system prompt after `T1`'s `beforeRequest`; `planSystemEntries` returns `[]` on `T2` because sections and tools did not change.
3. **Append-only messages**: `pi-durable`'s `deriveContext()` omits `AssistantEntry(stopReason: 'aborted')`, so `T2` enters `volatileContextExtension.beforeRequest` with `[S, ...H, User(M1), User(M2)]`.
   - `sharedLength(prior.sources, sources)` matches all `N` elements `[S, ...H, User(M1)]` (`frozen = N`).
   - `volatileContextExtension` returns `[...prior.messages.slice(0, N), User(M2)]`: **`User(M1 + volatile)` stays bit-for-bit identical**, `<turn_state>` is NOT duplicated onto `M2`, and `User(M2)` is simply appended at index `N`.
   - On Anthropic (`anthropic-messages.js`), `system`, `tools`, and `messages[0..N-1]` are byte-identical and `cache_control` moves to `User(M2)`, hitting cache on the entire prefix `[system, tools, ...H, User(M1+volatile)]`.
   - On OpenAI / compatible providers (`openai-completions.js`, `openai-responses-shared.js`), `tools`, `prompt_cache_key`, and `messages[0..N-1]` are byte-identical.
   - If `T1` was aborted before `beforeRequest`, `T1` never sent an HTTP request and `T2` hits cache on `[system, tools, ...H]`.

## Failure & recovery behavior

- **Race: `answer()` commits right before `root.abort()`**: `root.abort()` is a no-op; `M1`'s answer is already committed; `M2` submits immediately on the idle conversation and starts `T2` in the same step (no `steer_missed`, no successor step churn).
- **Race: `toolUse` returns right as `M2` arrives**: `afterResponse` synchronously sets `inToolRound = true` before `startToolRound` commits, preventing `barge_in` from aborting the tool round; `M2` steers cleanly at `postTools`.
- **Race: late `watch` view for aborted `T1`**: `mirror.suppressTask(T1)` + `await mirror.drain()` runs before `api.resetLive(stepId)`, guaranteeing no stale chunk from `T1` can appear after reset.
- **Race: user presses `Esc` during `barge_in`**: `stopping !== null` aborts restart, releases unsubmitted `M2` cleanly, and marks `S1` `stopped`.
- **Crash between `root.abort()` and `root.submit(M2)`**: `M1` is `consumed` in SQLite; `M2` remains `pending` in `coordinator_input`. On restart, `inputs.recover` leaves `M2` pending if `S1` resumes or releases `M2` into a successor step if `S1` ended — zero message loss.

## Single-path deletions (redundant Coordinator queue removed)

Deleted in the same change:
- `mode?: 'queue'` on Coordinator send (`chiefSendMessageBodySchema`, `sendChiefMessageFromComposer`, `api/hooks.ts`, `use-chief-surface.ts`, `chief/outbox.ts`, `home-c.tsx`).
- `QUEUED_HOLD` and `queueChiefMessage` (`chief-turns.ts`, `coordinator-steps.ts`).
- `PATCH /api/teams/:id/chief/threads/:tid/messages/:mid`, `editChiefMessage`, `chiefMessageEditBodySchema`, `chiefEditMessage`, `editingQueued` / `stashedDraftRef` / `chief-queue-save` / `chief-queue-cancel-edit` (`routes-chief.ts`, `chief.ts`, `chief-conversation.tsx`, `queue-tabs.tsx`).
- `CHIEF_INPUT_PLACEHOLDER_STEERING_TOUCH` and the touch long-press `holdToQueue` / `chief-send-queue` menu (`composer-surface.tsx`). `CHIEF_INPUT_PLACEHOLDER_STEERING` becomes `'继续说，会直接打断'` (`'Keep typing to interrupt'`).

Kept because it serves a distinct real need:
- `QueueTabs` simplified to display `held` (quota outage) / waiting `queued` (non-composer / waiting-for-machine) messages with `撤回`.
- Worker task threads' `queuedMessage` table & `detail/composer.tsx` `onQueue` (multi-minute autonomous coding builds where users genuinely queue follow-up tasks for after a build finishes).
- Unread `steering` bubble + `撤回` (`steerWithdrawals`) for messages waiting during a long tool call (`ask_user` / computer actions).

## Tests (red-first, one per path)

1. **Owner's exact correction case (e2e runtime)**: slow-streaming M1 `"今天是星期几"` -> M2 `"说错了，明天是星期几"` sent mid-stream -> T1 aborted in <200 ms, T2 receives `[M1, M2]` with byte-identical cached prefix through M1, `resetLive` emitted once, exactly **1** assistant reply (`"明天是星期三。"`) persisted, zero `chief_message` rows from T1.
2. **Two separate questions**: M1 + M2 mid-stream -> T1 aborted immediately, T2 sees both and persists 1 combined reply.
3. **3+ rapid bursts**: M1 -> M2 -> M3 -> single final reply, all 3 user messages present in order.
4. **Side-effecting / active tool protection**: `create_todo` (and `ask_user`) running -> M2 does NOT abort tool, steers cleanly at `postTools` boundary, tool runs exactly once.
5. **Round-2 barge-in after completed tool**: Round 1 tool completes -> Round 2 text streams -> M2 aborts Round 2 only, preserves Round 1 tool call/result and cache prefix.
6. **Late delta fencing**: T1 emits partial -> barge-in -> `resetLive` clears buffer -> no T1 text leaks into T2's live stream or final DB row; stopping T2 before text never resurrects T1 partial.
7. **Prompt-cache byte invariance (OpenAI + Anthropic thinking-binding)**: assert `system`, `tools`, and `messages[0..N-1]` are byte-for-byte identical between aborted Request 1 and restarted Request 2 (including frozen `<turn_state>` on M1 and no duplicate `<turn_state>` on M2).
8. **Instant stop signal**: `POST .../stop` aborts in-server turn in <200 ms even with `stopPollMs: 60_000`.
9. **Crash recovery**: crash between `root.abort()` and `root.submit(M2)` loses zero messages on restart.
