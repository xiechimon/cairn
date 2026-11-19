---
name: design-cairn
description: Use when a task or brief touches apps/web/src (new screen, UI fix, copy, layout, state handling). Carries the cairn UI brief template (references, component x state list, compare-to-reference acceptance), the draft-first rule for the five main surfaces and the seed-missing-states rule. Use together with the global design skill.
---

# design-cairn: UI work in cairn

Read `apps/web/DESIGN-RULES.md` first (rules with ids), then `apps/web/DESIGN.md` for tokens and components. Reference screenshots live in `docs/design/references/<surface>/`; `docs/design/references/README.md` maps each surface to its shots.
| Surface | Reference product |
|---|---|
| Coordinator chat | Claude.ai |
| Thread list and sidebar | t3code and Amp |
| Settings | Amp and t3code |
| Thread progress, review and diff | t3code and Amp |
| First run and connection state | Amp |

## Order of work

The owner's order for UI work (mon X 2026-11-19): 1. the owner says the idea; 2. a prototype the owner opens and judges (a replayable visual; no recording needed at this step); 3. implement; 4. show the real result, as a recording when it moves or a screenshot when it does not; 5. land through `queue/main`. Do not push before step 4 when the owner asked to see it.

## Draft first

A new feature that touches first run, Coordinator chat, thread list and sidebar, thread and review, or settings needs a page draft (sketch or screenshot mock, built from the real components) and the owner's pick before code. Get the pick with `options-prototype-cairn`: three grayscale directions with why-notes; the draft then builds the picked one. Backend-only changes and single settings are exempt. A fix to an existing screen needs no draft but still needs the reference comparison below.

## Brief template

Copy this into every brief that changes `apps/web/src`, and fill each field. A brief with an empty field is not ready to dispatch.

```text
UI brief

Surface: <first run | coordinator chat | thread list and sidebar | thread and review | settings>
Goal: <one sentence, in the user's words>
Rules: read apps/web/DESIGN-RULES.md; the ids that apply here: <e.g. C1, C3, C11, V3>

References (open before coding; paths in the repo):
- docs/design/references/<surface>/<shot>   what to take from it: <one line>
- docs/design/references/<surface>/<shot>   what to take from it: <one line>
(1 to 3 shots. If the surface has no reference yet, say so and ask the owner.)

Draft: <link to the sketch or mock the owner picked, or "exempt: backend-only / single setting">

Component x state list (every cell is produced and screenshotted; the transition cell is recorded, DESIGN-RULES P3):
| Component | empty | loading | error | offline | long content | pending question | 390px | dark | transition |
|---|---|---|---|---|---|---|---|---|---|
| <component> | <how produced: live / seeded / fixture> | ... | | | | | | | <recording: appear, update, settle, reopened> |
Seed any state the stack cannot reach on its own (verify-cairn seeds or fixtures). Mark fixture cells as fixture. Do not mark a cell "n/a" without a reason.

Acceptance (done means all of these):
1. Coverage table: the filled component x state list above, each cell with a screenshot.
2. Compare to reference: for each state with a reference shot, one row "reference | ours" and one sentence on the difference. State what is still worse than the reference.
3. DESIGN-RULES ids listed above checked; `M` rules measured, not eyeballed.
4. Self-review at 1440 and 390, light and dark, by the building session against the reference shots (visual review stays with Claude; no second reviewer is needed).
5. Real stack shot for the main state (live, not `?scenario=`).
```

## Seed missing states

A state nobody has seen is not done. For every cell of the list that the live stack cannot produce (pending question, offline machine, quota, long content, error), seed it: write a fixture scenario or seed data, then screenshot it and label it fixture in the coverage table. Report the cells you could not produce as `Not covered` in the wrap-up, with the reason. The coverage table is part of the evidence.

## After the build

Put the reference-versus-ours rows and the transition recordings in the wrap-up shown to the owner, and capture with `.claude/skills/verify-cairn/SKILL.md` ("UI reference comparison"). There are no pull requests; work lands through `queue/main` (AGENTS.md, Ship).

When a new reference is needed, operate the product (use the `walk` skill), save real screenshots under `docs/design/references/<surface>/`, remove personal data, and add rows to the references README. Do not send messages or start runs on the owner's accounts without asking.
