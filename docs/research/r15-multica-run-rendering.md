# r15 · How Multica renders a run in progress (UI rendering + event stream): source-level facts

> Purpose: pin down at source level "how a work unit being run by an agent is presented in the Multica UI" (frontend rendering + wire + persistence timing), as a comparison target for the real-time row changes in pacman's chief drawer.
> Material A (source side, the only first-hand source): a shallow clone of `multica-ai/multica` with `--depth 1`, HEAD = `b4ca5b4a23e68b26292a680dca7689a952bb1cd5` (2026-10-04 12:48:20 +0800, "refactor(skills): retire legacy issue skill redirect (#9046)"), at `/tmp/multica-src-runui.BHtJaX` (outside the repo, not polluting pacman). Cloned 2026-10-05 15:57 UTC.
> Material B (docs caliber): the same repo's `apps/docs/content/docs/*.mdx` (tracks the source version).
> Unused material: the local Multica desktop app (`~/Library/Application Support/Multica/`) and CLI were not taken; no live UI was captured — the source alone can answer all six questions, so the latter two kinds of first-hand source in B/C were not needed.
> Reading conventions: two kinds of sources, marked per item — **C** (code) = multica source `path:line` (relative to the clone root); **D** (docs) = `apps/docs/content/docs/*.mdx:line`; **[inference]** = a conclusion with no direct source, inferred from code behavior. No emoji anywhere in this document.
> Naming first: in Multica, one agent execution is called a **task** (in the UI layer, a **run**). The UI has two independent presentation surfaces sharing the same task data — the **chat surface** (`packages/views/chat/`, the agent's replies in the conversation stream) and the **issue surface** (`packages/views/issues/`, the live run bar + execution log inside an issue's detail). Both read the same `task_message` rows, but with different splitting and folding logic, described separately below.

---

## 1. Conclusions first

1. **A run is "one row" in the UI, and the page uses `task:<taskId>` as the row key**; the real-time stream and the final version share this one key, and persistence is an **in-place replacement of the same row's data**, not an unmount-and-rebuild (`packages/views/chat/components/chat-message-list.tsx:124-137,469-479`). **Inside** the row, the timeline is cut into multiple steps (narration text / tool calls / thinking / error), and these steps appear **one by one in real time**, not batch-appended at wrap-up. (§2, §3)
2. **The boundary of one `task_message` is not "one tool call" but "a run of consecutive same-type deltas"**: the daemon accumulates consecutive text (or thinking) deltas into the same buffer, sealing them into one row only on **type change / 500ms tick / run end**; tool calls and tool results are each **independent rows**, never entering this buffer. (`server/internal/daemon/daemon.go:9439-9469,9573-9666`) (§2)
3. **Splitting and folding happen on the read side, not the write side**: the wire is a flat `(seq, type, tool, content, input, output, call_id)` row; the frontend pairs `tool_use`/`tool_result` into one step by `call_id`, merges consecutive same-type text, and folds runs of consecutive same-tool calls (≥3 and non-shell) into a group. (`packages/views/common/task-transcript/build-steps.ts:95-198`, `build-timeline.ts:23-46,135-154`) (§2, §4)
4. **Tool calls are visible during streaming, in the form of an expandable one-line row** (the provider's native tool name + the single most informative argument), not a standalone big card. The **interleaved order** between tool rows and surrounding narration text is preserved, ordered by `seq`. (`chat-message-list.tsx:1232-1280`, `trace-event-presenter.ts:124-147`) (§3)
5. **Intermediate narration text and the final conclusion are explicitly layered in the chat surface**: `splitTimeline` cuts the timeline into preface (text before the first non-text item) / middle (from the first to the last non-text item, including text in between) / final (text after the last non-text item). During streaming, final renders as body text outside the fold; **after settled, the persisted `chat_message.content` of the spine takes over final**, while preface+middle remain as process history. (`packages/views/chat/lib/copy-text.ts:16-34`, `chat-message-list.tsx:1075-1150`) (§3, §4)
6. **Multiple assistant messages of one run do not each occupy a UI record; they are merged.** Two-level merging: the daemon seals consecutive deltas into one row (§2), and the frontend `buildTimeline` merges adjacent same-type rows a second time (`build-timeline.ts:135-154`). In one chat conversation, **each turn** occupies one row and is not split further into multiple rows. (§4)
7. **Fold defaults are coupled to the streaming state**: the chat surface's process fold **defaults to open during streaming and auto-folds at settled** (`chat-message-list.tsx:1171-1176`); the issue surface's live run bar **defaults to folded** (`inline-comment-run.tsx:42`); the full transcript dialog **defaults to chronological order and does not follow**, with live follow enabled only when switched to "Newest first" (`agent-transcript-dialog.tsx:581-582`, `stores/transcript-view-store.ts:19-20`). (§5)
8. **Wire surface: real-time push goes over WebSocket, and it is "persist first, then broadcast"**. daemon → server is batched HTTP POST (one beat per 500ms + the first visible event immediately); the server first persists with `CreateTaskMessages`, then broadcasts with `publishTask` in seq order; the frontend writes `task:message` frames into the React Query cache incrementally, and the client backfills the whole timeline from REST **when opening a run**. There is no SSE and no polling. (`server/internal/handler/daemon.go:5090-5233`, `use-realtime-sync.ts:1488-1512`, `chat/queries.ts:218-235,321`) (§6)
9. **Text rows and tool rows ride the same channel on the wire** (the same `task:message` event, the same seq space, globally ordered by seq), differing only in the `type` field; all differences live in downstream rendering (§3) and the daemon's sealing policy (§2). (§6)
10. Hand-offs like "the typing row is taken over by the persisted row" are **explicitly hard-coded**: the chat surface uses a `pendingAlreadyPersisted` gate + a stable row key + the same `AssistantMessage` component carrying both states (`chat-message-list.tsx:238-257,524-600`); cache writes use a by-seq union merge, so backfill does not overwrite already-arrived real-time frames (`chat/queries.ts:249-298`). (§6)

---

## 2. Surface 1: is the process "one continuously growing block" or "multiple records split by steps"

### 2.1 Source measurement (C)

**One run = one entity in the UI, internally multiple steps ordered by seq.**

- The real-time row and the final row **share one Virtuoso row key**: `messageRowKey` returns `task:<taskId>` for assistant messages carrying a `task_id`, identical to the live row's `key: task:<taskId>` (`packages/views/chat/components/chat-message-list.tsx:124-137`; the live row is constructed at `:275`). The comment (`:117-123`) says this is so that "Mermaid charts / HTML iframes already rendering mount without loss when the task completes".
- In-row rendering is `TimelineView` → the timeline is laid out step by step (§3 below).

**Step boundaries are defined on both ends, and both are "a run of consecutive same-type deltas", not "one tool call per step":**

- **The daemon write end** (`server/internal/daemon/daemon.go`):
  - `appendPending(type, content)`: text / thinking deltas are appended into the `pendingContent` buffer; on a type switch, `sealPendingLocked()` first seals the previous run into one row (`:9455-9469`).
  - `sealPendingLocked()`: seals the current consecutive frames into one `TaskMessageData` carrying a `seq` (`:9439-9453`).
  - `flush()`: seals the current frame + sends the whole `batch` (`:9471-9487`), driven by the 500ms ticker (`:9489`) and "the first visible event" (`flushFirstVisible`, `:9508-9517`).
  - `tool_use` / `tool_result` / `error` **do not go through the buffer**; each is immediately appended to `batch` as an independent row (`:9573-9666`); when a `tool_use` arrives, `sealPendingLocked()` is called first to seal the preceding text frame (`:9578`), ensuring text rows and tool rows never share one seq.
- **The frontend read end**: `buildTimeline(msgs)` sorts by `seq` and merges adjacent `text`/`thinking` rows again (`:135-154`); the merge predicate `canMergeStreamingText` = the previous and next are both `text` or both `thinking` (`build-timeline.ts:23-25`).

**"When splitting happens" is real-time:** the daemon publishes once per 500ms tick or per type switch; the client writes the first `task:message` frame into the cache immediately and merges subsequent frames on a fixed 100ms window (`use-realtime-sync.ts:137,1498-1505`). Wrap-up has only one supplementary flush (`daemon.go:9678`) — the whole turn is not accumulated for a one-time split at the end.

### 2.2 Docs caliber (D)

- `apps/docs/content/docs/tasks.mdx:66`: "Click **View transcript** on a row to see the agent's messages, tool calls, and error output. For a run still in progress the transcript keeps streaming while the dialog stays open, and a **Newest first** toggle flips the event order." — the docs confirm the three kinds "messages / tool calls / error output" and "continuous appending during streaming".

### 2.3 Differences

- The docs only say the transcript "keeps streaming", without stating the splitting granularity or timing. The source-measured granularity is **"a run of consecutive same-type deltas" per row**, **not** "one tool call per row" — the latter is a read-side re-processing product (§4).
- The docs do not mention "the same row is replaced in place between real-time and final"; in the source this is achieved via a stable row key + a single component carrying two states (§6).

---

## 3. Surfaces 2 / 3: the form of tool calls, interleaved order, and the layering of process vs conclusion

### 3.1 Chat surface (agent replies inside the conversation stream)

**Tool call form = an expandable one-line row.**

- `ToolCallRow` (`chat-message-list.tsx:1247-1280`): the folded state is `tool name + one-line summary`; expanding shows the full input JSON (`<pre>`). `item.tool` is displayed as-is (the provider's native name, not renamed).
- The summary is picked from the input by `traceToolArgSummary` by priority (the single most informative argument): `query` → multi-file patch → `file_path`/`path` → `pattern` → `description` → `command`/`cmd` → `prompt` → `skill` → the first short string; commands also get the `zsh -lc '...'` wrapper stripped and are truncated to 120 characters (`trace-event-presenter.ts:124-147`).
- `ToolResultRow` (`:1282-1310`): a separate row, the summary takes the first 120 characters of the output, expanding shows the first 4000 characters.
- `ThinkingRow` (`:1312-1332`): a separate row, italic preview of the first 150 characters, expanding shows the full text.
- `ErrorRow` (`:1334-1341`): a non-collapsible row in destructive color.

**Interleaved order is preserved.** `TimelineView` lays the timeline out as a row sequence by seq, and `ItemRow` dispatches by `item.type` to the four row kinds above (`:1232-1245`); inside the fold, `text` items go through `MiddleTextRow` and everything else through `ItemRow` (`:1187-1198`). That is, **tool rows and the narration text between them are interleaved in arrival order**, not aggregated into one place.

**Process and conclusion are separated — the boundary is defined by `splitTimeline`** (`packages/views/chat/lib/copy-text.ts:16-34`):

- `preface` = text before the first non-text item (the first thinking/tool/error);
- `middle` = from the first non-text item to the last non-text item (text in between included);
- `final` = text after the last non-text item.
- Streaming-period rendering: preface is body text above the fold (`RichContent`), middle goes into `OuterProcessFold`, final is body text below the fold (`chat-message-list.tsx:1115-1149`).
- **After settled**: `processItems = preface + middle` stays in the fold; `final` is **replaced by the persisted `chat_message.content` (the canonical answer)** (`:1088-1112`; `canonicalAnswerText` in `copy-text.ts:41-47`). The comment (`:1062-1073`) states it explicitly: "Once settled, the persisted chat_message content is authoritative for the answer. Preface + middle remain in the process fold so intermediate narration is still inspectable; only trailing transcript text is replaced."

### 3.2 Issue surface (live run bar inside issue detail + full transcript dialog)

**Live run bar (`InlineCommentRun`)** (`packages/views/issues/components/inline-comment-run.tsx`):

- The folded state is **just one line of activity summary**: `RunActivitySummary` shows the current activity — preferring the argument string of "the last tool call that has no result yet", otherwise the last content-bearing step (first line of text / thinking preview / error copy / "waiting for response") (`:127-136,376-382`). The status prefix is decided by task.status (queued/dispatched/waiting/running) (`:137-140`).
- The expanded state is a step list (`:231-243`): `buildSteps` → `groupSteps` produce `TraceRow`s, each rendered as `InlineStep` (`:318-361`) — a native `<details>` fold whose folded state is one line of `icon + summary + arrow`, expanding to that step's input/result body (`StepBody`). Tool pairing relies on `call_id`; shell calls are never folded, and ≥3 consecutive same-tool calls are folded into a group (see §4).
- By default **only the last 12 rows are rendered**, with a "show N earlier" button for more (`:98,236-237`).

**Full transcript dialog (`AgentTranscriptDialog`)** (`packages/views/common/task-transcript/agent-transcript-dialog.tsx`):

- The file-header comment (`:109-112`) summarizes the four-layer reading: "what happened (header), what it produced (outcome), where the time went (timeline), and the evidence (steps)".
- Step row dispatch (`TranscriptRow`, `:1412-1417`): group → `GroupRow`; text and not a call → `ProseRow`; everything else → `StepRow`.
- `ProseRow` (`:1491-1506`): **the agent's own words stay open at body size**, and the comment (`:1472-1489`) says this is "the layer inversion the redesign turns on: ... Prose is content and stays open; tool calls are evidence and fold." — that is, **narration text is fully expanded by default, while tool calls default to a folded one-line row**.
- `StepRow` (`:1510-1587`): one line of `offset time + vertical bar + icon + tool name/kind + one-line summary + duration`; selecting it opens a `StepInspector` (`:1700+`) on the right showing the full input/result body.
- Differentiated rendering of expanded bodies is in `trace-event-presenter.ts:236-258` (`TraceEventDetail`, four kinds: diff / file / patch / text) — file modifications render as diffs, whole-file writes as plain content, multi-file patches with one section per file.

### 3.3 Docs caliber and differences

- `tasks.mdx:66` lists only "agent's messages, tool calls, and error output" three kinds; the source-measured step types are `text`/`thinking`/`tool_use`/`tool_result`/`error`, five kinds (`build-timeline.ts:7`, `trace-event-presenter.ts:28-34`) — the docs miss thinking.
- The docs do not describe the "fold" structure; the three-part layering of `splitTimeline` is purely a source implementation (the comment calls itself "Conductor-style"). [inference] This is deliberate product design: the process is inspectable but does not upstage the answer.

---

## 4. Surface 4: merge / split criteria for multiple assistant messages

### 4.1 Merging (multiple messages within one run)

Two levels:

1. **Daemon side** (before writing): consecutive same-type text deltas are sealed into one row (`daemon.go:9455-9469`).
2. **Frontend** (at read time): `buildTimeline` (`packages/views/common/task-transcript/build-timeline.ts:135-154`) merges adjacent `text`/`thinking` rows again, with the predicate identical to `coalesceTimelineItems` (`:28-46`) — `canMergeStreamingText(prev, next)` = both are `text` or both are `thinking` (`:23-25`). On merge, contents are concatenated directly and `created_at` takes the later one.

There is also **tool pairing** by `call_id` (not fanned out into two rows): `buildSteps` combines a `tool_use` with its `tool_result` into one `TraceCallStep`, paired by the **opaque `call_id`**; old records without a `call_id` fall back to "FIFO by tool name"; the two key sets are stored separately (the `id:` vs `tool:` prefixes) and do not cross (`build-steps.ts:95-149`). Orphan results stay as independent steps and are never dropped (`:128-137`).

**The grouping fold criteria** (`build-steps.ts:152-198`):

- `MIN_GROUP_SIZE = 3` (`:64`) — only runs of ≥3 consecutive same-tool calls fold into a `TraceGroupRow`;
- **shell calls are never folded** (`isShellCall`, `:75-77`), the predicate being the input carrying a `command` string (no tool-name whitelist dependency, holding across backends).

### 4.2 Splitting (multiple runs / multiple turns)

- **Chat conversation**: each turn (one task) occupies one row (row key `task:<taskId>`), and a turn is not split into multiple rows (`chat-message-list.tsx:124-137,265-278`).
- **Issue execution log**: one row per run (`execution-log-section.tsx:47-72` comment + active/past two buckets); the full process lives in each row's transcript dialog.
- **Issue live run bar**: one section per run (`inline-comment-run.tsx:173-175`, `data-run-id={task.id}`).

**Code-location summary of the criteria**: a turn = the boundary of a task (`task.id` / `task_id`); within a turn, step boundaries = the daemon's `sealPendingLocked`/`appendPending` (`daemon.go:9439-9469`) + the frontend's `buildTimeline` (`build-timeline.ts:135-154`); a tool pair = `buildSteps`'s `call_id` pairing (`build-steps.ts:95-149`).

---

## 5. Surface 5: folding / expanding of long processes and the defaults

| Surface | Structure | Default |
|---|---|---|
| Chat process fold (`OuterProcessFold`) | `Collapsible`: preface/middle go into the "process · N steps" fold area | **Defaults to open during streaming, auto-folds at settled** (`chat-message-list.tsx:1171-1176`: `useState(!!isStreaming)`, `wasStreaming && !isStreaming → setOpen(false)`) |
| Chat single tool/result/thinking rows | Each a `Collapsible`, click to expand | **Folded by default** (`ToolCallRow`/`ToolResultRow`/`ThinkingRow` all `useState(false)`, `:1249,1284,1313`) |
| Chat body text (final / preface) | `RichContent` | Always open |
| Issue live run bar step list | `<details>` folding per step; last 12 rows | Overall **folded by default** (`inline-comment-run.tsx:42`), label `查看活动 · N 步` |
| Transcript dialog step list | Virtual list (`react-virtuoso`); `ProseRow` always open, `StepRow`/`GroupRow` folded | Chronological order, no follow; live follow only with `Newest first` (`agent-transcript-dialog.tsx:581-582`; default values in `packages/core/agents/stores/transcript-view-store.ts:19-20`) |
| Transcript dialog "longer" content | `ToolDetailSurface`: beyond 1600 characters / 14 lines → fade + "show all" (`detail-surfaces.tsx:248-282`); same for diffs beyond 14 lines (`:201-229`) | Folded |
| Timeline (`RunTimeline`) | Dual-lane (model / tools) real-time axis + 1×/2×/4×/8× zoom (`run-timeline.tsx:43,110-288`) | Always open (when lanes exist) |

**The live-follow model** (`transcript-follow.ts:1-70` + the chat surface's `stick-to-bottom`): both share the same "live-end follow latch" pure state machine — only a user-initiated scroll breaks the follow; programmatic movement does not count; returning to the edge area re-engages follow. The chat surface's live-row scrolling uses Virtuoso's `scrollToIndex({index:"LAST"})` (`chat-message-list.tsx:202-204`).

**Status label** (`TaskStatusPill`, `packages/views/chat/components/task-status-pill.tsx`): the label is decided by **the type of the last message that is neither error nor tool_result** — `thinking` → `思考中`, `text` → `正在输入`, `tool_use` → mapped by tool slug (bash/exec → `运行命令`, read/glob → `读取文件`, grep → `搜索代码`, write/edit → `编辑`, web_search → `联网搜索`, unknown → `工作中`) (`pickStageKeys`, `:61-123`; the mapping table `:44-56`). The seconds ticker runs at 1s, with the anchor locked to the first render (`:169-199`).

---

## 6. Surface 6: the wire surface (real-time push vs persistence, incremental vs final convergence, whether tools/text ride separate channels)

### 6.1 Channels

- **Client receives: WebSocket**. The event type is `task:message` (`packages/core/types/events.ts:33`), the payload type `TaskMessagePayload` (`:291-316`): `{task_id, issue_id, seq, type, tool?, call_id?, content?, input?, output?, output_truncated?, created_at?}`. The WS client is in `packages/core/api/ws-client.ts` (URL constructed at `:85`, `new WebSocket(url.toString())` at `:99`). **No SSE, no polling** (grep for `EventSource`/`text/event-stream` across core/web is empty; task messages have no `refetchInterval`).
- **Daemon sends: batched HTTP POST**. `ReportTaskMessages` (`server/internal/handler/daemon.go:5090`), body `{messages: [...]}` (`:5085-5087`); driven by the 500ms ticker + the first visible event (`server/internal/daemon/daemon.go:9489,9508-9517`).

### 6.2 Persistence timing: persist first, then broadcast

- `ReportTaskMessages` first calls `CreateTaskMessages` (batch insert, `:5209`), and only **after success** does `h.publishTask(protocol.EventTaskMessage, ...)` broadcast row by row in seq order (`:5216-5230`). The comment (`:5217-5221`) states it explicitly: "CreateTaskMessages orders its result by seq ... subscribers render these events as they arrive, so the ordering lives in the query rather than in the clients."
- A client-side comment confirms this contract directly (`packages/core/chat/queries.ts:321`): "Dropping a frame for an unregistered task is safe — **the row is persisted before it is broadcast**, so whoever opens the task next fetches it from the server."
- Before persistence the server **redacts a second time** (`redact.Text/InputMap`) and does PostgreSQL NUL cleaning (`daemon.go:5157-5180`); the daemon also redacts once before sending (`daemon.go:9590-9598`).

### 6.3 Convergence of incrementals (is it "the typing row is taken over by the persisted row"?)

**Yes, and it is explicit logic.**

- **Cache-layer convergence**: `task:message` frames are written into the React Query cache `["task-messages", taskId]` via `mergeTaskMessagesBySeq` (`chat/queries.ts:249-258`, dedup by seq, keeping existing object references); REST backfill goes through `structuralSharing: unionTaskMessagesBySeq` (`:209-213,280-298` — server data wins on conflict, but seqs not mentioned in the response are **kept, not deleted**). The comment (`:266-278`) explains why: "a normal query response and the realtime stream race ... A plain replace would drop those seqs, and staleTime: Infinity means nothing would ever refetch them".
- **View-layer takeover**: the chat surface's `pendingAlreadyPersisted` (`chat-message-list.tsx:238-244`) = when an assistant message with `task_id === pendingTaskId` already appears in messages, **the live timeline is suppressed** and the persisted messages take over; `showLiveTimeline` / `hasLive` are mutually exclusive with it (`:250-278`). Both are rendered by **the same `AssistantMessage` component** (`:469-479` and `:508-522`), with the `message` prop going from `undefined` (streaming) to the persisted object (settled), and `phase` from `"streaming"` to `"settled"` (`:585`).
- **Backfill timing**: `useTaskMessages(taskId, isLive, enabled)` refetches with `refetchOnMount:"always"` at mount, `refetchOnWindowFocus:"always"` on window focus, and refetches again when `isLive` goes from true→false (`chat/queries.ts:218-235`) — that is, "WS while running, REST to fill in when opening / finishing".

### 6.4 Are tool rows and text rows two separate channels

**The same channel, the same seq space, differing only in the `type` field** (the `type` union at `events.ts:298` includes text/thinking/tool_use/tool_result/error). The differences live only downstream:

- Daemon side: text/thinking go through the buffer-and-seal path, while tool_use/tool_result/error each become rows immediately (§2.1).
- Rendering side: the chat surface dispatches by type into different row components (§3.1); the issue surface then pairs tool_use/tool_result into one step by `call_id` (§4.1).

[inference] The reason tool rows do not enter the text buffer is to let "which tool was called" surface within 500ms instead of being held back by long text; and the reason text is accumulated into runs is to avoid one row per token blowing up the transcript (the comment at `build-steps.ts:3-16` records the historical lesson: "a 75-call run rendered 150 rows").

### 6.5 Per-side cache keys / ingestion gates

- The broadcast is a **whole-workspace fanout** (`daemon.go:5114-5120` comment; `use-realtime-sync.ts:1443-1446`), but the client has two gates (`use-realtime-sync.ts:1443-1457`): (1) keep only frames for tasks whose timeline cache entry **this client already holds** (`isTaskMessageTimelineHeld`, `chat/queries.ts:323-328`); (2) surviving frames are merged into a single cache write on a fixed 100ms window. The gate is **re-checked before writing** (GC may have collected it, `:1461-1472`).

---

## 7. Direct implications for pacman

pacman current state (measured positions on this repo's `chief-live-split` branch): one turn = one step = one `activeRun`; while in flight, all `text_delta`s of the turn are **concatenated without separators into a single typing row** (`apps/web/src/api/mappers.ts:1166-1174`); only at turn end is the transcript uploaded and split into rows by assistant message; the tool-disclosing `LiveRow` (`apps/web/src/components/chat/live-row.tsx`) **renders only before the first token** (`mappers.ts:1175-1206`). Following Multica's approach, the chief drawer's real-time row needs these changes:

1. **Stable row key; persistence takes over in place**: Multica's real-time row and final row share one key (`task:<id>`), rendered in two states by the same component, switched by the `pendingAlreadyPersisted` gate, and persistence is "replacement of the same row's data" rather than unmount-and-rebuild (`chat-message-list.tsx:124-137,238-257,469-479`). pacman already has a hand-off comment for the "typing row ↔ persisted robot row" (`mappers.ts:1182-1187`); tighten it against this: confirm the hand-off is data replacement rather than a remount, so Markdown / tool-expanded state is not lost at the hand-off instant.
2. **Split by boundaries during streaming; do not accumulate until turn end**: pacman currently keeps "one row for the whole turn's text_delta, split only at turn end". Multica's splitting happens in real time during streaming — the daemon seals on "type change / 500ms / first visible event" (`daemon.go:9439-9517`), and the frontend merges same-type frames by seq. Mapped to pacman: inside the typing row, breaks should happen **during streaming** at event boundaries (when a tool call / thinking appears between assistant-text paragraphs), not after the transcript persists.
3. **Tool rows and text rows coexist and interleave; not either-or**: pacman currently has "tool disclosure only before the first token; once the typing row takes over, tool rows are absent" (`mappers.ts:1193-1195`). In Multica, tool rows are **independent step rows**, interleaved with narration text by seq and folded into one step as tool pairs (`build-steps.ts:95-149`, `chat-message-list.tsx:1232-1280`). The chief drawer should keep tool calls visible continuously throughout the turn, inserted in order, rather than being displaced by the text row.
4. **Layer process and conclusion, with a definable boundary**: Multica uses the `splitTimeline` three-part division; after settled, the persisted content takes over only final, while preface+middle remain as an inspectable process (`copy-text.ts:16-34`, `chat-message-list.tsx:1062-1112`). If pacman wants "process fold + answer", this boundary definition can be reused directly ("before the first non-text item / from the first to the last non-text item / after the last non-text item"), and the fold made to **default to open during streaming and auto-fold at settled** (`:1171-1176`).
5. **Activity label takes "the latest event type", no hard-coded copy**: Multica's `TaskStatusPill` derives the label from the type of the last non-error/tool_result message plus a tool-slug mapping (`task-status-pill.tsx:61-123`), and seconds render only with a real start point, never showing a frozen number. pacman already has `activityLabel` / the latest signal (#905, `mappers.ts:1196-1204`); map the drawer real-time row's label to the same "latest-event-type-driven" shape, and hold the line "no real timestamp → no seconds rendered for the whole row".
6. **Deduplicate and merge incrementals and final by id/seq; do not let backfill overwrite already-arrived real-time frames**: Multica uses `mergeTaskMessagesBySeq` + `unionTaskMessagesBySeq` + `structuralSharing`, with server data winning on conflict while seqs unmentioned in the response are kept (`chat/queries.ts:209-298`). pacman's SSE already has a stream hand-off (`apps/web/test/chief-stream-handoff.test.ts`); check against this class of window: "can the final re-fetch drop a segment already rendered during streaming but not yet contained in the persisted row?"

---

## 8. Not obtained / boundaries

- The local Multica desktop app (`~/Library/Application Support/Multica/`, app.asar) and CLI were not taken — the source alone suffices to answer all six questions, and the read-only cost of the artifacts outweighed the benefit.
- No live UI was captured.
- `apps/docs/content/docs/tasks.mdx` is the only docs page describing this UI (`chat.mdx` covers chat usage, with no process-presentation details); beyond the two sentences quoted in §2.2/§3.3 there is no further caliber to cross-check.
- Unverified: whether the chat surface's `OuterProcessFold` fold state gets re-expanded by the next turn's streaming under rapid consecutive tasks — this pass read source only and did not measure it live ([inference] it will, because the `open` initial value takes `isStreaming`, but how the `open` state migrates when the same `AssistantMessage` component instance spans turns without remounting was not traced line by line).
