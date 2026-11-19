# Task panel: live token count, background sub-agents, durable agent todo

Status: decided by mon X (2026-11-19); nothing built yet. Prior art: `docs/research/task-panel-live-row-subagents-todo-2026-11-19.md`.

Three task-panel gaps left after `1bdafc7d8` (unframed transcript):

- A. The live status row shows phase and elapsed time but no token count.
- B. A background sub-agent or background shell started by the engine is invisible: its tool calls merge into the parent transcript, and the daemon tracks it only in memory to decide when the step ends.
- C. The agent todo survives only while the server process keeps `lastAgentTodo` in memory; afterwards it is rebuilt from loaded message pages, and only Claude Code tool calls and markdown checklists produce one.

Out of scope: queued input. Task threads already queue (Cmd/Ctrl+Enter), steer, and send a queued message now (`queued-capsules.tsx`, `deliverQueuedMessage(steer=true)`). Withdrawing an already-steered task message is a separate gap.

## Facts the design rests on

- Engines in use (measured, desktop `server.db`, last 7 days): task steps ran on pi native and Devin ACP; no Claude Code task step, no `TodoWrite` row. A design that only consumes Claude Code events reaches no current user.
- No engine streams usage to the server during a step. Usage arrives once, in `POST /api/machine/done/:stepId` (`machineDoneBodySchema.usage`), and is written to `token_usage` / `step_usage` by `recordStepUsage`. The daemon already holds running numbers: Claude Code `assistant.message.usage`, pi per-message usage, Devin ACP `usage_update`.
- `ToolCallRecord` already has `parent?: string` and `todo?: AgentTodoItem[]`. Only Devin ACP sets `parent`; only native Claude Code sets `todo`. Tool calls are `message` rows (`content.kind = 'toolcall'`), so anything carried on the record is persisted with no migration.
- Claude Code's background task events (`task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`) reach `BackgroundSubagents` (`apps/daemon/src/backend/claude-background-subagents.ts`), which keeps `local_agent` tasks only, drops `tool_use_id`, and sends nothing to the server.
- From Claude Code 2.1.268 the todo tools are on by default only for older models (research file, docs-level; not yet seen in a captured stream).

## A. Live token count

**State.** One in-memory value per running step on the server: `{ stepId, outputTokens, inputTokens, at }`, the latest cumulative counts for the step. It is not persisted while the step runs; the step's final usage stays authoritative in `step_usage`.

**Transitions and paths.**

1. Daemon: each backend exposes its running counts through the existing activity tracker. `createActivityTracker` gains `noteUsage({ input, output })` (cumulative for the step, monotonic). Claude Code calls it on each main-loop `assistant` usage (`parent_tool_use_id == null`, as the context meter already filters) plus `thinking_tokens.estimated_tokens` while thinking; pi on each message usage; ACP on `usage_update`.
2. Wire: `stepActivityReportSchema` gains optional `tokens: { input: number, output: number }`. It rides on the activity report the tracker already re-sends every 5 s; no new endpoint, no extra request.
3. Server: `reportActivity` passes it through `publishActivity`; the hub's `lastActivity` replay carries it to a reloaded page. No SQLite write.
4. Web: `activityStore` keeps it; `mapTranscript` copies it to the `streaming` item; `TaskLiveRow` shows `· 1.2k tokens` after the elapsed time, using output tokens (what the agent produced in this step), same `>= 5s` rule as the timer.
5. Step end: the hub clears `lastActivity` as today; the usage ring reads `step_usage` as today.

**Failures.** A backend without numbers sends no `tokens`; the row shows no count, never `0`. A server restart mid-step loses the value until the next 5 s report. Counts are approximate while streaming and are never summed into billing.

**Tests.** daemon: tracker sends `tokens` monotonically and omits it when unknown; Claude Code ignores sub-agent usage; pi and ACP feed the tracker. server: activity body with and without `tokens` validates and replays on subscribe. web: live row shows the count after 5 s, hides it without `tokens`.

## B. Background sub-agents and shells

**State.** A background task is one row of a new message content kind, `{ kind: 'bg_task', task }`, in the task's conversation, keyed by the engine's task id (message id `bg-<taskId>`), upserted like a tool call. `task`:

`{ taskId, toolCallId, type: 'agent' | 'shell', description, prompt?, model?, status: 'running' | 'done' | 'failed' | 'stopped' | 'orphaned', startedAt, endedAt?, toolUses?, tokens?, summary? }`

No new table and no migration (`message.content` is JSON). Sub-agent tool calls keep their own `toolcall` rows with `call.parent = toolCallId`.

**Transitions.**

| From | Event | To |
|---|---|---|
| none | `task_started` (`local_agent` or `local_bash`, not `ambient`) | running |
| running | `task_progress` | running, counts updated |
| running | `task_notification` completed / failed / killed | done / failed / stopped |
| running | user stop on the row → `stopTask(taskId)` | stopped |
| running | step ends while the task still runs | orphaned |

**Paths that write.**

1. Daemon Claude Code: `BackgroundSubagents` becomes the task registry for both types, keeps `tool_use_id`, and emits a `bg_task` step event on each transition; the existing hold-for-background logic reads the same registry. `mapClaudeMessage` sets `call.parent = parent_tool_use_id` on sub-agent `tool_use` / `tool_result`, and drops sub-agent text deltas from the parent's live text (the Devin ACP adapter already drops them).
2. Daemon ACP: Devin already sets `parent`; it emits `bg_task` rows from its subagent spawn tool call. Other engines emit none.
3. Daemon step finish: every registry entry still `running` is written `orphaned` before the done report.
4. Server: `POST /api/machine/tool/:stepId` accepts `{ kind: 'bg_task', task }`, upserts the message row and publishes it as a message event (same path as transcript rows).
5. Stop: `POST /api/builds/:id/tasks/:taskId/stop` → `machineHub` control → daemon `query.stopTask(taskId)`. Only for a running step on Claude Code; the button is absent otherwise.

**Paths that read.** `mapTranscript` hides `toolcall` rows that have a `parent` from the main `WorkTrace` and attaches them to their background task; the Task/Agent spawning call renders as one work step `后台：<description>`. The panel shows a `后台任务` group above the agent todo while any row is running, one line each: description, status, elapsed, tool uses, stop. Clicking opens the inspector in the panel (same pattern as the raw-output view): prompt, model, and the sub-agent's tool calls as a collapsed `WorkTrace`. The todo item marked `doing` shows `N 个后台任务进行中` while N rows run.

**Failures.** Daemon crash: rows stay `running` until the server's step-recovery path marks the step failed; recovery also rewrites that step's running `bg_task` rows to `orphaned`. Lost stop request: the button stays until a `task_notification` arrives; a repeated stop is idempotent. An event for an unknown task id creates the row (no ordering assumption). Unknown `task_type` is counted and logged, never dropped silently (`durable-threads-and-engines.md`, engine view rule).

**Tests.** daemon: registry tracks `local_bash` and `local_agent`, keeps `tool_use_id`, writes `orphaned` at step end; `parent` set on sub-agent calls; stop control calls `stopTask`. server: `bg_task` upsert and replay; recovery orphans running rows; stop route 409 when the step is not running. web: child calls leave the main trace; group row and inspector render; todo badge counts running rows.

## C. Durable agent todo

**State.** The todo is derived, not cached: the latest todo snapshot among the task's persisted rows, across all steps. A snapshot is any `toolcall` row with `call.todo`, any `TodoWrite` call, or a text row that parses as a checklist. The in-memory `lastAgentTodo` map and its replay are deleted.

**Paths that write.**

1. Daemon: every backend sets `call.todo` on its plan tool. Claude Code already does (keep `activeForm` as an optional item field). ACP: map the `plan` session update to a synthetic `toolcall` row (`name: 'plan'`, `todo` from the entries). pi: map its plan / todo tool if the model calls one; otherwise the markdown checklist fallback already applies.
2. Server: `reportAgentTodo` keeps publishing the live SSE event for a fast first paint but stores nothing.
3. Server: `GET /api/builds/:id/messages` returns `agentTodo`, the latest snapshot computed with a query over the conversation's rows, so it does not depend on which page the web has loaded.

**Paths that read.** `mapTranscript` uses, in order: the live `agent_todo` event for the running step, else the page's `agentTodo`. `liveEngineRun.plan` uses the same value. After step end the list stays at the tail while any item is open (`doing` shown as `todo`, as today); when all items are done it collapses to `N/N 已完成`.

**Failures.** Server restart, reload, older pages not loaded: the list comes from SQLite. A malformed tool argument yields no snapshot and the previous one stands. A snapshot with zero items is a cleared list.

**Tests.** server: messages page returns the latest snapshot across steps and pages, and none when there is none. daemon: ACP `plan` becomes a `toolcall` row with `todo`. web: list survives reload with an empty live store; collapses when all done; `lastAgentTodo` replay removed (existing catch-up test updated).

## Decisions

1. Turn the Claude Code todo tool on (`CLAUDE_CODE_ENABLE_TODO_TOOLS=1`, `CLAUDE_CODE_ENABLE_TASKS=0`) for task runs. It changes agent behaviour on Claude Code. Recommendation: yes, after one captured stream confirms the default. Decided (mon X 2026-11-19): on, after a captured stream confirms the default.
2. Per-row stop for background tasks needs `perTaskStopAffordance: true`, which also changes the whole-run Stop: it stops the main loop without killing background tasks. Recommendation: yes, and the whole-run Stop also stops every running background row so Stop still means stop. Decided (mon X 2026-11-19): per-row stop, and the whole-run Stop stops every running background row.
3. Order of work. Recommendation: C, then A, then B. C reaches every engine and removes a cache; A is small; B only reaches Claude Code and Devin, which current task runs do not use. Decided (mon X 2026-11-19): C, A, B.

## Owed before building

- Capture a logged-in `claude -p --output-format stream-json --verbose --include-partial-messages` run with a background Bash, a background Agent and the todo opt-in, to confirm the `task_*` and usage frames.
- Check which plan tool, if any, pi's current models call.
- Operate Claude Code Desktop's Background tasks pane (`walk`) before taking its row layout.
