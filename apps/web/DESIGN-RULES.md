# Cairn UI rules for agents

Short, checkable rules for any change under `apps/web/src`. `DESIGN.md` is the full reference for tokens, components and motion; this file is what you read first and what a reviewer checks against. Decision: D120 (2026-11-06). Evidence behind it: `docs/research/ai-frontend-quality-2026-11-06.md` and `docs/research/ui-ux-audit-2026-11-06.md`.

Each rule has an id. Put the ids you checked in the PR (Proof, reference row). The Check column says how a violation is found:

- `M` a measurement an assertion can make (candidate for the look-and-feel job in section 5).
- `G` an existing gate or test, named.
- `H` a human or self-review against the reference screenshots; no assertion can decide it.

## 1. Process

| Id | Rule | Check |
|---|---|---|
| P1 | Start from a reference. Name the surface and open its shots in `docs/design/references/<surface>/` before writing code; the PR shows a reference-versus-ours row per state. | H |
| P2 | A new feature that touches one of the five main surfaces (first run, Coordinator chat, thread list and sidebar, thread and review, settings) needs a page draft (sketch or screenshot mock) before code. Backend-only and single-setting changes are exempt. | H |
| P3 | List component x state before coding: empty, loading, error, offline, long content, pending question, 390px, dark. A state the stack cannot produce is seeded; a state nobody has seen is not done. | H |
| P4 | Drafts and fixtures use real copy and real-looking data, never lorem ipsum or `Item 1`. | H |
| P5 | Fixture screenshots (`?scenario=`) are labelled as fixture evidence and never stand in for the live stack. | G `pr-evidence` |

## 2. Composition and state

| Id | Rule | Check |
|---|---|---|
| C1 | One fact, one wording. A status comes from one selector and is not restated differently elsewhere on the page. A finished thread does not say both "done" and "unverified". | M text of one entity is identical across header, list and footer |
| C2 | No capability, no placeholder. Do not render a block for a feature that is not available (grey 16:10 preview, `—·—·—`, "coming soon", "ships with X"). Show one line: what is off and the action to turn it on. | M no element text matching `^[\s—·-]+$`; no empty fixed-ratio block |
| C3 | Hidden means no space. An element shown on hover or focus takes no layout when hidden (absolute, negative margin, or not rendered). | M gap between consecutive short chat messages is 16 to 24px |
| C4 | Every icon-only control has a visible tooltip (about 300ms, the next one instant) and an accessible name. | M hover 600ms shows a tooltip; axe `button-name` |
| C5 | No raw error text reaches the user. Map it to a plain sentence that says what to do next; keep the raw text in a tooltip or the details. No `chief agent not bound (...)`, stack, status code or JSON. | M toast and banner text does not match `\(.*\)$`, `Error:`, `\b[45]\d\d\b` |
| C6 | Developer switches (feature flags, release buttons) never sit on a user page. They live behind the dev route or dev mode. | H |
| C7 | A disabled control says why next to it. No agent bound: the composer is disabled, and the reason with a link to settings sits above it. | M disabled composer has adjacent explanatory text |
| C8 | Show connection and agent state where the user acts, on the composer line (Amp: a `Connect a machine` chip with the command beside it), not only on a settings page. | H |
| C9 | First run is a checklist with live status per step (provider, machine, agent, first message), not a dead-end error. A step finished elsewhere ticks itself. | H |
| C10 | A row that stands for work shows its state and its age (glyph, title, reason, time), grouped by what needs the user, as in the references. In the sidebar the age follows L6. | H |
| C11 | After sending, the user's message and the start of the reply are in the viewport; when the user has scrolled away, a jump-to-latest control appears (Claude.ai). Message tools show on hover and on the latest message; on touch, on the latest only. | M latest reply top is inside the viewport after send |
| C12 | An empty state is one sentence and at most one primary action (`DESIGN.md`, Empty state). | G `ui-page-style-gate` |

## 3. Visual identity (what makes it Cairn, not generic)

| Id | Rule | Check |
|---|---|---|
| V1 | Colors, sizes, radii and shadows come from tokens. No hex, no arbitrary pixel values (`text-[13px]`, `ml-[10.5px]`). | G `ui-drift-gate`, `ui-debt-gate` |
| V2 | Fonts are Source Serif 4, Instrument Sans and JetBrains Mono only. No Inter, system-ui default, Space Grotesk or another font that models converge on. | M computed `font-family` of every text node is in the set (CJK fallbacks allowed) |
| V3 | No AI-default styling: no purple or blue-violet gradients, glow, gradient text, frosted blur panels, decorative blobs, emoji as icons or labels (a celebration emoji in a status line), or the same radius and shadow stamped on every block. Two exceptions copy a measured claude.ai surface: the user message bubble, `bubble-gradient` (owner decision 2026-11-07, `docs/design/claude-ai-spec.md`), and the text-selection Reply bar, black at 80% with an 8px backdrop blur, as measured on claude.ai 2026-11-08 (`docs/research/selection-reply-2026-11-08.md`). | M no `linear-gradient` in new CSS except `bubble-gradient`; G `test/anti-slop-foundations.test.ts`: `backdrop-blur` appears only in `chief/selection-reply.tsx`, as `backdrop-blur-sm` (8px), and in the pristine shadcn dialog overlays, which `app.css` sets to `backdrop-filter: none`; M `e2e/chief-selection-reply.spec.ts`: the bar is the only element with a computed `backdrop-filter`; no emoji in `t()` strings |
| V4 | Not everything is a card. A list is rows in one divided `ListCard`; no card inside a card; one card corner per page (`--radius-card`). | M nested `[data-slot=card]` count is 0 |
| V5 | Three roles carry colour. Ochre, the one accent, means waiting on you; it also takes the accent roles claude.ai gives its own accent: the keyboard focus ring, a switch that is on and the enabled send button (`docs/design/claude-ai-spec.md`, section 6). Green is a 6px dot for running or online and nothing else. Rust is failure and destructive actions only. Everything else is the ink ladder (slate and per-project hues are retired). Status is icon, color and text, never color alone. Lists and sidebar rows are the exception and follow L1 and L2: one accent only. | G `ui-drift-gate`, `test/anti-slop-foundations.test.ts`; H |
| V6 | One primary action per screen, and it is the `primary` Button. Card actions are text links. | H |
| V7 | Elevation is `--e1`, `--e2` or `--e3` only; no second ring and no raw `box-shadow`. | G `ui-drift-gate` |
| V8 | Spacing is on the 4px grid. | G `ui-debt-gate`; M computed margins and paddings are multiples of 4 |
| V9 | Icons are lucide from the project icon set; never invent an icon name, check that the import exists. Stroke and size are V14. | G `pnpm typecheck` |
| V21 | No hover shadows or elevation; a hover background covers the whole row, or a whole standalone control, never a band over part of a row or card. | G `ui-drift-gate` G8; M `e2e/paper-hover-bands.spec.ts` |
| V10 | Pages compose existing pieces (`EmptyState`, `SettingsHeader`, `SettingsCard`, `FormStack`, `DialogShell`, `SegmentedTabs`, `ThreadRow`, `SidePanel`) before building their own. | G `ui-page-style-gate`, `ui-drift-gate` |

Anti-slop rules (audit `docs/research/ui-ux-audit-2026-11-06.md`, section on AI slop; batch 1 landed the foundations). Baselines come from `apps/web/.audit-slop.mjs` on the seeded verify stack (2 projects; the 7-project stack adds 5 projects), measured at `5f672eab9` (before) and on this change (after). Where a rule is marked M and a `G` gate is named, the gate already fails; the other M rows await the CI look-and-feel job and run non-blocking first (section 5).

| Id | Rule | Check | Baseline: before, after (measured) |
|---|---|---|---|
| V11 | Identity carries no colour. No element is 1 to 2 characters, 14 to 44px square and tinted (a letter tile), and an avatar has no hue. A project shows its chosen icon or a neutral folder glyph. | M; G `test/anti-slop-foundations.test.ts` | letter tiles per screen 2 to 9 (home 7-project: 7), 16 of 27 screens; after: 0 |
| V12 | At most 2 non-neutral hue families per screen (avatar `<img>` decoded and counted; provider brand marks and user content excluded). | M | home 7-project 6, team page 7, project settings 6; after: home 2, project settings 3 (ochre, green and one rust text), team page not re-measured |
| V13 | Type budget. Font sizes come from the token steps, at most 6 per screen; at most 3 font weights per screen (ratchet first, then tighten); at most 9 size and weight pairs. | M | 4 weights on 19 of 27 screens, 16px on 1 screen, up to 11 pairs; after: unchanged, 4 weights is the open item |
| V14 | Icon uniformity. Every lucide svg computes `stroke-width` 1.75px (`svg.lucide` in `app.css` pins it, so a component default of 2 cannot leak) and a size of 14, 16 or 18px (empty-state art and brand marks excluded). | M; G `test/icon-stroke.test.ts` (source scan) | stroke off 1.75: 5 of 15 icons on home, 16 of 27 on the machines pane, 131 of 456 overall; after: 0 of 22 on home, 0 of 34 on the machines pane |
| V15 | Badge budget. At most 3 tinted short-text elements per screen (keycaps excluded); a tint is for "needs you" counts, and status is a dot plus text. | M | 3 to 12 per screen (home 7-project 8, activity 13, search 12); after: home 1, activity 1, search 5 including 4 keycaps (batch 2 owns the rest) |
| V16 | No texture or gradient on surfaces. An element wider than 24px has `background-image: none` (progress bars, shimmer text and the user bubble `bubble-gradient` excepted) and no `feTurbulence` data URI outside that bubble. | M; G `test/anti-slop-foundations.test.ts` | home 4, thread 4 to 7 gradient layers; after: 0 on every main screen |
| V17 | A speaker is not repeated. For consecutive messages from one speaker, avatar images number at most the speaker changes plus 1. | M | home 14 avatars for 1 speaker (owned by #3165) |
| V18 | Like rows fold. Three or more sibling rows with the same status text sit under one section heading. | M | team page `未设归属机` x6 (batch 2) |
| V19 | A placeholder is not content. No text node consists only of `—`, `·` or `-` (extends C2 to trailing `—` and `· —`). | M | activity 7, machine settings 3, thread 1 (batch 2) |
| T3 | No text node contains a backtick; code renders as `<code>`. | M | machine settings 1 (batch 2) |
| V20 | An object list is rows in one card, not a grid of identical cards; a card grid is for true parallel choices only. | H | team page against t3code providers (batch 2) |

## 3b. Lists and sidebars

Source: the owner's reference-versus-ours review of the sidebar (#3144, 2026-11-06) against Amp and t3code. A list is any group of three or more rows that stand for entities (threads, projects, tasks). Measure inside the list container (`aside`, `[data-testid=thread-groups]`, a `ListCard`).

| Id | Rule | Check |
|---|---|---|
| L1 | At most 2 distinct hues in a list, the accent included. Count the computed colors of glyphs, text, fills and borders whose HSL saturation is above 0.15 and lightness between 0.1 and 0.9, bucket them by 30 degrees of hue; neutrals and the ink ladder do not count. | M distinct chromatic hue buckets in the container is <= 2 |
| L2 | Status in a row is a monochrome glyph (ink ladder) or a muted text tag, never a multi-color icon. Only the one state that needs the user may take the accent (needs-you glyph and its count); failed is a text tag (`Failed`), not a red icon. | M every `[data-slot=sidebar-thread-row]` glyph color is neutral unless `data-state=needs-you`; failed rows contain a `sidebar-thread-tag` |
| L3 | No colored letter or tinted tile avatars in a list row. A row has no avatar or one neutral 16px type icon in `ink-3`. | M no row descendant has a chromatic background and a one-letter text; `.project-avatar` count is 0 |
| L4 | The title gets the row. The title box is at least 80% of the row width, or 55% when the row also carries a running elapsed time or a failed tag, at the 248px sidebar and the 288px phone drawer. Nothing else shares the line. | M `title.width / row.width` is >= 0.8 for every thread row, >= 0.55 for a row with a tag or elapsed time |
| L5 | Group by status with a count header, in this order: needs you, in progress, done (folded). Order comes from `threadStatus`; no thread becomes done by age. Archived threads show nowhere in the list. | G `test/sidebar-threads.test.ts`; M header order in the DOM |
| L6 | Time shows only on running rows (elapsed) or on hover. A resting non-running row holds no time text, and the hover time takes no layout. | M resting `[data-slot=sidebar-thread-meta]` exists only inside `data-state=running` |
| L7 | The running row and the open row carry one subtle emphasis step, a surface lift or the hover fill, never a color change or a border in a hue. | M computed background of the running or open row differs from a resting row; its border color is neutral |

## 4. Text, language, access

| Id | Rule | Check |
|---|---|---|
| T1 | One language per screen. UI strings go through `t()`; no English fragments inside Chinese labels (`查看 thread`). Use the glossary term for thread, task and agent. | M no Latin word of 4+ letters inside a CJK string unless it is a glossary term |
| T2 | Copy says what happened and what to do, in the user's words. Errors say how to fix, empty states say what is missing. | H |
| A1 | Click targets are at least 24px on desktop and 44px on touch. | M bounding boxes, also under `pointer: coarse` |
| A2 | Keyboard focus is visible (`--focus-ring`); `prefers-reduced-motion` is respected; animate only `opacity` and `transform`; the user's own actions are instant. | G `e2e/motion-quiet.spec.ts`; M |
| A3 | axe reports 0 violations at `wcag2a/aa/21aa/22aa` in light and dark. | M axe |
| A4 | Loading shows nothing for the first 150 to 300ms, then a skeleton in the final shape, so layout does not jump. | H |
| R1 | Every state in P3 is checked at 1440px and 390px, in light and dark; no horizontal scroll at 390. | M `scrollWidth <= innerWidth` |

## 5. Using the rules

- Briefs for UI work come from `.claude/skills/design-cairn/SKILL.md`; the brief lists the rule ids that apply and the reference shots.
- The look-and-feel assertions come from the `M` rows. They run next to axe in the CI screenshot job (D117, branch `ops/pr-evidence-standard`, PR #3134 and its follow-up). That job owns the Playwright code; this file only supplies the ids. An assertion message starts with the rule id (`C3: ...`) so a failure points here.
- Rollout (D120): the assertions run non-blocking for 2 weeks from the day the job first reports on `main`, then become blocking together with the axe condition. Record the start date in the plan decision table when the job lands.
- A rule enters this file after the A/B check in `docs/design/rule-ab.md`, or when it copies a measured value from `DESIGN.md` or an audit finding. A rule that stops changing output is deleted.
- A review finding that can be measured becomes an `M` rule with an assertion; one that is taste becomes an `H` rule with a reference shot. Fixing the one page is not enough.

## 6. Weekly owner review

Every Monday the owner reviews the pages that changed in the previous week's CI screenshots (the job's changed-page list, light and dark, 1440px and 390px) and marks problems with Scrawl. The agent on duty:

1. Builds the contact sheet: for each changed page, the reference shot next to the current screenshot (`docs/design/references/README.md` maps surface to shots).
2. Reads the Scrawl capture and sorts each mark: measurable becomes an `M` rule plus an assertion, taste becomes an `H` rule plus a reference shot, a plain defect becomes an issue.
3. Lands the rule changes in the next PR and says in chat what was added.

The review is a standing routine; no calendar entry is created for it.
