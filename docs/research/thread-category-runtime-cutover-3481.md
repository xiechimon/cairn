# Remaining thread-category retirement: state and wire cutover

Status: proposed for coordinator review before state/wire implementation. This refines the staging of the [approved retirement](thread-tags-retirement-3481.md), after correction independence #3727, GitHub-label isolation #3782 and UI retirement #3804. Audited main: `3f75ace9ff1bb69d0cbca73d39acbdf579769789`.

## Primary-source audit

This removes Cairn behavior rather than borrowing a new runtime mechanism. The primary sources are the current implementation and an isolated entry-point probe; no external product comparison is needed.

| Source | Observed behavior | Consequence |
|---|---|---|
| [todos.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/server/src/services/todos.ts) | Label/category replacements recompute `correctionRequired` from generic membership OR dedicated GitHub labels. Project moves clear classification; ordinary edits do not. | Deleting membership before retaining its provenance can weaken the guard on the next label replacement. |
| [machine-relay.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/server/src/services/machine-relay.ts) and [runner.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/daemon/src/runner.ts) | Ordinary naming accepts/advertises a fixed category; the GitHub form uses dedicated labels with legacy `tag`/`tags` argument names. | Change ordinary prompt, advertised schema and relay together; preserve the GitHub form and title-final rules. |
| [routes-todos.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/server/src/routes-todos.ts) and [todo.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/packages/shared/src/records/todo.ts) | REST parsing strips unrelated unknown keys; the web still sends an optional `machineId`. | Reject retired assignments narrowly rather than changing every unrelated unknown-key contract. Use the installed Zod pipeline, not a new parser. |
| [mcp-face.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/server/src/services/mcp-face.ts) and [coordinator-request.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/server/src/services/coordinator-request.ts) | MCP has an advertised input shape plus a directly callable executor; Coordinator already uses strict schemas. | Removing an advertised property alone is insufficient: SDK input processing must not silently strip the stale key before validation, and direct calls need the same rejection. |
| [tag-tool.ts](https://github.com/xiechimon/cairn/blob/3f75ace9ff1bb69d0cbca73d39acbdf579769789/apps/daemon/src/tag-tool.ts) | `create_tag` creates/pushes annotated Git release tags; it is unrelated to task categories. | Preserve this module, tool constant, backend bridge and tests. The feature map currently misattributes these files to thread categories; correct that attribution instead of deleting the Git capability. |

## Probe and inference

The [archived probe](../verify/3481/category-cutover-probe/probe.test.ts) ran against isolated in-process production mutation and HTTP route entry points; [observations](../verify/3481/category-cutover-probe/result.json) contain no instance ids. It represents a legacy category task on a project that later becomes GitHub-backed. Intact legacy correction membership plus empty GitHub-label replacement keeps completion at 409. Deliberately deleting only that fixture association, then replacing labels again, changes completion to 200. Dedicated-only correction removal remains reversible. Unrelated unknown create/patch fields are currently accepted with 201/200.

Inference: a naive future generic-data deletion would make this guard weakening reachable without fixture manipulation. This is a negative control for the proposed cutover, not a current ordinary-API exploit. To repeat, temporarily copy the archived probe into `apps/server/test/`, set `CAIRN_CUTOVER_PROBE_RESULT` to a scratch file and run that file with the normal shared admission/worker limits; never run it on production data.

## Proposed ordered states

1. **Current:** UI entry/queries gone; generic routes, assignment inputs, seeding, ordinary worker categories and legacy read/storage contracts remain. Dedicated GitHub labels and the internal materialized correction flag are independent storage.
2. **Writer retirement:** a coordinated phase removes generic GET/POST routes, all generic assignment inputs, fixed seeding/backfill and ordinary worker category advertising/assignment. Every writer-removal PR updates its affected active feature-map, verification registry/recipes and normative specs in that same head, then regenerates the map. No shipped entry may advertise a removed route, argument or flow. Stale REST/Coordinator/MCP/ordinary-worker assignments fail before writes. Ordinary naming and sealed-owner behavior remain. Keep legacy tables, read-only wire `tagIds` and their lifecycle cleanup temporarily, so model removal is independently reviewable. Existing generic membership still participates in classification until the final snapshot.
3. **Final data/model retirement:** one migration adds internal boolean `correctionBaselineRequired` (default false), snapshots case-insensitive legacy correction membership into it before dropping `todo_tag` then `tag`, and preserves existing materialized true requirements. Atomically replace storage readers, wire/model exports and their client/gallery/fixture consumers. Active category discovery and normative contracts have already moved with their writers; only inactive historical cleanup can be independent. If review size requires splitting the writer phase, each independent writer PR carries its matching active-contract updates. Preserve untitled naming documentation and Git release-tag registration. Number/timestamp/snapshot come from latest main at implementation; no slot is reserved.

The proposed baseline field is required because the current boolean conflates two independent sources. After generic removal, explicit GitHub-label replacement computes baseline OR current dedicated correction labels. Thus a category-origin requirement survives label removal, while a dedicated-only correction label can still be removed. Merely making the existing flag monotonic would change the latter behavior and is not proposed. The baseline is internal classification state, never a public assignment field or user-editable value.

## Reader/writer and regression contract

These are required tests, not claims of implemented coverage.

| Path | Writer-retirement behavior / final-state behavior | Regression |
|---|---|---|
| Existing/fresh/repeated boot | Stop seeding; final snapshot precedes DROP and restart never recreates categories | Mixed legacy/local/converted/moved/GitHub fixtures, whole unrelated rows and FK check |
| Failed final migration | Baseline addition/snapshot and table deletion roll back together | Injected snapshot/DROP failure, complete predecessor state intact |
| REST/Coordinator project creation | No category seeds for plain/local/hosted/GitHub projects | Each creation entry plus restart |
| Generic tag GET/POST | 404 for every project kind | Route absence matrix |
| REST create/patch | Stale category input fails before any mutation; unrelated unknown-key behavior unchanged | Missing/empty/populated stale values; full task/link/schedule rows; ordinary edit/naming |
| Coordinator update | Schema and executor reject stale category inputs; owner request and blocked-by semantics remain | Direct/relayed calls, unchanged request text and state |
| MCP update | SDK request and direct executor reject stale assignments before mutation | Real MCP tools/call plus direct execution, label/flag isolation |
| Ordinary worker naming | Name-only schema/prompt/relay; stale category arguments rejected; sealed owner words unchanged | Claim/daemon/relay tests, title and spec preservation |
| GitHub worker metadata | Legacy names-based label arguments remain; imported/sealed titles stay final | Multiple/empty/invalid label sets, exact dedicated ids and atomic failure |
| Dedicated-only correction | Label removal clears its requirement as today | Before/after flag and completion status |
| Legacy baseline correction | Ordinary edits/reset and empty label replacement preserve requirement; private input cannot clear either flag | Converted-project negative control above becomes a passing preservation test |
| Project move | Validate target/labels first; reset baseline and materialized classification as today; atomic schedule move | Successful move, invalid ids and injected write failure |
| Project/task deletion | Preserve current cascade and unrelated-task behavior; no implicit cross-project classification reset | Cross-project ownership, retained flags and FK check |
| Active feature/verification/spec contracts | Remove or update each advertised category route/argument/flow in the same head as its writer; retain correctly attributed Git release tools and untitled naming | Regenerated feature map plus a reference audit that rejects shipped retired routes and obsolete verification flows |
| Legacy record projection/client | Retain legacy read-only record compatibility only during staging, not a shipped category feature; final wire has no generic ids/model and dedicated ids remain | Exact record/schema inventories, API and mapper/fixture consumers |
| GitHub list/import/bug routing | Dedicated storage and issue chips unchanged | Existing import/sync/orchestration and scoped browser cases |
| Git release tags/untitled tasks | Preserve unrelated tool, credentials boundary and naming behavior | Existing tag-tool/runner-create-tag and naming tests; corrected feature-map attribution |

## Failure, deployment and rollback

Reject obsolete assignments before changing title, classification, associations, schedules or publishing success. Do not silently accept an SDK-stripped stale MCP key. Preserve existing unknown-field behavior elsewhere; do not use retirement to tighten unrelated REST fields.

Deploy server and daemon together for the ordinary metadata contract. The writer-retirement stage is code-revertible because legacy data is retained. Final data/model removal is one-way relative to old code: use a pre-migration backup, not a code-only downgrade. After the final migration, the baseline has no assignment API; only a validated project move clears it, while normal title/spec/reset paths preserve it. Failed requests leave every classification and unrelated row unchanged.

## Decision requested

| Decision | Recommendation | Status |
|---|---|---|
| Review-size staging | Retire writers before final schema/wire deletion; update affected active discovery/verification/spec contracts in each writer-removal head; temporarily retain legacy read contracts, with no new writer or dual mirror | Pending coordinator review |
| Correction provenance | Add the internal baseline in the final migration, preserving both legacy-origin protection and reversible dedicated labels | Pending coordinator review |
| Compatibility boundary | Reject retired category arguments before writes without changing unrelated ignored REST fields | Pending coordinator review |

No state, schema, wire or agent behavior is changed by this design PR. Keep `coordinator-hold` while these cutover decisions are pending. Only the final completed retirement segment closes #3481.
