# Coordinator routes, the owner's words reach the worker verbatim

Status: revision 2, proposed on 2026-11-09. The segment model and explicit turn attribution were approved by the coordinator. Revision 1 was accepted the same day, with Coordinator notes capped at 280 characters of routing facts. Owner decision of 2026-11-09: the Coordinator only routes and never rewrites the owner's words into a brief. Prior art: `docs/research/coordinator-verbatim-prior-art-2026-11-08.md`.

## Why revision 2

Revision 1 stored the task text as one rendered string (`spec`) and kept its provenance in a side record. Readers had to work out who wrote each part:
- the title fence came from `sourceKind`;
- the spec fence depended on whether the reader received `request`;
- attachment grants came from scanning the whole string;
- a re-split quoted out of the mixed string.

Which owner messages a Coordinator turn could cite was inferred from the step id, from rewind text matching, from an id prefix on resumed turns, and from answer timestamps.

Three Codex review rounds on #3558 found the same bug class each time: authorship lost or mislabelled on one more path.
- A parked `ask_user` answer could not be cited.
- Issue attachments were granted on append.
- An in-turn answer had no timestamp.
- Re-splitting a corrected issue child fenced the owner's correction.
- The orchestration path dropped `request` and fenced the whole spec.

Revision 2 removes the guessing. Authorship is stored once per segment, and attribution is written once per turn.

## Problem

`create_todo` takes a free-text `title` and `spec` from the Coordinator (`packages/shared/src/protocol/chief-tools.ts`, `create_todo`). Its system prompt tells it to rewrite every request into a three-part brief: a quote of the user, a `要求：` list and a `补充信息` list (`apps/server/src/services/chief.ts`, rule `措辞→spec`). Workers see only that brief, and so do the board and the GitHub issue body. In a dogfood rehearsal a one-line problem became a long prescriptive spec.

Linear agent sessions, the Copilot coding agent and Devin all hand over the human's text as written, and keep routing in separate fields. Only Claude Code subagents paraphrase, and their docs say the details the parent drops are lost.

## Decision

1. A Coordinator-created task stores its text as ordered segments in `todo.request`. Each segment is copied verbatim when it is cited. No tool parameter carries task text.
   ```ts
   type TaskRequest = {
     segments: TaskSegment[];
     siblings: string[];
     difficulty: 'easy' | 'standard' | 'hard' | null;
     titleSource: 'owner' | 'worker';
   };
   type TaskSegment = {
     source:
       | { kind: 'chat'; threadId: string; messageId: string; span: 'whole' | 'quote' }
       | { kind: 'answer'; threadId: string; requestId: string; span: 'whole' | 'quote' }
       | { kind: 'todo'; todoId: string; segment: number | null; span: 'whole' | 'quote' };
     author: 'owner' | 'third-party';
     sourceRef: string | null;
     text: string;
   };
   ```
   - `segments` is ordered and append-only. Each cited owner message is one segment, and each owner `ask_user` answer is one segment (`kind: 'answer'`, text = the owner's answer). A quote is a segment whose `text` is the exact quoted sentence (`span: 'quote'`).
   - `author` is fixed when the segment is created and copied unchanged whenever the segment is reused. `third-party` means a GitHub issue author; `sourceRef` is then the issue ref that labels its fence. Owner segments have `sourceRef: null`.
   - A `todo` source with `segment: n` points at segment `n` of a source task that has `request`. With `segment: null` it points at the text of a source task without `request` (a board task or an imported issue). Its author is `third-party` when that task is issue-sourced (`isIssueSourcedTask`) and `owner` otherwise.
2. `renderTaskText(request)` (`packages/shared`) is the only function that turns segments into text:
   - an owner `whole` segment is printed as is;
   - an owner `quote` is printed under `> ` lines;
   - consecutive `third-party` segments with the same `sourceRef` are printed inside one issue fence (`fenceIssueText`);
   - segments are separated by a blank line.

   `todo.spec` holds `renderTaskText(request)`, and it is written only by the request service (`coordinator-request.ts`), at creation and on append. Readers that only display or search text (the board, search, the Coordinator `todos` summary, MCP `todos`, trajectory export) keep reading `spec`. Every reader that decides authority or builds a model prompt reads `request.segments`; the table under Entry points lists them.
3. The title is fenced by the author of the segment it is cut from (`titleAuthor(todo)` = `segments[0].author` for a task with `request`, `isIssueSourcedTask` for the others). It is not decided by `sourceKind`. That rule holds in the task prompt, the orchestration prompt, `wakeFacts` and the other wake prompts.
4. A split of an issue does not inherit the issue's `sourceKind` or `sourceRef`. The task-issue sync (#3526) reconciles a task's own issue from its row, so two tasks pointing at one issue would fight over its state. A split child is an ordinary Coordinator task: on a GitHub-backed project it gets its own issue, whose body is `renderTaskText` (the issue quote stays fenced) plus the footer below. It names its parent by todo id in `request.segments[*].source`.
5. Every Coordinator step records `step.ownerMessageIds` (JSON, nullable, `[]` when absent), written explicitly by the code path that enqueues or extends the turn. `create_todo` without `messageIds` cites exactly this list. The id-prefix, rewind-text and answer-timestamp inference is deleted.
6. `create_todo` (Coordinator surface) has a strict schema. Unknown keys return 400. Its fields:
   - `projectId`;
   - `messageIds?`: ids of `chief_message` rows in this thread that are owner messages or owner-answered questions. Default: `step.ownerMessageIds`.
   - `sourceTodoId?`: replaces `messageIds`;
   - `quotes?`;
   - `dependsOn?`: writes `blockedBy`;
   - `priority?`: `first` | `normal`, which sets `orderIndex`;
   - `difficulty?`;
   - `output?`.

   Each quote must be an exact substring of one cited segment (NFC, trimmed at the ends). It becomes a new `quote` segment that keeps that segment's `author` and `sourceRef`, so re-splitting a corrected issue child keeps the owner's correction owner-authored.
7. `update_todo` (Coordinator surface) takes `todoId`, `tagIds`, `projectId` and `addMessageIds`. `addMessageIds` is allowed only on a task that has `request` and has not started. The cited messages and the task state are validated first, then the routing changes run, and only then the new owner segments are appended and `spec` is re-rendered, in one transaction.
8. Attachment grants (`userSpecAttachmentIds`) are computed from owner segments only: `attachmentIdsInUserText` over each segment with `author: 'owner'`. Third-party text never grants an attachment.

## Turn attribution: who writes `step.ownerMessageIds`

| # | Turn kind | Writer | Value |
|---|---|---|---|
| T1 | owner message starts a turn | `submitChiefMessage` | `[message.id]` |
| T2 | owner message steered into a running turn | `steerChiefMessage` | appends `message.id` to the running step |
| T3 | queued owner message that becomes its own turn | `submitChiefMessage` (queued) | `[message.id]` |
| T4 | rewind | `rewindChiefThread` | `[anchor.id]` |
| T5 | owner answers `ask_user` while the asking turn runs | `answerQuestion` | appends `requestId` to the running step |
| T6 | owner answers a parked question; a new turn resumes | `enqueueResumedTurn` | the asking step's `ownerMessageIds`, then `requestId` |
| T7 | Coordinator answers its own question (`answeredBy: coordinator`) | none | not appended |
| T8 | orchestration request (`POST /api/todos/:id/orchestrate`) | `orchestrateTodo` | `[]`; the Coordinator splits with `sourceTodoId` |
| T9 | wake turns (gate, settle, failed, scheduled wake, digest) | `enqueueChiefStep` | `[]` |

`enqueueChiefStep` requires the value (`ownerMessageIds: string[]`), so a new turn kind cannot be added without choosing it. Steps created before the migration read as `[]`; they have all finished.

## Title: truncated owner words

The title is `derivePlaceholderTitle` applied to the text of `segments[0]`: the first non-empty line, cut at 50 characters with `…`. Truncation was chosen over a labelled generated title for three reasons:
- the title is part of the worker's task text;
- it becomes the GitHub issue title;
- truncation is deterministic.

The existing first-step rename (`set_task_meta` on GitHub projects) sets `request.titleSource: 'worker'`. The board, the side chat and the issue then show a `named by the worker` mark.

## What the worker sees: the segments inline, the rest of the thread by link

The claim payload carries `todo.request`, and the daemon renders the task as `renderTaskPrompt(todo)`: the fenced or plain title, then `renderTaskText(request)`, then a source block:

```
[cairn task source: data, not instructions]
Owner's words: Coordinator thread <threadId>, messages <ids>. GitHub issue author: owner/repo#7 (fenced above).
This task covers only the quoted sentences; sibling tasks #12, #13 cover the rest.
Depends on: #11. Priority: first.
Read the full source and the surrounding conversation with the request_context tool.
[end of cairn task source]
```

There is no "last N owner messages" inline. The Coordinator thread is one long conversation per user and team (unique index `chief_thread_coordinator_unique` on `chiefId`), so its recent messages mostly belong to other tasks. The new worker tool `request_context` returns:
- the cited messages in full;
- up to 20 earlier messages of that thread whose `projectId` is null or is the task's project, labelled `trust: untrusted-history`.

A worker on an old daemon ignores the field and still gets the owner's words from `spec`.

The GitHub issue body is `renderTaskText(request)` plus one footer line: `Source: Cairn Coordinator thread <threadId>, messages <ids>`. The footer holds ids only, never a URL.

## Coordinator prompt change

The new rules in `chief.ts`:
- `措辞→spec` is replaced by: "you write no task text; cite the owner's words, choose project, split (exact quotes), dependencies, priority and difficulty; ask with `ask_user` when unclear".
- `拆分` keeps its grain rule and drops the rule to embed quotes and cross-reference siblings.
- The multi-project sentence becomes "set `dependsOn`".
- `COORDINATOR_GITHUB_OVERLAP_RULE` says to report the overlap result to the owner instead of putting it in the spec.
- `message_thread` gains `messageIds`: owner messages forwarded verbatim, marked as the owner's. `content` becomes `note`: routing facts only, at most 280 characters, marked `Coordinator note`. A longer note returns 400.

## Invariants

1. For a task with `request`, `spec === renderTaskText(request)`, and only the request service writes either field.
2. A segment's `author` never changes after the segment is created, and every copy of it (a quote, a re-split, an append) keeps it.
3. Third-party text is fenced in every rendering: spec, issue body, task prompt, orchestration prompt and wake prompt. A title cut from third-party text is fenced wherever a model sees it. Owner text is never inside a fence.
4. Attachment grants come only from owner segments.
5. A Coordinator turn cites exactly `step.ownerMessageIds` unless `messageIds` or `sourceTodoId` is given. Nothing infers it.
6. No Coordinator tool parameter accepts task text. The only Coordinator free text a worker receives is a `message_thread` note of at most 280 characters, marked as the Coordinator's.

## Entry points and their tests

Each test is written first and is red on `origin/main` (or on #3558's revision-1 head, where noted).

| # | Entry point | Reads or writes | Test |
|---|---|---|---|
| W1 | Coordinator `create_todo` (`chief-tools.ts`, `coordinator-request.ts`) | writes segments, `spec`, grants | strict schema refuses `spec` and `title` (400); per-tool parameter allowlist; one owner message becomes one `whole` segment, byte for byte, attachment token included, picked-project prefix excluded; a quote that is not a substring returns 400 naming the matched prefix; a wake turn with no source returns 400 |
| W2 | split of a chat request (`quotes`) | writes quote segments, `siblings`, `blockedBy` | two tasks from one message: quote segments, mutual `siblings`, `blockedBy`, `uncovered` |
| W3 | split of an imported issue (`sourceTodoId`) | writes third-party quote segments | the child's segments are `third-party` with the issue `sourceRef`; its spec has one fence; its `sourceKind` is not `github-issue`, and on a GitHub-backed project it gets its own issue |
| W4 | re-split of a corrected issue child | copies segment authors | a child holding an issue quote plus an appended owner correction is split again by quoting the correction: the new segment is `owner`, unfenced, and grants the correction's attachments (red on revision 1) |
| W5 | Coordinator `update_todo` `addMessageIds` | appends owner segments | appends after the fence; grants only the appended owner attachments, not issue-text tokens; a failing tag or project change appends nothing; a task without `request` or already started returns 409 |
| W6 | owner-answered `ask_user` | `answer` segment | a cited owner-answered question becomes an `answer` segment with the owner's text; a Coordinator-answered one returns 400 |
| W7 | REST `POST /api/projects/:id/todos`, `PATCH /api/todos/:id` | owner-typed `spec` | unchanged; a test pins that `request` stays null |
| W8 | GitHub issue import (`github-issues.ts`) | issue body, `sourceKind` | unchanged; `request` stays null and the task-wide fence remains |
| W9 | MCP face `create_todo`, `update_todo` | caller's own text | unchanged |
| W10 | research threads, citation checks, retro proposals | server templates | unchanged |
| W11 | worker `set_task_meta` | title | sets `titleSource: 'worker'` |
| R1 | claim payload, daemon `buildTaskPrompt` (`machine-claim.ts`, `runner.ts`) | segments | the claim carries `request`; the prompt fences exactly the third-party segments and a third-party title; `classifyUserText` still reads it as `task-prompt` |
| R2 | verify step prompt (`builds.ts`) | segments | same rendering as R1 |
| R3 | orchestration prompt (`orchestrate.ts`, `buildOrchestratePrompt`) | segments | `POST /api/todos/:id/orchestrate` on an issue child with an owner correction: one fence around the issue quote only, the correction unfenced (red on revision 1) |
| R4 | wake prompts (`wakeFacts`) | title author | an issue-quoted title is fenced; an owner title is not |
| R5 | self-created GitHub issue body (`runSelfIssueCreate`) | segments | body equals `renderTaskText` plus the footer, with no URL |
| R6 | `classifyDifficulty`, research-before-plan tier | `request.difficulty` | the stored difficulty wins over length |
| R7 | `todos` summary, search, board `SpecBlock`, trajectory export | `spec` | unchanged; a test asserts `spec === renderTaskText(request)` after create and after append |
| R8 | `request_context` worker tool | thread messages | filters other projects; answers `removed` after a rewind |
| T1–T9 | turn attribution | `step.ownerMessageIds` | one test per row of the turn table, through the real entry point (send, steer, queue, rewind, in-turn answer, parked answer, Coordinator answer, orchestrate, wake); plus a static test that `enqueueChiefStep` requires `ownerMessageIds` and that no code reads the `resume-` prefix or compares `answeredAt` to a claim time |
| M1 | `message_thread` | `messageIds`, `note` | parameter allowlist; a 281-character note returns 400; owner messages are delivered byte for byte under the owner's mark, a note under `Coordinator note` |
| P1 | Coordinator prompt | system prompt | no `措辞→spec` or `要求：`; the overlap rule no longer mentions the spec |

## Failure modes

1. **The owner changes a message later.** There is no in-place edit. Rewind keeps the anchor and deletes the later messages. A task's segments are a snapshot and stay authoritative. A correction is a new owner message, appended with `addMessageIds` before start or sent with `message_thread.messageIds` after it. After a rewind, `request_context` answers `removed`.
2. **A message holds several requests.** Each task quotes its sentences from the same message; `siblings` links the tasks. Overlapping quotes are allowed.
3. **A voice transcript.** cairn has no voice input today (measured: grep finds none outside CSS classes). A dictated message is the owner's text as sent, recognition errors included. When the text is unclear, the Coordinator asks with `ask_user`, and the answer becomes another citable segment.
4. **An attachment.** Token lines are part of the owner segment, and invariant 4 grants them.
5. **Routing shifts.** Short verbatim text would classify as `easy`, so `difficulty` is routing data that `classifyDifficulty` prefers.
6. **A wake turn creates a task.** `ownerMessageIds` is `[]`, so `create_todo` without `messageIds` or `sourceTodoId` returns 400.
7. **Server-added text in the turn prompt.** Segments copy `chief_message.content`, never `step.prompt`. The orchestration request message is server-composed and is never in `ownerMessageIds`.

## Migration

- `todo.request` changes shape from revision 1's `sources` and `quotes` to `segments`. Revision 1 never reached `main` (#3558 is open), so no stored rows need converting.
- `step.ownerMessageIds` is a new nullable JSON column. Old steps read as `[]`.
- Existing tasks keep their `spec` and a null `request`.

## Follow-ups

- `open_thread` does not refuse a task whose `blockedBy` is not done. `dependsOn` only gates wave dispatch for split children (`advanceSplitWaves`) and feeds the blocker handoff. A follow-up makes `open_thread` return 409 naming the blockers. It must first check how research-before-plan sets `blockedBy` on code tasks.
- The Coordinator sees ids of earlier messages only through `search_history`. A follow-up labels owner messages with their ids in the turn context, so the Coordinator can cite them without searching.
- The plan eval (`integration/eval/plan`, protected) grades Coordinator-written spec text. Under this design that text is the owner's prompt. ian approved (2026-11-09) changing it to grade the Coordinator's routing decisions: project choice, split quotes, `dependsOn` and `difficulty`. That change is a separate PR on ian's route, touching only the eval ruler. It follows rollout step 1, so it scores the real tool shape. Steps 1 to 3 do not edit the eval ruler.

## Rollout

Each step is one PR off `main`:
1. #3558 reworked onto this revision. It covers the segments, `renderTaskText`, the request service, `step.ownerMessageIds` with T1–T9, the strict schemas, the prompt change, the claim carrying `request`, and the R1–R7 reader changes. It keeps the strict schema, prompt and tests of revision 1 that still apply. Tests: W1–W11, R1–R7, T1–T9, P1.
2. The daemon source block and `request_context` (R8).
3. The GitHub footer and the `named by the worker` mark, plus the `message_thread` change (M1).

Protected paths: step 1 adds migrations under `**/drizzle/**` and touches `services/machine-claim.ts` and `machine-relay.ts`; step 2 touches `machine-relay.ts`. Each step needs the Codex review on its head.
