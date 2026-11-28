---
name: design-cairn
description: Use when a task or brief touches apps/web/src (new screen, UI fix, copy, layout, state handling). Carries the cairn UI brief template (references, component x state list, compare-to-reference acceptance), the draft-first rule for the five main surfaces, the seed-missing-states rule and links to the procedure skills (options-prototype-cairn, cairn-design-review).
---

# design-cairn: UI work in cairn

`apps/web/DESIGN.md` is the single entry: token frontmatter, surface-to-reference map, which-component table, process rules (`P1`–`P7`), and performance budgets. Run `node scripts/design-rules-for.mjs <paths>` before editing to print every applicable rule (`DESIGN.md` + `foundation.md` + `motion.md` + the touched surface file); resolve a single id with `node scripts/design-rules-for.mjs <id>`. Open the surface's shots under `docs/design/references/<surface>/`, and check `/design.html` or `apps/web/src/components/ui/INVENTORY.md` before adding primitives.

## Related procedures

| Task type | Skill |
|---|---|
| Grayscale layout options for owner pick on a new main-surface feature | `options-prototype-cairn` |
| Read-only cross-domain surface, diff, or motion review (when requested) | `cairn-design-review` |

## Vendored references

Jakub Krehel's skills are vendored verbatim at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`) and Emil Kowalski's at `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (MIT, the tree's own `LICENSE`), each upstream `SKILL.md` kept as `README.md`.

| File | Use when |
|---|---|
| `upstream/build-design/README.md` with `figma.md` | The owner hands a Figma link or design image: map its values onto Cairn's tokens without adding a colour or font family |
| `upstream/explain-interface/README.md` with `read-the-system.md`, `find-the-effect.md`, `from-an-image.md`, `no-browser.md` | Explaining how a reference product does something (`walk` method: read the system, find the effect, separate measured/inferred/unknown) |
| `upstream/break/README.md` with `scenarios.md` | Hostile scenarios beside the extreme-data catalog |
| `references/pick-ui-library/README.md` | Before adding a dependency (after AGENTS.md's established-library rule) |

## Order of work

The owner's order for UI work: 1. owner states the idea; 2. prototype the owner opens and judges (replayable visual, no recording needed); 3. implement; 4. show the real result (recording when moving, screenshot when static); 5. land through `scripts/ops/push-queue.mjs`. Do not push before step 4 when the owner asked to see it.

## Draft first

A new feature touching first run, Coordinator chat, thread list and sidebar, thread and review, or settings needs a page draft (built from real components) and the owner's pick before code. Get the pick with `options-prototype-cairn` (1–3 grayscale directions with why-notes), then build the picked one. Backend-only changes, single settings, and fixes to an existing screen need no draft (fixes still need reference comparison).

## Brief template

Copy this into every brief that changes `apps/web/src`, and fill every field:

```text
UI brief

Surface: <first run | coordinator chat | thread list and sidebar | thread and review | settings>
Goal: <one sentence, in the user's words>
Rules: the verbatim output of `node scripts/design-rules-for.mjs <the paths this task touches>`

References (open before coding; paths in the repo):
- docs/design/references/<surface>/<shot>   what to take from it: <one line>
(1 to 3 shots. If the surface has no reference yet, say so and ask the owner.)

Draft: <link to the sketch or mock the owner picked, or "exempt: backend-only / single setting">

Component x state list (every cell is produced and screenshotted; transition is recorded, rule P3):
| Component | empty | loading | error | offline | slow network | rapid repeated input | long content | pending question | 390px | dark | transition |
|---|---|---|---|---|---|---|---|---|---|---|---|
| <component> | <how produced: live / seeded / fixture> | ... | | | | | | | | | <recording: appear, update, settle, reopened> |
Slow network: delay API replies ~400ms. Rapid repeated input: press controls 50ms apart while moving the pointer a few pixels; last press wins, nothing reorders, no press dropped (`e2e/rapid-input-sweep.spec.ts`). Seed unreachable states and mark fixture cells as `fixture`; never mark "n/a" without a reason.

Craft (answer before code, one line each; rule P6):
- Arrival: what appears/changes while watching and how it grows (`docs/design/surfaces/motion.md`, Growth)? History, reloads and own actions show at once; reduced motion turns growth off (`C23`, `A2`, `V24`).
- States: loading skeleton in final shape (`A4`)? Own change lands same-frame and rolls back on failure (`C24`)? Which P3 cells need seeding?
- Finish: counts/times in tabular figures (`V27`), dark layers by surface lightness (`V28`), glyphs optically centred (`V29`).
- Measure: which `M` rule and spec assert each answer (`test/anti-slop-foundations.test.ts` enforces spec links)?

Acceptance (done means all of these):
1. Coverage table: filled component x state list, each cell with a screenshot.
2. Compare to reference: per state with a reference shot, one row "reference | ours" + one sentence on what is still worse.
3. Rule rows pasted in Rules checked; `M` rules measured and pixel-verified (`P7`).
4. Self-review at 1440 and 390, light and dark, against reference shots.
5. Interface review of the diff (`cairn-design-review`): read the whole diff, expand changed files one hop (up to 5 consumers), read removed lines for regressions, hold to stated intent, classify `Introduced` / `Regression` / `Pre-existing` keyed to rule ids (at most 3 pre-existing).
6. Real stack shot for the main state (live, not `?scenario=`).
```

## Long content

Fill the `long content` cell from `upstream/break-ui/CATALOG.md` (vendored from `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c`, MIT, `upstream/break-ui/LICENSE`, `README.md`): long hyphenated and CJK names, unbreakable emails/URLs, emoji and ZWJ sequences, huge/locale numbers, `0`/`1`/missing, all status enums, edge dates, broken images (`example.com` / `.test` only).

## Seed missing states & after the build

Seed any cell the live stack cannot reach (`fixture` label in coverage table); report unproduced cells as `Not covered` with reason. Put reference-versus-ours rows and transition recordings in the wrap-up via `.claude/skills/verify-cairn/SKILL.md` ("UI reference comparison"), and land via `scripts/ops/push-queue.mjs` (AGENTS.md, Ship). When a new reference is needed, operate the product (`walk`), save redacted shots under `docs/design/references/<surface>/`, and update `docs/design/references/README.md`.

## Using the rules

- Paste `node scripts/design-rules-for.mjs <paths>` output into UI briefs; `M` assertions live in ordinary e2e/unit specs with messages starting with the rule id (`C3: ...`).
- Specs exercising live motion carry `@motion` in their title for the Monday `motion-reel` workflow artifact.
- `test/anti-slop-foundations.test.ts` enforces that every `M` row names a live spec/test, every referenced source path exists, every `## Rules` section opens with live `Scope:` prefixes, no rule id duplicates, rule rows stay `<= 60` words, and `apps/web/DESIGN.md` stays `<= 150` lines.
- New rules enter only from real audit findings (`M` with spec) or taste gaps (`H` with reference shot); delete rules that stop changing output.

## Weekly owner review

Every Monday, build a contact sheet for pages whose sources changed on `main` (reference vs fresh capture at 1440/390 light/dark plus `motion-reel`), triage owner Scrawl marks (`M` rule + spec, `H` rule + reference shot, or bug issue), and land rule updates in the next change.
