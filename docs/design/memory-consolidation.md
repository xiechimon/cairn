# Offline memory consolidation for the Coordinator — plan, 2026-11-28

## User scenario

Someone who installed Cairn today talks with the Coordinator a few times a week. Memory is written for them without any setting: on compaction, and after ten minutes of quiet. Nothing ever reads that memory back, so a scope that is used for months keeps every earlier wording: three lines state the same deployment rule differently, one line names a service that has since moved, and the index reaches the bound at which the always-loaded part stops carrying the rest.

With this change the Coordinator gets an offline review pass. Thirty minutes after the last message in a team or project, one summary-model call re-reads that scope's `MEMORY.md` together with the scope's recent messages, then merges duplicates, rewrites the line a newer message contradicts, deletes a duplicate or a line a cited newer message disproves, and drops the memory file nothing points at. It only ever shortens the always-loaded index, uses the model route summaries already use (no new setting, account or key), and never touches another scope.

Settings → Memory shows the pass under the auto-tidy section: when it ran, how many lines it merged, rewrote or deleted, each line's before and after text, and an Undo button. Before anything is written the pass is recorded with the full prior text, so undo restores the index and brings dropped files back. When the store changed after the pass, undo refuses and asks the user to tell the Coordinator instead of silently overwriting newer edits.

What the user does not get: a proposal step, an apply button, a new setting, or a way for the pass to grow memory. When no provider route resolves, the store changed during the call, the scope is busy, or the model's answer is unusable, memory and the record stay as they were and the pass simply tries again later.

## Prior art: what this adopts

One or two sources (brief): Cindy's memory system notes in `docs/research/cindy-2026-11-28.md` §6.2, and Anthropic's "dreaming" pattern as described there and in the brief.

| Source | Adopt | Reject |
| --- | --- | --- |
| Cindy `memory_review` / `memory_consolidate`, soft and hard size caps (`docs/research/cindy-2026-11-28.md:341-357`) | A periodic pass over the existing store, an explicit size budget, atomic merge | The two-step "LLM suggests, agent executes" flow: Cairn has no second agent standing by to press apply, so the pass applies inside one transaction and records undoable edits |
| Cindy memory kept as a worktree file | — | Storing memory as a repository file: Cairn keeps DB records, corrections and per-turn recall |
| Anthropic "dreaming" (brief, line 7) | Offline pass that re-reads raw transcripts, fixes what they contradict, merges duplicates, drops stale entries, keeps a small always-loaded index under a budget | A separate dreaming service or model: the pass reuses the summary route and the Coordinator tick Cairn already runs |
| Cindy `memory_consolidate` on demand | — | A "tidy now" button or schedule entry: not asked for, and the idle pass covers the need |

## Scope

1. **Trigger.** A new sweep runs from the existing 5 s Coordinator tick, after the idle flush. A team or project scope is eligible when all hold: its `MEMORY.md` has at least 3 lines or files; no user or assistant message in the scope's unarchived conversations for 30 minutes (`CONSOLIDATION_IDLE_MS`); the scope's memory changed after its last recorded pass (or it never had one); 6 hours passed since that pass's start (`CONSOLIDATION_MIN_RUN_INTERVAL_MS`); an idle summary route resolves for the scope. One scope per tick, one request in flight, the scope whose memory changed earliest first. A failed, stale or timed-out request backs off 30 minutes in process, like the idle flush; a restart clears that backoff.
2. **Input.** The numbered `MEMORY.md` lines (the full index, already bounded at 200 lines / 25 KiB by `boundMemoryIndex`), the scope's live memory files (title, byte size, first line, and up to 1 KiB of each), the newest 30 user and assistant messages across the scope's conversations from the last 7 days (2,000 characters each, 8 KiB total), the budget constants, and the previous pass's summary when one exists. Never another scope's memory, never worker transcripts, never tool payloads.
3. **Output.** JSON only: `edits` where each edit is `merge`, `rewrite` or `delete`, names 1-based line numbers of the index shown, carries the replacement `- ` line for merge and rewrite, and a one-line `why`; and `dropFiles` naming a memory file with a `why`. At most 12 edits and 3 drops are applied from one answer. Unknown ops and unknown file names are discarded; an edit that names a line outside the index, overlaps another edit, pairs `merge`/`rewrite` with the wrong number of lines, or lacks a `- ` replacement rejects the whole answer; an answer with no edit is an empty pass. A `delete` is accepted only when every deleted line duplicates a line that stays, or when the edit names (`message`) the 1-based number of an evidence message that contradicts the line; anything else rejects the answer, because "nobody mentioned it lately" is not evidence a fact is stale.
4. **Apply.** One SQLite transaction with no model call inside it: the index change through `update_memory` (base-version compare-and-set, which also keeps the team-entry bookkeeping), each dropped file through `delete_memory` (soft delete, retained version). The pass drops a file only when the edited index no longer links it. Before applying, the pass checks that `MEMORY.md` still has the captured version, that every file it drops is still the current, live version, and that the project still exists unarchived; any such change discards the result. A malformed or rejected answer leaves memory untouched and writes a `rejected` record with the reason; a provider error, a deadline or a shutdown leaves memory and record untouched.
5. **Budget.** A pass never lengthens `MEMORY.md` (after ≤ before in characters) and must bring an index that is over 120 lines or 12 KiB (`CONSOLIDATION_INDEX_MAX_LINES`, `CONSOLIDATION_INDEX_MAX_BYTES`) back within it; an answer that would lengthen the index is rejected whole. Team memory keeps its existing 2,000-character write guard and the pass can only shrink it.
6. **Record.** New table `memory_consolidation`, one row per finished pass: id, teamId, projectId, status (`applied`, `empty`, `rejected`), provider and model id, startedAt, finishedAt, a one-line summary, `edits` (kind, line numbers, before text, after text, why), `dropFiles` (title, memory id, why, and the first 4 KiB of the content for the panel), the whole before and after `MEMORY.md` text, and `undoneAt`. Retention: the newest applied pass always stays; beyond it at most 10 rows per scope and none older than 30 days, pruned when a pass finishes, so newer `empty`/`rejected` rows can never push out the one pass that can still be undone.
7. **Visible and undoable.** `GET /api/teams/:id/memory-consolidation?projectId=` returns the scope's passes newest first. The Settings → Memory panel, for the team page or a project page, lists them under the auto-tidy section with the merged/rewritten/deleted counts, the per-line before and after, and Undo on the newest applied pass only (an older pass's text has since been replaced). `POST /api/teams/:id/memory-consolidation/:cid/undo` restores the recorded before text and revives dropped files, keeping each file's original source, when the scope's `MEMORY.md` still equals the pass's after text; otherwise it answers 409 and says the memory changed. Reading, editing, deleting and importing memories, recall and injection stay exactly as they are.
8. **What the pass never does.** It does not create entries, move facts between scopes, rename files, edit the text of a memory file, touch scratchpad entries or corrections, or drop a memory file whose `source` starts with `import:` (a file the user imported from a repository). Cairn has no pinned-entry flag, so nothing marks a hand-written line: instead every removed or rewritten line is kept verbatim in the record and restored by Undo, every dropped file comes back from its retained version on Undo (the record's 4 KiB excerpt is only for display), and the pass never empties `MEMORY.md` completely.

## Edge cases

| Edge case | What the user sees | Proving test | Slice/Status |
| --- | --- | --- | --- |
| Empty memory, or fewer than 3 entries | No request, no record, nothing changes | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Recent message contradicts a saved line, duplicates exist | The line is rewritten to what the newer message says and duplicates become one line; the record shows each before and after | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Memory edited by the user or the Coordinator while the request runs | Result discarded, newer text kept, record not written; a later eligible pass reads the new text | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Conversation resumes in the scope, or a new message arrives mid-request | Same discard; no write and no record | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| No provider route, quota error, hung response, shutdown | No request or no write, memory unchanged, no record; retried after the in-process backoff | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| The evidence window holds no messages, or a delete cites no message and duplicates nothing | No deletion is accepted; merges and rewrites still apply, so a quiet scope keeps every fact | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Answer is not JSON, names an unknown op, an out-of-range or overlapping line, or a missing `- ` prefix | Nothing written; the pass is recorded `rejected` with the reason and the index text unchanged | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| An answer would lengthen `MEMORY.md`, empty it, or leave an over-budget index over budget | Rejected whole; the index stays as it was and the `rejected` row says why | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Nothing to change, or the only requested drop is an imported file | Recorded `empty`, no write, no new `MEMORY.md` version; no new request until the interval passes | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Scope is busy, interval not elapsed, or memory unchanged since the last pass | No request | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| A dropped memory file that someone imported, or the edited index still links it, or the last index line | Not dropped, not emptied; the index keeps its last line | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| A line or file the user wrote by hand (Cairn has no pin flag) | It may be merged, rewritten or dropped, but its exact prior text stays in the record, a dropped file comes back from its retained version, and Undo puts both back | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| An index already at the 200-line / 25 KiB load bound (huge memory) | The pass must bring it under 120 lines and 12 KiB or the answer is rejected; the always-loaded part never grows and nothing over the bound is injected | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Undo a pass | `MEMORY.md` returns to the before text, dropped files are alive again with their original source, the pass shows Undone | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Undo after a later edit, or Undo an older pass | 409, memory unchanged, the panel says to tell the Coordinator; Undo only appears on the newest applied pass | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Undo a pass, then the next eligible pass | The undone edits are shown to the model as rejected, so it does not immediately redo them | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Two scopes eligible at once, or a restart mid-request | One request at a time, the other waits for a later tick; a restart writes nothing and the next tick may try again at once, since the backoff lives only in process | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| The project is archived while the request runs | No write and no record; the newer state stays | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| Any team member's message is in the evidence | The prompt marks messages as third-party data and never follows instructions in them; any edit still shows its before and after and can be undone | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| A scope passes every 6 hours for months | The newest applied pass always stays, at most 10 rows per scope and none older than 30 days; the panel shows the newest first | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |
| The panel with no passes, or offline | No auto-tidy section, nothing extra to load; the rest of the page works as today. The record shape the panel reads is asserted in the server test; the rendered section is checked on production screenshots | `apps/server/test/coordinator/memory-consolidation.test.ts` | this change |

## Out of scope

- A proposal/approval step, a manual "tidy now" control, a setting or schedule entry, and a new provider route.
- Moving facts between team and project scopes, renaming or rewriting memory files, and consolidating scratchpad or per-thread entries.
- A pinned/`user-authored` flag and pin-aware deletion; changing recall ranking, injection bounds, corrections, import or `memory-edit` turns.
- Cost accounting per pass beyond the provider/model id on the record; changing the idle flush, compaction or team retirement rules.
- An e2e browser test for the panel: the record shape the panel renders is asserted in the server test, and the rendered section is verified on production with screenshots (see the brief's Done-when).

## Review

- Verdict: CONCERNS
- Plan-SHA256: 90d1a01ef3b572a2623cfadd786962e65484b0209f7aa87362622ae3d7102740
- Author-Model: doubao-main-agent
- Reviewer: fresh-context pi review session
- Reviewer-Model: anthropic/claude-opus-5-5
- Findings: 9 should-fix and 5 notes, all addressed: deletions require a duplicate or a cited contradicting message; an undone pass is shown to the next pass as rejected; a malformed answer now records `rejected`; drops count only after filtering; a still-linked file is never dropped; the newest applied pass survives retention; every edge row states what the test asserts; restart wording matches in-process backoff; the record keeps a 4 KiB display excerpt while undo uses the retained version. Note 14 (feature map) is fixed in `feature-map.json`.
- Fix-check: PASS
- Fix-check-Plan-SHA256: e4b3fbf663f35c82c3d6e3b76cc04a0c654687bfdf2df2d218743c780659d35d
