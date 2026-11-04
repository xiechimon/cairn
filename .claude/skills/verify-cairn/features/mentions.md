# @mentions (composer, #311/#327)

Users reference other entities (agent/todo/skill/project/machine, plus files) in a composer by typing `@` in the textarea, which opens the inline completion (`.mention-inline`) grouped by kind. The textarea shows the chosen mention as `@label`; the text that is sent keeps the wire token — agent -> `[名](agent:{id})`, task -> `#seq`. The execution surface (Segments rendering) parses tokens back into chips. The former toolbar `提及` button, the five-group picker dialog and the `/mention` slash command were removed; the new-task dialog has no mention route.

## Sub-features

- `mention-inline-at` typing `@` in the composer textarea opens the grouped inline completion, filtered by `@partial`; Enter/click inserts, Esc closes.
- `mention-serialization` the textarea shows `@label`; the sent text carries `[名](agent:{id})` / `#seq`.
- `mention-render-back` after submitting, the execution surface / detail spec rendering parses the token back into a chip (Segments component).

## How to get to it (user POV)

- The composer (detail page run / confirm surfaces, chief drawer): type `@` in the textarea.
- Driving (`vp.mjs list mentions` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive mentions mention-inline -- <todoId>`: types `@` in the detail composer, picks the first row and checks the `@label` display.

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` brings the isolated stack up, `doctor.mjs` fully PASS. Mentions are pure UI + text serialization, no daemon needed.
2. The live surface needs referenceable entities: seed at least one agent (`POST /api/teams/{t}/agents`) and a todo in an editable phase (`setup-review-seed.mjs`).

- **How to run.** `node <skill>/scripts/drive-mentions.mjs <todoId>`.
- **Truth.** After submitting, `GET /api/todos/{id}`'s spec or the conversation message content contains the serialized token (`[名](agent:` / `#seq`); the detail spec rendering surface shows a chip.

## Gotchas

- The serialization format is a text convention (`[名](agent:{id})`), not a structured field; there is no server-side mention table.
- The inline `@` completion exists only on the live editable composer surface (the fixture static div has no textarea).
- Read the draft with `inputValue()` and expect `@label`, not the wire token.
