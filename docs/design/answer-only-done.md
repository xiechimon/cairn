# Non-code tasks finish when delivered — plan, 2026-11-28

## User scenario

A newcomer asks the Coordinator in a project to delegate a hostname lookup, a one-line answer to 1 + 1, or a four-slide HTML review deck. The task should be Done when the reply or uploaded deck is visible in its conversation, without a repository commit. They use their existing model and Runner; no new accounts, fees, keys or settings. Cairn keeps requests, replies and uploads in the existing task conversation and attachment storage. Runner failures and questions still show as such.

In production both examples answered correctly but stopped with “Not delivered,” a check only reached under the default `code` kind. That path guesses read-only intent from the brief and missed both requests. Simply routing them to `info` would still leave them in Review. Reuse Cairn's [existing non-code routing](../research/subagents-vs-tasks-2026-11-24.md), not the retired report pipeline. The owner approved on November 28: the answer is the deliverable; if the task asked for changes and made none, it should still stop for input. The owner added that an attachment is also a non-code deliverable. In production the Q3 deck was a `report` with a ready, nonempty `q3-review.html` attachment and was blocked despite delivering it.

## Scope

1. The Coordinator declares intent in its existing `create_todo.output` call: `info` for a reply (including research delivered entirely in the conversation and commands that just report); `code` for any requested repo/file edit, including conditional edits or requests that also ask for a report; other non-code kinds for standalone artifacts not meant to edit the project. Difficulty measures effort, not intent. The original brief is copied verbatim. A Coordinator-created `code` task never uses the old text exemption. Prior/direct tasks with no recorded Coordinator request keep their compatibility path. The routing choice is only as accurate as the Coordinator's call; do not add a second classifier that guesses from wording or from the reply.
2. A Coordinator-request `info` task with `hasChanges: false`, no edits or separate artifact, and a final nonblank assistant reply in the current step is Done. A final tool-only turn or failed last command cannot serve as an answer. Existing internal research without an uploaded attachment stays on its existing path.
3. A successful non-code task with a ready, nonempty conversation attachment uploaded by a worker step in the current attempt is Done. The server's stored upload is the deliverable, not an `attach_file` call, a user upload, an earlier attempt's file, or a promise in the reply. This replaces legacy report read-back checks for this uploaded-file path only; uncompleted uploads and legacy report/manifest-only flows still use their existing checks. Failure, stop, unanswered questions and undelivered answers still take precedence.
4. Do not change [the production evidence rule](done-in-prod.md), commit capture, evidence retry or PR behavior for code. There are no new keys, fields, model calls or settings.

## States, readers, writers, and exits

- `chief-tools.ts` accepts `create_todo`; `coordinator-request.ts` writes the quoted request and kind through `todos.ts`. The Runner writes transcript and outcome through the existing message and finish routes; `agent-attachments.ts` (`attachWorkerFile`) writes a ready nonempty `message`-scope attachment and its conversation link. `build-step-complete.ts` reads those scoped rows plus the attempt transcript, checking reply freshness against the current step. Its stale, stopped, archived, reserved, replay, unanswered-question and undelivered-answer branches still have precedence. Acceptance nudges remain for code and non-code tasks without a delivered upload. `applyStepFailure` remains separate.
- `finishTodoDone` writes Done using `setTodoPhase` and publishes the existing task update. `keepInfoReport`, `publishDeliverables` and `setTodoPhase` retain legacy outputs and Review where no new delivery qualifies. `undeliveredEnd` and `askUndeliveredOnce` keep Coordinator code tasks with no commit in Needs input even if their brief includes a no-edit qualifier. The existing task list and conversation read the phase and original reply. `blockers.ts` releases dependents on Done and `blocker-handoff.ts` already projects the last assistant reply into their summary without a report attachment.

## Edge cases

| Situation | What the user sees / system action | Proving test | Slice/Status | Wait and cost |
|---|---|---|---|---|
| Answer-only text or command task provides a final answer with no commit | Answer remains in the task, now Done; a dependent receives that answer in its existing handoff | `apps/server/test/task-stall-needs-input.test.ts` | this change | Same turn; no extra call |
| Code task has no change, including a change request that only reports | Needs input even if the brief says not to edit outside the repo; legacy direct-task exemption stays | `apps/server/test/task-stall-needs-input.test.ts` | this change | Existing question path |
| Non-code task uploads a standalone deck and successfully ends | Done with the HTML file in the task conversation, even if legacy read-back checks would ask for more; a code task's evidence attachment is not its deliverable | `apps/server/test/task-stall-needs-input.test.ts` | this change | Same turn; no extra call |
| Worker fails, stops, asks, owes delivery of a question answer, or no upload qualifies for Done | Existing failure, stop, question or applicable acceptance continuation takes precedence; no new path for archive, replay or a stale build | `apps/server/test/task-stall-needs-input.test.ts` (unchanged-behavior guards in the same red file) | this change | Unchanged |
| No ready worker attachment, and an info task has an empty, earlier-step, tool-only or failed-command reply, edits, a file-upload call, a legacy separate deliverable or no confirmed `hasChanges: false` | No automatic Done; existing Review or acceptance path. The code commit and production-evidence gate is unchanged | `apps/server/test/task-stall-needs-input.test.ts` (unchanged-behavior guards in the same red file) | this change | Unchanged |

## Out of scope

- Reclassifying past tasks, auto-completing past questions, and changing direct task or schedule creation, legacy runner report/manifest review, or the code evidence standard.

## Review

- Verdict: PASS
- Plan-SHA256: 3a7d46314c6e59707f5ea7c9dd96ad10e68c3f4f7921501ba6d8d2734b277e7d
- Author-Model: openai-codex/gpt-6.2-sol
- Reviewer: Pi fresh-context plan review; findings-only confirmation
- Reviewer-Model: anthropic/claude-sonnet-5-5
- Findings: 10 addressed: narrow routing and explicit compatibility boundary, final-reply and artifact guards, handoff, acceptance precedence, and matching regression tests. Confirmed the owner-added attachment row and test without reopening the original review.
