# Quick lane for small tasks with a known destination

Status: approved on 2026-11-16, not built yet. The owner chose to build it (`两个都要，按这个边界继续出方案，先不改代码`) and decided that the quick lane skips the GitHub overlap check. The owner approved implementation on 2026-11-16. Companion design: `personal-space.md`. Builds on `coordinator-routes-verbatim.md` (owner segments, `step.ownerMessageIds`) and `coordinator-project-channels.md` (a task's reports return to the channel that created it, #5136).

## Problem

Saying "add a `node.txt` that says hello" in the cairn channel today costs a project lookup, a GitHub overlap check whose numbered result goes into the reply, a second `update_todo` call for the title, and a thread session whose brief (`SESSION_BRIEF` in `packages/shared/src/records/prompts.ts`) asks it to write tests first. Only the last part does work the owner asked for. Measured on this host's server DB (read-only), the single Coordinator-created code task of the last two weeks (#174) had about 19 minutes of session time and reached `done` about 4.8 hours after it started; one sample sets no target.

## Decision

1. The quick lane removes ceremony before the merge gate. It does not change who executes or how code lands: the task still runs in a recorded thread, on a work branch, through a PR, the merge gate, CI, independent review for protected paths and the project's merge policy. No latency promise is made for merging, and the lane is never chosen by file or line count.
2. The Coordinator still has no shell and no file-writing tool (D60, #2577, #2907).
3. A request takes the quick lane when all three hold:
   - The turn is an owner turn: every cited message is in `step.ownerMessageIds` (rows T1 to T6 of the turn table in `coordinator-routes-verbatim.md`). Wake turns (`[wake:…]`) never qualify.
   - The destination has a basis the server can check, stored as `request.projectBasis`:
     - `channel`: the creating thread's `projectId` equals the task's project;
     - `composer`: the cited message carries the composer's picked-project prefix for that project;
     - `owner-named`: an owner segment contains the project name or repository name as a substring, and the name is at least two characters long;
     - `owner-answer`: an owner `answer` segment chose that project in an `ask_user` question.
   - The owner's words state the outcome. Only the Coordinator judges this; a wrong judgment costs an ordinary session, which can still ask the owner.
4. What the lane skips and keeps:

   | Skipped | Kept |
   |---|---|
   | Asking for the project when a basis exists | One question in the main channel when no basis exists and several destinations fit |
   | `github_overlap` and its numbered result in the reply (owner decision) | The `threads` check for an existing thread on the same request, the verbatim citation and the `409` on rebinding a message |
   | The follow-up `update_todo` title call; the placeholder title cut from the owner's words is final | Work branch, PR, merge gate, CI, protected-path review, merge policy |
   | Tests first, when the owner's words fix the content and the change only adds, edits or removes data or copy | Tests first for any behavior change; a session that cannot tell uses `SESSION_BRIEF` |

## State

`todo.request` (JSON, no migration) gains two optional fields:

```ts
type TaskRequest = {
  // existing fields of coordinator-routes-verbatim.md
  lane?: 'quick';
  projectBasis?:
    | { kind: 'channel'; threadId: string }
    | { kind: 'composer'; messageId: string }
    | { kind: 'owner-named'; segment: number; name: string }
    | { kind: 'owner-answer'; segment: number };
};
```

Both are written once by the request service at creation and never change. Moving the task to another project (`update_todo projectId` or the board) clears `lane` and `projectBasis` in the same write, and so does an owner edit of the task text, which replaces the cited segments; a moved or edited task runs as an ordinary task.

## Paths that read or write the lane

| # | Path | Reads | Writes | On failure |
|---|---|---|---|---|
| L1 | Coordinator `create_todo` with `lane: 'quick'` (`chief-tools.ts`, `coordinator-request.ts`) | step `ownerMessageIds`, cited segments, creating thread scope, project row | `request.lane`, `request.projectBasis`, final title | `400` and nothing written when the turn is not an owner turn, a cited message is outside `ownerMessageIds`, or the basis does not check out. In a project channel a task for another project needs `owner-named` or `owner-answer` |
| L2 | Coordinator `update_todo projectId` | task state | clears `lane` and `projectBasis` | unchanged rules: only an unstarted task moves |
| L3 | MCP `create_todo`, REST task creation, issue import | none | no lane fields | not quick; unchanged |
| L4 | Claim (`machine-claim.ts`) | `lane`, `projectBasis`, cited segments, task project | step prompt: `QUICK_SESSION_BRIEF` instead of `SESSION_BRIEF` | a basis that no longer checks out (a cited message rewound, the project moved) dispatches nothing and puts the task in needs-you with the reason |
| L5 | Merge landing (`machine-merge-landing.ts`) and the merge gate | the same as L4 | none | same as L4. The gate's verdict does not read `lane`: the same patch gets the same verdict with and without it |
| L6 | Retry (`build-restart.ts`) | creating thread's watch | keeps the creating thread's watch | fixes the #5136 P2: reports after a retry no longer go to the main channel |
| L7 | Reports to the creating channel | PR events, build state | one line when a PR opens (`…开了 PR #n，在等检查` or `…在等你合并` under a human merge policy) and one when it merges | the main-channel mirror stays `needs-you` and `done` only (#5136) |
| L8 | Coordinator prompt (`chief.ts`) | none | quick-lane rules: no overlap check, no title call, a one-sentence acknowledgment naming the project and that results return here | prompt only; L1 enforces |

Credentials, network and machines for a quick task are exactly those of an ordinary task in the same project. Third-party text (issue bodies, CI logs, web pages, thread reports) stays fenced data and can never be a `projectBasis`.

## Failure behavior

- No machine online: the task queues; the composer line says which machine is offline and that the task starts when it returns (DESIGN-RULES C8).
- The file already exists: the session asks instead of overwriting; the question returns to the creating channel.
- A protected path is touched: the acknowledgment says it needs independent review and is slower.
- CI fails: the existing CI fix rounds run; past the limit the task goes to needs-you.
- Plan auto-confirm blocked by an unrelated pending question (#5136 P2): out of scope, tracked separately.

## Tests

One per row: L1 (owner turn accepted; wake turn `400`; `channel` basis to another project `400`; `owner-named` without the name in any segment `400`; one-character name `400`), L2 (move clears the lane), L3 (MCP create has no lane), L4 and L5 (rewound message stops dispatch and landing; gate verdict identical with and without `lane`), L6 (retry keeps the watch), L7 (two report lines in the creating channel, mirror unchanged), L8 (prompt has the rules and no overlap instruction for quick tasks).

## Acceptance

- In a project channel, "add `node.txt` that says hello" gets zero questions, one acknowledgment and one reference row in the same turn.
- In the main channel with two projects and no basis, one question, and no task in that turn.
- Ten rehearsal tasks report the median of each stage from `step` and `build` timestamps: request to task, task to claim, claim to PR, PR to checks done, checks done to merge. No merge-time target; the stages are measured before and after the prompt change.

## PR order

1. Q1: `lane` and `projectBasis` on `create_todo`, L1 to L3, L6.
2. Q2: L4 and L5 (security surfaces: `machine-claim.ts`, `machine-merge-landing.ts`).
3. Q3: L8 and `QUICK_SESSION_BRIEF`. The protected eval ruler (`integration/eval/**`) is not edited.
4. Q4: L7 report lines and copy; waits for the channel-routing UI PR.
