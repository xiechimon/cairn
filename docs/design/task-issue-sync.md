# Task issue sync

Issue #3505. Research: `docs/research/task-issue-lifecycle-2026-11-09.md` (lands with the landing path, PR #3508).

cairn opens one GitHub issue per task in a GitHub-linked project (`sourceKind = 'github-issue-self'`). This page fixes how that issue follows the task. There are two halves, and each has exactly one path.

## Landing: the PR body keyword

- Every open PR of a task whose own issue lives in the PR's repository carries a `Closes #N` line. GitHub closes the issue when that PR merges into the default branch, on every route: cairn's REST merge, the Mergify squash queue, or a human merge.
- `ensurePullClosesTaskIssue` (`apps/server/src/services/pr-closing-line.ts`) is the only writer. The PR watch runs it on every sweep of an open PR. The REST merge runs it once more before the merge `PUT`, then rechecks the merge gate.
- Fenced code, HTML comments and inline code do not count as a keyword. The body is reread right before the `PATCH`.
- A PR whose base is not the default branch never closes the issue. That PR has not landed on the default branch, so this is by design.

## Not landing: one level-triggered reconciler

### Invariants

1. The desired issue state is a pure function of the task row as it is now, never of the transition that led there:

| Task row | Desired | `state_reason` | Comment |
|---|---|---|---|
| archived and `done` | closed | `completed` | archived after completion |
| `supersededBy` set and (`closed` or archived) | closed | `not_planned` | links the successor's issue |
| `closed` | closed | `not_planned` | cancelled |
| archived | closed | `not_planned` | archived |
| `done`, not archived | no opinion | - | the landing path owns it |
| anything else (`todo` … `failed`) | open | `reopened` | reopened |

2. `todo.issueState` records the state cairn last wrote or observed: `open`, `closed` or null for unknown. The reconciler acts only when desired and recorded differ.
3. Before writing, the reconciler reads the issue. When GitHub already shows the desired state, it records that state and writes nothing, so it posts no comment. A person who closes an active task's issue by hand is not overruled: desired `open` equals recorded `open`.
4. A deleted task, or a task moved to a project that cannot hold its issue, leaves a row in `task_issue_close` (team, issue ref, comment). The same sweep closes it as `not_planned` and then deletes the row.
5. Writes happen only inside the sweep. The sweep is single-flight and handles rows one at a time, so two writes for the same issue never race.

### Write paths

- **Task state:** `setTodoPhase`, `updateAutonomousTodo`, `setTodoArchived` and `resetTodo` write phase or `archivedAt`, and so does every future path that writes them directly. None of them call the reconciler. The sweep selects every self-issue row whose desired state differs from `issueState`, using a database query only.
- **Issue link:** `runSelfIssueCreate`, on first creation or a retry, sets `sourceRef` and `issueState = 'open'`. A task cancelled before creation finished is therefore picked up by the next sweep.
- **Supersede:** `close_todos` with `supersededBy` stores the successor id on the closed rows. When the successor's own issue is still being created, the sweep waits for it.
- **Delete:** `deleteTodo` writes the tombstone in the same transaction that deletes the row. When a task is deleted while its issue is still being created, `runSelfIssueCreate` finds no row and writes a tombstone for the new issue.
- **Project move:** dropping the issue, or replacing it with a new one in another repository, writes a tombstone for the old issue.

The sweep runs with the PR watch, once a minute. A change on the board reaches GitHub within about a minute.

### Failure modes

| Failure | Behavior |
|---|---|
| No token, or GitHub unreachable | the row stays divergent; the next sweep retries |
| The issue cannot be read | treated as unknown: the reconciler writes the desired state |
| The issue was deleted on GitHub (404/410) | records the desired state and stops retrying |
| The successor's issue is not created yet | waits; the comment always names the successor's issue |
| Rate limit | at most 20 issue writes per sweep; the rest wait for the next sweep |

### Tests

`apps/server/test/github-writeback.test.ts`, describe "task issue sync":

- one test per row of the table;
- already in the desired state: no write and no comment;
- failed stays open;
- delete, and delete during creation, close through the tombstone;
- cancel then reopen settles open;
- reset reopens;
- a creation retry after cancel closes;
- supersede links the successor;
- the negative control: a path that writes `todo.phase = 'closed'` straight into the database, with no service call, still gets reconciled by the next sweep.

Landing tests live in `thread-pr.test.ts` and `pr-merge-api.test.ts`.
