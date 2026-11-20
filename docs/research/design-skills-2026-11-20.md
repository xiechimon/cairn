# Design skills from Jakub Krehel and Emil Kowalski, loading.dev, and how Cairn could use them (2026-11-20)

ian likes the visual quality of three things and asked how to get it into Cairn:

- `github.com/jakubkrehel/skills` (16 skills, "interfaces" plugin)
- `github.com/emilkowalski/skills` (19 skills, aiforui.dev)
- `loading.dev`, e.g. `/spinners/bouncing-dots`

His idea: vendor or reference these skills as on-demand skills, and have the design entry doc name which one to load per kind of task, so the main rules stay short and agents still get the strong guidance.

Tag convention (repo convention, see `docs/research/open-design-2026-11-20.md`): **verified** = read first-hand in the source at the pinned commit, or run live; **derived** = derived from verified facts, recheckable; **guess** = the rest.

Sources and pins:

- Jakub's skills: `jakubkrehel/skills` at `672ae44ace6aaed65b86cbb1e2fd6fbea0e79578` (2026-11-18). Links below: `J/` = `https://github.com/jakubkrehel/skills/blob/672ae44ace6aaed65b86cbb1e2fd6fbea0e79578/`.
- Emil's skills: `emilkowalski/skills` at `64eb3deb9a5fbfa041faf783e0bc3fd635872e9c` (2026-11-15). `E/` = `https://github.com/emilkowalski/skills/blob/64eb3deb9a5fbfa041faf783e0bc3fd635872e9c/`.
- loading.dev: its source is public, `jakubkrehel/loading` at `da6f2e6ebb127e9a3c3ceaa24e584cdb812ee04a` (2026-11-19), found from the GitHub link in the site's own HTML. `L/` = `https://github.com/jakubkrehel/loading/blob/da6f2e6ebb127e9a3c3ceaa24e584cdb812ee04a/`. (verified)
- The running site, operated in headless Chromium (Playwright 1.63) at 1440x900 @2x, light and dark, with computed styles read from the page and the CDP animation clock slowed to 0.05x for mid-transition frames. Screenshots in `/tmp/dogfood/design-skills/` (not committed, per the evidence rule). (verified)
- Skill loading: `https://code.claude.com/docs/en/skills.md` and `https://docs.devin.ai/cli/extensibility/skills/overview.md`, fetched 2026-11-20. (verified of the docs)
- Cairn: this worktree's `origin/main` (`4ced3778e`), `apps/web/DESIGN.md`, `apps/web/DESIGN-RULES.md`, `.claude/skills/design-cairn/SKILL.md`, `apps/web/src/styles/shadcn.css`, `apps/web/e2e/design-rules-measure.spec.ts`, `docs/design/audit-2026-11-20.md`. Another lane is consolidating these docs into a short `DESIGN.md` entry plus `docs/design/surfaces/*`; this note proposes changes and edits none of them.

## 0. Conclusions

1. **Jakub is a systems writer across the whole interface; Emil is a motion specialist with a strong voice.** Jakub's 16 skills split into 8 domain skills (motion, UI polish, typography, color, accessibility, layout, writing, plus an orchestrating reviewer) and 8 procedures; each rule lives in exactly one skill and every skill says how hard to press. Emil's 19 skills are 12 about animation or gesture, plus a 684-line "design-eng" philosophy file, mobile-web fixes, a Swift guide and workflow helpers. (verified, section 1)
2. **They disagree on values.** Press scale `0.96` (Jakub, "exact") vs `0.97` (Emil, "0.95-0.98"); spring bounce always `0` vs `0.2`; ease-out `cubic-bezier(0.2, 0, 0, 1)` vs `cubic-bezier(0.23, 1, 0.32, 1)`. Loading both into one agent gives it two answers. (verified, section 1.4)
3. **loading.dev's quality is a small, consistent token-and-primitive set plus the author's craft. The only enforcement covers the spinner library's motion contract, not the site's look.** One popup transition utility, one button style table, Base UI primitives, semantic OKLCH tokens, a hover-capable variant, a reduced-motion reset. Tests assert that every spinner ships reduced-motion CSS, an `animation-play-state` on every shorthand, `aria-hidden` and `currentColor`; lint bans Radix and `framer-motion` imports. There is no visual regression, screenshot test or design skill in the repo. (verified, section 2)
4. **The site does not fully follow its author's own skill.** loading.dev presses to `0.97` and opens popups from `0.95`; Jakub's `better-motion` says `0.96`, and `0.96`/`0.97` for dropdowns. The skill also says a deliberate project convention is a preference, not a finding. So the values are a codified default, and a project's own consistent choice outranks them. That is exactly the stance Cairn needs. (verified values; reading of intent derived)
5. **Cairn already contradicts both authors in places ian decided on purpose.** A pressed Cairn button never moves (`DESIGN.md` Motion, line 382) where both skills scale it; Cairn uses no springs (line 384); Cairn's `--ease-standard` is the Material curve `cubic-bezier(0.4, 0, 0.2, 1)`, which Emil's `animate` names as the familiar curve not to invent. A skill loaded without an override layer would push agents to undo owner decisions. (verified)
6. **ian's idea works with a change: on-demand skills, not the upstream sets.** Claude Code and Devin both load `.claude/skills/*` on description match, but description matching is probabilistic, and 35 extra descriptions cost listing budget on every turn. The reliable shape is two or three Cairn wrapper skills (motion, polish, typography) that `design-cairn` names per task type, each carrying a pinned copy of one upstream skill plus a short "Cairn overrides" table, and a test that holds the routing and the pins. (derived, sections 4 and 5)
7. **Adopt Jakub's domain skills as the base, take Emil's as a reading source, and import no spinners.** Jakub's structure (one owner per rule, calibration lines, a "Before you finish" detection table) composes with Cairn's rule ids; Emil's skills open with a fixed persona reply and "default to flagging", which fights an autonomous pipeline. loading.dev's bouncing dots and dot spinners are not for Cairn: the working mark is the spiral, and ian rejected dot working indicators on 2026-11-17. Take loading.dev's engineering pattern (one motion registry, a test over every animated component) instead. (derived; re-assessed on merit in section 7, which supersedes this point)

## 1. The two skill repositories

### 1.1 Jakub Krehel: `jakubkrehel/skills`

MIT, "Copyright (c) 2026 Jakub Krehel" (`J/LICENSE`). Distributed by `npx skills add` and as a Claude Code plugin named `interfaces` (`J/AGENTS.md` "What this repository is"). The repo carries no build, lint or test tooling. (verified)

| Skill | Kind | Invoked by | Lines (SKILL.md + refs) | What it holds |
|---|---|---|---|---|
| `better-interface` | orchestrator | model | 132 + review-format | Reviews a screen across all domains, one ranked report; discovers project conventions first |
| `better-motion` | domain | model | 184 + 8 refs | Whether to animate, durations by size, ease-out, springs with bounce 0, scale by size, press 0.96, enter/exit, icon cross-fade, layoutId, drag, reduced motion, slow-motion check |
| `better-ui` | domain | model | 67 + 3 refs | Concentric radii, optical alignment, shadows vs borders, image outlines, hover gating, overscroll, icon stroke vs text weight |
| `better-typography` | domain | model | 156 + 6 refs | Type scale, spacing, font features, wrapping, truncation, punctuation |
| `better-colors` | domain | model | 84 + 6 refs | Palettes, semantic token naming, formats, contrast |
| `better-accessibility` | domain | model | 130 + 6 refs | WCAG 2.2: focus, ARIA, names, forms, announcements, motion, zoom, hit areas |
| `better-layout` | domain | model | 88 + 2 refs | Grouping, alignment, reading order, responsive, room for translation |
| `better-writing` | domain | model | 142 + 2 refs | Labels, errors, empty states, confirmations |
| `build-design` | procedure | model | 83 + figma | Build from a Figma file or image with project tokens |
| `interface-review` | procedure | user | 149 + 2 refs | Change-scoped review (introduced / regression / pre-existing) |
| `explain-interface` | procedure | user | 106 + 4 refs | Explain how a live site or effect was built |
| `break` | procedure | user | 76 + scenarios | Stress a component under every scenario on a throwaway page |
| `state-machine` | procedure | user | 80 + switcher | Every state of a component on a throwaway page |
| `variant` | procedure | user | 112 + picker | Several variants behind a picker |
| `afk` | procedure | user | 140 | Works unattended on a branch, leaves a report |
| `upskill` | procedure | user | 176 + 2 refs | Mines past sessions for skills and hooks to add |

How they are written (verified, `J/AGENTS.md` "Structure" and "Invocation"):

- Frontmatter `name` + a one-sentence `description` that states outputs, not trigger phrases ("Decides what should animate and builds it, with exact values for duration, easing, scale and distance…", `J/skills/better-motion/SKILL.md` line 3).
- A plain H1, a two-sentence opener, then a **calibration** section that says how hard to press. `better-motion` lines 10-16: which values are exact ("`0.96` is not `0.95`") and which are starting points, and "A deliberate and consistent project convention is a preference and not a finding… The same detail done two ways within the project is a finding." `better-ui` lines 10-14 say the same.
- Headings that carry the point ("Press scales to 0.96", "Exits are shorter and smaller than enters").
- A hand-off line naming the sibling that owns adjacent topics (`better-motion` line 18).
- A `## Before you finish` table whose left column is a code pattern to grep for and right column the fix (`better-motion` lines 153-178: `transition-all`, `bounce:` not 0, a modal entering below `0.98`, a popup with `origin-center`…).
- `## Reporting` with verification steps and "report every check you could not run as `Not verified`".
- Depth lives in sibling reference files with recipes and code for CSS, Tailwind and Motion; the entry file states rules and links out.
- "Each rule lives in exactly one skill"; a rule-ownership table in `J/AGENTS.md` assigns every topic.
- Procedures that write throwaway pages carry `disable-model-invocation: true` plus the Codex `allow_implicit_invocation: false`, with a written reason per skill.

**Focus (derived):** the whole interface as a system (motion, surfaces, type, color, a11y, layout, copy), with exact measured values, written so that a project's own conventions win, and so that a review blocks on evidence and not on taste.

### 1.2 Emil Kowalski: `emilkowalski/skills`

MIT, "Copyright (c) 2026 Emil Kowalski" (`E/LICENSE`). Installed with `npx skills@latest add emilkowalski/skills`; every skill has a page on aiforui.dev (screenshot `12-aiforui-skills.png`: 58,250 GitHub stars, 3.8M installs on skills.sh, 19 skills ordered "the way you'd reach for them"). (verified)

| Skill | Invoked by | Lines | Focus |
|---|---|---|---|
| `emil-design-eng` | model | 684 | The philosophy file: animation decision framework, easing tokens, durations, springs, press scale, origin-aware popovers, tooltips, clip-path, gestures, performance, Sonner principles, stagger, review checklist |
| `animate` | model | 209 + 324 recipes | Build one animation in a fixed decision order |
| `animate-expo` | model | 263 + 386 | The same for React Native / Expo |
| `review-animations` | user | 113 + 188 standards | Strict review, "Default to flagging; approval is earned" |
| `improve-animations` | model | 113 + audit + plan template | Codebase motion audit producing plans for cheaper agents |
| `find-animation-opportunities` | model | 139 | Read-only: where motion would help, and where not |
| `remove-animations` | model | 166 | Subtract motion: keyboard actions, high-frequency surfaces |
| `choreograph` | model | 170 + 287 | Several elements moving together: lead, follow, overlap, stagger |
| `animation-performance` | model | 222 | Frame budget, composite-only properties, `will-change` |
| `animation-vocabulary` | model | 179 | Glossary from vague description to the term |
| `apple-design` | model | 287 | WWDC principles translated for the web: springs, materials, gestures |
| `gestures` | model | 112 | Drag, swipe, sheets, 1:1 tracking, interruptible |
| `mobile-native` | model | 314 | Web app that feels native on a phone |
| `break-ui` | model | 177 + catalog | Worst-case data stress test |
| `prototype` | user | 100 + picker | Several versions behind a picker |
| `pick-ui-library` | user | 86 | Curated library list |
| `learn-taste` | user | 157 | Turn a session's design corrections into rules, preferring a check over a sentence |
| `ask-emil` | user | 72 | Router over the other skills |
| `ask-sonner` | model | 88 + API | Guide to his Sonner toast library |
| `write-swift` | model | 396 | Modern Swift |

How they are written (verified):

- Long descriptions with trigger phrases and "use X instead" hand-offs (`E/skills/choreograph/SKILL.md` line 3 ends "Triggers on — stagger, sequence, choreography, 'one after another'…").
- Several skills open with a scripted persona reply: "When this skill is first invoked without a specific question, respond only with: > I'm ready to help you build interfaces that feel right…" (`E/skills/emil-design-eng/SKILL.md` lines 8-14; same in `review-animations` lines 8-14 and `animate`).
- Values as tables and ranges ("Button press feedback 100-160ms", `emil-design-eng` lines 127-133), named custom curves (lines 110-119), lots of before/after code, a required `| Before | After | Why |` review table (lines 38-60).
- Strong rules with reasons: "Never animate keyboard-initiated actions" (line 77), "Never use ease-in for UI animations" (line 121), "Raycast has no open/close animation" (line 79).
- `learn-taste` is the most transferable idea for Cairn: "A check beats a sentence. If a violation can be found by matching code… propose a lint rule, a token restriction, or a test" (`E/skills/learn-taste/SKILL.md` line 22). Cairn's `retro-cairn` and correction ladder already work this way.

**Focus (derived):** how motion and interaction *feel*: whether to animate at all, easing, timing, interruptibility, gestures, choreography, frame budget; plus the small "invisible details" (origin, press, tooltip delay). Layout, color and typography appear only in passing (`E/ui-cheatsheet.md`).

### 1.3 Where they overlap

Both cover, with near-identical reasoning (verified, both sources):

- Frequency decides whether something animates; keyboard and 100-a-day actions get none (Jakub `better-motion` lines 20-24; Emil `emil-design-eng` lines 66-79).
- Ease-out for enters and exits, linear for loops, never ease-in on UI.
- Exits shorter than enters; transitions (retargetable) over keyframes for interactive state.
- Popovers scale from their trigger (`transform-origin`), modals stay centred; never from `scale(0)`.
- Name transition properties, never `all`; animate transform, opacity, filter, clip-path.
- Reduced motion keeps opacity and drops travel; hover only on hover-capable pointers.
- Both ship a "variants behind a picker" procedure (`variant` / `prototype`) and a stress procedure (`break` / `break-ui`). Cairn already has the first as `options-prototype-cairn`.

### 1.4 Where they conflict

| Topic | Jakub | Emil | Cairn today |
|---|---|---|---|
| Press feedback | `scale(0.96)`, 150ms ease-out, "exact" (`better-motion` lines 77-79) | `scale(0.97)`, "0.95-0.98" (`emil-design-eng` lines 201-215) | Never moves; instant 10% tint (`DESIGN.md` line 382) |
| Spring bounce | always `0` (line 52) | `0.2`, "keep 0.1-0.3" (lines 184, 193) | No springs (`DESIGN.md` line 384); V24 bans bounce |
| Ease-out curve | `ease-out`, or `cubic-bezier(0.2, 0, 0, 1)` as a spring stand-in (line 48) | `cubic-bezier(0.23, 1, 0.32, 1)` (line 112) | `--ease-standard: cubic-bezier(0.4, 0, 0.2, 1)`, `--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)` (`shadcn.css` lines 64-65) |
| Popover / dropdown enter scale | `0.96`-`0.97`; modals `0.98`-`0.99` (line 58) | `scale(0.9)` or higher, example `0.95` (lines 217-233) | `.95→1` for dialogs, menus, ⌘K and tooltips (`DESIGN.md` Motion table) |
| Frequently opened menu | No opening animation, animate only the close (line 24) | Command palette: no animation at all (line 72) | Menu 100ms in, no exit; ⌘K 200ms in and out |
| Durations | tooltip 150, dropdown 250, modal 350-450ms (lines 36-40) | under 300ms; modals and drawers up to 500ms (lines 127-135) | 100-220ms overlays |
| Review stance | "a deliberate and consistent project convention is a preference and not a finding" (line 16) | "Default to flagging. Approval is earned" (`review-animations` line 3) | Rule ids with M/G/H checks |

The two disagree on four values, and Cairn disagrees with both on press and springs. A copied skill, used as written, would make an agent "fix" ian's no-move press. (derived)

## 2. loading.dev: how the quality is made and kept

### 2.1 What the product is

A React spinner library (`loading-dev` on npm, v0.3.8, 36 spinners) and its showcase site, by Jakub Krehel and Paul Faivret (site footer, screenshot `03-bouncing-dots-light.png`). pnpm workspace: library at the root, `apps/web` is Next.js 16 with Tailwind 4, Base UI and Motion (`L/AGENTS.md` "Architecture"). MIT (`L/LICENSE.md`). (verified)

Operated (verified, screenshots in `/tmp/dogfood/design-skills/`):

- Home (`01`, `02`, `06` dark): a sidebar, a two-tone headline ("Loading," ink / "made beautiful." grey), an install line, a 3-column grid of 24px-corner cards with the spinner centred and its name below. Nothing else.
- Spinner page (`03`, `05` dark): breadcrumb title, one-line description, a preview stage with a customise panel (segmented size, colour, speed slider "500ms", opacity), pause and "show in context" buttons, the generated code beneath, then five shared sections (Size, Custom Classes, Color, Duration, State) with a table of contents.
- ⌘K search (`07` mid-transition at 0.05x, `08`, `09` typed "dots"): a centred palette with a spinner glyph per row and a keyboard legend. Mid-frame `07` (0.05x clock) shows the palette half-transparent over the page as it enters through the shared `.popup-transition`.
- Customise (`10`): moving the speed slider with the arrow keys rewrites the code sample live.
- Tooltip on the pause button (`11`).

Measured on the live page (verified, computed styles):

- Bouncing dots: `animation: ld-bouncing-dots-bounce 0.5s ease-in-out alternate infinite`, staggered delays, dot = 25% of the size, gap 20%, travel `translateY(28%)` to `translateY(-72%)` (`L/src/bouncing-dots.tsx` lines 7-31). Everything is relative to one `--ld-size`.
- Buttons: `transition-property: scale, background-color, color`, `0.2s`, `cubic-bezier(0, 0, 0.2, 1)` (Tailwind's `ease-out`), `active:scale-[0.97]` (`L/apps/web/src/components/ui/button-styles.ts` line 14).
- Body: Inter variable, `font-feature-settings: "cv01", "ss03"`, 16px / 26px.

### 2.2 Where consistency comes from

Structure that makes the consistent choice the only easy one (verified):

- **One motion registry.** `SPINNER_MOTION` in `L/src/motion.ts` lines 13-50 holds every spinner's default duration; `duration()`, `stagger()` and `animation()` (lines 54-74) are the only way to write an animation, and `animation()` always appends `animation-play-state`. `L/AGENTS.md` "Library conventions" has a "reach for the helper rather than writing what it writes" table.
- **One vocabulary file.** `L/CONTEXT.md` defines Spinner, Motion contract, Catalog, Customization, Document: "Names here should be the names in the code — if a term drifts, fix the code or fix this file."
- **Types that fail when something is missing.** A spinner without a `SPINNER_MOTION` entry does not type-check; the catalog fails until every spinner is listed or `UNLISTED` (`L/AGENTS.md` "Adding a spinner", steps 2 and 4).
- **Site tokens in one file.** `L/apps/web/src/styles/globals.css`: semantic OKLCH tokens (`--color-content`, `-subtle`, `--color-background`, `-hovered`, `--color-border` at 5% ink), two shadow recipes (`--shadow-custom` ring plus soft layers, `--shadow-popover` four layers), a 13/15px type scale with fractional line heights, a `semimedium` 450 weight, `@custom-variant hover-hover (@media (hover: hover) and (pointer: fine))`, a global reduced-motion reset.
- **Shared primitives.** One `.popup-transition` utility (`L/apps/web/src/styles/utilities.css` lines 2-12: `scale, opacity`, 200ms, `var(--ease-out)`, from `scale: 0.95`) used by popover, tooltip, dropdown and search; one `buttonVariants` table; Base UI for every interactive primitive.
- **The skill rules show up as code.** `DisableThemeTransitions` (better-motion "Suppress transitions on theme switch"), `MotionProvider` with `LazyMotion features={domMax}` and `MotionConfig reducedMotion="user"` ("Load only the Motion features in use"), `AnimatedIcon` with exactly the skill's cross-fade (`scale 0.25`, `blur(4px)`, spring `duration 0.3, bounce 0`; `L/apps/web/src/components/ui/animated-icon.tsx` lines 5-8), the segmented-control indicator spring `0.3`/`bounce 0`.

Enforcement that exists (verified):

- `L/tests/spinners.test.tsx`: for every spinner in `SPINNERS`, static render asserts `aria-hidden`, the `ld-` class, `currentColor`, no duration or play-state written unless passed, `@media (prefers-reduced-motion: reduce)` with `animation: none`, and one `animation-play-state` per `animation:` shorthand; one stylesheet per spinner kind however many instances.
- Lint: Oxlint (Ultracite presets) with `--deny-warnings`; `no-restricted-imports` bans `@radix-ui/*` ("Use @base-ui/react for interactive primitives"), `framer-motion` ("Use motion/react"), and `memo`/`useMemo`/`useCallback` (React Compiler) (`L/oxlint.config.ts` lines 11-25). Biome `useBaseline` errors on CSS outside Baseline (`L/biome.jsonc`).
- CI: `pnpm check`, `pnpm test`, `pnpm typecheck`, and a build of `examples/consumer` against the published npm tarball (`L/.github/workflows/ci.yml`).

Enforcement that does not exist (verified by absence in the tree at the pin): no visual regression or screenshot tests, no Storybook, no design-rule lint for the site's CSS values, no skill or rules file for design in the repo. `L/AGENTS.md` says the opposite of a gate for visuals: "A passing check is not a working feature… For any visual or runtime change, state what was verified and what was never seen running… the word is 'unverified'", and "Don't run builds or checks on routine changes" such as a styling tweak.

Verdict: **craft held in place by structure.** The look comes from the author's taste, applied through a few tokens and shared primitives; the library's motion contract is the only thing a test guards. The skills repository is the same author writing that taste down for agents, and the site predates or drifts from some of its exact values (press `0.97`, popups from `0.95`). (derived)

## 3. Cairn today, against these

Cairn's design system is larger and more enforced than loading.dev's, and less consistent:

- **Rules:** `DESIGN-RULES.md` (140 lines, ids with M/G/H checks), `DESIGN.md` (446 lines, tokens, components, motion table), `COMPONENTS.md` (106 lines). The 2026-11-20 audit measured about 29,000 words, near 45k tokens, and found the three files contradicting each other (stale paste-into-prompts block, two dark palettes, duplicated contracts) (`docs/design/audit-2026-11-20.md` "Are the design docs too much to read?"). (verified)
- **Checks:** `e2e/design-rules-measure.spec.ts` asserts font family, placeholder text, backticks, nested cards, no horizontal scroll at 390px, one primary, no card grid, across twelve fixture surfaces, with a ratchet for open violations; V24 is held by `test/unslop-signs.test.ts`; V27-V29 by texture specs. loading.dev has nothing comparable for its site. (verified)
- **Motion:** a written table of kinds, durations and easings, two duration tokens (`--dur-fast` 150ms, `--dur-overlay` 200ms) and two curves (`shadcn.css` lines 62-65); press is an instant tint that never moves; no springs; "Growth" rows describe live-surface choreography in prose (`DESIGN.md` lines 362-386). (verified)
- **Skill:** `design-cairn` (71 lines) is a process skill: brief template, reference screenshots per surface, draft-first, seed states. It says "Use together with the global design skill", and no skill by that name is installed on this machine (verified by the skill listing in this session); that pointer resolves to nothing today. (verified)

What Cairn lacks that the skills have (derived):

1. **Exact craft values for things the rules do not mention:** concentric radii, optical alignment recipes, shadow recipes for floating surfaces, icon cross-fade values, exit shorter than enter, origin from trigger, theme-switch transition suppression, the slow-motion check.
2. **A detection table per domain** (grep-able patterns), which is cheaper for an agent than a 900-word rule row.
3. **A calibration line** saying which values are exact and that a consistent project choice wins.

Where Cairn is ahead: measured checks with negative controls, owner-decided contracts with dates, reference screenshots per surface. The skills should feed that system, not replace it.

## 4. Does "on-demand skills named by the design entry" work?

### 4.1 How the harnesses load skills

| Harness | Discovery | Auto-load | Opt-out | Source |
|---|---|---|---|---|
| Claude Code | `.claude/skills/<name>/SKILL.md` in the project, `~/.claude/skills`, plugins | The model sees a listing of names + descriptions and invokes a skill when the description matches; `paths` globs can activate a skill for matching files | `disable-model-invocation: true` | code.claude.com/docs/en/skills.md, frontmatter reference (verified) |
| Devin CLI | `.devin/skills`, `.windsurf/skills`, `.agents/skills`, and also `.claude/skills`, `.codex/skills` and others | Same model: description-triggered, `triggers: [user, model]` | `triggers: [user]` | docs.devin.ai/cli/extensibility/skills/overview.md (verified) |

Costs and limits (verified, Claude Code docs "Skill descriptions are cut short" and frontmatter table): the description plus `when_to_use` is truncated at 1,536 characters; the whole listing has a budget of 1% of the context window, and when it overflows Claude Code drops descriptions of the least-used skills first, removing the keywords that trigger them; a loaded skill's body stays in context for the rest of the session and is re-attached after compaction up to 5,000 tokens per skill and 25,000 in total.

So, for ian's idea (derived):

- **Vendoring all 35 upstream skills would hurt.** Each adds a description to every turn's listing; several overlap (two pickers, two stress tests, two reviewers, five motion skills) so the model picks between near-duplicates; the least-used lose their descriptions under budget pressure. And the values conflict (section 1.4).
- **Description matching alone is not reliable for "load the motion skill when doing motion."** A UI fix that adds a transition is described by the user as "fix the popover", not "animation"; whether the model invokes `better-motion` then depends on its judgement. (guess, consistent with Cairn's own history: the AGENTS.md first line already has to tell agents to invoke `design-cairn` explicitly.)
- **An explicit routing chain is reliable enough.** AGENTS.md already forces `design-cairn` for any `apps/web/src` change. If `design-cairn` carries a short table "if the change touches motion, invoke `cairn-motion`; surfaces, shadows, radii, icons: `cairn-polish`; type: `cairn-type`", the agent loads the right one as a step of a skill it is already following. Claude Code's `paths` field can add a second trigger for files such as `apps/web/src/styles/motion.css`. (derived)
- **A check can hold the chain, not the loading itself.** A unit test can assert that every skill `design-cairn` routes to exists, that each wrapper names its upstream pin and keeps the upstream LICENSE, and that the wrapper's override table names only Cairn rule ids that exist. Whether an agent actually invoked the skill shows only in its transcript; the wrap-up can name the skills loaded, as it already names rule ids. (derived)

### 4.2 Licenses

All three repositories are MIT (verified: `J/LICENSE`, `E/LICENSE`, `L/LICENSE.md`). Vendoring is allowed with the copyright and permission notice kept with the copied files. Keep each upstream `LICENSE` in the vendored directory and say in the wrapper where the text came from and at which commit. Cairn is public, so the notice matters. (verified licence text; obligation derived from MIT's notice clause)

### 4.3 Conflicts with Cairn's rules and banned patterns

| Upstream guidance | Cairn rule it hits | Resolution |
|---|---|---|
| Press scales to 0.96 / 0.97 (both) | `DESIGN.md` Motion: a pressed button never moves (line 382) | Cairn wins; the override table says so. Changing it is ian's call (intended behaviour) |
| Springs for sheets, indicators, drag; Emil's bounce 0.2 | No springs (line 384); V24 bans bounce and overshoot | Cairn wins. Jakub's CSS stand-in `cubic-bezier(0.2, 0, 0, 1)` is the usable part |
| Stagger staged entrances by 100ms (Jakub), delight on rare moments (Emil) | No entry animation on chat messages or board cards; only the Growth rows (line 384) | Cairn wins outside the Growth rows; Emil's `choreograph` is good reading for the Growth rows themselves |
| Emil's custom curves | `--ease-standard`, `--ease-out-expo` tokens; `e2e/color-freeze.spec.ts` pins `--ease-out-expo` | Keep Cairn tokens; whether `--ease-standard` (Material) should become a stronger ease-out is a candidate for the pilot, decided by before/after evidence |
| Shadows for elevation instead of borders (Jakub `better-ui`) | V21 no hover shadows; outlined cards by design | Applies to floating surfaces only (menus, popovers, dialogs); not to cards |
| loading.dev bouncing dots and dot spinners | Owner rejected dot working indicators on 2026-11-17 (his verdict: too ugly), Cairn's working mark is the spiral | Do not import any spinner. The rejection was of Bayer dot-ink at 14-32px; solid dots are a different look, but the spiral is the brand loop and a second working indicator would split it |
| Emil's persona opener and "default to flagging" | Autonomous lanes that must finish their turn | Do not vendor those skills as model-invocable |

### 4.4 Adapt vs copy

- **Copy verbatim, pinned:** Jakub's `better-motion`, `better-ui`, `better-typography` reference files (recipes, tables, detection patterns). Verbatim copies stay easy to diff against upstream and keep the licence clean.
- **Adapt (write ours):** a thin wrapper `SKILL.md` per domain: Cairn description, Cairn tokens instead of raw values, the override table keyed by Cairn rule ids, and the hand-off to `design-cairn`. Jakub's own calibration line ("a deliberate and consistent project convention is a preference and not a finding") already licenses this.
- **Read, do not vendor:** Emil's `emil-design-eng`, `choreograph`, `animation-performance`, `remove-animations`, `learn-taste`. Mine them once into the wrapper's override or detection rows where they add something Jakub lacks (keyboard-triggered actions never animate; tooltip delay skipped after the first; asymmetric enter/exit for deliberate actions).
- **Skip:** Jakub's `afk`, `upskill`, `variant`, `state-machine`, `break` (Cairn has lanes, `retro-cairn`, `options-prototype-cairn`, fixture scenarios); Emil's `animate-expo`, `write-swift`, `mobile-native` (Mac first, no iOS), `ask-sonner`, `pick-ui-library`, `prototype`, `ask-emil`.

## 5. Recommendation

### 5.1 Comparison of options

| Option | Reliability of loading | Context cost | Conflict risk | Upkeep |
|---|---|---|---|---|
| A. Install both upstream sets as plugins / `npx skills add` | Description match only | 35 descriptions per turn | High: two value sets, both against ian's press and spring decisions | None, but upstream changes land unreviewed |
| B. Vendor both sets into `.claude/skills` unchanged | Same as A | Same as A | Same as A | Manual sync of ~12k lines |
| C. Reference only (links in `DESIGN.md`) | Low: agents rarely fetch a URL mid-task | Zero | Low | None; nothing gets used |
| **D. Two or three Cairn wrapper skills, each with one pinned upstream skill + an override table, routed by `design-cairn`, held by a test** | Explicit chain from AGENTS.md | Three descriptions; bodies only when routed | Low: overrides are written once | One pin bump per upstream release, reviewed |

D is the recommendation. (derived)

### 5.2 Steps

1. **Vendor** `better-motion`, `better-ui` and `better-typography` from `jakubkrehel/skills@672ae44` into `.claude/skills/cairn-motion/upstream/`, `cairn-polish/upstream/`, `cairn-type/upstream/` with the upstream `LICENSE` beside each. Upstream `SKILL.md` files are renamed so they are not discovered as separate skills (for example `upstream/README.md`); their reference files keep their names so internal links work.
2. **Write each wrapper `SKILL.md`** (under 80 lines): description scoped to Cairn ("Use when a change under apps/web/src adds or changes a transition, animation, enter/exit or loading state"), "Read `upstream/README.md` and the reference file for the recipe you need", then the override table from section 4.3 keyed by rule id, then the Cairn tokens to use in place of raw values. `paths:` the files that are always motion (`apps/web/src/styles/motion.css` and similar) as a second trigger.
3. **Route from the entry.** The new short `DESIGN.md` entry (the other lane's work) and `design-cairn` each get one table: task kind → skill to invoke. Motion → `cairn-motion`; surfaces, shadows, radii, icons, optical alignment → `cairn-polish`; type, wrapping, tabular figures → `cairn-type`. This replaces the dangling "global design skill" pointer in `design-cairn`. Coordinate with the consolidation lane instead of editing its files in parallel.
4. **Hold it with a test** (`apps/web/test/design-skill-routing.test.ts` or alongside `anti-slop-foundations.test.ts`): every routed skill exists; every wrapper carries an upstream commit and a LICENSE file; every rule id in an override table exists in the rules file; no second copy of an upstream skill is discoverable (no `SKILL.md` under `upstream/`). Negative control: delete a wrapper and remove a LICENSE, both turn it red.
5. **Pilot one surface in one wave** (5.3), then decide whether to keep going surface by surface.
6. **Upkeep:** a monthly lane diffs upstream against the pin and opens a change with the delta and its conflicts with the override table.

### 5.3 Pilot: the overlay family (⌘K, menus, popovers, tooltips, dialogs)

Why this surface: the owner's reaction is to how loading.dev *feels*, and the place Cairn's feel is set in one spot for the whole app is the overlay layer: one set of shared components (`DialogShell`, menu, popover, Select, tooltip, ⌘K) used on every screen, already tabled in `DESIGN.md` Motion. Both authors give concrete, checkable guidance here, and two of Cairn's current values sit against it: ⌘K animates 200ms in and out although both authors say a command palette opened many times a day should not animate on open, and every overlay opens from `scale(.95)` where Jakub says `0.96`-`0.97` for anchored popups and `0.98` for dialogs, with `transform-origin` at the trigger. (verified values; fit derived)

Scenario table (what the user meets):

| Situation | Today | After the pilot (proposal) | Wait / cost |
|---|---|---|---|
| Press ⌘K twenty times a day | 200ms fade and scale in, 200ms out | Opens instantly; closes with a 100-150ms fade | Saves 200ms per open |
| Open a row's menu | 100ms in from `.95`, from the centre | Opens from the trigger corner at `0.97`, or instantly if counted as high-frequency; exit 100ms | Same or less |
| Open a confirm dialog | 200ms in from `.95` | 200ms in from `0.98`, centred; exit shorter than enter | Same |
| Hover along the toolbar | Every tooltip waits and animates | First tooltip waits; the next ones open instantly (Emil) | Faster scanning |
| Switch light / dark | Colour transitions may smear | All transitions suppressed for the swap (Jakub) | None |
| Reduced motion on | Keyframes shrink, transitions untouched | Overlays cross-fade only | None |

The press behaviour (no move) and the absence of springs stay as ian decided; the pilot does not touch them.

How to prove it (before/after, per `visual-change-needs-recording`):

- Capture each overlay opening and closing at real speed (a recording) and at 0.1x (frames via the CDP `Animation.setPlaybackRate`, as done for `07-search-dialog-enter-slowmo.png`), on a `verify-cairn` live stack, light and dark, before and after.
- Read computed `transition-*`, `transform-origin` and `scale` from the live page, before and after, into a small table.
- Turn the new values into an `M` check in `design-rules-measure.spec.ts` (open each overlay, assert origin is not `center` for anchored popups, enter scale ≥ 0.96, ⌘K has no enter transition), with a negative control.
- Show ian the side-by-side recording; he decides whether to continue to the next surface.

### 5.4 Do not adopt (superseded by section 7)

This list judged items against earlier owner decisions. ian asked for a re-assessment on merit; section 7 replaces it.

- Any loading.dev spinner, bouncing dots included, or any dot-based working indicator (owner rejection 2026-11-17; the spiral is the working mark).
- Press scale, springs with bounce, staggered entrances on chat or board items: each reverses an owner decision. Ask ian before any of them.
- Emil's persona-reply skills and "default to flagging" review as model-invocable skills.
- Upstream procedure skills that duplicate Cairn's own (`variant`/`prototype` vs `options-prototype-cairn`; `afk`; `upskill` vs `retro-cairn`).
- Installing either set as a plugin or via `npx skills add` on the shared machine: it would change every lane's skill listing without review.

Worth copying from loading.dev's engineering rather than its visuals: one motion registry that every animated component reads (Cairn has the tokens but the Growth rows hard-code durations in prose and code), and a test that iterates every animated component and asserts the reduced-motion and play-state contract, the way `L/tests/spinners.test.tsx` does.

## 6. Coverage

| Source | Read / operated | Notes |
|---|---|---|
| `jakubkrehel/skills` | All 16 frontmatters; `better-motion` and `better-ui` in full; `AGENTS.md`, `README.md`, `LICENSE` | Pinned `672ae44` |
| `emilkowalski/skills` | All 19 frontmatters; `emil-design-eng` headings and lines 1-240; `animate` lines 18-142; `review-animations` lines 1-60; `learn-taste` lines 1-80; `ui-cheatsheet.md`; `README.md`; `LICENSE` | Pinned `64eb3de` |
| `jakubkrehel/loading` | `AGENTS.md`, `CLAUDE.md`, `CONTEXT.md`, `motion.ts`, `bouncing-dots.tsx`, `easing.ts`, tests, CI, lint configs, `globals.css`, `utilities.css`, web UI components | Pinned `da6f2e6` |
| loading.dev (live) | Home, bouncing-dots page, ⌘K search (slowed), customise slider, tooltip, `llms.txt`; light and dark | Headless Chromium; no sign-in needed |
| aiforui.dev/skills (live) | Landing page | Screenshot `12` |
| interfaces.dev (live) | Landing page | Screenshot `13` |
| Claude Code skills docs | Loading, frontmatter, listing budget, compaction | code.claude.com/docs/en/skills.md |
| Devin CLI skills docs | Discovery paths, triggers | docs.devin.ai/cli/extensibility/skills/overview.md |
| Cairn | `DESIGN.md` Motion, `DESIGN-RULES.md`, `design-cairn`, `shadcn.css` motion tokens, `design-rules-measure.spec.ts`, `audit-2026-11-20.md` | `origin/main` `4ced3778e` |

## 7. Re-assessment on merit (ian, 2026-11-20)

ian asked that nothing be rejected only because it conflicts with an earlier owner decision. Each item below is judged on what it would improve in Cairn, its cost and risk, and quality. Where the answer depends on how it feels, it is marked **taste** and the proposal is a side-by-side for ian, not a decision.

New facts read for this section (verified, at `origin/main` of this change):

- Cairn already ships solid typing dots: `TypingDots` in `apps/web/src/components/chat/live-row.tsx` (lines 55-86), three 6px dots, `typing-hop` 1.2s `ease-in-out`, 0.15s apart, a 3px hop with opacity 0.45 to 1, resting for 60% of each cycle (`apps/web/src/styles/app.css` lines 492-511). The 2026-11-17 rejection was of Bayer dot-ink texture, not of solid dots.
- Inline busy states use lucide `LoaderCircle` with `animate-spin` (8 sites, e.g. `apps/web/src/chief/approval-card.tsx` line 173); the brand working mark is the spiral (2.4s linear).
- The no-move press came from issue #3152 (commit `85c0ac960`): the old press was `active:translate-y-px` and about 33 call sites cancelled it. The problem it fixed was a 1px downward shift of the label, not scale as such.
- Cairn has no motion library (`apps/web/package.json` lists `tw-animate-css` only). A JS spring would need `motion`, a new dependency and a lockfile change, which is ian's call. CSS `linear()` can draw a spring curve without a library.
- loading.dev's bouncing dots run a 1s cycle (0.5s each way, `alternate`), travel one full dot height (`translateY(28%)` to `translateY(-72%)`), are evenly staggered across the cycle, and never rest (`L/src/bouncing-dots.tsx` lines 7-31).

### 7.1 Items

| Item | What it would improve in Cairn | Cost and risk | Recommendation |
|---|---|---|---|
| loading.dev bouncing dots | Cairn's typing pill already uses three solid dots, but they hop 3px and rest 60% of the cycle, so the pill reads as idle between hops. loading.dev's dots never stop and travel a full dot height with even spacing, which reads as "working" at a glance | A faster, larger bounce in a chat pill can feel nervous next to calm text; the CSS is ~20 lines | **Adapt, taste**: retune `typing-hop` toward loading.dev's motion (period, travel, even stagger, no rest) inside the existing `TypingDots`; side-by-side of today vs retuned at 1x |
| Other loading.dev spinners (Arc, Ring, Classic) for inline busy glyphs | Replaces the stock lucide `LoaderCircle` in buttons and cards with a drawn, size-relative spinner that inherits `currentColor` and ships reduced-motion CSS | Two loop languages (spiral for agent work, a small spinner for "this button is busy"); either copy one spinner (MIT, notice kept) or add `loading-dev` as a dependency (lockfile) | **Adapt, taste**: copy one or two spinners' CSS into a Cairn `BusyGlyph`, no new dependency; side-by-side `LoaderCircle` vs Arc vs Ring at 16 and 20px. Skip the whole library |
| Press scale | Physical acknowledgement in the frame of the click, the effect ian sees on loading.dev buttons. Scale from the centre does not move the label down, which was the actual #3152 complaint | A scaled button shrinks its edges by 0.5-3px, so a click that starts at the very edge can release outside it; text can soften for a frame during scale; on dense rows and icon buttons the movement is noise | **Adapt, taste**: scale only standalone labelled buttons (filled and outline `Button`), keep the instant tint, never rows, menu items, sidebar or toolbar icon buttons; disabled never scales. Side-by-side today vs scale |
| Press value 0.96 vs 0.97 | Either reads as a press; one value project-wide is what matters (Jakub `better-motion` line 16) | None beyond the item above | **Adapt**: 0.97. Cairn buttons are small (28-32px tall) and dense, and 0.97 is also what loading.dev itself ships; 0.96 is the stronger value for larger components. Shown in the same side-by-side |
| Springs | The few moves that imitate an object (segmented-control pill, side panel slide, jump-to-latest button) settle more naturally and can be reversed mid-way | `motion` would be a new dependency for three surfaces; a CSS `linear()` spring has no velocity hand-off on interruption | **Adapt**: no library; a no-bounce spring curve as a CSS `linear()` token (or Jakub's `cubic-bezier(0.2, 0, 0, 1)`) on those three surfaces only |
| Bounce 0 vs 0.2 | Bounce adds play; Jakub never bounces, Emil allows 0.1-0.3 for playful and drag-to-dismiss | Overshoot on work chrome (menus, panels, toggles) reads as toy-like and slows the settle | **Bounce 0 for chrome (adopt Jakub). Taste** for one rare celebratory moment (a task's done check or first-run completion): side-by-side 0 vs 0.15 |
| Easing curves | Cairn's `--ease-standard` is Material `cubic-bezier(0.4, 0, 0.2, 1)`, which starts slowly; overlays use the default `ease`. A strong ease-out (Emil `cubic-bezier(0.23, 1, 0.32, 1)`, or Cairn's own `--ease-out-expo` `cubic-bezier(0.16, 1, 0.3, 1)`) moves at once, so the same 150-200ms feels faster | Retuning curves touches every overlay; `--ease-out-expo` is pinned by `e2e/color-freeze.spec.ts`, so a new token or a pin update is needed | **Adopt** a strong ease-out for every enter and exit (overlays, panels), keep a gentle curve for colour and hover. **Taste** only on which strong curve: side-by-side Emil's vs `--ease-out-expo` on the ⌘K and menu pilot |
| Staggered entrance on chat messages | Would give each new message a little choreography | Messages arrive every turn: high frequency, the case both authors say not to animate; streaming text already moves; it competes with C18 (start of reply in view) and C23 (what is shown stays put); Claude.ai, the reference, does not stagger | **Skip** for messages and lists, on merit |
| Staggered entrance on rare moments | First run, an empty state, a finished setup step: 100ms stagger, 12px, 4px blur (Jakub) gives these moments a crafted arrival | Low; reduced motion falls back to a cross-fade | **Adapt, taste**: first-run page only as a trial; side-by-side today vs staggered |
| Emil's motion skills (`remove-animations`, `find-animation-opportunities`, `improve-animations`) | Cairn added many Growth animations on 2026-11-19; a read-only audit that both prunes over-animation and finds missing motion, with plans another lane can execute, fits the dispatch model | Persona opener and "default to flagging" stall autonomous lanes; values conflict with the Cairn table | **Adapt**: one user-invoked `cairn-motion-audit` built from these three, with the persona line removed, findings keyed to Cairn rule ids and values from the Cairn tokens |
| `review-animations` | A strict motion review before landing a motion change | Same persona and flag-everything stance | **Adapt** into the audit above (diff scope), not a second skill |
| `choreograph`, `animation-performance` | Direct guidance for the Growth rows (lead, follow, overlap) and frame budget | None as reference | **Adopt** as reference files of `cairn-motion` |
| `emil-design-eng` | Strong reasons, but 684 lines overlapping everything above | Context cost; duplicates `better-motion` | **Skip** as a skill; already mined |
| `gestures`, `apple-design`, `mobile-native`, `animate-expo` | Touch and sheet interactions | Cairn is Mac first with pointer input; no iOS | **Skip** now; revisit `gestures` if drag-to-reorder or sheets arrive |
| `variant` / `prototype` | Several variants behind a picker | `options-prototype-cairn` already does this, grayscale and structurally different, wired into the owner's pick | **Skip**; borrow one thing: a "promote the picked variant" step |
| `state-machine` | Every state of one component on a page with a switcher | Cairn has fixture scenarios and `/design.html`; a second throwaway route would duplicate them | **Skip** the skill; P3 already requires the states |
| `break` / `break-ui` | Worst-case data catalog (long names, unbreakable emails, CJK and emoji, huge counts, empty) | Low | **Adapt**: add the catalog as the "long content" checklist in `design-cairn`'s state list |
| `interface-review` | Change-scoped UI review (introduced / regression / pre-existing) that Cairn's general review lacks | A review lane per UI change | **Adapt** as a step of the design review, with Cairn rule ids |
| `afk`, `upskill`, `learn-taste` | Unattended work, session mining, corrections into rules | Cairn has lanes and `retro-cairn`, which already turns corrections into checks | **Skip**; `learn-taste`'s "a check beats a sentence" is already Cairn practice |

### 7.2 Side-by-sides for ian

Taste calls, each shown as a real-speed recording plus a 0.1x frame strip on one prototype page with an A/B switch, built from the real components:

1. Typing dots: today vs retuned toward loading.dev.
2. Inline busy glyph: `LoaderCircle` vs loading.dev Arc vs Ring, at 16 and 20px, in a real button.
3. Press: today's tint vs tint plus `scale(0.97)` on standalone buttons.
4. Overlay curve: today vs Emil's strong ease-out vs `--ease-out-expo`, on ⌘K and a menu.
5. Celebration bounce: done check with bounce 0 vs 0.15.
6. First-run entrance: today vs 100ms stagger.

Decided on merit without a side-by-side: bounce 0 for all chrome, no stagger on messages, no motion library, the motion audit and reference adoptions, and the process-skill skips.

## 8. Selection by fit across all 36 skills (ian, 2026-11-20)

ian's correction: pick skills by how well they fit Cairn's work, not by whether they overlap something already vendored. Dropping skills, or keeping only Jakub's three, loses detail and overfits Cairn to one author. Sections 5.4 and 7 skipped several skills because they overlapped; this section supersedes those skips.

The selection test has three parts:

- Fit with Cairn's actual work: a Mac-first Electron desktop and web app with chat, tasks, dense settings, motion and a future design-preview feature.
- Unique guidance: what the skill has that nothing already vendored covers.
- Cost of vendoring it verbatim as reference files behind a Cairn wrapper.

A vendored reference costs no per-turn tokens. Only a wrapper's `SKILL.md` description is discoverable, and a reference is read only when the wrapper sends the agent to it (verified: `apps/web/test/design-skill-routing.test.ts` fails when a second `SKILL.md` is discoverable under a wrapper). On disk, every candidate below is 70-700 lines. So the only real costs are a pin, a LICENSE copy, and one routing line in the wrapper. "Skip" is kept for skills that do not apply to Cairn's platforms or that conflict with how Cairn runs agents.

The upstream repos hold 36 skills: Jakub 16 and Emil 20 (verified with `ls skills/`). The count of 35 in the brief was one short.

Repo facts behind the verdicts (verified on main 1c8c5ddf9):

- `sonner` is a dependency of `apps/web` and is imported in 12 files under `apps/web/src`.
- `apps/desktop` is Electron, so no Swift ships for the Mac app. `apps/ios` exists but is out of scope (Mac first).
- `@dnd-kit/core` and `@dnd-kit/sortable` are declared in `apps/web/package.json`, but nothing under `apps/web/src` imports them.
- Rule R1 requires every state at 390px.

### 8.1 Already vendored (unchanged)

| Skill | Where |
|---|---|
| Jakub `better-motion` | `cairn-motion/upstream` |
| Jakub `better-ui` | `cairn-polish/upstream` |
| Jakub `better-typography` | `cairn-type/upstream` |
| Emil `choreograph`, `animation-performance` | `cairn-motion/references` |
| Emil `remove-animations`, `find-animation-opportunities`, `improve-animations`, `review-animations` | `cairn-motion-audit/upstream` |
| Emil `break-ui` | `design-cairn/upstream` |

### 8.2 The other 26 skills (and Emil's two root cheatsheets)

| Skill | Fit with Cairn | Unique guidance not already vendored | Verbatim cost | Verdict |
|---|---|---|---|---|
| Jakub `better-colors` | High: ochre accent, dark layers, status colours, contrast findings in the audit | Ramps where each step has a job; primitives named by hue and semantics by role; one colour, one meaning; one filled action per view; measure the rendered pair; gradient interpolation space | 9 files, 639 lines | **Vendor** under `cairn-polish` (colour route) |
| Jakub `better-layout` | High: dense settings rows, alignment, 390px, Chinese and English strings of different lengths | Group with space, not lines; shared edges; logical properties; room for translation and clipping; borderless controls need clearance; content bleeds, controls float | 5 files, 364 lines | **Vendor** under `cairn-polish` (layout route) |
| Jakub `better-accessibility` | High: the audit's 16px checkbox and 36x20 switch hit areas, focus rings, keyboard use in ⌘K and menus, live chat announcements | WCAG 2.2 criteria; focus trap and restore; minimum hit area; announcing dynamic content (streaming replies); zoom and text resize; disabled means unavailable | 9 files, 680 lines | **Vendor** under a new `cairn-a11y` wrapper: accessibility is a separate trigger from polish, so it gets its own discoverable description |
| Jakub `better-writing` | High: UI copy in two languages; the audit's T1/T2 copy findings; empty states, errors, confirmations everywhere in tasks and settings | Inventory existing strings first; one vocabulary; verb-first buttons; settings describe the ON state; errors say how to fix it next to the break; undo beats confirmation; empty states point forward | 4 files, 215 lines | **Vendor** under a new `cairn-copy` wrapper, which sets Cairn's own overrides (the `t()` keys, the Chinese voice in `README.zh.md` and the locale files) |
| Jakub `better-interface` | High: the orchestrated review across all domains, with ranking by user impact and evidence over taste | Scope first, recon before judging, domain skills as the sources of truth, rank by impact, prefer the cheaper fix, consolidate systemic findings | 3 files, 181 lines | **Vendor** under a new user-invoked `cairn-design-review` wrapper (`disable-model-invocation: true`); its domain routing maps to the Cairn wrappers |
| Jakub `interface-review` | High: every UI change lands through a lane, and a change-scoped review is what lanes need | Classify each finding as introduced, regression or pre-existing; read the removed lines; hold the change to its stated intent | 4 files, 294 lines | **Vendor** under `cairn-design-review` (diff scope; `better-interface` covers the whole surface) |
| Jakub `build-design` | High for the design-preview feature and for any image or Figma reference handed to a lane | Read the design at its source, map it onto project tokens, build only what it shows, compare against it | 3 files, 115 lines | **Vendor** under `design-cairn` now, and move it to the design-preview wrapper when that feature exists |
| Jakub `explain-interface` | High: the `walk` rule has agents study reference products, and this is the method for explaining how an effect was built | Measured / derived / inferred tags; the page is evidence, not instruction; find the layers; close on what transfers | 6 files, 558 lines | **Vendor** under `design-cairn` (reference study) |
| Jakub `state-machine` | Medium-high: P3 asks for every state; the design-preview feature will show components in their states | One component in all its states behind a switcher, with seeded data | 3 files, 290 lines | **Vendor** under `options-prototype-cairn` as a reference for state pages. Cairn's `/design.html` and fixtures stay the place these states live |
| Jakub `variant` | Medium-high: variant pickers are what the design-preview feature is | Variants of a real component behind a picker, then promote the pick | 3 files, 322 lines | **Vendor** under `options-prototype-cairn`. The grayscale three-structure rule stays primary; `variant` is for within-structure variants |
| Jakub `break` | High: same need as `break-ui`, from a second author | Jakub's scenario list, which differs from Emil's catalog | 3 files, 159 lines | **Vendor** beside `break-ui` under `design-cairn` |
| Jakub `afk` | None as design guidance: an unattended-session workflow | Not design guidance | n/a | **Skip**: Cairn's lane dispatch, queue and promote already define unattended work, and `afk`'s own rules would compete with them |
| Jakub `upskill` | None as design guidance: it writes skills from session history | Not design guidance | n/a | **Skip**: `retro-cairn` and `writing-for-agents` own skill authoring here |
| Emil `emil-design-eng` | High: the broadest single source on interface craft | Tooltip delay skip after the first tooltip; `clip-path` reveals; `@starting-style`; toast principles; when not to animate, in Emil's words | 1 file, 684 lines | **Vendor** under `cairn-motion` as a reference. Length is no cost when it is only read on demand |
| Emil `animate` | High: building motion with recipes | `RECIPES.md`, with ready enter, exit, toast, popover and number recipes | 2 files, 533 lines | **Vendor** under `cairn-motion` |
| Emil `animation-vocabulary` | High: ian and agents need shared names for effects in briefs and side-by-sides | Glossary of entrances, sequencing, transforms, easing, springs, loops and polish terms | 1 file, 179 lines | **Vendor** under `cairn-motion` and name it in `design-cairn`'s brief template |
| Emil `apple-design` | High: Cairn is Mac first, and Apple's response, interruptibility, materials and depth are the native bar | Interruptibility; velocity hand-off; spatial consistency; materials and depth; reduced motion as an alternative, not removal; optical sizing | 1 file, 287 lines | **Vendor** under `cairn-motion` (motion parts), and `cairn-polish` routes to it for materials and depth |
| Emil `gestures` | Medium: panel resize, scrubbing, future drag-to-reorder (`@dnd-kit` is already declared), and remote web use on a phone | Track and release phases; interruptibility; linked values; the Vaul sheet curve without springs; asymmetric hold gestures | 1 file, 112 lines | **Vendor** under `cairn-motion` |
| Emil `mobile-native` | Medium: Cairn's web UI is used from a phone over the LAN or tailnet, and R1 requires every state to work at 390px | Symptom table: sticky hover after tap, tap flash, wrong `vh`, input zoom, notch insets, long-press selection | 1 file, 314 lines | **Vendor** under `cairn-polish` (390px route) |
| Emil `ask-sonner` | High: Sonner is Cairn's toast library, used in 12 files | Sonner API and its intended usage | 2 files, 152 lines | **Vendor** under `cairn-polish` (toasts) |
| Emil `pick-ui-library` | Medium: lanes sometimes reach for a new dependency | Curated list per need, plus the common mismatches | 1 file, 86 lines | **Vendor** under `design-cairn`, behind Cairn's rule that an established library is used before a hand-written one |
| Emil `prototype` | Medium-high: same purpose as `variant`, from a second author | Recon before directions; a picker harness; promote on selection | 2 files, 301 lines | **Vendor** under `options-prototype-cairn` beside `variant` |
| Emil `learn-taste` | Medium: ian's corrections on UI taste | How taste corrections become a stored, checkable rule | 1 file, 157 lines | **Vendor** under `retro-cairn` as the reference for design corrections; Cairn's ladder (codebase before rules) still decides where a safeguard lands |
| Emil `ask-emil` | Low: a router over Emil's 20 skills | Routing only | 1 file, 72 lines | **Skip**: it routes to skill names that are not discoverable here, and the Cairn wrappers do the routing |
| Emil `animate-expo` | None: React Native and Expo | n/a | n/a | **Skip**: no React Native code in Cairn |
| Emil `write-swift` | None for the shipped product: the Mac app is Electron; `apps/ios` is out of scope | n/a | n/a | **Skip**; revisit only if iOS work is asked for |
| Emil root `ui-cheatsheet.md` | High: one-page summary | Compact rules list | 16 lines | **Vendor** under `cairn-polish` |
| Emil root `performance-cheatsheet.md` | High | Compact rules list | 15 lines | **Vendor** under `cairn-motion` |

Totals: 21 more skills and both cheatsheets vendored; 5 skipped (`afk`, `upskill`, `ask-emil`, `animate-expo`, `write-swift`).

### 8.3 Wrapper layout after the change

| Wrapper | Discoverable? | New references |
|---|---|---|
| `cairn-motion` | yes | `emil-design-eng`, `animate`, `animation-vocabulary`, `apple-design`, `gestures`, `performance-cheatsheet.md` |
| `cairn-polish` | yes | `better-colors`, `better-layout`, `mobile-native`, `ask-sonner`, `ui-cheatsheet.md` |
| `cairn-type` | yes | none |
| `cairn-a11y` (new) | yes | `better-accessibility` |
| `cairn-copy` (new) | yes | `better-writing` |
| `cairn-design-review` (new) | user-invoked only | `better-interface`, `interface-review` |
| `design-cairn` | yes | `build-design`, `explain-interface`, `break`, `pick-ui-library` |
| `options-prototype-cairn` | yes | `state-machine`, `variant`, `prototype` |
| `retro-cairn` | yes | `learn-taste` |

Two new discoverable descriptions (`cairn-a11y`, `cairn-copy`) add about 600 characters to the skill listing. `cairn-design-review` is user-invoked, so it adds nothing to the listing (derived from the Claude Code skill docs cited in section 4).

### 8.4 Conflicts between the authors

With both authors vendored side by side, their values disagree in places: press 0.96 vs 0.97, bounce 0 vs 0.1-0.3, and two different ease-out curves. Each wrapper keeps one rule: its Cairn override table wins, and where the table is silent, the agent names both upstream values in its report and picks the one the table's nearest row implies. It never averages the two. The routing test is extended so that every new `references/` or `upstream/` tree has its pin, its LICENSE and no discoverable `SKILL.md`.

### 8.5 Order

1. The `cairn-polish` and `cairn-motion` additions (reference-only, no new wrapper).
2. `cairn-a11y` and `cairn-copy`, each with its own override table drawn from DESIGN.md (focus, hit areas, the `t()` copy rules).
3. `cairn-design-review`.
4. The `options-prototype-cairn` and `design-cairn` references. The prototype ones move to the design-preview wrapper when that feature is built.
