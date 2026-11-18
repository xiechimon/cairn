# Coordinator completion summaries on task settle and retirement of bare sub-thread rows

Status: owner-approved design (1 + Option A, 2026-11-18).

## Problem

Finished tasks (`todo.phase -> 'done'`) currently diverge across two broken paths:

1. **Watched tasks stay silent**: `triggerChiefWakes` enqueues `[wake:settle]`, whose prompt tells the Coordinator `"对话里已记下这条，不用再告诉用户"`. Event turns hide ordinary assistant text from the user, and the web client drops `thread-report` rows for any task already linked by a `task-card` (`subThreadRowIds`), so the user gets no summary bubble in the Coordinator conversation when a code or non-`info` task finishes.
2. **Unwatched tasks drop an orphan pill**: When a task is created outside the loaded Coordinator stream (API, script, Tasks panel, or scrolled past the loaded page) and enters `done`, `triggerChiefWakes` skips `enqueueChiefStep` and inserts only a system `thread-report` row. `groupThreadEvents` renders that unacknowledged row as a bare `<SubThreadRow>` pill (`chief-sub-thread`) with no bubble, no context, and no Coordinator summary.

## States and transitions

- **Watched `done`**: `setTodoPhase` -> `notifyPhaseEntry` -> `triggerChiefWakes(deps, record, 'done', options)` gathers every live watching thread in `chief.watches`, inserts `thread-report` (`phase: 'done'`), and removes the watch.
- **Unwatched `done`**: `triggerChiefWakes` resolves `unwatchedReportThread(deps, record)`:
  - Orchestration research whose asking thread is archived/deleted returns `null` (no report, no wake).
  - Live orchestration-research asking thread returns that thread id.
  - Otherwise returns `coordinatorThreadRow(deps, ensureChief(deps, record.teamId)).id` (the team's main Coordinator thread).
- **Suppression guards** (insert `thread-report` without `wakeStepId` and enqueue no `[wake:settle]` step):
  1. `reportAnsweredIn(deps.db, threadId, todoRecord)` is `true` (an `info` report turn already sent `report-notice-*` or recorded `report-silent-*`).
  2. `options.silentSettleThreadId === threadId` (the Coordinator itself just called `complete_todos` in that thread).
  3. Manual owner phase update (`updateTodo(..., { manualPhase: true })`), which already bypasses `notifyPhaseEntry`.
- **Active `[wake:settle]`**: inserts `thread-report` with `wakeStepId` and atomically enqueues a `chief` step (`trigger: 'settle'`, `provenance: 'watch:<todoId>'`) inside the `setTodoPhase` SQLite transaction.

### `[wake:settle]` prompt contract

- Instructs the Coordinator to send a 2–4 line summary via `notify_user` (with `provenance` matching line 1) naming the finished `[title](todo:<id>)` chip, what it completed/verified, and its delivery state (branch, PR, or merged) — staying silent only if that exact completion was already notified in the same conversation.
- Appends `settleDeliveryBlock(db, record)` reading only synchronous SQLite rows (`build`, `step`, `message`, `project`) with zero git subprocesses inside the transaction:
  - Delivery line (`交付事实：`): merged PR / landed merge commit, open PR number & URL, working branch `conversationBranch(buildId)` + short head commit, or `无代码分支改动`.
  - Worker excerpt: for non-third-party tasks, reads the latest non-empty `assistant` text (falling back to `build.reportLine`), clips to 600 code points (`（已截断）`), neutralizes `attachment:` via `neutralizeIssueAttachmentTokens`, and line-quotes via `quoteIssueLines` marked as untrusted result data.
  - Third-party `github-issue` tasks (`titleAuthor === 'third-party'`): omits raw worker prose from the wake prompt (pointing to `conversation` tool instead) and keeps `settleDeliveryBlock` before `fencedTitle(todo.title, todo)` so the issue title remains strictly inside `ISSUE_FENCE_OPEN..CLOSE`.

## Paths reading or writing state

| Path | Trigger / Caller | Server outcome | Web outcome | Test covering path |
| --- | --- | --- | --- | --- |
| Watched code/plain build finishes (`finishTodoDone`) | `build-step-complete.ts`, `ci-grind-outcome.ts`, `build-github-merge.ts` | `thread-report` (`wakeStepId`) + `[wake:settle]` with delivery facts; watch cleared | `notify_user` renders `chief-reply-bubble` with inline task chip; 0 `chief-sub-thread` rows | `chief-thread-report.test.ts` |
| Unwatched task reaches `done` (API/CLI/panel) | `setTodoPhase(..., 'done')` | Resolves `unwatchedReportThread`, writes `thread-report` (`wakeStepId`), enqueues `[wake:settle]` | `notify_user` renders summary bubble; 0 `chief-sub-thread` rows | `chief-thread-report.test.ts` |
| Coordinator accepts via `complete_todos` | `chief-tools.ts` `complete_todos` | Passes `silentSettleThreadId: ctx.threadId`; writes `thread-report` without second wake | Existing reply/notice stays; 0 `chief-sub-thread` rows | `chief-thread-report.test.ts` |
| Already-answered `info` report moves to `done` | `reportAnsweredIn === true` | Writes `thread-report` without `wakeStepId`; no wake | Existing `chief_notice` keeps report card (`placeReportCards`) | `chief-thread-report.test.ts`, `thread-activity.test.ts` |
| Archived/deleted research asking thread | `unwatchedReportThread === null` | Inserts no report and enqueues no wake | Nothing added to main thread | `research-project.test.ts` |
| Project-channel task reaches `done` | `insertThreadReport` mirror check | Channel receives wake; main channel gets `fromThreadId` mirror | `ChannelMirrorRow` renders; `chief-sub-thread` never renders | `coordinator-project-channels.test.ts`, `thread-activity.test.ts` |
| Third-party GitHub issue task settles | `titleAuthor === 'third-party'` | `settleDeliveryBlock` omits worker prose; title stays solely inside `ISSUE_FENCE_OPEN..CLOSE` | Notice shows task chip (`C15`) | `issue-fence.test.ts`, `chief-thread-report.test.ts` |
| Manual owner mark-done | `updateTodo(..., { manualPhase: true })` | Skips `notifyPhaseEntry`; no wake | No duplicate notice | `routes-todos` / existing suite |

## Failure behavior

- If `insertThreadReport` or `enqueueChiefStep` throws (e.g. `convHub` failure), `setTodoPhase`'s SQLite transaction rolls back the phase change, `thread-report`, and `step` atomically (`phase-fanout-atomic.test.ts`).
- Prompt length stays under 2,000 characters regardless of transcript length (`SETTLE_SUMMARY_MAX_CHARS = 600`).
- Historical `thread-report` (without `fromThreadId`) and `thread-message` rows in existing databases are filtered cleanly in `groupThreadEvents` with no database migration required.
