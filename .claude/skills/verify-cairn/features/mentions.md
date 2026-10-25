# @mentions (composer + new task, #311/#327)

Users reference other entities (agent/todo/skill/project/machine) in the composer or the new-task dialog: click the toolbar `提及` button to open the five-group MentionPicker (tasks / skills / Agents / projects / machines, multi-select accumulation + an `插入 (N)` bottom bar), or type `@` in the textarea to trigger inline agents completion. Selected mentions serialize into tokens that land in the text — agent -> `[名](agent:{id})`, task -> `#seq` — and go with the message / task spec; the execution surface (Segments rendering) parses them back into chips. Spec source: r9 §3.2 (todos.dev measured).

## Sub-features

- `mention-button-opens-picker` the composer / new-task toolbar `提及` button (`button[aria-label="提及"]`) opens the MentionPicker popup (`.mention-picker` or `.mention-inline`).
- `mention-five-groups` the picker's five groups: tasks / skills / Agents / projects / machines, each group's rows carry an `(N)` count; the live data source = useTodos/useSkills/useMembers/useProjects/useMachines projections, the fixture = fixture.todos/resources.
- `mention-multi-select` multi-select accumulation, the bottom bar `插入 (N)` confirms inserting N tokens.
- `mention-inline-at` typing `@` in the composer textarea triggers inline agents-only completion (`.mention-inline`), filtered by `@partial`, Enter/click inserts, Esc closes.
- `mention-serialization` selected mentions serialize: agent -> `[名](agent:{id})`, task -> `#seq`; landing in the draft/spec text.
- `mention-render-back` after submitting, the execution surface / detail spec rendering parses the token back into a chip (Segments component).

## How to get to it (user POV)

- The composer (detail page run / confirm surfaces) toolbar `提及` button -> the picker; or type `@` in the textarea.
- The new-task dialog (board `新建任务`) toolbar `提及` button -> the picker (lands in the spec textarea).
- Driving (`vp.mjs list mentions` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive mentions mention-picker`: the mention-button picker and the `@` inline completion; pass a todoId after `--` to add the composer path.

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS. Mentions are pure UI + text serialization, no daemon needed.
2. The live surface needs referenceable entities: seed at least one agent (`POST /api/teams/{t}/agents`) + one todo (board-create or seed), otherwise the picker group counts are 0 (it still opens, just shows empty).

- **How to run.** `node <skill>/scripts/drive-mentions.mjs` (only the new-task-dialog path, self-sufficient) or `node <skill>/scripts/drive-mentions.mjs <todoId>` (additionally the composer's picker + inline `@` paths; the todo must be in an editable phase, the seed comes from `setup-review-seed.mjs`). **Precondition: at least one agent**, otherwise the Agents group counts 0 (the seed creates one).
- **Picker path.** Detail-page composer or new-task dialog -> click `button[aria-label="提及"]` -> `.mention-picker`/`.mention-inline` visible -> select a row in the Agents group (group row `.mention-row--top[aria-label^="Agents"]` -> entry `.mention-row--entry`) -> the bottom bar `插入 (1)` -> the textarea/spec shows the `[名](agent:{id})` token.
- **Inline @ path.** Type `@` in the composer textarea (live editable surface) -> the `.mention-inline` inline listbox appears -> keep typing to filter -> select a row -> the token lands at the caret.
- **Truth.** After submitting, `GET /api/todos/{id}`'s spec or the conversation message content contains the serialized token (`[名](agent:` / `#seq`); the detail spec rendering surface shows a chip.

- **Verification state (2026-09-28)**: the main-repo scripted probe is in — `drive-mentions.mjs` 10 checks all green (dialog picker + composer picker + inline `@`, three paths), evidence archived at `docs/verify/311/2026-09-28T13-29-24-524Z-mentions/`.

## Gotchas

- The serialization format is a text convention (`[名](agent:{id})`), not a structured field — the execution surface "parsing" = text rendering back into chips; the agent reads the text and knows the reference, there is no server-side mention table.
- The inline `@` completion exists only on the live editable composer surface (the fixture static div has no textarea); the picker button exists on both surfaces.
- The picker data source is agnostic: live goes through REST-hook projections, fixture goes through fixture.todos/resources — when driving, confirm you are on the live surface (the URL carries no `?scenario=`).
- An empty group still lets the picker open (shows a 0 count, r9 §2.2 first layer) — do not treat "0 count" as a dead button.
