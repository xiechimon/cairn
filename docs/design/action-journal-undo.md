# Action journal undo + remaining Coordinator face

Status: implementation design for project seq-17 (`AI-native action registry: faces generation + undo`). Grounded on `origin/main` `b9409e314`. Extends `docs/design/action-registry-and-approvals.md` — its paths-table rows "Undo" and "Web pending list and journal list" are the contract this fills in. Slice 1 shipped the registry, journal, proposals and the archive/unarchive/delete execute paths; `action_journal.kind` already allows `undo` and `undo-refused` with no writer.

## Persisted state

No schema change. `action_journal` keeps its columns; a new migration is deliberately avoided (`**/drizzle/**` is `dataDestruction` humanQueue, and nothing here needs a column).

- `run`: an executed action, written by `executeAction`/`answerProposal` today.
- `undo`: a journal row that applies the inverse of an earlier `run` or `undo` row. `actionId` stores the inverse action (the thing that was done), `targetId` the same target, `inputHash` the hash of the inverse's natural input — so the journal stays a readable sequence of state changes.
- `undo-refused`: a refused undo. `actionId` is the row the owner tried to undo, `inputHash` is the hash of the undo request `{undoOf: journalId}`. The conflicting journal id is returned in the 409 response and is derivable from the journal (the latest `run`/`undo` on that target); it is not persisted because the table has no column for it.
- `error`: unchanged.

## Transitions

```
run/undo --[owner undo]--> inverse write + undo row        (one immediate tx)
run/undo --[owner undo]--> undo-refused row                (state moved; one tx, no inverse write)
run/undo --[owner undo]--> 409, no row                     (no inverse, or kind error/undo-refused)
```

"State moved" = a `run` or `undo` journal row exists on the same `teamId`+`targetId` with `createdAt` later than the row being undone. The check runs inside the same `immediate` transaction as the inverse write, so a concurrent execute on that target serializes: whichever commits first wins and the loser refuses instead of overwriting by recency.

Undoing an `undo` row is allowed: its `actionId` is the inverse, which has its own inverse, so a double undo re-applies the original action through the same path.

## Readers and writers

| Path | Reads | Writes | On failure |
|---|---|---|---|
| `undoJournalEntry`, journal missing/other team | journal | nothing | 404 |
| `undoJournalEntry`, kind `error`/`undo-refused` | journal | nothing | 409 `not-undoable`, no row |
| `undoJournalEntry`, inverse is null | journal, registry | nothing | 409 `no-inverse`, no row (`project.delete`, `todo.delete`) |
| `undoJournalEntry`, later `run`/`undo` on target | journal, registry | one `undo-refused` row | 409 body carries `conflictJournalId`; the row records the attempt; no inverse write |
| `undoJournalEntry`, ok | journal, registry, project | inverse update + `undo` row, one `immediate` tx on the same handle | journal-insert failure rolls the project row back; inverse failure writes no row. `archiveOn` (tx-aware) is the inverse primitive — `setProjectArchived` is never called |
| `GET /api/actions/journal` | journal | nothing | empty list |
| `GET /api/actions/proposals` | proposals (status `pending`) | nothing | empty list |
| `POST /api/actions/journal/:id/undo` | above | above | above |

All three routes are owner-only: they reject when a paired-device or agent token drives the request, using the existing `requireOwnerSession` convention (`ctx.authToken === null || ownerIdentity !== undefined`) plus `isOwner` for the session user. `lib/token-auth.ts` is not touched, so no security surface changes; routes are registered in `wire.test.ts` `INFERRED_ROUTES`.

## Coordinator face: `delete_project`

The last ungenerated face. Removing the `delete_project` filter in `actionToolDefs` makes `coordinatorToolDefs()` emit it; `ACTION_COPY['delete_project']` describes it as propose-not-execute. A Coordinator call then reaches `executeAction` → `confirm-once` → `bindProposal`, which today returns `{input}` with no card — an unanswerable proposal. A `project.delete` branch in `bindProposal` loads the project (404 on missing/other-team), names it, says running work is removed and the delete cannot be undone (the gap noted at `action-registry-and-approvals.md:91`), and offers `批准执行`/`不执行` — never `always` (`standingGrant: false`). The two tests pinning the omission flip to assert presence.

`todo.delete` already has its own card path; nothing else changes.

## Faces coverage test

One shared test walks `SLICE1_ACTIONS`: every entry with surface `coordinator` appears in `coordinatorToolDefs()` output with copy and a parameters schema; every `web` entry has a live route in `INFERRED_ROUTES`; no entry appears on `mcp`/`cli`. A new registry entry without a generated face fails the suite instead of drifting.

## Out of scope

Journal/pending-list web UI (the design's "journal view" remains future work); undo from the Coordinator or MCP surfaces (owner route only); undo of `todo.delete`/`project.delete` (irreversible by design).
