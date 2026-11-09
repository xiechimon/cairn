# Task stall root causes

Status: accepted (coordinator review on #3635, 2026-11-09; class 3 auto-start decided by the owner the same day). Builds on `answer-delivery-record.md` and `thread-owner-field.md`, both landed (#3545, #3527). Prior art: `docs/research/task-stall-root-causes-2026-11-09.md` (Linear, GitHub Actions, Temporal, Airflow, Buildkite) and `docs/research/orca-execution-model-2026-11-09.md` (Orca, Codex CLI, Claude Code, t3code; its section 5 recommendations R1 to R3 are the input for classes 3, 1 and 4, and 2, and each section below says where it follows or departs from them). Out of scope, fixed elsewhere: the dirty `AGENTS.md` zero-change commit failure (#3615) and deploy starvation (#3624). Also out of scope: Orca R4 (long-lane hosting) and R6 (park a failure that repeats the same cause), which are separate changes.

Evidence is the 2026-11-09 stuck sweep of the live `server.db`, read-only. Every open task has since been archived by the owner, so the cases below are history (`todo`, `build`, `step`, `message` and `chief_message` rows).

One rule runs through all four classes: a task that is not running is either waiting on a named actor, who gets woken, or waiting on a structural condition that the scheduler re-checks. No wait lives only in prose: not in the Coordinator's memory, not in a worker's report line, not in a notice.

Implementation order is the section order. Each class is one PR of under 400 lines, written red-first: every row in an entry-point table gets one test that fails on current `main`.

## Class 3: a todo whose blockers are done, or that has none, never starts

### Evidence

- #140, #141, #149 and #150 were moved back to `todo` by `reopen_todos` at 2026-11-08 17:53:08. In the same turn the Coordinator opened a thread on #148 only and wrote that it would dispatch the rest in order, at most 3 at a time. #158 to #161 were created by `create_todo` at 18:40:44, and the Coordinator said it would dispatch them as slots freed. None of the eight ever got a build. They sat in `todo` for 12 to 13 hours until the owner archived them.
- The Coordinator cannot record an order. `create_todo` and `update_todo` take no `blockedBy`. Only `holdCodeThreadForPriorResearch` writes `todo.blockedBy`.
- "When a slot frees up" depended on a watch wake. `triggerChiefWakes` wakes only on `done`, and a watched task that reached `review` with no owner never woke anyone (class 1). The queue the Coordinator kept in its head had no way to advance.
- Concurrency is already enforced at claim: `machine.maxConcurrent` and `project.maxConcurrent` in `machine-claim.ts`. The Coordinator's own "at most 3" duplicated that limit outside the system.

### Design

Prior art: GitHub `needs`, Airflow trigger rules and Buildkite `depends_on` all record the dependency on the downstream unit, park it in a named waiting state, and let the scheduler start it.

1. `create_todo` starts the thread. A todo the Coordinator creates goes straight to `queued` through `startBuilds`, so a Coordinator-created todo can never sit in `todo`. `reopen_todos` also starts a new build instead of landing in `todo`. `open_thread` stays only for todos the person created.
2. `create_todo` and `update_todo` accept `blockedBy: todoId[]`, validated as same-team todos with no cycle.
3. A blocked task is held by one rule. While any blocker is unsatisfied, every pending `plan` or `session` step of the task carries `holdReason = 'blocked-by'`. Claim already skips held steps. A blocker is satisfied when it is `done`, or when it is an `info` task in `review` whose stored report matches `build.reportAttachmentId` (today's research rule, kept).
4. `releaseBlockedSteps(deps)` runs on every scheduler tick and after every phase write. It is the only function that clears `blocked-by`.
5. When a blocker reaches `failed` or `closed`, the dependent's step stays held, and `ownerOf` returns `coordinator` with the new reason `blocked` and work key `blocked:<blockerId>:<phase>`. The Coordinator wakes once and can retry the blocker, drop the edge with `update_todo`, or close the dependent. This is the counterpart of Airflow's `upstream_failed`, routed to the Coordinator instead of failing the task.
6. Parallelism is `project.maxConcurrent` only. The Coordinator prompt's dispatch guidance says to start everything and express order with `blockedBy`.

The owner decided rule 1 on 2026-11-09: Coordinator-created todos start automatically, without his confirmation.

This follows Orca R1's root fix, which folds create and open into one call. It does not add R1's level-triggered `runTick` sweep over unstarted todos, for two reasons. First, the sweep cannot tell a todo the Coordinator forgot from one that was deliberately stopped back to `todo`: #139's first build was cancelled during the 11-08 freeze, and a sweep would have restarted it. Second, with create and reopen starting the build themselves, the forgotten case no longer exists, so the sweep would be a second starter for a state that cannot be reached. The level re-check Orca relies on lives in rule 4, which re-evaluates every held task on every tick.

### Deletes

- `RESEARCH_BEFORE_PLAN_HOLD` and `releaseResearchBeforePlanHolds`. Research-before-plan writes `blockedBy`, and the lesson injection moves into `releaseBlockedSteps`.
- `splitBlockersSatisfied`, `advanceSplitWaves` and `dispatchSplitChildren`, along with their five call sites (`routes-todos.ts`, `chief-tools.ts` `complete_todos`, and `builds.ts` confirm, landing and phase end). Split children all start at confirm and are held by their `blockedBy`.

### Entry points

| # | Path | Today | After |
|---|---|---|---|
| 1 | `create_todo` (Coordinator) | `todo`; needs `open_thread` | `queued`; held if blocked (auto-start, owner decision 2026-11-09) |
| 2 | `reopen_todos` | back to `todo` | new build, `queued` |
| 3 | `update_todo` with `blockedBy` | n/a | writes the edge; next release pass re-evaluates |
| 4 | `startBuilds` / `enqueueStep` for a blocked task (continuation, rework, wakes) | not held | held at insert |
| 5 | Blocker reaches `done` | split children only | `releaseBlockedSteps` |
| 6 | Info blocker reaches `review` with report | research holds only | released |
| 7 | Blocker `failed` / `closed` | research hold released, others silent | dependent stays held; Coordinator-owned `blocked` |
| 8 | Split confirm | dispatches satisfied children | starts all children, held ones wait |
| 9 | Research-before-plan | private hold | writes `blockedBy`, rule 3 |
| 10 | Person-created todo, never started | `todo` | unchanged: the person starts it |

Migration: rewrite `holdReason = 'research-before-plan'` rows to `blocked-by`.

## Class 1: a no-PR research or read-only task finishes into review with no owner

### Evidence

- Research #137 (blocker of #136) reached `review` with a stored report at 2026-11-08 11:49 and stayed until the owner marked it done at 2026-11-09 07:14, 19.4 hours later. Research #142 (blocker of #139) waited from 12:11 to 07:14. Research #154 (blocker of #148) waited from 17:55. Code task #126 finished its last session with "no PR opened" and stayed in `review`. Each of these has zero Coordinator wake steps (`provenance=watch:<id>`) and only a thread-report row.
- Cause: in `reviewOwnership` (`owner.ts`), under the default `autonomous` policy (both projects have `autonomy = NULL`), an `info` review returns `null`. A code review with no PR has no PR gate and no blockers, so it also returns `null`. `triggerChiefWakes` posts a report line on `review` but no wake. Both the Coordinator and the owner have nothing to do.
- The system already contradicts itself. `wakeFactText('gate')` tells the Coordinator that accepting a research report is its job, and `complete_todos` is refused unless `coordinatorAcceptsReview`, which is never true under `autonomous`.

### Design

`ownerOf` returns `null` for a review only while the system itself is moving it: a PR whose gate has not evaluated since the review began, a transient gate blocker, or a ready gate on the merge queue or autonomous local merge. Every other review has an owner:

| Review of | `human` policy | `autonomous` policy |
|---|---|---|
| `info` | coordinator (unchanged) | coordinator (was `null`) |
| code, GitHub project, no PR or no changes | owner (unchanged) | coordinator (was `null`) |
| code with PR | unchanged | unchanged |
| code, local repository | unchanged | unchanged (autonomous local merge) |

`coordinatorAcceptsReview` then holds for these reviews, so `complete_todos` accepts them, and `message_thread` reworks them.

This is Orca R2(a), widened to no-PR code reviews. It leaves out R2(a)'s auto-accept timeout: accepting a report nobody read would end the wait silently, which is the defect being fixed. A review the Coordinator does not act on goes to the owner through the class 4 handoff instead.

### Deletes

- The `info review, autonomous -> null` row and the implicit "no PR and autonomous means nobody" path in `reviewOwnership`.
- The separate gate-wake copy split: a single `review` wake text names the deliverable (report or branch) and the three actions (accept, rework, close).

### Entry points

`reviewOwnership` (the only change), `reconcileOwners` (wakes on the new owner), `complete_todos` (`coordinatorAcceptsReview`), `listNeedsYou` and the `needs_you` tool (read `owner`), and the class 3 release (an accepted info or code blocker releases its dependents).

## Class 2: a worker's ruling or missing prerequisite appears only in the report line

### Evidence

- #126 ended with "fixed, pushed the original branch; no PR, remote CI unverified" and went to `review`.
- #146 ended with "missing signed-in reference access; registry integration awaits #3447". It did ask, but the question was cancelled when `reopen_todos` moved the task to `todo` (class 3).
- #162 ended with "chose to wait to avoid a competing implementation; this card is not fixed".
- #155 ended with "merge into main blocked; the Android work is unfinished".

In every case the worker's statement that the task was not delivered lived only in `build.reportLine`, which the system displays but never reads.

- Cause: `completeStep` sends a code build step with no GitHub PR straight to `review` (`if (!deliveredGithubPr)`). The only structural catch is `askAboutZeroChangeOnce`, and it fires only when the step committed nothing. A step that committed but delivered no PR, or that gave up, needs no answer from anyone.

### Design

There is one notion, an undelivered step: a build step of a `code` task on a GitHub-bound project that ends with no pending question and either no commits or no PR on the build. An undelivered step asks one synthetic question per build, `no-deliverable-<buildId>`, written with `writeWorkerQuestion`. The question quotes the worker's report line and last message, and asks what is missing and who should supply it. From there the existing path takes over: `needs_input`, Coordinator-owned through the question, a wake carrying the request id, `answer_question` or `ask_user`, and the answer delivered on the same build by the delivery record.

If the same build ends undelivered again after that question is answered, it goes to `review`, which class 1 makes Coordinator-owned.

Orca R3 instead proposes a required `status` on `thread_report` (`done`, `blocked` or `needs_ruling`) that creates the question, plus the same server-side check for reports that are free text only. This design keeps only the server-side check. `ask_user` is already the typed channel a worker uses to say what it needs. A status enum would be a second channel for the same thing, and the server-side check is needed anyway for workers that use neither. That matches Orca's own model: the turn-stop kind (`finished`, `errored`, `needs-input`, `exited`) is derived by the runtime, not declared by the worker.

### Deletes

- `endedWithoutChanges` and `askAboutZeroChangeOnce`, replaced by `endedUndelivered` and `askUndeliveredOnce`.
- The direct `!deliveredGithubPr -> review` transition for the first undelivered end.
- `SESSION_BRIEF` wording that offers "give up" as a way to finish. `thread_report` stays a display line.

### Entry points

| # | Path | After |
|---|---|---|
| 1 | Session ends, no commits | question (as today, new request id) |
| 2 | Session ends, commits, no PR | question (was `review`) |
| 3 | Session ends with a pending `ask_user` | unchanged `needs_input` |
| 4 | Second undelivered end on the same build | `review`, Coordinator-owned |
| 5 | Info task without report | unchanged gate failure |
| 6 | Local-repository project | unchanged `review` (local merge is the deliverable) |
| 7 | Phase change cancels pending questions (`reopen_todos`, close) | unchanged; class 3 keeps reopen from landing in `todo` |

Migration: none. Answered `no-change-*` questions stay answered.

## Class 4: a failed task handed to the Coordinator gets no action

### Evidence

- #148 failed with zero changes at 17:58. #165 hit the review round cap at 07:29 and failed a commit at 08:44. #156 hit the review round cap at 09:00. Each got exactly one `[wake:failed]` Coordinator turn. In each turn the Coordinator called `machines` and then `notify_user` and ended. The task stayed `failed`, Coordinator-owned, with the checkpoint already at that work key, so no second wake came and nothing reached the owner's inbox. A notice is not an inbox item.
- Cause: the failed-wake prompt ends "otherwise send no message", so a turn that only diagnoses counts as handled. Nothing checks whether the Coordinator actually acted on what it owns.

### Design

Prior art: GitHub environment approvals, Airflow `response_timeout` and the Temporal HITL timeout all end an unanswered wait at a defined time with a defined outcome.

1. When the reconciler enqueues a Coordinator wake, it stores `todo.coordinatorTurn = {stepId, workKey}`. `reconcileRow` is the only writer.
2. `ownerOf` hands the task over. If the computed ownership is `coordinator`, `coordinatorTurn.workKey` equals the current work key, and that wake step has ended (done, failed or stopped) or is still not finished 30 minutes after creation, the owner becomes `owner` with the reason `handoff`. The work key stays the same, so the reconciler diffs `coordinator -> owner` and sends exactly one owner notification and push. Any action by the Coordinator (retry, answer, accept, close, a new `blockedBy`) changes the work key, so no handoff fires.
3. `NEEDS_YOU_REASONS` gains `handoff`. The web and `/api/needs-you` show the Coordinator's last notice for that task as the row copy.
4. The `failed` wake text lists the actions that settle a failure (`message_thread` retry, `close_todos`, `update_todo` with `blockedBy` and a restart) and says that a turn ending without one hands the task to the owner.

The same rule covers the class 1 review wake, the class 2 question wake and the class 3 `blocked` wake, so no Coordinator-owned state can end in silence.

Orca R2(b) re-fires the wake once, with the previous turn's last message, before escalating. This design hands over on the first no-op turn instead. The wake already carried every fact, and #148, #156 and #165 each show the turn diagnosing correctly and then stopping. A second identical turn adds hours of delay and no information. R2(c), "a wake turn must end in a recorded action", is rule 4's wake text, backed by the structural handoff in rule 2.

### Deletes

- The "otherwise send no message" exit in `wakeFactText('failed')`.
- `notify_user` as a way to hand a task to the owner. It stays as an informational notice; the handoff is structural.

### Entry points

`reconcileRow` (writes `coordinatorTurn`), `enqueueOwnershipWake` and `enqueueGateWake` (return the step id), `ownershipOf` (reads it), Coordinator step terminal paths (`finishChiefTurn`, `sweepAbandonedChiefSteps`, stop) triggering `reconcileOwners` for the task, the scheduler sweep (catches the 30-minute deadline), and `listNeedsYou` and the web selectors (read `handoff`).

Migration: add a nullable `coordinatorTurn` JSON column. Existing rows read as no turn and keep today's behavior until their next wake.

## Decisions taken here (revertible)

| Decision | By | Date |
|---|---|---|
| Coordinator-created todos start automatically, without owner confirmation (class 3 rule 1) | owner | 2026-11-09 |
| The design as a whole, including the departures from Orca R1 to R3 | coordinator | 2026-11-09 |

- Coordinator-created todos always start. There is no draft switch, because no recorded case needed a Coordinator-created backlog item. Revert: add the switch back on `create_todo`.
- A failed or closed blocker routes to the Coordinator instead of failing the dependent. Research-before-plan no longer proceeds silently when its research fails.
- The 30-minute Coordinator turn deadline is one constant in `owner.ts`.
