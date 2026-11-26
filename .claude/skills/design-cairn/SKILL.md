---
name: design-cairn
description: Use when a task or brief touches apps/web/src (new screen, UI fix, copy, layout, state handling). Carries the cairn UI brief template (references, component x state list, compare-to-reference acceptance), the draft-first rule for the five main surfaces, the seed-missing-states rule and the routing table to the domain skills (cairn-motion, cairn-polish, cairn-type, cairn-motion-audit).
---

# design-cairn: UI work in cairn

Read `apps/web/DESIGN.md` first — the token frontmatter and the which-component table — then the surface file for the surface you touch under `docs/design/surfaces/` (its `## Rules` section holds that surface's rule rows), and `apps/web/src/components/ui/INVENTORY.md` for what already exists to reuse. Then run `node scripts/design-rules-for.mjs` on the files you will touch and keep the printed rule rows; a rule id alone resolves through `node scripts/design-rules-for.mjs <id>`. Reference screenshots live in `docs/design/references/<surface>/`; `docs/design/references/README.md` maps each surface to its shots.
| Surface | Reference product |
|---|---|
| Coordinator chat | Claude.ai |
| Thread list and sidebar | t3code and Amp |
| Settings | Amp and t3code |
| Thread progress, review and diff | t3code and Amp |
| First run and connection state | Amp |

## Skill routing

Every `apps/web/src` change loads this skill first (AGENTS.md), then the domain skill for its task type:

| Task type | Skill to load |
|---|---|
| Motion, animation, transitions, enter/exit, press feedback, loading or status motion | `cairn-motion` |
| Surfaces, shadows, borders, radii, icons, optical alignment, spacing polish | `cairn-polish` |
| Type, fonts, sizes, wrapping, truncation, tabular figures | `cairn-type` |
| Focus, keyboard, accessible names, announcements, hit areas, form errors, an axe finding | `cairn-a11y` |
| A new or edited user-facing string, an error, an empty state, a confirmation | `cairn-copy` |
| Reviewing or auditing motion (only when someone asks) | `cairn-motion-audit` |
| A cross-domain review of a surface or a UI diff (only when someone asks) | `cairn-design-review` |

## Vendored references

Jakub Krehel's skills are vendored verbatim at `jakubkrehel/skills@672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (MIT, `upstream/LICENSE`) and Emil Kowalski's at `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (MIT, the tree's own `LICENSE`), each upstream `SKILL.md` kept as `README.md`. The extreme-data catalog is its own section below; these are the rest.

| File | Use when |
|---|---|
| `upstream/build-design/README.md` with `figma.md` | The owner hands a Figma link or a design image: the design decides, its values map onto Cairn's tokens, and no new colour or font family enters |
| `upstream/explain-interface/README.md` with `read-the-system.md`, `find-the-effect.md`, `from-an-image.md`, `no-browser.md` | Explaining how a reference product does something — the method behind the `walk` rule: read the system, find the effect, and say which part is measured, inferred or unknown |
| `upstream/break/README.md` with `scenarios.md` | Hostile scenarios beside the extreme-data catalog: what the user does to the screen, and what it does back |
| `references/pick-ui-library/README.md` | Before adding a dependency: AGENTS.md's established-library rule comes first, and this list is a shortlist to check Cairn's declared dependencies against, not a survey |

## Order of work

The owner's order for UI work (mon X 2026-11-19): 1. the owner says the idea; 2. a prototype the owner opens and judges (a replayable visual; no recording needed at this step); 3. implement; 4. show the real result, as a recording when it moves or a screenshot when it does not; 5. land through `scripts/ops/push-queue.mjs`. Do not push before step 4 when the owner asked to see it.

## Draft first

A new feature that touches first run, Coordinator chat, thread list and sidebar, thread and review, or settings needs a page draft (sketch or screenshot mock, built from the real components) and the owner's pick before code. Get the pick with `options-prototype-cairn`: three grayscale directions with why-notes; the draft then builds the picked one. Backend-only changes and single settings are exempt. A fix to an existing screen needs no draft but still needs the reference comparison below.

## Brief template

Copy this into every brief that changes `apps/web/src`, and fill each field. A brief with an empty field is not ready to dispatch.

```text
UI brief

Surface: <first run | coordinator chat | thread list and sidebar | thread and review | settings>
Goal: <one sentence, in the user's words>
Rules: the verbatim output of `node scripts/design-rules-for.mjs <the paths this task touches>`

References (open before coding; paths in the repo):
- docs/design/references/<surface>/<shot>   what to take from it: <one line>
- docs/design/references/<surface>/<shot>   what to take from it: <one line>
(1 to 3 shots. If the surface has no reference yet, say so and ask the owner.)

Draft: <link to the sketch or mock the owner picked, or "exempt: backend-only / single setting">

Component x state list (every cell is produced and screenshotted; the transition cell is recorded, rule P3):
| Component | empty | loading | error | offline | slow network | rapid repeated input | long content | pending question | 390px | dark | transition |
|---|---|---|---|---|---|---|---|---|---|---|---|
| <component> | <how produced: live / seeded / fixture> | ... | | | | | | | | | <recording: appear, update, settle, reopened> |
Slow network: every API reply delayed about 400ms. Rapid repeated input: press the controls 50ms apart while the pointer still moves a few pixels; the last press must win, nothing may reorder, and no press may be dropped while a request is pending (`e2e/rapid-input-sweep.spec.ts` shows the pattern). Seed any state the stack cannot reach on its own (verify-cairn seeds or fixtures). Mark fixture cells as fixture. Do not mark a cell "n/a" without a reason.

Craft (answer before code, one line each; rule P6):
- Arrival: what appears or changes while the user watches, and how it grows (docs/design/surfaces/motion.md, Growth)? History, reloads and the user's own actions show the result at once; reduced motion turns it off. Rules C23, A2, V24.
- States: does the loading skeleton have the final shape (A4)? Does the user's own change show in the same frame and roll back with a message on failure (C24)? Which P3 cells need seeding?
- Finish: counts and times in tabular figures (V27); dark layers by surface lightness, not stroke (V28); glyphs on their optical centre (V29).
- Measure: which `M` rule and which spec asserts each answer? A new `M` rule names its spec in the Check column (`test/anti-slop-foundations.test.ts` enforces it).

Acceptance (done means all of these):
1. Coverage table: the filled component x state list above, each cell with a screenshot.
2. Compare to reference: for each state with a reference shot, one row "reference | ours" and one sentence on the difference. State what is still worse than the reference.
3. The rule rows pasted in the Rules block checked; `M` rules measured, not eyeballed.
4. Self-review at 1440 and 390, light and dark, by the building session against the reference shots (visual review stays with Claude; no second reviewer is needed).
5. Interface review of the diff (`cairn-design-review`, adapted from Jakub Krehel's `interface-review`): read the whole diff; expand each changed file one hop to the surfaces it renders in, five consumers at most; read the removed lines for regressions; hold the change to its stated intent — a state left unbuilt is a finding; classify each finding `Introduced` / `Regression` / `Pre-existing`, keyed to its rule id, with at most three pre-existing findings as courtesy.
6. Real stack shot for the main state (live, not `?scenario=`).
```

## Long content

The `long content` cell of the state list is filled from the extreme-data catalog vendored at `upstream/break-ui/CATALOG.md` — Emil Kowalski's `break-ui` at `emilkowalski/skills@64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (MIT, `upstream/break-ui/LICENSE`, upstream `SKILL.md` kept as `README.md`). Read it and pick the rows that apply to the data the component renders: long hyphenated and CJK names, unbreakable emails and URLs, emoji and ZWJ sequences, huge or locale-formatted numbers, `0`/`1`/missing, every status enum at once, edge dates, broken images. Use `example.com` / `.test` domains so no fixture points at a real inbox.

## Seed missing states

A state nobody has seen is not done. For every cell of the list that the live stack cannot produce (pending question, offline machine, quota, long content, error), seed it: write a fixture scenario or seed data, then screenshot it and label it fixture in the coverage table. Report the cells you could not produce as `Not covered` in the wrap-up, with the reason. The coverage table is part of the evidence.

## After the build

Put the reference-versus-ours rows and the transition recordings in the wrap-up shown to the owner, and capture with `.claude/skills/verify-cairn/SKILL.md` ("UI reference comparison"). There are no pull requests; work lands through `scripts/ops/push-queue.mjs` (AGENTS.md, Ship).

When a new reference is needed, operate the product (use the `walk` skill), save real screenshots under `docs/design/references/<surface>/`, remove personal data, and add rows to the references README. Do not send messages or start runs on the owner's accounts without asking.

## Using the rules

- Briefs for UI work come from this skill; the brief pastes the `design-rules-for.mjs` output for the task's paths and lists the reference shots.
- The look-and-feel assertions come from the `M` rows of the `## Rules` sections in `apps/web/DESIGN.md` and `docs/design/surfaces/*.md`. There is no separate screenshot job: an assertion lives in an ordinary e2e spec (axe runs in `e2e/a11y-axe.spec.ts`), and its message starts with the rule id (`C3: ...`) so a failure points at the rule. An `M` row with no spec yet (the by-hand list in `test/anti-slop-foundations.test.ts`) is measured by hand in the change that touches it.
- A spec that exercises a live surface carries `@motion` in its title; the `motion-reel` workflow records those specs every Monday (and on demand) and uploads the videos as the `motion-reel` artifact. It is not part of `ci`, so it never slows landing.
- An `M` row names the spec or test that measures it in its Check column; `test/anti-slop-foundations.test.ts` fails on a new `M` row that names none, on any source path `apps/web/DESIGN.md`, a surface file or `INVENTORY.md` names that no longer exists, on a `## Rules` section without a live `Scope:` prefix or a rule id that appears twice, and on an entry file over 150 lines or a rule row over 60 words. The rows still measured by hand are listed there and the list only shrinks.
- A rule enters the index after the A/B check in `docs/design/rule-ab.md`, or when it copies a measured value or an audit finding. A rule that stops changing output is deleted.
- A review finding that can be measured becomes an `M` rule with an assertion; one that is taste becomes an `H` rule with a reference shot. Fixing the one page is not enough.

## Weekly owner review

Every Monday the owner reviews the pages that changed in the previous week and marks problems with Scrawl. The agent on duty:

1. Builds the contact sheet: for each page whose sources changed on `main` that week, the reference shot next to a fresh capture (light and dark, 1440px and 390px; `docs/design/references/README.md` maps surface to shots), plus that week's `motion-reel` video of every changed live surface, so a jump or flash shows before the owner meets it in use.
2. Reads the Scrawl capture and sorts each mark: measurable becomes an `M` rule plus an assertion, taste becomes an `H` rule plus a reference shot, a plain defect becomes an issue.
3. Lands the rule changes in the next change and says in chat what was added.

The review is a standing routine; no calendar entry is created for it.
