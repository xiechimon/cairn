# Prior art: telling the agent what to change about memory, on the memory page

Status: research, 2026-11-09, for #3664. No code changed. Feeds [memory in-place edit design](../design/memory-inplace-edit.md).

Question (ian, on the v2 memory prototype, 2026-11-09): the owner wants to type "what to change" on the memory page and have the Coordinator change memory there. The v2 prototype routed the text into the main Coordinator thread; ian rejected that: `它完全就不是同一个行为，直接到了我的主对话里`. What do other products do after the instruction is sent: is it applied or proposed, is a diff shown, is there undo or history, where does the transcript live, which operations may the model use, and how are conflicts handled?

Labels: `实测` = read first-hand in a primary source or in cairn code this session; `推断` = follows from `实测`; `猜测` = everything else. No product was operated on a signed-in account: sending an instruction on ian's claude.ai would change his real memory, so the claude.ai post-send behavior stays `推断` until a walk is approved (open question 6 in the design).

## 0. Answers

1. **Nobody bounces the owner into a chat thread from the memory page.** ChatGPT (`实测`: a text box at the bottom of the memory summary, "it will update accordingly") and claude.ai (`实测`: a "Tell Claude what to change or remove" box on the Manage page) keep the instruction on the memory surface. Devin is the counter-example: its memory page is read-only and every change goes through a session (`实测`), which is exactly the behavior ian rejected.
2. **Owner-initiated edits are applied directly everywhere we could read.** ChatGPT, claude.ai legacy, Letta `/remember` and Devin apply without a confirmation step (`实测` or `推断`). Approval exists only for memories the model generates on its own (Cursor 1.2, `实测`). Our design still proposes before applying (design §1, open question 1) because a Coordinator edit can rewrite team-wide facts that steer every lane; that is a deliberate departure, not prior art.
3. **History with restore is common; a diff before apply is not.** ChatGPT restores prior versions (`实测`, Oct 2025), Letta keeps git history and linear undo/redo checkpoints (`实测`, source), Mem0 stores old value, new value and the input that caused the change (`实测`). Only Devin shows "what changed", after the fact, as a card in the session (`实测`).
4. **The change record is the transcript.** Mem0 keeps the triggering input on the history row (`实测`); Devin links each note to its session (`实测`). This supports storing the owner's instruction with the changeset instead of a chat thread.
5. **Stale writes are rejected, not overwritten.** Devin rejects and retries stale writes (`实测`); Letta uses an optimistic version column (`实测`, source). cairn's own `updateMemoryEntry` already returns 409 for a superseded predecessor (`实测`, `apps/server/src/services/memory.ts`).
6. **Tool surface.** The Anthropic memory tool and Letta both expose create / str_replace / insert / delete / rename and return "not verbatim" and "multiple occurrences" errors to the model (`实测`). cairn already has `save_memory`, `update_memory`, `delete_memory` and `memories` with candidate/duplicate/quota errors (`实测`, `apps/server/src/services/chief-tools.ts`); no new tool vocabulary is needed.

## 0b. Prior art inside cairn (`实测`, code at `bc4ead8dd`)

| Mechanism | What it gives this design | Where |
|---|---|---|
| Digest side thread | A Coordinator thread outside the main conversation (`chief-digest-<chiefId>`), excluded from the one-main-thread unique index and from seeding, run as a fresh session with a restricted read-only tool list; the restriction is enforced twice, at claim (`remoteTools`, `remoteToolsOnly`) and at relay (`assertChiefDigestTool`, 403) | `services/chief-digest.ts`, `services/machine-claim.ts`, `services/machine-relay.ts`, `db/schema.ts` `chief_thread_coordinator_unique` |
| Versioned update | Changed content inserts a successor and invalidates the predecessor in one transaction; a stale predecessor returns 409 naming the successor | `services/memory.ts` `updateMemoryEntry` |
| Save candidates | Overlap returns candidates without writing; repeat needs `force:true` | `services/memory.ts` `saveMemoryEntry` |
| In-place promotion | `promoteMemoryEntry` changes `projectId` on the same id with a new `updatedAt`: an id alone is not a version token | `services/memory.ts` |
| Propose then decide | Retro proposals are drafts with `accept`/`dismiss` routes and `decidedAt`/`decidedBy` | `routes-chief.ts`, `db/schema.ts` `retro_proposal` |
| Card on the composer | The question card is drawn as one surface with the composer below it (#3580) | `chief/chief-question-card.tsx`, `chief/composer-surface.tsx` |
| Word diff | `diffWordsWithSpace` from the installed `diff` package, with diff tokens `--diff-add-bg`, `--diff-del-bg`, `--diff-*-word-bg` | `detail/word-diff.ts`, `detail/docpane.tsx` |

## Method

Method: official help centers, release notes, docs and open-source code, fetched over the web. No product was operated: no signed-in account was used. Per the `walk` rule, a UI behavior marked `推断` or `猜测` must be walked in ian's Chrome before it is used as a design basis.

## 1. claude.ai memory (Anthropic)

Sources:
- S1 Help: chat search and memory. https://support.claude.com/en/articles/11817273
- S2 Help: import and export memory. https://support.claude.com/en/articles/12123587
- S3 Release notes, entry dated August 25, 2026: "Memory in Claude Cowork, editable topics". https://support.claude.com/en/articles/12138966-release-notes
- S4 Blog: memory works everywhere (Aug 25, 2026). https://claude.com/blog/claudes-memory-works-everywhere-and-you-decide-whats-in-it
- S5 API memory tool docs. https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool

Findings:
- `实测` Current model: memory is a set of **Topics** that are saved while you chat, not after the chat ends. Each topic can be read, edited with an edit icon, or deleted. S1: "Select any topic to read it, then use the edit icon". S3 says the same.
- `实测` Location: Settings > Your Claude > "Manage" next to Your memory (older layout: Settings > Memory). S1.
- `实测` The memory surface has a natural-language box. S2: add information "using the 'Tell Claude what to change or remove' box". This is the only primary mention found.
- `实测` Import flow on the same surface: Claude "will extract key information and store it as individual memory edits", which you review via "Manage edits". This is from S2's legacy-layout section. `推断`: in the legacy experience, NL instructions became discrete "edits" layered over the synthesized summary, with a list you can review and remove.
- `实测` Legacy (summary) experience: you could ask "Claude to edit the existing summary". In-chat edits "immediately apply to your next conversation" and do not wait for the 24h synthesis. S1, legacy section.
- `实测` In chat: "Tell Claude what you'd like it to remember, change, or forget"; the update "applies to your next conversation". S1.
- Not documented in any source read: what happens after sending in the "Tell Claude what to change" box. No source says whether the edit applies immediately or is proposed first, shows a preview or diff, or leaves a transcript. `推断`: it applies directly with no confirmation step. Two reasons: chat-side edits apply directly, and the docs mention no review step except "Manage edits" for imports. `猜测`: no chat thread is created; the instruction and its result show inline on the memory surface.
- `实测` Undo/history: no per-topic history or undo is documented. Reset is irreversible: "this cannot be undone" (S1).
- `实测` Refusals: some categories (ID numbers, criminal history, immigration status) are never stored, and Claude "says when it can't update memory". S4. Sensitive topics need an opt-in, and a one-time notice appears in chat when Claude declines to save one (S1). These are the only documented error/refusal paths.
- `猜测` (not primary): community-published system prompts describe a chat-side tool `memory_user_edits` with view/add/remove/replace commands. It could not be verified in an Anthropic source.
- API memory tool (S5), `实测`. Commands are `view`, `create`, `str_replace`, `insert`, `delete` and `rename` under `/memories`, and the client runs them.
  - Errors are plain strings with `is_error: true`, e.g. "did not appear verbatim", "Multiple occurrences of old_str".
  - `rename` refuses to overwrite an existing destination.
  - Deleting or renaming the `/memories` root is rejected.
  - Path-traversal validation is required.
  - Concurrency is not addressed (`推断`: left to the handler).

## 2. ChatGPT memory (OpenAI)

Sources:
- O1 Help: "Memory in ChatGPT". https://help.openai.com/en/articles/8590148-memory-faq (redirects to …-memory-in-chatgpt; fetched via r.jina.ai reader because the direct fetch returned 403)
- O2 ChatGPT release notes. https://help.openai.com/en/articles/6825453-chatgpt-release-notes (entries Oct 15 2025, Jun 4 2026, Jun 12 2026)

Findings:
- `实测` Location: Settings > Personalization > Memory. The **memory summary** page lets you "Enter a correction in the text field" or "Highlight text and provide a correction". O1.
- `实测` Apply mode: per the June 12, 2026 notes, you type a change "into the text box at the bottom of the memory summary". The notes add "it will update accordingly". O2. `推断`: applied directly with no confirm step; none is described.
- `实测` Highlight-to-correct is a scoped variant: the user selects the affected span, so the model gets an explicit target. O1, O2.
- `实测` Removal semantics differ by action:
  - "Don't mention this again" reduces future references and "does not delete the original source".
  - "Delete and turn off memory" is a separate, explicit destructive action.
  - Both are in O1.
- `实测` Version history: since Oct 15, 2025 you can "view and restore prior versions of saved memories". That entry also adds automatic prioritization (top-of-mind vs background), which the user can turn off, plus search and sort. O2. The O1 FAQ repeats that controls may include "automatic prioritization, and version history".
- `实测` Propagation: "It can take time for deletion and Memory updates to propagate". Deleted saved memories may sit in logs for up to 30 days. O1.
- `实测` Provenance: **Sources** under a response show which memory/chat informed it, and you can correct, delete or mark it not relevant from there. O1, O2 (memory sources entry).
- `实测` Improved memory (Jun 4, 2026) updates memories automatically to reduce "stale or contradictory saved memories". Legacy saved memories remain selectable. O2.
- Transcript: `推断` corrections typed on the summary page don't create a chat; O1 lists them as summary-page controls. Neither source describes a diff/preview, an error UI, or concurrency.

## 3. Cursor Memories and Windsurf (Cascade) memories

Sources:
- C1 Cursor 1.0 changelog. https://cursor.com/changelog/1-0
- C2 Cursor 1.2 changelog. https://cursor.com/changelog/1-2
- C3 Former docs URL docs.cursor.com/context/memories, which now redirects to https://cursor.com/docs/rules
- W1 Windsurf Memories & Rules. https://docs.devin.ai/windsurf/plugins/cascade/memories.md (docs.windsurf.com redirects to docs.devin.ai)

Findings:
- `实测` Cursor: Memories are stored per project, per user, and "managed from Settings" (C1, 1.0 beta). 1.2 GA "introduced user approvals for background-generated memories" (C2).
  - This is a propose-then-approve model, but only for memories the background model generates.
  - `推断`: memories the user asks for explicitly were saved directly.
- `实测` Cursor today: the memories docs URL redirects to Rules (C3), and the current Customize tabs list no Memories. `推断`: the feature has been retired in favor of `.cursor/rules` and `/create-rule`, so persistent guidance is now version-controlled files. The retirement date and reason were not found (unverified).
- `实测` Windsurf:
  - Cascade may auto-generate memories, or you prompt "create a memory of ...".
  - Memories are workspace-scoped.
  - You edit one by clicking into it, then the Edit button, under the Customizations panel.
  - All three points are in W1.
- `实测` Windsurf documents no approval step, history, or NL-on-surface instruction box (W1, absence). `推断`: edits are direct form edits, and NL changes happen in the Cascade chat.

## 3b. Devin Memory (Cognition), added because it is the closest documented analog

Source:
- D1 https://docs.devin.ai/product-guides/memory.md

Findings:
- `实测` Storage: memory is a "persistent Git repository of Markdown notes". Each entry is a one-line bullet with a `[source: <session url>; added: <date>]` back-link. D1.
- `实测` Apply and transcript: Devin edits the note, commits, merges, and saves. An "**Updated memory** card in the session shows what changed". D1. So the transcript lives in the session (a thread), and the change is shown after the fact as a card.
- `实测` Concurrency: "a stale write is rejected and retried". Conflicting edits "are resolved rather than overwritten". D1. This is optimistic concurrency on git.
- `实测` Memory surface: Customize → Memory lets you browse the files and see each dreaming run with what it changed. The files are "read-only in the app": to change or remove a memory, you ask Devin in a session. D1.
- `实测` Background consolidation ("Dreaming", about daily) merges, prunes and reorganizes notes, and it keeps "Source links and explicit preferences". D1.
- `推断` Undo is not exposed in the UI, though git history makes it possible.

## 4. Letta / MemGPT

Sources:
- L1 MemFS. https://docs.letta.com/concepts/memfs/index.md
- L2 Memory & dreaming. https://docs.letta.com/configuration/memory/index.md
- L3 Letta server source at tag 0.16.8:
  - https://github.com/letta-ai/letta/blob/0.16.8/letta/functions/function_sets/base.py
  - https://github.com/letta-ai/letta/blob/0.16.8/letta/services/block_manager.py

Findings:
- `实测` Current model (MemFS): memory is a git repo owned by the agent. "Every memory edit is committed", which "provides version history, conflict resolution". L1.
- `实测` Concurrency: memory subagents (dreaming, memory doctor) "use git worktrees" so they can update memory concurrently without blocking the main agent. L1.
- `实测` Teach via `/remember <text>`: "The agent decides where the lesson belongs and commits". You review the result with `/memory` or the directory. L2. This is direct apply, with review afterwards.
- `实测` Dreaming option "Agent reviews before applying" is a second-agent review, but it "does not ask you for approval". L2. Reorganization "backs up the current repository" first. L2.
- `实测` Legacy block tools (L3, `base.py`):
  - `core_memory_append` / `core_memory_replace`
  - `memory_replace(label, old_string, new_string)` / `memory_insert` / `memory_apply_patch`
  - `memory_rethink(label, new_memory)`, for a full rewrite
  - `memory_finish_edits`
  - a unified `memory(command=create|str_replace|insert|delete|rename)`, which mirrors the Anthropic memory tool
- `实测` Errors come back to the model as ValueErrors (L3):
  - "did not appear verbatim" and "Multiple occurrences of old_string"
  - a rejection if the model pastes display line-number prefixes into `old_string`
- `实测` Block history (L3, `block_manager.py`):
  - `checkpoint_block_async`, `undo_checkpoint_block` and `redo_checkpoint_block` keep a strictly linear BlockHistory.
  - The docstring says "remove any 'future' checkpoints" after an undo.
  - Writes use "SQLAlchemy's built-in version_id_col for concurrency checks" and are commented as optimistic locking.
- `猜测` ADE UI (block editor with history) was not re-checked this session.

## 5. Mem0 (optional)

Sources:
- M1 History API. https://docs.mem0.ai/api-reference/memory/history-memory.md
- M2 How it works. https://docs.mem0.ai/core-concepts/how-it-works.md
- M3 Source: https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py

Findings:
- `实测` `GET /v1/memories/{id}/history/` returns entries with `old_memory`/new values and "The conversation input that led to this memory change". M1. So each change carries its provenance transcript.
- `实测` Automatic extraction is "additive", and the docs say to use explicit update or delete operations to correct or remove a memory. M2.
- `实测` History rows record ADD/UPDATE/DELETE events (`add_history(..., "ADD")`, plus UPDATE and DELETE) in M3.
- `实测` `update` overwrites the value. Memories flagged `immutable` must be deleted and re-added (docs: update operation page).

Gemini Saved info: skipped. The Google help page fetched through the reader returned navigation only (blocked: content not rendered).

## Comparison

| Product | Input location | Apply mode | Diff / preview | Undo / history | Transcript location | Tools / ops | Conflict handling |
|---|---|---|---|---|---|---|---|
| claude.ai (current Topics) | "Tell Claude what to change or remove" box on memory page (`实测` S2); also in chat (`实测` S1) | Direct (`推断`; post-send undocumented) | None documented | None documented; reset irreversible (`实测`) | Not documented (`猜测`: inline on page, no thread) | Topic edit/delete UI (`实测`); chat tool unverified (`猜测`) | Refusal message for never-stored categories (`实测` S4) |
| claude.ai legacy | Summary modal: ask Claude to edit summary (`实测` S1) | Direct, next conversation (`实测`) | None | Imports reviewable via "Manage edits" (`实测` S2) | n/a | Discrete "memory edits" layered on synthesis (`推断`) | Not documented |
| Anthropic API memory tool | Model-driven in any conversation | Direct, client executes (`实测` S5) | Up to client | Up to client | The conversation | view/create/str_replace/insert/delete/rename (`实测`) | Text errors: not-verbatim, multiple occurrences, destination exists (`实测`) |
| ChatGPT | Text box at bottom of memory summary; highlight-to-correct (`实测` O1/O2) | Direct "update accordingly" (`实测` O2) | None documented | Saved memories: view and restore prior versions (`实测` O2 Oct 15 2025) | Not a chat (`推断`) | Correct / don't-mention / delete / prioritize (`实测`) | "time to propagate" (`实测` O1); none for concurrency |
| Cursor (1.x, retired) | Settings | Background-generated: user approval (`实测` C2); explicit: direct (`推断`) | Approval card (`推断`) | None documented | Chat | n/a | n/a |
| Windsurf Cascade | Customizations panel, Edit button; NL via chat (`实测` W1) | Direct | None | None documented | Chat | create via prompt, edit, delete | Not documented |
| Devin Memory | Session chat only; surface is read-only (`实测` D1) | Direct commit (`实测`) | "Updated memory" card shows what changed (`实测`) | Git history; dreaming runs listed with changes (`实测`) | The session thread (`实测`) | File edits in git repo | Stale write rejected and retried; conflicts resolved, not overwritten (`实测`) |
| Letta MemFS / blocks | Chat, `/remember` (`实测` L2); ADE block editor (`猜测`) | Direct commit; optional agent self-review, no user approval (`实测`) | Review afterwards via `/memory` | Git history (`实测` L1); block undo/redo linear (`实测` L3) | Agent conversation | memory_replace/insert/apply_patch/rethink, unified memory cmd (`实测`) | Git conflict resolution; optimistic lock via version_id_col (`实测`) |
| Mem0 | API | Direct overwrite (`实测`) | None | Per-memory history with old/new plus input messages (`实测` M1) | Stored in history row (`实测`) | add/update/delete/batch_update (`实测`) | Immutable flag forces delete+add (`实测`) |

## Patterns worth adopting / avoiding (owner tells the Coordinator on the memory page)

- **Adopt: direct apply plus a visible change record.** No product here makes the owner pre-approve the owner's own NL edit. ChatGPT, claude.ai legacy, Devin and Letta all apply directly (`实测`/`推断`). Approval exists only for model-initiated memories (Cursor 1.2, `实测`). Show the result right away as a per-entry before/after card, like Devin's "Updated memory" card, on the page itself.
- **Adopt: per-entry version history with restore.** ChatGPT (restore prior versions), Letta (git history, linear undo/redo) and Mem0 (history with old/new and the triggering input) all keep it (`实测`). Store each change with the owner's instruction text as provenance. Then the "transcript" is the history row and needs no chat thread. Mem0's `input` field is the model for this.
- **Adopt: scoped targeting.** ChatGPT's highlight-to-correct (`实测`) gives the model an explicit target. Let the owner select entries before typing, and pass those ids to the Coordinator. That cuts ambiguous `str_replace` failures ("multiple occurrences" is a first-class error in both the Anthropic tool and Letta, `实测`).
- **Adopt: optimistic concurrency.** Use a version/etag per entry or for the whole store. Reject a stale write and retry; never let the last writer win silently. Devin (`实测`) and Letta's `version_id_col` (`实测`) both do this. The owner may hand-edit while the Coordinator is applying, and the stale edit must surface as a conflict.
- **Adopt: an edit tool surface shaped like the Anthropic memory tool.** That means create, str_replace, insert, delete and rename, with verbatim-match errors returned to the model (`实测` S5, L3). Reject delete of the root and rename onto an existing name.
- **Avoid: a read-only surface that forces edits into a chat thread (Devin, `实测`), and an undocumented, irreversible path (claude.ai reset, `实测`).** Also avoid silently dropping an instruction the agent cannot apply. claude.ai at least "says when it can't update memory" (`实测` S4); our design should return an explicit refusal or no-op result on the page.

## Unverified / blocked

- What claude.ai does after send in "Tell Claude what to change or remove": no primary source found. It needs a walk in ian's signed-in Chrome.
- The `memory_user_edits` chat tool on claude.ai: community sources only.
- The ChatGPT "Memory updated" in-chat notice: not in the current FAQ text read.
- Cursor Memories retirement: date and reason not found.
- Letta ADE block-editor UI: not re-checked.
- Gemini Saved info: page content not retrievable.
