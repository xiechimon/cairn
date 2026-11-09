# Why Coordinator tasks stop midway, and the flow that keeps them moving (2026-11-08)

Question from the owner: why do tasks stop midway, and how should the whole flow work?

Scope: a diagnosis of every stall class seen in the live database today, traced through `origin/main` at `f704c5939`, followed by prior art and one recommended flow. It changes no code.

Labels: **Measured** = read or run first-hand in this session (code on `origin/main`, rows from the live server database opened read-only, daemon log lines). **Inferred** = derived from Measured and checkable. **Guess** = everything else.

Prior art lives in the companion file [`task-stall-flow-2026-11-08-priorart.md`](task-stall-flow-2026-11-08-priorart.md). It has one row per source with links: Codex CLI and cloud, Devin, Copilot coding agent, OpenHands, Cursor cloud agents, Sweep (blocked), Temporal, Claude Code CLI/SDK and cloud/Desktop, the Anthropic API, Amp, t3code and pi-durable.

## 1. How a task moves today

Facts first, all Measured on `origin/main`:

- **A work step ends.** The daemon reports the step outcome. `completeStep` (`apps/server/src/services/builds.ts:2834`) decides the phase:
  - an `info` card goes to `review` (`:2950-2962`);
  - a code step with no GitHub PR goes to `review` (`:2968-2973`);
  - a code step with a PR stays `building` while the PR is watched, and the independent review is queued (`:2975-2981`).

  A step that *failed* goes through `applyStepFailure` and lands in `failed`.
- **"review" without a PR** therefore means "the step ended and no PR exists". It does not distinguish a finished research report, a code change that never pushed, a step that asked a question and ended its turn, or a step that did nothing.
- **A worker asks a question.** `askWorkerQuestion` (`apps/server/src/services/worker-questions.ts:115`):
  1. stores the question;
  2. sets `todo.awaitingReply = true`;
  3. posts a `needs-you` thread report to the Coordinator thread and pushes a notification (`:97-111`).

  After `ASK_PARK_MS` = 70 s (`chief-questions.ts:32-34`) it parks the question. The worker is told to end its turn (`WORKER_ASK_PARKED_REASON`, `:28`). The step then finishes `done` and the todo goes to `review` with `awaitingReply` still set.
- **An answer resumes the task** only through `messageThreadAsUser` (`apps/server/src/services/thread-message.ts:170`). The Coordinator reaches it with the `message_thread` tool, and a person reaches it by typing in the task thread. Delivery depends on the phase (`:86-133`):
  - `building`/`done` → steer the running step or start a new turn;
  - `review`/`confirm` → a `revision` on the same session;
  - `failed` → `restart`, which creates a **new build and a fresh session** from the original spec plus the message.

  Pending question ids are answered with the message text (`:192-194`).
- **Nothing routes a Coordinator-thread message to a task by itself.** `submitChiefMessage` (`chief.ts:647`) stores the message and enqueues one Coordinator turn. Any effect on existing todos depends on that turn's model calling `message_thread`, with no structured link. The Coordinator system prompt tells it to relay answers verbatim and *not* decide for the user (`chief.ts:1310-1311`).
- **What wakes the Coordinator.** `CHIEF_WAKE_KINDS = ['gate','settle','failed']` (`packages/shared/src/records/chief.ts:227`). `triggerChiefWakes` (`chief.ts:1069`) wakes only for **watched** todos, and only on a phase change to `review`/`confirm`/`done`/`failed`. The watch is removed after `settle` or `failed` (`:1113-1115`). A worker question is not a wake kind. The `review` wake text says "parked at the review gate, waiting for a person; do not release it yourself" (seen in today's `[wake:gate]` prompts).
- **Who can cancel:**
  - the Coordinator, with `stop_thread` (`chief-router-tools.ts:117-127`) or `cancel_builds` (`chief-tools.ts:705-709`);
  - the MCP face, with `cancel_builds` (`mcp-face.ts:262-266`);
  - the web UI, through `POST /api/builds/:id/stop` and `POST /api/todos/:id/stop-and-done`;
  - archive and exit sweeps (`stopActiveStepsForArchive`, `stopActiveStepsAfterExit`).

  `cancelBuild(deps, buildId)` (`builds.ts:767`) takes no actor and no reason. The only trace is `build.errorMessage = '已取消'` ("cancelled") (`STOP_MESSAGE`, `builds.ts:712/748/827`).
- **How the commit error is captured.** `workspace.commitAll` runs `git add -A` and then `git commit` (`apps/daemon/src/workspace.ts:337-349`). `gitPrim.commit` (`apps/daemon/src/git.ts:510-518`) spawns git with `timeout: META_TIMEOUT_MS` = 30 000 ms (`:221`). It throws `git commit failed (${r.code}): …`, and `r.signal` is dropped. A git killed by the spawn timeout has `code = null` and `signal = SIGTERM`, so the message reads `(null)` with no word "timeout". `runGitOk` (`:51-60`) does print the signal; `commit` does not.

## 2. Stall classes, with evidence

| # | Stall class | Live rows (Measured) | Root cause | By design or failure |
|---|---|---|---|---|
| S1 | **Asked a question; the answer never reached the parked task** | #133 build 3: asked at 08:15:28, parked, step `done` at 08:16:49 → `review`, `awaitingReply=1`. #136 the same at 08:08:37. Coordinator message at 08:22:07 ("Explicit confirmations … Re-run each task now … Do not ask again") has **no Coordinator turn after it**: no assistant rows, no `chief_turn_usage` row, and its queued step row no longer exists. | Two defects stack. (a) The 08:22:07 message was steered into the running turn `h3WHvnk…`, which was already ending. Daemon log at 08:22:06: `steer dropped (no live session)`. The turn settled at 08:22:09 with 278 output tokens and no further rows. The only code paths that delete a queued Coordinator step are withdraw and `ackChiefSteer` (`chief-turns.ts:204, 314`), so the steer was acked into a turn that never answered it (Inferred). The steer poll swallows errors with `.catch(() => {})` (`coordinator/runtime/turn.ts:145-168`). (b) Even when a turn runs, nothing links "answer in the Coordinator thread" to "parked question on #133". It depends on the model choosing `message_thread`. | **By design** for the ask itself: both agents correctly asked. Delivery is a **failure**: the message was lost in the steer race, and no wake or link exists. |
| S2 | **Answered, then restarted from scratch and asked the same question again** | #133: the 08:10:59 answer resumed build 2 in the same session (worked). That build then failed on commit. At 08:12:03 the Coordinator's `message_thread` on the `failed` task created build 3 (`restart`): a fresh session whose first user row is the original spec, which still says "copy byte-for-byte". Build 3 hit the same conflict and asked again at 08:15:28. | `restart` from `failed` opens a new build from `todo.spec` (`thread-message.ts:118-126`). Answers live in the old build's transcript and question rows, never in the spec or in a durable "rulings" record, so a restart forgets them. | **Failure** (lost context). |
| S3 | **Brief conflicts with a repo rule, and the Coordinator is told not to decide** | #133 (copy byte-for-byte vs the banned-string and public-content rules), #136 (copy unchanged vs English-only), #146 (missing signed-in reference access). Their report lines say "awaiting confirmation", "need explicit exception", "paused as the task requires, asking for a ruling" (originally Chinese). | The dispatch briefs contained instructions that the repo rules forbid. The Coordinator prompt says to relay, not decide (`chief.ts:1310-1311`). Its `gate` wake says not to release. No rule table says "repo rule beats brief". | **By design** (it asked) but **avoidable**: the precedence rule exists in the repo (CLAUDE.md and the public-content gates), so the conflict can be resolved by rule. |
| S4 | **Coordinator promised to resume later; nothing remembers it** | 08:10:29 unblock listed five tasks "at most 3 in flight". At 08:11:19 the Coordinator resumed three and wrote "The rest stay queued … it will resume in its listed slot". No row records that queue. #136 and #146 were never resumed. | The Coordinator has no durable "pending resumes" queue. Wakes are per watched todo, and watches are removed on `failed`/`settle` (`chief.ts:1113-1115`). Build 3 of #133 had no watch, so its 08:16:54 move to `review` produced only a passive thread-report row and **no wake** (no Coordinator step at 08:16). | **Failure** (a promise with no mechanism). |
| S5 | **"building" with no step for hours** | #131: session step `done` at 06:56:00; next step at 08:24:23, a `[ci-fix]` round from `github`. Phase stayed `building` for 88 minutes with no active step, and #130 likewise. Both have PRs (#3440, #3422). | With a PR, `completeStep` keeps the phase `building` and waits for CI/review polling (`builds.ts:2975-2981`). The PR wait has no state of its own and no visible reason. | **By design** (waiting on CI), but **invisible**: it looks identical to a hung task. |
| S6 | **Commit failed with `(null)` right after the hook passed** | #145, daemon log 08:20:23: `step failed: git commit failed (null): … Checked 2089 files … ✅ pre-commit checks passed`. | `git commit` runs the pre-commit hook (`biome ci`, then `pnpm -r typecheck` when TS is staged, then `spec:parse`; `.husky/pre-commit`) inside a 30 s spawn timeout. When the total passes 30 s, Node kills git with SIGTERM after the hook has printed success: `code=null`, and the signal is not reported (Inferred from `git.ts:221, 510-518`; the hook alone took most of the budget). | **Failure** (a product bug in the error path, plus a timeout below the real hook cost). |
| S7 | **Commit rejected for a lockfile the agent never touched** | #133 build 2, 08:11:52: `git commit failed (1): pnpm-lock.yaml is staged with external dependency changes` (`@pnpm/exe@12.5.1`). Its `git status` showed ` M pnpm-lock.yaml` after the setup/resume hook ran pnpm 12.5.1. | `commitAll` runs `git add -A` (`workspace.ts:339`), so drift written by the workspace setup hook is staged with the agent's work. The lockfile guard then rejects the whole commit. The injected `AGENTS.md` causes the same kind of drift: it blocked `git merge origin/main` in #133 and failed self-tests in #126 (report lines, Measured). | **Failure** (environment pollution, not the agent's work). |
| S8 | **Cancelled, and nobody knows who** | #139: build `errorMessage='已取消'` ("cancelled"), its one session step `stopped` with `claimCount=0` at 04:13:59, todo back to `todo`. The Coordinator transcript at 04:13:04 shows `stop_thread` on #139 (and two others) after the owner's priority message to finish another task before any other work. At 08:11:19 the Coordinator itself claimed "Confine is already open, not cancelled". | `cancelBuild` records no actor or reason (`builds.ts:767`). The Coordinator's own later turn cannot see that it stopped the task, and no resume is scheduled. | **By design** (a priority pause by the Coordinator) but **unattributed and never resumed**. |
| S9 | **Retry storm on `model_not_found`** | 2 639 builds with `triggerSource='chief'` failed with `404 … model_not_found` (model `glm-5.3-flash`), 2026-10-25 → 2026-11-08. 2 478 of them belong to two "Check research citations" todos (#111: 1 863, #113: 615), about one build per minute from 11-04 14:00 to 11-06 02:13. Today only 2 such builds (#135, #138). | `research-citations.ts:314` restarted the checker on every intake tick with no attempt cap and no terminal-error class. Fixed in `074956434` (#3083): `CITATION_MAX_ATTEMPTS = 3` (`:27, :258`) and `terminalCheckerFailure` parks on dead models (`:224`). The class remains: any automatic re-starter without a cap or terminal classification can do it again. | **Failure** (fixed for this caller only). The brief's "earlier today" is not what the rows show: the storm ran 11-04 to 11-06. |
| S10 | **Ops-only work fails as "zero changes"** | #151 08:14:18 `构建零改动` ("build made zero changes"): the ops fixes were host changes with no repo commit. | The code-output gate treats "no commit" as failure. A task whose deliverable is host state has no output kind for that. | **Failure of fit** (brief vs output kind). |

Side signals (Measured): `thread_report rejected: The operation was aborted due to timeout` twice in #133 build 3, and daemon `presence failed: Machine presence timed out after 20000ms` all morning. The server was slow under load, so tool calls that report state can be lost (Inferred).

## 3. What prior art does (summary of the companion file)

- **Waiting is its own state under "active", and approval differs from input**: Codex `WaitingOnUserInput`, Devin `waiting_for_user`, OpenHands `AWAITING_USER_INPUT`, t3code's `Awaiting Input` pill ranked above `Working`. cairn has a boolean `awaitingReply` hidden under `review`.
- **Answers are routed by request id**: Codex `Op::UserInputAnswer{id}`, t3code `runtime-request.respond{requestId}`, Claude Code `tool_deferred` and `--resume`, which re-fires the same tool call. Temporal's human-in-the-loop cookbook ignores a decision whose `request_id` is not the pending one. cairn has request ids on worker questions but routes answers by "next message on the thread".
- **Durable waits outlive the turn**: Temporal `wait_condition(timeout)`, Devin auto-resume on message, Claude cloud "answer when you come back". cairn's parked question is durable, but the resume needs a Coordinator decision.
- **Timeouts end in a defined outcome**: Codex `TimedOut`, the Temporal cookbook's timeout result, Devin `inactivity` suspension. Escalation to another person is written as workflow code (Temporal), not built in.
- **Cancellation records a reason, and only Temporal records who** (`identity` on `WorkflowExecutionCancelRequested`). OpenHands separates a user stop from a crash in history (`ERROR_ACTION_NOT_EXECUTED_STOPPED`).
- **Errors are a state change carrying the real error**: OpenHands `last_error`, Temporal `ActivityTaskFailed.failure`, pi `RunFailure.detail`.
- **Steering into a busy turn is an explicit mode with a defined idle outcome**: pi `whenBusy: steer | followUp | reject`; Cursor `409 agent_busy`; Copilot applies steering "after it finishes its current tool call". cairn uses `whenIdle: 'reject'` and swallows the rejection.

## 4. Recommended flow (one)

Model the stall points on Temporal's signal-plus-timeout pattern and Codex's request-id correlation:

```
running ──ask_user(requestId)──▶ needs_input{requestId, question, askedAt, deadline, owner}
   ▲                                   │
   │  answer(requestId) from: task thread │ Coordinator thread (structured) │ needs-you card
   └───────────── same build, same session (never restart) ◀──┘
                                       │ deadline passes
                                       ▼
                    escalate: Coordinator wake 'question' → resolve by rule, or notify the owner
                    (second deadline → notify the owner again with the default it will take)
```

1. **An explicit `needs_input` phase.** It replaces `review + awaitingReply`. `review` then means one thing: a deliverable (PR or info report) is waiting for acceptance. Add `waiting_ci` (or a visible `waitingOn: 'ci' | 'review'` field) for the S5 case, so "building with no step" cannot exist.
2. **The question goes to the owner as a wake.** Add `question` to `CHIEF_WAKE_KINDS`. It fires for every `needs_input` transition whether or not the todo is watched, and the wake carries the `requestId`. The needs-you card and the push stay as they are.
3. **Answers are routed by id, not by model choice.**
   - A new Coordinator tool `answer_question{todoId, requestId, answer}`, or the existing needs-you answer action, writes the answer row and resumes **the same build and session**. A `failed` task with a pending question is resumed, never restarted.
   - A Coordinator-thread message that names a task (`#133`, or a todo id) is matched server-side to that task's pending `requestId` before the turn runs. The turn's tool list then shows "pending question #133 r=… unanswered".
   - Steers into an ending turn become a new queued turn. `ackChiefSteer` must not delete the queued step until the turn has produced an entry after the steer.
4. **Rulings survive restarts.** An answer that resolves a brief conflict is appended to the todo as a `ruling` record, so `restart` and every new build include it. Its source is the requestId or the Coordinator message id.
5. **Rule-based conflict resolution.** A short precedence table runs before a question parks: repo rule > Coordinator brief > worker default, plus the owner's standing grants (lockfile only with an explicit per-task grant). The Coordinator prompt line "do not decide for the user" (`chief.ts:1310-1311`) becomes: answer by rule when the table covers the question, and route only design, payment, credential and intended-behavior questions to the owner. This matches the repo rule "ask the owner for payments, credentials, intended-behavior or design changes".
6. **Timeout escalates.** `needs_input` carries a `deadline` (default 30 min while the Coordinator is the owner). On expiry it raises a `question` wake to the Coordinator, then a push to the owner that names the default answer the Coordinator will apply after a second deadline. It never parks silently, and it never auto-approves anything on the ask-the-owner list.
7. **Step errors carry the real failure.** `gitPrim.commit` and every `runGit` caller report `code`, `signal`, `timedOut` and the last stderr lines. The hook-bearing commit gets its own timeout, sized from the measured hook cost, separate from the 30 s metadata budget. `commitAll` stages only the agent's paths: workspace setup drift (lockfile, injected `AGENTS.md`) is excluded and reported, never committed or blocking.
8. **Cancellation records who and why.** `cancelBuild` and the stop route take `{actor, reason}` and write them to the build (or to a `build_event` row). `stop_thread` requires a reason and records a `resumeAfter` (a todo id or a time). The Coordinator's `threads` and `needs_you` views show "stopped by Coordinator: priority #131", so its own later turn cannot claim "not cancelled".
9. **Every automatic re-starter has a cap and a terminal class.** Lift #3083's pattern (`CITATION_MAX_ATTEMPTS`, `terminalCheckerFailure`) into the shared start path, so `model_not_found` and similar errors park a task with `failed{terminal}` for any caller.

### Code areas

- Phases and records: `packages/shared/src/records/todo.ts`, `packages/shared/src/records/chief.ts` (`CHIEF_WAKE_KINDS`), `apps/server/src/db/schema.ts` (a migration from `awaitingReply` to the new phase; deadline and ruling columns or table).
- Ask, park and answer: `apps/server/src/services/worker-questions.ts`, `worker-question-store.ts`, `thread-message.ts`, `builds.ts` (`sendBuildSteer`, `continuationTodo`, `completeStep`, `dropQuestionOnPhaseChange`, `cancelBuild`).
- Coordinator: `apps/server/src/services/chief.ts` (`triggerChiefWakes`, `submitChiefMessage`, prompt lines 1310-1311), `chief-router-tools.ts` (`answer_question`, `stop_thread` reason), `packages/shared/src/protocol/chief-tools.ts`, `chief-turns.ts` (`steerChiefMessage`, `ackChiefSteer`), `apps/server/src/coordinator/runtime/turn.ts` (steer poll).
- Daemon: `apps/daemon/src/git.ts` (`commit`, `runGit` error shape, commit timeout), `apps/daemon/src/workspace.ts` (`commitAll` staging).
- Scheduler: deadline sweep beside the existing sweeps in `apps/server/src/services/scheduler.ts`.
- `routes-machine.ts` and `services/machine*.ts` are owner-routed security surfaces. Item 7 should stay inside the daemon and `machine-finish-step.ts` only if needed. Check `packages/shared/merge-gate-paths.json` before touching them.

### Tests to write first (failure modes)

1. A worker asks; the step ends; the todo is `needs_input` (not `review`) and a `question` wake step exists for an **unwatched** todo (`apps/server/test/worker-questions*.test.ts`, `chief-wake-atomic.test.ts`).
2. `answer_question{requestId}` on a `needs_input` task resumes the **same build id** and session. On a `failed` task with a pending question it also resumes and does not restart (`thread-message.test.ts`).
3. A stale `requestId` is rejected, and an answer to request A never resolves request B (the Temporal cookbook rule).
4. A Coordinator message steered while the turn is ending is not lost: the queued step survives and runs as the next turn (`apps/server/test/coordinator/steer.test.ts`, `chief-queue-steer-stop.test.ts`).
5. A restart after a ruling includes the ruling text in the new build's first prompt.
6. A deadline passes → escalation wake; a second deadline → push with the default; nothing on the ask-the-owner list is auto-applied.
7. A git commit killed by timeout reports `signal SIGTERM` and `timed out after N ms`, and a hook rejection reports the hook stderr (`apps/daemon/test/git.test.ts`).
8. `commitAll` with setup-hook lockfile drift commits only the agent's paths and reports the drift (`apps/daemon/test/` workspace tests).
9. `stop_thread` without a reason is rejected, and a stop records `{actor, reason}`, visible in `threads` (`queued-cancel-release.test.ts` or a new `cancel-attribution.test.ts`).
10. A generic re-starter hits `model_not_found` → one failure, then terminal park, never a second build (extend `research-citation-retry-cap.test.ts` to the shared path).

### Old paths to delete

- `todo.awaitingReply` and its special cases: `builds.ts:268, 587-596`, `todos.ts:150, 341, 576-612`, `chief-router-tools.ts:160, 186`, `chief.ts:1276-1296`. They fold into the `needs_input` phase.
- `WORKER_ASK_PARKED_REASON`'s "the answer will arrive as the next message" contract (`worker-questions.ts:28`), replaced by id-routed resume.
- `restart` as the delivery for a `failed` task that has a pending question (`thread-message.ts:118-126`).
- The `.catch(() => {})` around steer submission (`coordinator/runtime/turn.ts:164`), and step deletion in `ackChiefSteer` before the turn has consumed the steer (`chief-turns.ts:314`).
- The `gate` wake text that tells the Coordinator not to act on parked questions, and the prompt rule "do not decide for the user" in its current absolute form (`chief.ts:1310-1311`).
- `git commit failed (${r.code})` without a signal (`git.ts:518`), and `git add -A` in `commitAll` (`workspace.ts:339`).

## Added later the same night (reported by the Coordinator session, not re-measured here)

- **S11, the owner's needs-you inbox floods.** More than 35 items: worker questions, failures, research reports awaiting acceptance, daily intakes. Rule: needs-you lists only the owner's escalation classes (design or taste, payment, credentials, intended-behavior changes). Worker questions in other classes, brief conflicts, failures and finished research reports go to the Coordinator, which resolves them by rule or re-dispatches. Superseded research intakes and citation checks close on their own.
- **S12, implementation steps that end with zero changes fail silently.** Six large tasks ended `构建零改动` ("build made zero changes") because the agent ended its turn asking or explaining instead of committing. A zero-change end on an implementation task becomes `needs_input` routed to the Coordinator with the agent's last message attached, not a failure.
- The "stop model-not-found retry storms" build failed because `git add -A` staged a `pnpm-lock.yaml` that workspace setup had changed: the S7 case.

## Not covered

- Whether pi-durable's `submit({whenBusy:'steer'})` drops a steer that arrives after the last model call, or keeps it for the next run. The installed package was not present in this worktree's `node_modules`, so S1(a) is Inferred from the daemon log and the deletion paths.
- The exact elapsed time of #145's commit. The daemon log has no start timestamp for the commit, so S6's timeout cause is Inferred.
- Sweep (blocked: the product pivoted and its docs did not load; see the companion file).
