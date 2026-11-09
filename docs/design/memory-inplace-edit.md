# Memory in-place edit and the MEMORY.md shape

Status: approved for implementation, revision 3, for #3664 (plan decision D123). The owner approved the recommendations and the coordinator approved implementation on 2026-11-09. The PRs that touch the migration, `machine-claim.ts` or `machine-relay.ts` keep `coordinator-hold`. This page contains no product code.

The owner decided on #3677 (2026-11-09):

- Changes apply directly. There is no proposal step and no apply or discard buttons (`我选择相信模型`).
- There is no undo or promote button. To revert or change scope, the owner tells the Coordinator, and the model picks the scope itself.
- Memory moves to the Claude Code shape: one `MEMORY.md` per scope, always injected and kept short by the model, plus unlimited memory files. There is no owner-facing size limit.

Baseline `bc4ead8dd`. The page layout follows the #3666 restyle: a `每个线程都会读` section for `MEMORY.md` and a `记忆文件` section. Research: [prior art, revision 2](../research/memory-inplace-edit-2026-11-09.md). This page replaces the row model in `memory-backend.md` and `memory.md` (#3640). Prototype: [memory-inplace-prototype](memory-inplace-prototype/README.md).

## 1. Interaction

| Moment | What the owner sees |
|---|---|
| Input | A composer pinned under the page, placeholder `告诉 Coordinator 要改什么`. It is the Coordinator composer surface without attachments, mentions or slash commands. In a file's detail dialog the same composer sits in the footer, scoped to that file. |
| Working | A card attached above the composer, like the question card (#3580). It shows the owner's sentence and `Coordinator 正在改记忆 · 0:04`. Stop takes the send slot. |
| Applied | The page refreshes in place: changed lines and files show `刚刚更新`. The card shows `已按你的话改了 N 处` and a read-only word diff of each change (the `MEMORY.md` lines and files touched). The card has no buttons. It stays until the next sentence or until the owner leaves the page. |
| Question back | When the instruction is ambiguous, the card shows the Coordinator's short question. Persisted status is `awaiting_input`; the next sentence continues the same edit record in a fresh execution attempt. |
| Partial | If any writes committed before failure, stop or restart, show `已修改 N 处，其余未完成` with the committed diffs and the uncompleted work. Keep the instruction on the card; do not automatically resend it. |
| Stopped | With no committed writes, show `已停止，记忆没有变`. A new send starts a new edit record. |
| Error | Only when zero writes committed: `Coordinator 这次没有改成，记忆没有变。` The owner's sentence is put back in the composer so a second send retries. Raw error text never shows (C5). Offline: the composer is disabled with `离线中。重新连接后才能让 Coordinator 修改。` (C7). |

Reverting (`把刚才的改回去`), moving a fact between team and project, and deleting all go through the same box. The page keeps the existing hard Delete for a file, and no other mutation control.

## 2. Storage: MEMORY.md plus memory files

| Today (`agent_memory.layer`) | New shape | Injected |
|---|---|---|
| `core` rows, team (`projectId` null) | Lines of the team `MEMORY.md` | Every Coordinator turn and every worker claim |
| `core` rows of project P | Lines of P's `MEMORY.md` | Turns routed to P and workers on P |
| `searchable`, `log` rows | Memory files (existing titles preserved) in their scope | Never; read through `memories` |
| `scratchpad` rows | Unchanged | With the matching thread |

The table stays `agent_memory`. The existing layer names are kept to avoid a schema change (#3695): `core` holds `MEMORY.md`, `searchable` holds memory files, `scratchpad` is unchanged, and `log` is retired into files.

- One valid `core` row per (team, project, independent owner), titled `MEMORY.md`. Existing independent scopes stay separate, as in #3695; this feature creates no new independent-agent scope.
- A `searchable` row's title is its file name, unique among valid files in its scope. `MEMORY.md` is reserved for `core`: file creation, rename and move reject that exact name with 400. Existing file titles are preserved, including titles without `.md`, as in #3695.
- Every destructive mutation requires `baseVersion`, the opaque document revision returned by reads, listings and successful writes. Content, name, scope and validity changes advance it. Updates, moves, soft deletes, restores and Settings hard Delete compare it inside the transaction; missing tokens return 400, stale tokens return 409 with no mutation. A valid-row id alone is insufficient if metadata can change in place. Content updates retain the existing successor-row plus `history` model.
- **Scope lifecycle.** Use a single transactional ensure-index path before any scope read or write. Team creation, every project creation/import/clone/conversion path, worker first use, flush, tidy, restore and post-upgrade empty scopes all reach it; an empty scope gets an empty `core` row titled `MEMORY.md`. Concurrent first access returns the same row under the serialized database transaction. It never replaces an existing index. Reads return its revision even for empty content; `update_memory` first reads it, then supplies that revision. Initialization failure fails the operation, rather than returning an unversioned synthetic index.

**No size limit for the owner.** There is no cap, counter or save rejection anywhere in the product, and no limit text on the page. Keeping `MEMORY.md` short is the model's job, as in Claude Code.

What Claude Code does (`Verified`, research §0a):
- It loads the first 200 lines or 25 KB of `MEMORY.md`, whichever comes first, and drops the rest at load.
- Near the limit, it reminds the model to keep one line per entry and move detail into topic files.
- Over the limit, the write still succeeds, and the model gets an error telling it to rewrite the index.

Ours mirrors that, model-facing only:
- **Prompt.** The system prompt and the `update_memory` description tell the model to keep each `MEMORY.md` to short one-line entries, move detail into files, and merge or drop stale lines.
- **Load bound.** The injection path silently truncates each `MEMORY.md` at the same bound Claude Code uses (200 lines or 25 KB). It appends a note to the model: `（MEMORY.md 后面还有 N 行没有加载；用 memories 读全文，并把细节移到记忆文件）`. This bound is a server constant. It is never shown to the owner and never rejects a write.
- **Write reminder.** A write that leaves the index past the bound succeeds. Its tool result carries the same reminder, so the model tidies the index on its own.

**Files.** There is no count limit. A full read of a very large file is paged, so the result stays under the 32 KB Coordinator tool-output cap (`COORDINATOR_TOOL_OUTPUT_MAX_BYTES`); `memories` takes an optional `offset`. Nothing caps the size of a file.

**Deleted.** `MEMORY_QUOTA_PER_TEAM` and `MEMORY_QUOTA_PER_AGENT`, the overlap/candidate check and the `memory_save_conflict` table go away. A document model edits text in place, so there is no duplicate fact to arbitrate. Exact duplicate file names are rejected.

**Tools.** The four names in `MEMORY_TOOLS` stay; their parameters change to the Anthropic memory-tool shape (`Verified`, research §1):

| Tool | Parameters | Behavior |
|---|---|---|
| `memories` | `scope?`, `file?`, `offset?`, `query?`, `versions?` | With no arguments, lists both `MEMORY.md` files and the file names with first lines. Listings and reads include the current revision, including a tombstone revision for a deleted document. With `file`, reads the full text. With `query`, searches. With `versions`, returns that document's earlier versions (used for `改回去`). |
| `save_memory` | `scope`, `file`, `content` | Creates a file only if the name is absent in the same transaction; 409 if occupied, 400 for reserved `MEMORY.md`. Returns its revision. It cannot overwrite or upsert. |
| `update_memory` | `scope`, `file` (`MEMORY.md` allowed), then either `old_str` + `new_str` or `content`, required `baseVersion`, plus optional `moveTo` scope, `renameTo` file name or `restoreVersion` history id | Writes a successor version; `restoreVersion` selects retained history, checks the current live/tombstone base and restores as a new version rather than overwriting history. Errors: "not found verbatim", "multiple occurrences", stale base (409 naming the successor). No size error. Rename and move reserve the destination atomically, return 409 if occupied and reject `MEMORY.md` as a file destination. The index cannot move or rename. `moveTo` re-scopes a file as a successor version in the target scope, which replaces Promote. |
| `delete_memory` | `scope`, `file`, required `baseVersion` | Invalidates the file and keeps its versions (so `改回去` can restore it as a new version). `MEMORY.md` cannot be deleted, only emptied. |

## 3. In-place edit backend

- **Thread.** The edit runs on a side Coordinator thread, `chief-memory-<chiefId>`, built like the digest thread. It is outside the main-thread index, thread lists, seeding, digests and reports.
- **Session and prompt.** Each sentence from the page starts or continues one run in a fresh session. The prompt holds both `MEMORY.md` texts, the focused file if any, and the owner's sentence. It does not include the main conversation (owner question 3; no reference documents otherwise).
- **Tools.** Claim sends only the four memory tools, with `remoteToolsOnly`. Relay returns 403 on any other name for this thread.
- **Writes and atomicity.** Each tool call commits directly through the same version-checked services as the main thread, atomically with its change receipt in `memory_edit`. A move updates source, destination and receipt in one transaction. There is no transaction held open across model calls and no run-level rollback. A later failure cannot undo earlier committed documents. Stop, tool timeout, daemon loss and server restart reconcile persisted receipts before selecting the terminal state.
- **Retry.** Every mutating side-thread call has a persisted attempt/call id; a repeated relay delivery returns its receipt without writing again. After partial success the owner may continue with the same `editId`; the prompt includes committed receipts and fresh revisions and asks only for unfinished work. It never replays the full instruction automatically. Restoring a deleted file requires its current tombstone revision and an absent destination; restoring an older version over a live file requires the live revision.
- **Run record.** A new `memory_edit` row holds the instruction, status (`working`, `awaiting_input`, `done`, `failed`, `stopped`, `partial`), the Coordinator's reply, and the before and after version ids of every document it changed. The card's diff is drawn from it. One active row (`working` or `awaiting_input`) is allowed per team. Admission, continuation and stop use an edit-attempt revision to reject racing tabs or late relay replies with 409. Attempts record the failure/stop/restart reason separately from committed receipts. The main thread gets no message; its next turn simply sees the new `MEMORY.md`.
- **Transitions.** `working` → `done` after successful completion; an ambiguous reply → `awaiting_input`, retaining any committed receipts. Follow-up on that edit atomically returns to `working`. Stop or restart of `working` yields `partial` if receipts exist, otherwise `stopped` (stop) or `failed` (restart). A failed execution uses `partial` if receipts exist, otherwise `failed`. `awaiting_input` has no live execution to recover on restart and remains waiting; stop yields `partial` or `stopped` by the same receipt rule. Terminal rows never resume implicitly; an explicit continuation of `partial` starts a fresh attempt with receipts, while other terminal states require a new edit.
- **Routes**, all behind `requireTeam`:
  - `POST /api/teams/:id/memory-edits` (`text`, optional `file`, optional `editId` to continue);
  - `GET …/memory-edits/current`;
  - `POST …/:eid/stop`;
  - `GET /api/teams/:id/memories`, which now returns the documents.

  `POST …/memories/:mid/promote` is deleted. `DELETE` stays for files.

## 4. Every path that reads or writes memory

| Path | Today | New behavior; failure |
|---|---|---|
| Coordinator system prompt (`chief.ts` `buildChiefSystemPrompt`) | `injectMemoriesCapped` core rows, team, `MEMORY_INJECT_TOKEN_CAP` | Team `MEMORY.md` (silent load bound with a model-facing note), plus the thread scratchpad and a one-line file count. Missing index: ensure an empty persisted index and return its revision (§2). |
| Coordinator step claim (`coordinator-steps.ts`) | Same cap, `recordUse` off for the digest | Same as the system prompt. |
| Project context (`project-instructions.ts` `projectTurnContextTraced`) | Project core rows, capped, omitted count | That project's `MEMORY.md`, with the same silent load bound. |
| Worker claim (`machine-claim.ts`, `injectMemories`) | **Uncapped** core rows, team plus project | Team plus project `MEMORY.md`, each under the silent load bound, plus the todo scratchpad. This also closes today's unbounded worker injection. |
| `save_memory`, `update_memory`, `delete_memory`, main Coordinator (`chief-tools.ts`) | Row save with quota, candidates and conflict fingerprint; successor update; hard delete | §2 tools. A missing base returns 400; a stale base returns 409 for every destructive tool operation. A write is never rejected for size; a long index returns a tidy reminder to the model. Delete invalidates. |
| Same tools, workers (`executeWorkerMemoryTool`) | Same, with independent agent memory | Same as the Coordinator, scope from the todo. Existing independent scopes remain separately folded as in #3695; no team/project tool may select them. |
| `memories` tool | List and search rows | List, read, search and versions (§2). |
| Memory-edit side thread | none | Four tools only; per-call atomic writes and receipts, explicit partial success and clarification transitions (§3). |
| Pre-compaction flush (`memory-flush.ts`) | Saves or updates rows | Ensures the scope index, reads its revision, then appends through `update_memory`; new files use `save_memory`. Conflicts trigger a fresh read before recomputing the append, never blind replay. When the index is long, it writes detail into a file instead, following the prompt. A failure is reported and compaction proceeds. |
| Weekly consolidation (`memory-consolidation.ts`) | Merges and expires rows by `lastInjectedAt` | Replaced by a tidy pass: when a `MEMORY.md` passes the load bound, the digest asks the Coordinator to move detail into files and drop stale lines. Each tidy mutation uses fresh base revisions; stale work is recomputed, and committed file moves remain recorded if a later call fails. The owner sees nothing. Row merge and expiry are deleted. |
| Settings `GET …/memories` | Valid team rows | `MEMORY.md` per scope, plus files with name, first line, `updatedAt` and current revision. |
| Settings Delete | Hard delete of a row | Hard delete of a file and its versions (explicit erasure), with confirmation and required `baseVersion` from that confirmation view. Check before erasure; 400 if missing, 409 if stale, no erasure. Purge after the 90-day retention period compares the observed invalidation revision and cutoff inside its transaction, never purging a restored live version. |
| Settings Promote | In-place `projectId` change | Deleted; `update_memory` `moveTo`. |
| Project deletion | Project rows move to the team | The deletion request must carry the observed project/team index and file revisions (a scope manifest including namespace revision, so a newly created file also conflicts). In one transaction, compare that manifest before any destructive write, reserve destination names with §5 allocation, move files, rewrite their references in the project index, merge it into the ensured team index and delete the project. Keep existing team files unchanged. Any conflict or failure rolls back the entire deletion; never merge a stale pre-transaction snapshot. #3695 currently re-scopes rows and folds indexes; collision allocation and reference rewriting are required completion work. |

## 5. Storage fold and migration completion (transactional, idempotent)

Verified against [#3695](https://github.com/xiechimon/cairn/pull/3695) at `3ff434b95ade49d58ca50b6a12b219579483e6da`: `foldMemoryIndexes` runs on database open and project deletion, folds non-adopted valid core rows by `createdAt` then SQLite rowid, preserves existing `MEMORY.md` text, spills multiline facts into `searchable`, converts `log` to `searchable`, and keeps independent owners separate. It does not yet allocate unique names, create empty indexes or spill at the load bound. These are completion requirements, not claims that #3695 implements them.

1. In the storage transaction, group by (team, project, independent owner). Fold legacy facts into one `core` row titled `MEMORY.md`, using #3695's `- <title>：<first line>` format. Preserve existing index text. Each old core row is invalidated with `supersededBy` pointing at the index, keeping its history reachable.
2. A multiline fact becomes a `searchable` file; retain its title, and put the allocated title in the index reference. The later injection/tidy segment handles load-bound spill; the storage fold does not truncate or lose text. Existing searchable files and converted log rows retain their content and version history.
3. **One name allocator** serves all migration files (multiline core, searchable and log) and project-deletion moves. Reserve `MEMORY.md` first. Preserve unique destination titles; process incoming rows by `createdAt`, then rowid, allocating the first free `name (2).md`, `name (3).md`, etc. before an existing `.md` suffix, or `name (2)` without one. Check the entire namespace, including literal suffixed titles and duplicate core titles; a legacy searchable `MEMORY.md` becomes `MEMORY (2).md`. Never overwrite or merge distinct file contents. Write index references from allocated names, and rewrite moved-file references before merging indexes on project deletion. The initial fold reads and changes rows inside one serialized transaction, with no external stale snapshot. A second fold changes no names or versions.
4. Ensure empty indexes through §2 for scopes with no legacy rows. Drop overlap/candidate checks, quotas and `memory_save_conflict` only in the tools segment that migrates their callers; #3695 still retains them. The operator report lists line counts, bytes, files and renames. No owner-facing cap is introduced.

## 6. What this deletes

- The proposal and confirm step, apply/discard/undo routes and buttons, and the staged changeset from revision 1.
- The v2 prototype path into the main thread.
- The Promote route, `promoteMemoryEntry` and its button.
- `MEMORY_QUOTA_*`, `memory_save_conflict`, overlap candidates and `force`. No size cap replaces them.
- `capMemories`, `MEMORY_INJECT_TOKEN_CAP` and `lastInjectedAt`-based expiry.
- Consolidation merge and expiry.
- The `记忆 · {n} / {max}` count in `chief-settings.tsx`.
- The scattered `chief-digest-` prefix checks. They become one side-thread predicate that covers digest and memory-edit.

## 7. Tests to write first

1. A sentence on the memory page writes no `chief_message` row in the main thread, and the change is visible in the next main-thread prompt.
2. A memory-edit turn gets 403 for any non-memory tool.
3. For update, rename, move, soft delete, restore and Settings hard Delete, omit the base (400), then race version A against a committed version B (409). Assert B and every unrelated document survive, with no receipt for a rejected write. Cover main-thread, worker, side-thread, flush and tidy entry paths; check destination collision and reserved-name rejection before any source invalidation.
4. `改回去` after update or soft delete restores text as a new version using the current live/tombstone revision. A stale project-deletion manifest returns 409 before changing either scope. Racing restore and erasure cannot recreate erased history or delete a restored version. Retention purge does not touch newly restored live rows.
5. An index past the load bound is truncated silently at load, with the model note, in all four injection paths. The settings page and save path show no limit and reject nothing. Worker injection is bounded.
6. Storage fixtures include duplicate multiline core titles, searchable/log collisions, literal suffixed names, reserved `MEMORY.md`, existing independent scopes and an idempotent second fold. Project deletion with same-named team/project files keeps both contents, rewrites index references, and rolls back all changes on injected failure.
7. For a fresh team, each project creation/import/clone/conversion path, an empty upgraded scope and concurrent first readers/writers, assert exactly one empty versioned index, then a successful first update. Ensure failure is surfaced without a synthetic revision.
8. A two-document run commits A and fails on B: persist A and its receipt, show `partial` plus A's diff, and continue only unfinished B. Repeat for stop, restart, lost tool response and duplicated relay delivery; assert no duplicated append or misleading no-change message. A single failed tool transaction commits neither its document nor receipt.
9. Clarification persists `awaiting_input` across tabs and restart, continues with the same edit id, and stops without dispatching work. Cover clarification after committed writes and racing follow-up/stop, rejecting late replies.
10. UI: input, working, applied, awaiting input, partial, stopped, error and offline states at 1440 and 390 px, light and dark, axe clean. Current prototype captures only input/working/applied/error; remaining states require live implementation evidence.

These are required red-first implementation cases, not executed product tests in this documentation PR. Every §4 path must map to an implementation test before its segment ships.

This change touches `machine-claim.ts` and `machine-relay.ts` (the owner-routed machine surface) and migrates persisted state, so coordinator review comes before code.

## 8. Decisions (D123, 2026-11-09)

1. **Superseded and invalidated versions** are kept for 90 days for `改回去`, then purged.
2. **The memory-edit turn** sees memory and the owner's sentence only, never the main conversation.
3. **Final review decisions.** Require revisions for all destructive paths; initialize empty scopes lazily through one transactional path; use per-call atomicity and explicit partial success; persist clarification; reserve the index name; share deterministic collision allocation for migration and deletion; retain storage layer names. These complete the approved direct-write behavior. Reversible before implementation by editing this design; changes to shipped persistence need a migration.
4. **Safeguards (Ladder).** Feature registration and English prose use the existing generated-map and language gates (static analysis). Concurrency, lifecycle, atomicity and collision corrections are specified as implementation regression cases above. No runtime safeguard is claimed here: this PR contains only design and fixture artifacts, and runtime checks belong with the implementation segments.

## 9. Implementation order

Each PR branches off `main`, is red-first, and deletes what it replaces.

1. Storage shape and the migration.
2. Injection.
3. Tools.
4. The memory-edit side thread.
5. The page input.
