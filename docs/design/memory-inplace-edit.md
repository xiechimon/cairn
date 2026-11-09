# Memory in-place edit and the MEMORY.md shape

Status: approved for implementation, revision 2, for #3664 (plan decision D123). The owner approved the recommendations and the coordinator approved implementation on 2026-11-09. The PRs that touch the migration, `machine-claim.ts` or `machine-relay.ts` keep `coordinator-hold`. This page contains no product code.

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
| Question back | When the instruction is ambiguous, the card shows the Coordinator's short question. The next sentence continues the same run. |
| Error | `Coordinator 这次没有改成，记忆没有变。` The owner's sentence is put back in the composer so a second send retries. Raw error text never shows (C5). Offline: the composer is disabled with `离线中。重新连接后才能让 Coordinator 修改。` (C7). |

Reverting (`把刚才的改回去`), moving a fact between team and project, and deleting all go through the same box. The page keeps the existing hard Delete for a file, and no other mutation control.

## 2. Storage: MEMORY.md plus memory files

| Today (`agent_memory.layer`) | New shape | Injected |
|---|---|---|
| `core` rows, team (`projectId` null) | Lines of the team `MEMORY.md` | Every Coordinator turn and every worker claim |
| `core` rows of project P | Lines of P's `MEMORY.md` | Turns routed to P and workers on P |
| `searchable`, `log` rows | Memory files `<name>.md` in their scope | Never; read through `memories` |
| `scratchpad` rows | Unchanged | With the matching thread |

The table stays `agent_memory`. The existing layer names are kept to avoid a schema change (#3695): `core` holds `MEMORY.md`, `searchable` holds memory files, `scratchpad` is unchanged, and `log` is retired into files.

- One valid `core` row per (team, project, independent owner), titled `MEMORY.md`.
- A `searchable` row's title is its file name, unique among valid files in its scope.
- Every content change keeps the versioning that exists today: a successor row plus `history`, with the predecessor invalidated in one transaction. A stale base returns 409.

**No size limit for the owner.** There is no cap, counter or save rejection anywhere in the product, and no limit text on the page. Keeping `MEMORY.md` short is the model's job, as in Claude Code.

What Claude Code does (`实测`, research §0a):
- It loads the first 200 lines or 25 KB of `MEMORY.md`, whichever comes first, and drops the rest at load.
- Near the limit, it reminds the model to keep one line per entry and move detail into topic files.
- Over the limit, the write still succeeds, and the model gets an error telling it to rewrite the index.

Ours mirrors that, model-facing only:
- **Prompt.** The system prompt and the `update_memory` description tell the model to keep each `MEMORY.md` to short one-line entries, move detail into files, and merge or drop stale lines.
- **Load bound.** The injection path silently truncates each `MEMORY.md` at the same bound Claude Code uses (200 lines or 25 KB). It appends a note to the model: `（MEMORY.md 后面还有 N 行没有加载；用 memories 读全文，并把细节移到记忆文件）`. This bound is a server constant. It is never shown to the owner and never rejects a write.
- **Write reminder.** A write that leaves the index past the bound succeeds. Its tool result carries the same reminder, so the model tidies the index on its own.

**Files.** There is no count limit. A full read of a very large file is paged, so the result stays under the 32 KB Coordinator tool-output cap (`COORDINATOR_TOOL_OUTPUT_MAX_BYTES`); `memories` takes an optional `offset`. Nothing caps the size of a file.

**Deleted.** `MEMORY_QUOTA_PER_TEAM` and `MEMORY_QUOTA_PER_AGENT`, the overlap/candidate check and the `memory_save_conflict` table go away. A document model edits text in place, so there is no duplicate fact to arbitrate. Exact duplicate file names are rejected.

**Tools.** The four names in `MEMORY_TOOLS` stay; their parameters change to the Anthropic memory-tool shape (`实测`, research §1):

| Tool | Parameters | Behavior |
|---|---|---|
| `memories` | `scope?`, `file?`, `offset?`, `query?`, `versions?` | With no arguments, lists both `MEMORY.md` files and the file names with first lines. With `file`, reads the full text. With `query`, searches. With `versions`, returns that document's earlier versions (used for `改回去`). |
| `save_memory` | `scope`, `file`, `content` | Creates a file. Returns 409 if the name exists. |
| `update_memory` | `scope`, `file` (`MEMORY.md` allowed), then either `old_str` + `new_str` or `content`, plus optional `moveTo` scope and optional `baseVersion` | Writes a successor version. Errors: "not found verbatim", "multiple occurrences", stale base (409 naming the successor). No size error. `moveTo` re-scopes a file as a successor version in the target scope, which replaces Promote. |
| `delete_memory` | `scope`, `file` | Invalidates the file and keeps its versions (so `改回去` can restore it as a new version). `MEMORY.md` cannot be deleted, only emptied. |

## 3. In-place edit backend

- **Thread.** The edit runs on a side Coordinator thread, `chief-memory-<chiefId>`, built like the digest thread. It is outside the main-thread index, thread lists, seeding, digests and reports.
- **Session and prompt.** Each sentence from the page starts or continues one run in a fresh session. The prompt holds both `MEMORY.md` texts, the focused file if any, and the owner's sentence. It does not include the main conversation (owner question 3; no reference documents otherwise).
- **Tools.** Claim sends only the four memory tools, with `remoteToolsOnly`. Relay returns 403 on any other name for this thread.
- **Writes.** They apply directly through the same services as the main thread. Each write carries the version the model read, so a concurrent change comes back as 409 and the model re-reads.
- **Run record.** A new `memory_edit` row holds the instruction, status (`working`, `done`, `failed`, `stopped`), the Coordinator's reply, and the before and after version ids of every document it changed. The card's diff is drawn from it. One `working` row is allowed per team. The main thread gets no message; its next turn simply sees the new `MEMORY.md`.
- **Routes**, all behind `requireTeam`:
  - `POST /api/teams/:id/memory-edits` (`text`, optional `file`, optional `editId` to continue);
  - `GET …/memory-edits/current`;
  - `POST …/:eid/stop`;
  - `GET /api/teams/:id/memories`, which now returns the documents.

  `POST …/memories/:mid/promote` is deleted. `DELETE` stays for files.

## 4. Every path that reads or writes memory

| Path | Today | New behavior; failure |
|---|---|---|
| Coordinator system prompt (`chief.ts` `buildChiefSystemPrompt`) | `injectMemoriesCapped` core rows, team, `MEMORY_INJECT_TOKEN_CAP` | Team `MEMORY.md` (silent load bound with a model-facing note), plus the thread scratchpad and a one-line file count. Missing index: empty section. |
| Coordinator step claim (`coordinator-steps.ts`) | Same cap, `recordUse` off for the digest | Same as the system prompt. |
| Project context (`project-instructions.ts` `projectTurnContextTraced`) | Project core rows, capped, omitted count | That project's `MEMORY.md`, with the same silent load bound. |
| Worker claim (`machine-claim.ts`, `injectMemories`) | **Uncapped** core rows, team plus project | Team plus project `MEMORY.md`, each under the silent load bound, plus the todo scratchpad. This also closes today's unbounded worker injection. |
| `save_memory`, `update_memory`, `delete_memory`, main Coordinator (`chief-tools.ts`) | Row save with quota, candidates and conflict fingerprint; successor update; hard delete | §2 tools. A stale base returns 409. A write is never rejected for size; a long index returns a tidy reminder to the model. Delete invalidates. |
| Same tools, workers (`executeWorkerMemoryTool`) | Same, with independent agent memory | Same as the Coordinator, scope from the todo. Independent agent memory (`teamScoped:false`) follows `legacy/agent-layer` retirement and is not migrated here. |
| `memories` tool | List and search rows | List, read, search and versions (§2). |
| Memory-edit side thread | none | Four tools only, direct writes, run record (§3). |
| Pre-compaction flush (`memory-flush.ts`) | Saves or updates rows | Appends lines to the scope's `MEMORY.md` or writes a file through `update_memory`. When the index is long, it writes detail into a file instead, following the prompt. A failure is reported and compaction proceeds. |
| Weekly consolidation (`memory-consolidation.ts`) | Merges and expires rows by `lastInjectedAt` | Replaced by a tidy pass: when a `MEMORY.md` passes the load bound, the digest asks the Coordinator to move detail into files and drop stale lines. The owner sees nothing. Row merge and expiry are deleted. |
| Settings `GET …/memories` | Valid team rows | `MEMORY.md` per scope, plus files with name, first line and `updatedAt`. |
| Settings Delete | Hard delete of a row | Hard delete of a file and its versions (explicit erasure), with a confirmation. |
| Settings Promote | In-place `projectId` change | Deleted; `update_memory` `moveTo`. |
| Project deletion | Project rows move to the team | Kept as today: files move to the team, and the project `MEMORY.md` merges into the team one (#3695). |

## 5. Migration (one transaction per team, idempotent)

1. For each (team, project) scope, take valid `core` rows by `createdAt`. Write one `index` row whose content is one line per row: `- **<title>**：<first line>`.
   - When a row has more than one line, or the index would pass the load bound, the row becomes a file `<title>.md`. The index line then links to it: `- [<title>](<title>.md)：<first line>`.
2. `searchable` and `log` rows become files named from the title. A name collision gets ` (2)`.
3. Old rows are invalidated with `supersededBy` pointing at the new document, so their history is kept and `memories` `versions` can reach it. `memory_save_conflict` is dropped.
4. A dry-run report for the operator (not the owner) lists, for each team, the line count and bytes of each index and the number of files. The test fixture includes a team past the load bound.

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
3. A stale `baseVersion` returns 409 and nothing is written.
4. `改回去` after an update or delete restores the text as a new version.
5. An index past the load bound is truncated silently at load, with the model note, in all four injection paths. The settings page and the save path show no limit and reject nothing. Worker injection is bounded.
6. Migration covers: multi-line core rows become files; a team past the load bound spills into files; `searchable` rows become files; it is idempotent on a second run.
7. UI: input, working, applied and error states at 1440 and 390 px, light and dark, axe clean.

This change touches `machine-claim.ts` and `machine-relay.ts` (the owner-routed machine surface) and migrates persisted state, so coordinator review comes before code.

## 8. Decisions (D123, 2026-11-09)

1. **Superseded and invalidated versions** are kept for 90 days for `改回去`, then purged.
2. **The memory-edit turn** sees memory and the owner's sentence only, never the main conversation.

## 9. Implementation order

Each PR branches off `main`, is red-first, and deletes what it replaces.

1. Storage shape and the migration.
2. Injection.
3. Tools.
4. The memory-edit side thread.
5. The page input.
