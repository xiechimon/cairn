> Ticket: #394 (ready-for-agent).
# spec 15 · Untitled New-Task View and Fixed Tag Vocabulary

> Decision record: docs/adr/0002-untitled-new-task-view-and-fixed-tag-vocabulary.md (D1–D7).
> From this surface the new-task dialog no longer 1:1 replicates todos.dev (the first deliberate departure surface, ADR 0002 D7).

## Problem Statement

The new-task dialog requires the user to fill two fields — title + body — and can manually create/pick tags. In the real workflow the title is a summary of the body (the user writes the body and then distills a title from it), and free tags continuously manufacture the micro-decision of "tag it or not, which one", and since tags landed in #309 their only consumption surface is the detail-page chips — no filter, no search, pure burden. The shape the user wants: write only the task itself, the title and tag backfilled by the executing agent.

## Solution

The dialog converges to a single field (body). The title is two-stage: on save the server stores a placeholder title (the body's first non-empty line truncated ≤50 chars), and after the executing agent accepts the task and before starting it calls the new worker narrow tool `set_task_meta` to LLM-summarize the formal title + pick at most 1 tag from the fixed vocabulary. Tags change to a fixed 6-word vocabulary (bug / feature / improvement / refactor / docs / chore), seeded with the project, the manual create/pick UI fully removed, chips read-only. The dialog body font-size 13px → 14px.

## User Stories

1. As a task dispatcher, I want the new-task entry to write only the body field, so that task creation friction is minimal.
2. As a task dispatcher, I want the save gate pinned on body-non-empty (no longer requiring a title first), so that I am not blocked by "title required".
3. As a task dispatcher, I want the body's first line to be my one-sentence task and the board card to show it immediately after save (placeholder title), so that the task is readable before the agent accepts it.
4. As a task dispatcher, I want the agent, after accepting, to auto-replace the placeholder title with the LLM-summarized formal title, so that the board/detail stay readable long-term without my maintaining the title.
5. As a task dispatcher, I want the agent to simultaneously pick one tag from the fixed vocabulary, so that the task gains classification at zero manual cost.
6. As a task dispatcher, I want the vocabulary fixed as bug / feature / improvement / refactor / docs / chore, so that the classification caliber is stable and aggregatable across tasks.
7. As a task dispatcher, I want the agent to tag nothing when it cannot judge the category, so that there is no tag-for-tagging's-sake noise.
8. As a task dispatcher, I want backfill failure not to block task execution (the placeholder title keeps being used), so that metadata problems never block the work.
9. As a viewer, I want the detail-page tag chips read-only, so that I see the classification but am not led to manually maintain it.
10. As a viewer, I want an over-long first line truncated with an ellipsis and the card sequence number always present, so that placeholder-title collisions still have a distinguishing anchor (known trade-off: the short-first-line placeholder state has no visual marker, ADR 0002 Premortem item 2).
11. As a task dispatcher, I want the dialog body at 14px, so that writing tasks for a long time is easy on the eyes.
12. As a maintainer, I want the placeholder-title derivation logic single-sourced (the web fixture surface and the server use the same rule), so that fixture and live behavior do not drift.
13. As a maintainer, I want the fixed-vocabulary constant single-sourced in the shared package (server seeding and daemon prompt injection share it), so that changing the vocabulary in one place takes effect across the whole chain.

## Implementation Decisions

- **Dialog (web)**: remove the title input and its state, the tag row and tag panel and their state, the inline new-tag form; the `onSave`/`onSaveAndStart` signature changes to `(spec, projectId?)` (no longer passing title/tagIds); the save gate = `spec.trim() !== ''`; autofocus moves to the body textarea; body `font-size` 13px → 14px; the unsaved-gate dirty check now only looks at the body; the placeholder keeps the five-line template family. The fixture fallback mode syncs this shape (the locally landed card title = the same derivation rule).
- **Detail page (web)**: the fresh-state block removes the `添加标签` row; TagChip rendering kept (read-only).
- **Placeholder-title derivation (shared)**: `derivePlaceholderTitle(spec)` placed single-sourced in the shared package — take the first non-empty line, truncate ≤50 chars, append `…` when over; the web fixture branch and server createTodo share it.
- **server write**: `createTodo` calls the derivation function to land the placeholder title when `title` is blank; the existing explicit-title paths of REST POST todos and the chief `create_todo` tool stay unchanged (only normalized: the explicit title's leading/trailing whitespace trimmed before landing).
- **Fixed vocabulary (shared)**: the `FIXED_TAGS` constant (6 words, each with name/description/fixed color) in the shared package; the server seeds 6 tag rows on project creation, and at startup backfills existing projects idempotently by name.
- **Worker narrow tool (server)**: `set_task_meta({title, tag?})` — tag is the vocabulary **name** (not id, the agent needs no id knowledge); the server pins todoId from stepId (the agent cannot overreach to modify another task), a tag name not in this project's vocabulary = 400 rejection; blank title = 400; title over 50 chars server-side truncation backstop; success goes through the existing `updateTodo` surface (v++ + SSE broadcast, the board refreshes live). The tool definition ships with the worker step claim payload's remoteTools (daemon relay zero change).
- **Prompt injection (daemon)**: the worker step systemPrompt appends an instruction block — this task's placeholder title, the fixed vocabulary (name + one-sentence meaning), "before actually starting, call `set_task_meta` once: title ≤50 chars summarizing the task body; at most 1 tag, do not pass tag if undeterminable". A failed call only logs, does not block the build.
- **i18n**: remove the dead entries (tag panel/form family) cleanup, sync the added copy (if any) zh source + en.ts dictionary append (CI i18n-coverage pin).
- **e2e two-surface pin sync** (change means obligation): the apps/web e2e new-task flow spec switches to the single-field path; the integration `m5-web-e2e.test.ts` `.new-task-start` and other locators re-verified (button class names unchanged). (The visual geometry assertion surface is removed with the parity tool, no third surface to pin.)
- **verify-pacman feature map sync**: the new-task flow switches to the single-field path; `drive-tags.mjs`'s manual-tag scenario removed, switched to asserting fixed-vocabulary seeding (GET tags = 6 rows) + detail-page chips read-only.

## Testing Decisions

The standard of a good test: only external behavior (the todo-row title value after save, the tool call's reject/accept, board rendering), not internal implementation (state names, private functions). List failure modes before implementation (repo rule):

- Empty body → both save and save-and-start disabled.
- Multi-line body → placeholder title = the first non-empty line; a blank first line does not produce an empty title.
- First line >50 chars → truncated + `…`.
- `set_task_meta`: blank title 400; tag as a non-vocabulary name 400; tag omitted = only title backfilled; repeated calls = idempotent overwrite (last-write wins).
- Seeding: a new project carries 6 tag rows; existing projects backfilled at startup, then GET tags = 6 rows and idempotent (a second startup does not insert duplicates).
- fixture surface: the dialog has no title input / no tag row; the save-landed card title = the same derivation rule as the server.
- live e2e (during development only run the relevant specs): new-task single-field save → board card title = the first-line truncation.

Prior art: server vitest (the `apps/server/test/todos` family, machine-wire tests) covers createTodo/tool handlers; web e2e covers the dialog; verify-pacman covers the live chain.

## Out of Scope

- Filtering/searching the board by tag (the tag's filter consumption surface, a separate ticket later. Already realized: #403 board tag filter bar; #445 top bar reordered to repo + type dual-axis filter, task cards render tag chips — ADR 0002 F4's "board card does not render tags" calibration retires with it).
- Custom-vocabulary UI and detail-page tag editing (chips read-only; vocabulary changes go through the shared constant).
- Title backfill of existing tasks (only affects new).
- server-side LLM title generation (ADR 0002 F1: the server has no LLM surface, re-open trigger sees the ADR).
- Global font/weight/`-webkit-font-smoothing` adjustment (the reference-site replication fidelity surface unchanged, ADR 0002 D6).

## Further Notes

- A "save-only, not dispatched" task keeps the placeholder title long-term — expected behavior (ADR 0002 Premortem item 2 guardrail: seqNum as the distinguishing anchor).
- Parity with the reference todos.dev new-task dialog is permanently abandoned; after the e2e visual baseline is rewritten with this ticket, later departures each open their own ADR.