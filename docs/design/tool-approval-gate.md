# Tool approval gate

Status: design for review. Grounded on `origin/main` `9d56cb935`. Prior art: `docs/research/tool-approval-gate-2026-11-15.md`. It extends `docs/design/action-registry-and-approvals.md` and reuses its tables; nothing here adds a table or a migration.

## Problem

An isolated run on 2026-11-15 reproduced it: the owner wrote "prepare the deletion, wait for my approval", the model called `delete_todos`, and the server deleted the task. `executeChiefTool` (`apps/server/src/services/chief-tools.ts`, `case 'delete_todos'`) checks team ownership and calls `deleteTodo`. The only thing between the model and the deletion is a prompt line telling it to `ask_user` first. An `ask_user` answer is a model-authored question with a free-text answer; it authorizes nothing.

## Inventory, from code

| Action | Entry the model reaches | Undoable | Today |
|---|---|---|---|
| Delete tasks (`delete_todos`) | Coordinator tool | No: builds, steps and schedules go | Executes directly. **Gap; this change.** |
| Delete project (`project.delete`) | none: kept off the Coordinator | No | confirm-once proposal; no surface answered it until this change |
| Delete or overwrite a secret (`delete_secrets`, `set_secret`) | Coordinator tool | No: the old value is gone | Executes directly. On the frozen owner-only list, but the earlier design left the Coordinator tool as an owner decision. **Next slice, needs that decision.** |
| Merge a build (`merge_builds`) | Coordinator, MCP | No | Coordinator returns a rejection, MCP 403; merge is a person's click (`routes-builds.ts`) |
| Job application submit | Coordinator via job flow | No, external | Own gate: server-authored card, owner-only answer, preview hash, 15-minute expiry, `unknown` delivery blocks resubmit (`job-applications.ts`) |
| Browser actions on real sites (`browser_act`) | Coordinator computer tools | Depends on the site | Password and one-time-code fields refused in the daemon; any other click runs. **Out of scope: needs its own design, like job submit.** |
| Confirm a plan from an agent client (MCP `confirm_builds`) | MCP | Starts work | Executes |
| Remove a task's schedules (`unschedule_todo`) | Coordinator, MCP | Recreatable | Executes |
| Stop or cancel work (`stop_thread`, `cancel_builds`) | Coordinator, MCP | Work can be restarted | Executes |
| Git push from a task | Daemon worker | Branch push only; merge stays a person's click | Command gate asks on destructive shell shapes |
| Send mail, calendar writes | none | — | Not in the code: mail is read-only intake and a mail turn refuses every tool (`refuseMailTurnTool`); no calendar connector exists |
| Notify the owner (`notify_user`) | Coordinator | Push to the owner only | Executes |

## Decision

A confirm-once action never executes from a model call. The Coordinator tool proposes; the proposal record (`action_proposal`, `action_subscriber`, `action_wake_outbox`) is the only path to the handler; the owner answers a server-authored card; the answer settles the proposal once. This change moves `delete_todos` onto it and makes the existing record answerable. The other gaps above are named follow-ups, not part of this PR.

## What changes

- Registry (`packages/shared/src/action-registry.ts`): add `todo.delete`, tool `delete_todos`, class `confirm-once`, surface `coordinator`, input `{ todoIds }` sorted and deduplicated (1–50 ids), target the joined sorted ids. Sorting makes the same set in another order the same proposal. The tool definition stays the one in `CHIEF_REMOTE_TOOLS`, with its description changed to say it proposes and deletes nothing until the owner approves; `coordinatorToolsExtension` builds action tools only for registry entries that `CHIEF_REMOTE_TOOLS` does not already define, so nothing registers twice.
- Bind (`services/action-registry.ts`): the ownership check becomes per action. For `todo.delete` the server reads every task (team, sequence number, title, project, phase, `v`) and stores the ids with each task's `v` as the proposal input. The hash covers the versions, so a task edited after the proposal makes a new proposal and card on the next call, and the approval fails when any `v` moved.
- Card, in the proposal transaction: `proposeAction` takes the card questions and, only when it inserts a new proposal, inserts (never upserts) a `chiefMessage` row `approval-<proposalId>` in the proposing thread, `askedFor: ['action-proposal:<proposalId>']`, `parkedAt` set. The text is generated from the rows read just before it, the same read that supplies the stored versions; titles and project names are NFKC-normalized and keep only letters, marks, digits, spaces and `-_.,:/@`, so no bracket, `#` or separator lookalike can draw a fake entry, and are clipped: sequence number, project, phase, clipped title, and that deletion cannot be undone. Options `批准执行` / `不执行`. A repeat call while the card row exists returns `created: false` and writes nothing; when the card row is gone (digest-thread cleanup or a deleted thread), the old proposal is superseded and a new proposal and card are written, so the set never sits unanswerable until expiry. After commit, `executeChiefTool` publishes the card and sends the existing notification and push; that split is a small extraction from `createOrGetQuestion`.
- Forgery: `ask_user` refuses a model-supplied `requestId` that starts with `approval-` (the machine ask channel already requires `ask-`); `upsertChiefMessage`, the writer behind machine transcript and tool rows, refuses any `approval-` id; `answerQuestion` and `cancelQuestion` refuse a card whose `askedFor` carries the marker with 403. The proposal input also stores a hash of the card questions, and an answer runs only while the card row is pending, carries this proposal's marker and still hashes to that value, so a rewritten card runs nothing. MCP `reply_thread` and the parked-answer resume go through `answerQuestion`, so they cannot answer it.
- One answer path: the existing card routes (`POST …/questions/:requestId/answer` and `…/cancel`, `routes-chief.ts`) require the marker, the `approval-` id, the card's thread and the marker's proposal id to agree, then call `answerProposal`. `批准执行` alone is allow-once; any other choice, a custom text, or cancel is refuse. After commit the route publishes the card and runs `dispatchActionWakes`, so the woken thread does not wait for the scheduler tick. `POST /api/actions/proposals/:id/answer` refuses (409) any proposal created with a card, even when the card row is gone, so it can never skip it.
- Handler (`services/action-proposals.ts`): `answerProposal` dispatches on `actionId`. `todo.delete`, inside the savepoint: every id still in the team must have its stored `v`, an unarchived project and no claimed step (a machine running it), otherwise the handler throws and the proposal is `failed` with nothing deleted; ids already gone are skipped and reported; then `deleteTodo` per id (better-sqlite3 nests it as a savepoint on the same connection) and one journal row. `decidedBy` records the user id, or `device:<id>` for a paired device.
- Every terminal transition rewrites the card in the same transaction: answered with the owner's choice for refuse, executed and failed; cancelled with the outcome for expired and superseded. A missing card is a no-op, so a stray row cannot block the expiry sweep.
- Wake: the outbox prompt names the action and outcome, and says a refused, expired, failed or superseded action did not run and must not be retried unless the owner asks again.

## Paths that read or write the proposal or its card

| Path | Behavior | On failure |
|---|---|---|
| Model calls `delete_todos` | ownership and version read, one `pending` proposal, one subscriber and the parked card in one transaction; no task row changes; card published and pushed after commit | other team or missing id: 404, no row. Any insert fails: all roll back |
| Model calls again, same set and versions | same proposal id, subscriber scope updated, no new card, no push | — |
| Model calls again, same set, but the card row is gone | old proposal `superseded` (no card to update, wakes written), new proposal and card in the same transaction, card published | rollback keeps the old one |
| Same set from a second thread | same proposal; that thread becomes a subscriber and is woken with the outcome; the card stays in the first thread | — |
| A task edited after proposing, then the model calls again | different hash: old proposal `superseded`, its card cancelled, new proposal and card | rollback keeps the old one |
| Model `ask_user` with `requestId` `approval-…` | 400 | — |
| Owner approves | one immediate transaction: pending, expiry, handler, journal, `executed`, card answered, wake outbox; then publish and dispatch | handler throws (version moved, running work, any error): savepoint rolls back, `failed`, error journal, card answered, wakes; nothing deleted. A crash before commit leaves `pending` |
| Owner approves twice, or the response is lost and the page retries | 409 not pending; the card shows the outcome; nothing runs again | — |
| Owner refuses, writes a custom answer, or cancels | `refused`, card answered, wakes | — |
| Answer after `expiresAt` (7 days) | `expired`, card cancelled, wakes, 409 | — |
| Next-day answer | the card is parked, not tied to a turn; the proposal lives 7 days; the answer wakes each subscriber thread | — |
| Expiry sweep (scheduler) | `expired`, card cancelled, wakes | next sweep retries |
| `POST /api/actions/proposals/:id/answer` on a carded proposal | 409 | — |
| MCP `reply_thread`, parked resume, any `answerQuestion` caller | 403 on a proposal card | — |
| Owner deletes a task by hand (`DELETE /api/todos/:id`) | unchanged; a later approval skips it and reports it | — |
| Stop turn | `cancelPendingQuestions` skips parked cards | — |
| Rewind | refused while a question waits (`requireNoWaitingQuestion`), which covers the card | — |
| Wake dispatcher | unchanged: one step per subscriber, a primary-key conflict counts as delivered | — |

## Tests

One test per row above, through the real routes and `executeChiefTool`, starting with the reproduction: the model's `delete_todos` leaves the task and writes a pending proposal and a parked card.

## Risks

**Same-host owner identity (P0 in review, not closed here).** On loopback with auth off, `/api/auth/bootstrap` gives an owner session to any same-uid process (`routes-core.ts`, `lib/loopback-owner.ts`). The Coordinator's `browser_navigate` accepts any http(s) URL (`apps/daemon/src/computer/browser.ts`), so on a host where the agent browser runs as the owner it can open Cairn's own page and click `批准执行`; a worker shell can do the same with `curl`. Job submission and every owner route share this. The desktop tool already refuses Cairn windows; the browser tool does not. Follow-up, its own PR: the daemon refuses `browser_navigate` and `browser_act` on Cairn's web origins and loopback server ports, with a server-side URL check before the call is forwarded; worker shells are the machine confinement boundary. Until then this gate stops the model's direct tool call, which is what reproduced, not a model that drives the owner's own browser.

Card updates from the sweep and supersede are not pushed over SSE; the page shows them on its next load. `set_secret`, `delete_secrets`, `browser_act` and MCP `confirm_builds` remain ungated until their slices.

## Open decisions

- Paired devices may approve (recommended above), or owner session only, like job submission.
- Next slice: put `delete_secrets` and value-overwriting `set_secret` on this gate (recommended), or drop them from the Coordinator.
- Register `delete_project` on the Coordinator now that a card answers it, in a later slice.
