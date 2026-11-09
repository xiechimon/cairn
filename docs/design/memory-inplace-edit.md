# Memory in-place edit

Status: design draft for #3664. It waits for the owner's discussion and coordinator review, and contains no product code. Baseline `bc4ead8dd`; the UI baseline is the memory list in #3666. Research: [memory in-place edit prior art](../research/memory-inplace-edit-2026-11-09.md). Backend it extends: `memory-backend.md` and `memory.md` from #3640. Prototype: [memory-inplace-prototype](memory-inplace-prototype/README.md).

Problem: the owner reads a wrong or stale fact on `Coordinator 设置` → `记忆` and wants to say what to change right there. The v2 prototype sent that text into the main Coordinator thread, and the owner rejected it (`它完全就不是同一个行为，直接到了我的主对话里`).

Success means the owner:

- types one sentence on the memory page;
- sees exactly which entries change and how;
- applies or drops the change, and can undo it;
- never leaves the page and never finds the exchange in the main conversation.

## 1. Interaction

| Moment | What the owner sees |
|---|---|
| Input | A composer is pinned under the list, with the placeholder `告诉 Coordinator 要改什么`. It is the Coordinator composer surface (`ComposerSurface`) without attachments, mentions or slash commands. In the detail dialog the same composer sits in the footer and is scoped to that entry: the request carries the entry's id, and the placeholder reads `告诉 Coordinator 这条要怎么改`. |
| Working | A card attached above the composer, drawn like the question card (#3580), shows the owner's sentence and `Coordinator 正在看记忆 · 0:04`. A Stop button takes the send slot. The list stays readable and does not change yet. |
| Clarification or nothing to change | The card shows the Coordinator's short reply, for example `你说的“发布交接”有两条，改哪一条？`. The composer reads `回复 Coordinator…`, and the next sentence revises the same request. |
| Proposed | The card becomes `建议修改 N 处`, with one block per affected entry. Each block has a muted text tag (`修改`, `新增`, `删除`), the title and scope, and a word diff of the content. Removed words are struck through on `--diff-del-word-bg` and added words sit on `--diff-add-word-bg`, computed with the installed `diff` package as in `detail/word-diff.ts`. A delete shows the whole fact struck through; a create shows all of it as added. The footer has a primary `应用修改` and a ghost `放弃`. Typing in the composer revises the proposal instead of starting a new one. |
| Applied | The card shrinks to one line: `已修改 3 条记忆` with `撤销`. Changed rows show `刚刚更新`, created rows appear in their scope group, and deleted rows are gone. Focus moves to the status line. |
| Undone | `已撤销，记忆恢复到修改前。` Undo is offered for the newest applied change only, for 24 hours or until another change is applied (open question 2). |
| Errors | Raw error text never shows (C5). The cases:<br>- Run failed: `Coordinator 这次没有给出修改，记忆没有变。` with `重试`.<br>- Apply conflict: `有 1 条记忆在你确认前被改过，没有应用任何修改。`, naming the entry, with `按最新内容重新生成`.<br>- Undo conflict: `这条记忆之后又被改过，不能撤销。`<br>- Quota: the proposal itself names the limit: `已到 100 条上限：先删掉一条，或让 Coordinator 合并`.<br>- Offline: the composer is disabled with `离线中。重新连接后才能让 Coordinator 修改。` (C7). |

A team has one request at a time. While a request is working or proposed, a second tab shows the same card. Leaving the page keeps it, because the card is server state, not component state.

## 2. Backend

### Changeset

A new table `memory_edit` holds one request. Its columns:

- `id`, `teamId`, `chiefId`, `userId`.
- `status`: `working`, `proposed`, `applied`, `undone`, `discarded` or `failed`.
- `turns`: the owner's sentences and the Coordinator's replies, in order.
- `focusIds`: the entries the owner scoped the request to.
- `ops`: staged `create | update | delete`. Each op carries its base version `{id, updatedAt}` and the before and after title, content, scope and layer.
- `applied`: created ids, successor ids and snapshots of deleted rows.
- `undoOf`, plus timestamps.

A partial unique index allows one `working` or `proposed` row per team.

### Scoped turn

The request runs on a side Coordinator thread, `chief-memory-<chiefId>`, built the way the digest thread is (`services/chief-digest.ts`):

- It is excluded from the one-main-thread index, thread lists, seeding, digests and reports.
- Each new request starts a fresh session; follow-up sentences continue it.
- The prompt holds the owner's sentence, the focused entries in full, and the team and project titles. The system prompt says it may only change memory.

The main thread receives nothing. Its next turn simply sees the updated injected memory.

### Tools

Claim sends exactly four tools with `remoteToolsOnly`: `memories`, `save_memory`, `update_memory` and `delete_memory`. That means no MCP, no shell and no ask. Relay rejects any other tool name on this thread with 403, next to `assertChiefDigestTool`.

On this thread the three write tools do not touch `agent_memory`. Each one stages an op on the open changeset after running the same checks as a real write:

- text validation;
- the active-entry quota, counting staged creates;
- exact duplicates and overlap candidates;
- that the base row is still valid.

Errors return to the model as they do today. Scratchpad rows are invisible and cannot be staged. The run ends with `status=proposed` when ops exist; otherwise its reply is shown as a clarification.

### Apply, discard and undo

Routes, all behind `requireTeam`:

- `POST /api/teams/:id/memory-edits` with `text`, optional `focusIds`, and optional `editId` to revise an open request.
- `GET …/memory-edits/current`.
- `POST …/:eid/apply`, `…/discard`, `…/stop` and `…/undo`.

**Apply** first checks each op's base `{id, updatedAt}`; an id alone would miss an in-place promotion. It then runs every op in one transaction through `updateMemoryEntry`, `saveMemoryEntry` and `deleteMemoryEntry`. A version mismatch, missing row, quota failure or duplicate rolls everything back and returns 409 with the affected ids, so nothing is partially applied.

**Undo** builds the inverse changeset from `applied` and applies it with the same version check:

- an update goes back to the predecessor text as a new successor;
- created rows are deleted;
- deleted rows are re-created from their snapshots under new ids.

Invalidated rows are never revived. Snapshots are cleared when the undo window closes.

Every mutation pushes the existing team event, so `['memories', teamId]` and the changeset query refetch.

## 3. Every path that reads or writes memory

| Path | Reads/writes | Behavior with a pending or applied changeset |
|---|---|---|
| Main Coordinator `save_memory`, `update_memory`, `delete_memory` (`chief-tools.ts`) | write | Unchanged. If it touches a staged base, apply returns a conflict. Undoing an entry it changed also returns a conflict. |
| Worker memory tools (`executeWorkerMemoryTool`) | write | Same as the main Coordinator tools. |
| Settings Delete (#3666) | write | Same; the card shows the conflict on apply. |
| Settings Promote (`promoteMemoryEntry`, in place) | write | It changes `updatedAt`, so the `{id, updatedAt}` check catches it. |
| Weekly consolidation | write | Successors and invalidations make the base stale, so apply returns a conflict. |
| Pre-compaction flush (`memory-flush.ts`) | write | An update causes a conflict. A new duplicate of a staged create causes an apply-time duplicate 409. |
| Expiry | write | An invalidated base causes a conflict. |
| Memory-edit staging tools | read, stage | They never write `agent_memory`. Their scope is the team plus its projects, with no scratchpads. |
| Apply and undo routes | write | One transaction, version-checked, all or nothing. |
| Injection into Coordinator and worker prompts | read | Only committed valid rows. Staged ops are never injected, and a turn sees the state before or after an apply, never half of it. |
| Settings list `GET …/memories` | read | Committed rows only; the proposal is drawn from the changeset. |
| Project or team deletion | write | Base rows vanish, so apply returns 404 and the card shows a conflict. Team deletion cascades to the changeset. |
| Run failure, stop, server restart | none | The changeset becomes `failed` or `discarded`; nothing staged was ever written. A step left claimed by a restart is swept like other chief steps, and its changeset is marked `failed`. |

## 4. What this deletes or replaces

- **The v2 prototype path that posted the instruction into the main Coordinator thread (#3640 prototype).** This includes its `已发到 Coordinator 对话。` status and the detail line telling the owner to ask in the main conversation.
- **Two lines in the #3640 design docs.** In `memory-backend.md`, "No public write API for editing … correction path through conversation" is replaced by this design. So is "Inline Edit is not added … correction remains available through the Coordinator's tools" in `memory.md`.
- **The scattered `chief-digest-` prefix checks.** They sit in the schema index, seeding, `coordinator/index.ts`, `chief.ts`, `mcp-threads.ts` and consolidation. In the same change they become one side-thread predicate that covers both the digest and memory-edit threads.
- **Any second edit path.** There is no hand-edit form and no free-text PATCH; every content change goes through a changeset.

## 5. Tests to write first

1. Sending on the memory page creates no `chief_message` row in the main thread. This test is red on the v2 prototype behavior.
2. A memory-edit turn that calls any tool outside the four gets 403, and its write tools leave `agent_memory` unchanged.
3. Apply with one stale base (a successor, a promotion or a deletion) applies nothing and returns the affected ids.
4. Undo right after apply restores the visible text. Undo after a later change is a conflict, and nothing invalid is revived.
5. Quota and duplicate checks count staged creates. Two tabs see one changeset, and a second request while one is open is rejected.
6. UI: every state in §1 at 1440 and 390, light and dark, is axe clean. Focus moves to the status line after apply and back to the composer after discard.

Implementation touches `services/machine-claim.ts` and `services/machine-relay.ts`, which are on the owner-routed machine surface. It also adds a persisted table. So this page needs coordinator review before code. The turn uses the team's Coordinator router model; no new model is added.

## 6. Open questions for the owner

1. **Confirm, or apply at once?** Recommended: propose and confirm. It costs one click, and an edit can rewrite team-wide facts that every lane reads. The alternative is to apply at once with undo, which is what ChatGPT and claude.ai appear to do.
2. **How long is undo offered?** Recommended: 24 hours, or until the next change. Deleted text is kept that long so undo can restore it.
3. **What context does the turn see?** Recommended: only memory and the owner's sentence, not the main conversation. The cost: an instruction like "change it the way I said earlier" will not work.
4. **Can a proposal change scope?** Recommended: no. Moving a fact from a project to the team stays with the existing Promote button, rather than a create plus a delete.
5. **Walk claude.ai on the owner's account?** Its "Tell Claude what to change" box could be tested with a harmless fact, added and then removed, to see what happens after sending.
