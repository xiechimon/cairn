# Start Task Echo, SeqNum Removal, and Coordinator Unavailability

Date: 2026-11-25

## 1. Problem & User Impact

1. **System-initiated orchestration prompts impersonate the user**: Clicking Start on a task inserts a `chief_message` with `role: 'user'` and `origin: 'user'`. Even though `orchestrateTodo` passes `{ ownerWords: false }`, `submitChiefMessage` hardcodes `origin: 'user'`, so `collectChiefStream` renders `"开始任务 #N"` (or the entire internal prompt + `CORRECTION_PROMPT` / `【输入框选定项目：...】` when prefixes shift the first line) as a user chat bubble.
2. **Task sequence numbers (`#<seqNum>`) leak into user-facing UI**: Start prompts, thread titles (`orchestrateThreadTitle`), server notices (`retry-parking`, `merge-announcement`, `design-comments`, push bodies), mention pickers, and task chips expose `#123` to users instead of task titles.
3. **Silent/spinning Start when Coordinator cannot run**: When the Coordinator cannot run due to model quota exhaustion, model capacity/overload, expired subscription/credentials, or offline runner, the task panel keeps spinning `"编排中"` (`"Orchestrating"`) instead of surfacing the Coordinator unavailability reason and offering the existing `"给 Coordinator 换模型"` action while keeping the request queued.

## 2. Storage & Protocol Decision (No Protocol Break)

Coordinator runtime (`coordinator/runtime/seed.ts`, `coordinator/index.ts`, `chief-claim-history.ts`) skips `role === 'system'` rows when constructing LLM turn history. Meanwhile, `chief_message.origin` and `message.origin` already distinguish `'user' | 'synthetic' | 'task-prompt'` on `role: 'user'` rows, and `isChiefPromptEcho` (`apps/web/src/api/mappers.ts`) already suppresses `origin === 'synthetic'` and `origin === 'task-prompt'` from chat user bubbles.

- **Decision**: Keep `role: 'user'` for synthetic orchestration requests and set `origin: 'synthetic'` whenever `opts.ownerWords === false` in `submitChiefMessage`. No Pi runtime or daemon protocol change is needed.
- **Task thread feedback**: Keep rendering orchestration status in the task thread via existing `StatusLine` (`kind: 'note'`, `data-testid="transcript-note"`), formatted as `"已交给 Coordinator：{title}"` (no `#seqNum`).

## 3. Read/Write Path & Same-Bug-Class Audit

| Path | Current behavior | Target behavior |
| --- | --- | --- |
| `apps/server/src/services/chief.ts` (`submitChiefMessage`) | Hardcodes `origin: 'user'` even when `opts.ownerWords === false` | Write `origin: opts.ownerWords === false ? 'synthetic' : 'user'` |
| `apps/server/src/services/chief.ts` (`directThreadMessagesSinceLastTurn`, `rewindChiefThread`, `retryableGreetingStep`) | Only checks `role === 'user'` and `!id.startsWith('user-')` | Require `origin IS NULL OR origin = 'user'` (exclude `'synthetic'` and `'task-prompt'`) |
| `apps/server/src/services/coordinator-steps.ts` (`latestOwnerRow`) | Picks any `role === 'user'` not `user-*` for reply language | Filter `or(isNull(chiefMessage.origin), eq(chiefMessage.origin, 'user'))` |
| `apps/server/src/services/coordinator-request.ts` (`citedMessages`), `task-reply-context.ts`, `coordinator/server-api.ts` (`canSuggestReplies`), `chief-turns.ts` (`steeredMessages`) | Accepts any `role === 'user'` row | Exclude `origin IN ('synthetic', 'task-prompt')` |
| `apps/server/src/services/build-step-action.ts`, `build-restart.ts` | Hardcodes `origin: 'user'` even when `origin !== 'person'` | Set `origin: origin === 'person' ? 'user' : 'synthetic'` |
| `apps/server/src/services/orchestrate.ts`, `packages/shared/src/records/prompts.ts` | `orchestratePromptHead(seqNum)` & `orchestrateThreadTitle(seqNum)` emit `"开始任务 #N"` | Use task title (`orchestratePromptHead(title)`, `orchestrateThreadTitle(title)`); keep internal `[#seqNum](todo:id)` only inside prompt body for model linking; `orchestratedTodoIdOf` matches both legacy and new headers |
| `apps/web/src/api/mappers.ts` (`collectChiefStream`) | Renders `orchestratePromptHeadOf(text)` as user bubble; legacy `'user'` rows with `#N` or prefixes leak | Suppress all `isChiefPromptEcho(m)` AND any `role === 'user'` row where `orchestratedTodoIdOf(rawText) !== null`; also suppress rows whose stripped `chiefUserText(rawText)` is empty (covers legacy `CORRECTION_PROMPT`, `BLOCKER_HANDOFF`, `SKILL_ROUTE`, `TURN_CONTEXT`, schedule wakes) |
| `apps/web/src/api/mappers.ts` (`mapOrchestrationFeedback`) | Stops `rest` scan on daemon `user-${request.id}` prompt echo; emits `'已交给 Coordinator 安排'` | Skip daemon `task-prompt` echoes when finding next turn boundary; emit `{ kind: 'note', text: '已交给 Coordinator：{title}', vars: { title } }`; suppress spinning `'streaming'` when Coordinator outage is active |
| `apps/server/src/services/{retry-parking,merge-announcement,design-comments,owner}.ts` & `apps/web/src/{board/use-thread-mentions,chief/chief-conversation,chief/chief-message-rows,chief/use-orchestrate-start}.ts` | Emits `#${seqNum}` in user-facing notices, push bodies, mention labels, task chips | Replace `#${seqNum}` with task `title` (keep GitHub PR/issue `#N` and internal mention serialization intact) |

## 4. Legacy Data Compatibility

- Existing `chief_message` rows written prior to this change have `origin = 'user'` (or `null`) and content starting with `开始任务 #<N>\n\n编排请求：[#<N>](todo:<id>)` (optionally prefixed with `【输入框选定项目：...】` or `CORRECTION_PROMPT`).
- `orchestratedTodoIdOf` matches both the legacy header and the new title-based header, so:
  1. `collectChiefStream` suppresses all legacy and new orchestration prompts from user bubbles.
  2. `mapOrchestrationFeedback` still locates legacy and new requests on the task thread and renders the neutral `StatusLine` event without `#seqNum`.
  3. `coordinator-load.ts` (`isOrchestrationThread`) recognizes both `thread.orchestration != null` and legacy `/^开始任务 #\d+$/` titles.

## 5. Unified Coordinator Unavailability (Single Source of Truth)

- Extend `chiefOutageSchema` (`packages/shared/src/records/chief.ts`) `reason` enum to `'quota' | 'capacity' | 'subscription' | 'runner-offline'`.
- Server `chiefOutage(db, chiefId)` (`apps/server/src/services/chief-turns.ts`) produces the canonical `ChiefOutage` for all 4 failure states:
  1. **Quota / Capacity**: Parked steps (`waiting_quota` or `holdReason === 'quota'`) and pending chief step `claude-rate-limited` / `hold.reason === 'quota'`.
  2. **Subscription expired / unavailable**: Pending chief step blocked by `claude-logged-out`, `devin-subscription`, `antigravity-subscription`, `coordinator-provider-missing`, or `coordinator-provider-no-key`, OR active Coordinator runtime having expired subscription rows (`expiresAt <= now`) with no valid replacement.
  3. **Runner offline**: Pending chief step blocked by `machine-offline` or `no-computer`.
- Web unifies state via `resolveCoordinatorOutage(outage, coordinatorThread)` (`apps/web/src/chief/coordinator-outage.ts`) and renders `ChiefOutageBanner` (`"Coordinator 暂时不可用"` / `"The Coordinator is unavailable"`, one-sentence reason, and `"给 Coordinator 换模型"` routing to `COORDINATOR_ROUTING_HREF`).
- On the task page (`apps/web/src/board/thread-actions.tsx`), when `kind === 'start'` and `coordinatorOutage !== null`:
  - Clicking Start still queues the orchestration request so it auto-resumes when the Coordinator recovers.
  - Stop showing/spinning `"编排中"` (`orchestrating && coordinatorOutage === null`); render `ChiefOutageBanner` in place with working `"给 Coordinator 换模型"` navigation (`COORDINATOR_ROUTING_HREF`).

## 6. Mac mini Live Verification Plan

After `deploy-mini.sh` deploys the landed SHA to Mac mini (`~/cairn-server` and `~/cairn-runner`):

1. **Start-task hides system request in main chat + shows neutral event without seqNum in task thread**:
   - In the desktop app connected to mini, create a task (e.g. `"Test start echo removal"`), open the task panel, and click `开始` (`Start`).
   - Verify DB (`chief_message`) has `origin = 'synthetic'` on the orchestration message; main Coordinator chat shows zero `"开始任务 #N"` / prompt user bubbles; task thread renders `StatusLine` `"已交给 Coordinator：<title>"` with no `#seqNum`.
   - Repeat with a `failed` task retry orchestration and a task with `correction` label.
2. **Zero `#seqNum` across user-facing UI**:
   - Inspect main chat, task panel, mention dropdown (`@`), toast, and merge/parking notices in the live desktop app for any `#<seqNum>` task numbers; confirm only task titles appear.
3. **Coordinator unavailable states on Start Task**:
   - For each unavailable state (model quota exhausted, model overloaded, expired subscription, offline runner): open a `todo` task on the desktop app connected to mini, click `开始`.
   - Verify: (a) the step remains queued in DB so recovery resumes automatically; (b) `"编排中"` spinner does not spin; (c) `"Coordinator 暂时不可用"` + single-sentence reason + `"给 Coordinator 换模型"` button appear immediately; (d) clicking `"给 Coordinator 换模型"` navigates to `/app/settings/routing#route-coordinator`.
   - Evidence: server DB/logs saved to `~/Pictures/cairn-review/mini-live/start-task-echo/*.log` and desktop `screencapture` screenshots saved to `~/Pictures/cairn-review/mini-live/start-task-echo/*.png`.

