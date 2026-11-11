# Action registry and approvals

Status: design for the owner's review. Nothing here is built. First slice of the action-registry proposal, plus approvals as its confirm-once class. That proposal is not on `main`; it is `docs/design/ai-native-actions.md` on #3924 (`origin/claude/gracious-cray-wl8xyh`). This PR does not copy it, because that PR owns the file. The rules this slice uses are restated here so the design stands alone. Grounded on `origin/main` `7299c658e`. Prior art: `docs/research/action-registry-approvals-2026-11-11.md`.

## Decision

Slice 1 adds one registry, one execute function, a journal, and the approval record. It does not migrate the 47 Coordinator tools, does not edit `apps/server/src/services/mcp-face.ts`, and does not add daemon CLI commands. Those three are the drift, and rewriting them in the same change would hide the approval behavior.

Today the Coordinator runs `executeChiefTool` (`apps/server/src/services/chief-tools.ts`), the MCP face runs its own switch in `executeMcpTool` (`apps/server/src/services/mcp-face.ts`) over `MCP_TOOL_REGISTRY` (29 names in `packages/shared/src/protocol/mcp.ts`), and the web calls REST routes. The same name already means different things: MCP `create_todo` takes `title` and `spec`; the Coordinator tool cites the owner's messages. `confirm_builds` is removed from Coordinator tools (`CHIEF_TOOLS_REMOVED_UNDER_D60`) and still calls `confirmBuild` on the MCP face. `merge_builds` returns a rejection from the Coordinator and throws 403 from MCP (`MERGE_HUMAN_ONLY_COPY`).

`PermissionCard` already has deny / once / always (`apps/web/src/components/thread/permission-card.tsx`) and is used only in the design gallery. `permission-rules.ts` is an in-memory allow / ask / reject matcher for the daemon command gate, with no store. `ask_user` writes a model-authored question into `chiefMessage` and holds the tool for 70 seconds (`apps/server/src/services/chief-questions.ts`). None of those is this record.

## Registry

One entry in `packages/shared`: `id`, `toolName`, input schema, output schema, `scope` (`team` | `project`), `class` (`free` | `confirm-once` | `owner-only`), `standingGrant` (boolean), `inverse` (another id, or none), `surfaces` (`web` | `coordinator` | `mcp` | `cli`), and `targetOf(input)`.

Slice 1 entries:

| Id | Class | Inverse | Standing grant | Surfaces |
|---|---|---|---|---|
| `project.archive` | free | `project.unarchive` | no | web, coordinator |
| `project.unarchive` | free | `project.archive` | no | web, coordinator |
| `project.delete` | confirm-once | none | no | web, coordinator |

`toolName` is a field (`archive_project`, `unarchive_project`, `delete_project`), not derived. Archive and unarchive call `setProjectArchived` (`apps/server/src/services/projects.ts`). Delete does not call `deleteProject` unchanged. That function commits its db work and then calls `removeHostedRepoDir` before returning (`projects.ts`, `git.ts`). An outer transaction that rolls back after that return would restore the project row after the directory is gone. Slice 1 splits it: the db deletes and a cleanup outbox row commit with the journal row; `removeHostedRepoDir` runs only after that commit, from the outbox. The outbox row holds `teamId` and `repoName` until cleanup finishes, and `uniqueRepoName` (`apps/server/src/services/git.ts`, called from `POST /api/projects`) treats a pending outbox name as taken. Cleanup removes the directory only when no current project row owns that name. If one does, it does not delete the directory; the outbox is marked conflict and a journal row records it. The only production caller today is `DELETE /api/projects/:id` (`routes-projects.ts`). It calls the execute function, not `deleteProject`. REST archive and unarchive do the same. The Coordinator tools are registered from these three entries and call the same execute function. They are not added to `CHIEF_REMOTE_TOOLS`.

`project.delete` does not offer always-allow. A grant with no match would delete any later project. The grant table exists so a later action can set `standingGrant` without a new store. Slice 1 has no such action.

Owner-only names are a frozen list, not a removal: `set_secret`, `delete_secrets`, `merge_builds`, and the REST routes that change merge policy, ship route, or the eval ruler. A test fails if a new registry id is owner-only and also appears on a surface, or if that exception list grows. Slice 1 does not take `set_secret` away from the Coordinator. That is a behavior change and stays an owner decision.

The daemon CLI (`apps/daemon/src/cli.ts`) is machine start, stop, and token. It is not a product action surface. `surfaces` does not include `cli`. Worker threads and the MCP face do not receive these three actions.

## State

Five tables, team-scoped, cascade on team delete. No retention TTL in this slice.

- Proposal: `pending`, `refused`, `executed`, `failed`, `expired`, `superseded`. No committed `accepted`. Holds the validated input, its hash, `targetId`, `scopeProjectId`, decision (`refuse` | `allow-once` | `always` or empty), and expiry.
- Subscriber: one row per Coordinator thread waiting on a proposal. Holds `proposalId`, `threadId`, and `wakeStepId` (`wake:` plus proposal id plus thread id). Unique on proposal and thread.
- Wake outbox: one durable row per subscriber and terminal proposal, with the terminal outcome and delivery state. Unique on proposal and thread.
- Grant: `active` or revoked (`revokedAt` set, row kept). Unique on team, action, and match hash while active.
- Journal: append-only. One row per run, undo, or refused undo. A refusal lives on the proposal, not a second copy in the journal.

A pending proposal is unique on team, action, and target. A repeat from any thread returns that row and adds a subscriber. It does not replace the stored input. A new pending proposal for the same target, with a different input hash, marks the old one `superseded`, writes wake outbox rows for all its subscribers, inserts the replacement, and adds the new subscriber in one transaction. Any failure rolls the entire replacement back; the old proposal and subscribers remain pending.

Expiry is 7 days from insert, not the end of the Coordinator turn. The #3924 proposal says a confirm-once proposal expires with its turn. A turn ends before the owner is back; expiring with the turn would throw away the answer. The disagreement is open below.

## Transitions

```mermaid
stateDiagram-v2
  [*] --> pending: coordinator calls confirm-once
  pending --> refused: refuse, one transaction
  pending --> expired: past expiry
  pending --> superseded: newer input, same target
  pending --> executed: allow once, handler, and journal, one transaction
  pending --> failed: handler throws inside that transaction
  [*] --> executed: free action, or the owner's own click
```

Allow once does not commit `accepted` and then run the handler. The decision, the handler, the journal row, and the hosted-delete outbox row are one transaction. A crash before commit leaves `pending`, so the same answer can be retried. There is no sweep for a half-applied approval.

The Coordinator tool returns `pending` and the proposal id. It does not call `holdForQuestion`. A Coordinator propose without a `threadId` is 400 and writes nothing. Each waiting thread is a subscriber. Every terminal transition (`refused`, `executed`, `failed`, `expired`, or `superseded`) writes an outbox row for every subscriber in the same transaction as the transition. A durable dispatcher scans undelivered rows on startup and periodically, and retries after failures. It wakes each subscriber with the terminal outcome: `enqueueChiefStep` (`apps/server/src/services/chief.ts`) gets that subscriber's `threadId` and `wakeStepId`, trigger `wake`, provenance `action-proposal:<id>`. It does not add a trigger kind and does not wake a thread that did not subscribe. An owner click has no subscriber and does not wake. Claim: the subscriber row, including `wakeStepId`, exists before the enqueue. Lookup: a step with that id means that subscriber was woken. Completion: inserting that id is the marker; a primary-key conflict is success. A successful insert or primary-key conflict marks the outbox row delivered. A crash after insertion and before marking delivered retries the same id. A missing thread is recorded as an undeliverable terminal outcome for that subscriber without blocking the others; subscribers remain until delivery is accounted for.

The owner's own click is the confirmation. Actor `user` on `project.delete` runs the handler and journals it. It does not insert a proposal, so the person is not asked twice. Actor `coordinator` always proposes.

## Paths that read or write

| Path | Reads | Writes | On failure |
|---|---|---|---|
| Execute, unknown id or bad input | registry | nothing | 400, no row |
| Execute, owner-only id | registry | nothing | 403, no row |
| Execute, target missing or other team | project row | nothing | 404, no row. Archive already checks team (`routes-projects.ts`); delete does not, and this check closes that gap |
| Execute, caller surface not listed | registry | nothing | 403, no row. MCP and the daemon CLI hit this |
| Execute, free, or user on confirm-once | registry, project | project row and one journal row, one transaction. Hosted `project.delete` also writes the outbox row in that transaction | handler error rolls the transaction back and does not call `removeHostedRepoDir` |
| Execute, coordinator confirm-once | registry, pending proposal, caller thread id | one `pending` row if none exists, plus one subscriber for this thread | no `threadId`: 400, no row. Same input: return the existing id and add the subscriber. Different input: atomically supersede, write old subscribers’ wake outbox rows, insert the new proposal and its subscriber; rollback preserves the old proposal on failure. Handler does not run |
| Answer, body contains `input` | proposal | nothing | 400. The stored input runs, or nothing runs |
| Answer, not pending, unknown, or past expiry | proposal | expiry stamp and subscriber wake outbox rows in one transaction if past `expiresAt` | 409, handler does not run |
| Answer, refuse | proposal | status `refused`, decision, `decidedBy`, and subscriber wake outbox rows in one transaction | wake still fires; handler does not run |
| Answer, allow once | proposal, subscribers, stored input | decision, handler, journal, hosted-delete outbox, terminal status, and subscriber wake outbox rows in one transaction | a crash before commit leaves `pending`. Handler throw commits `failed` and the error journal row, no retry |
| Answer, always | proposal, registry flag | nothing in slice 1 | 409 `standing grant not offered`, proposal stays `pending` |
| Revoke grant | grant, team | `revokedAt` | owner session only; agent and MCP get 403; other team is 404 |
| Expiry sweep | pending proposals and subscribers | `expired` and subscriber wake outbox rows in one transaction | a failed sweep leaves them pending; the next sweep retries |
| Undo | journal row, inverse, current project | one new journal row, and the inverse write if it still matches | no inverse: 409, no write. State moved: journal `undo-refused`, names the later journal id, does not overwrite |
| Delete db plus outbox | project, hosted repo name | project rows, one journal row, one outbox row, one transaction | a throw before commit rolls all three back and does not call `removeHostedRepoDir` |
| Web pending list and journal list | proposals, journal | nothing | empty list |
| Directory cleanup | outbox row not done, current project rows for that `repoName` | `removeHostedRepoDir` only if no current project owns the name, then outbox done and one journal row | runs only after the delete transaction commits. A current project with that name: no directory removal, outbox marked conflict. A missing directory is success. A failed sweep leaves the outbox row; the next sweep retries. It does not delete the project row again |
| Create project name | project rows and pending outbox names | hosted `repoName` | a name in a pending outbox is taken, so a recreate during cleanup cannot reuse the path |
| Coordinator wake dispatcher | undelivered wake outbox rows and existing steps | one `enqueueChiefStep` per subscriber, then marks delivery | startup and periodic scans retry after a crash; insert conflict is success. Missing thread is recorded as undeliverable without blocking others. The handler never runs again |

The db half of delete still removes todos, builds, steps, and secrets, and it still does not stop running work. That guard is a separate to-do. The proposal text shown to the owner names the project and says running work is removed with it. Slice 1 does not add the guard. `ask_user`, the command gate, `clientMessage`, `skill_audit`, and plan auto-approve do not read or write these tables.

`deleteTodo` (`apps/server/src/services/todos.ts`) also queues a GitHub issue close. It is not in this slice, because that side effect is outside the journal transaction.

## Tests the implementation writes first

One test per row above, plus: a registry entry with surface `mcp` or `cli` fails the slice-1 fixture; `delete_project` is absent from `MCP_TOOL_REGISTRY` and `CHIEF_REMOTE_TOOLS`; the owner-only exception list is exact; a journal row never contains a field named `value`, `token`, `secret`, or `password`; two concurrent proposes for one target return one pending id; a rolled-back delete does not remove the hosted directory; a recreate while an outbox row is pending gets a different repo name, and cleanup does not delete that new directory; a Coordinator propose with no `threadId` writes nothing; a second thread on the same target is a subscriber and is woken; an answer wakes every subscriber and no other thread; a crash during allow-once leaves `pending` and a retry runs the handler once; supersede and expiry each deliver their terminal outcome to every subscriber; an injected replacement insert failure rolls back the supersede and retains its subscribers; a crash after terminal commit before dispatch is recovered by the startup sweep; a crash after step insertion before delivery marking retries without inserting a second step.

## Risks

Deleting a project is still not undoable, and a confirmed delete still removes running work. The directory removal can fail after the db delete; the second journal row is the record, not a rollback. MCP `create_todo` and `confirm_builds` keep drifting until a later slice. A future `standingGrant: true` with an empty match is a standing widening of the agent; the flag defaults false, and revoke is owner-only. Slice 1 does not edit the MCP face. An implementation that does is owner-routed on its own.

## Open decisions

- Expiry: 7 days, recommended here, against the #3924 proposal's rule that a proposal expires with its turn.
- Always-allow on delete: not offered, recommended. The owner can require it for a matched scope.
- Whether a worker thread or an MCP client later shares the Coordinator's free class: not in this slice.
- Journal retention: keep with the team, no TTL, until the owner says otherwise.
- Whether `set_secret` loses its Coordinator tool: not in this slice.
