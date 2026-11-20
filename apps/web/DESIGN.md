---
colors:
  canvas: '#e7e6e1'; sheet: '#ecebe6'; card: '#e5e4df'; popover: '#f8f7f3'; hover: 'rgb(0 0 0 / 0.06)'; line: 'rgb(0 0 0 / 0.1)'; rule: 'rgb(0 0 0 / 0.1)'; divider: 'rgb(0 0 0 / 0.1)'
  ink: '#1c1d1b'; ink-2: '#343633'; ink-3: '#4b4d4a'; ink-4: '#5d5f5c'; icon: '#343633'; accent: '#9a6500'; primary: '#1c1d1b'; on-primary: '#ecebe6'
  on-accent: '#ffffff'; count-badge: '#376dd6'; count-badge-ink: '#ffffff'; accent-hover: '#f7ecd2'; menu-hover: 'rgb(0 0 0 / 0.05)'; backdrop: 'rgb(0 0 0 / 0.4)'
  running: '#5f8f4f'; running-text: '#3f6c35'; running-bar: '#55833f'; running-track: '#d9d9d4'; danger-line: '#d98c7d'; pebble-waiting: '#d49a1c'; pebble-review: '#5379a0'
  pebble-working: '#5f8f4f'; pebble-idle: '#5d5f5c'; pebble-resolved: '#b8b7b3'; tint-working: '#d2e4ff'; tint-working-soft: '#e6eefb'; tint-working-ink: '#2f55a8'
  tint-wait: '#f3e6c8'; tint-wait-soft: '#f8efdc'; tint-wait-ink: '#6e4900'; tint-quiet: '#dad9d5'; tint-quiet-soft: '#e0dfda'; tint-quiet-ink: '#343633'; tint-fail: '#f5ddd6'; tint-fail-soft: '#f9e8e3'; tint-fail-ink: '#9c3627'
colors-dark:
  canvas: '#1b1c1b'; sheet: '#151615'; card: '#1f201f'; popover: '#2c2d2c'; hover: 'rgb(255 255 255 / 0.075)'; line: 'rgb(255 255 255 / 0.1)'; rule: 'rgb(255 255 255 / 0.1)'; divider: 'rgb(255 255 255 / 0.1)'
  ink: '#ecebe6'; ink-2: '#bbbab7'; ink-3: '#9c9b98'; ink-4: '#8c8b88'; icon: '#bbbab7'; accent: '#ebb550'; primary: '#ecebe6'; on-primary: '#151615'
  on-accent: '#1a1404'; count-badge: '#376dd6'; count-badge-ink: '#ffffff'; accent-hover: '#33290f'; menu-hover: 'rgb(255 255 255 / 0.075)'; backdrop: 'rgb(0 0 0 / 0.5)'
  running: '#82b46f'; running-text: '#9cc78b'; running-bar: '#6fa35c'; running-track: '#262726'; danger-line: '#8c4a3e'; pebble-waiting: '#e0a838'; pebble-review: '#7fa3cc'
  pebble-working: '#82b46f'; pebble-idle: '#8c8b88'; pebble-resolved: '#434443'; tint-working: '#223a5e'; tint-working-soft: '#1d2d49'; tint-working-ink: '#9cbcf2'
  tint-wait: '#3d3014'; tint-wait-soft: '#2e2510'; tint-wait-ink: '#f2cf86'; tint-quiet: '#2a2b2a'; tint-quiet-soft: '#222322'; tint-quiet-ink: '#bbbab7'; tint-fail: '#4a2a24'; tint-fail-soft: '#3a2420'; tint-fail-ink: '#f09a88'
typography:
  greeting: { fontFamily: serif, fontSize: 32px, fontWeight: '360' }; page-title: { fontFamily: serif, fontSize: 24px, fontWeight: '500' }; brand: { fontFamily: serif, fontSize: 18px, fontWeight: '500' }; response: { fontFamily: serif, fontSize: 15px, fontWeight: '400', lineHeight: '21px' }
  heading: { fontFamily: display, fontSize: 15px, fontWeight: '500' }; card-title: { fontFamily: sans, fontSize: 15px, fontWeight: '600', lineHeight: '21px' }; ui: { fontFamily: sans, fontSize: 14px, fontWeight: '400' }
  meta: { fontFamily: sans, fontSize: 13px, fontWeight: '400' }; caption: { fontFamily: sans, fontSize: 12px, fontWeight: '500' }; code: { fontFamily: mono, fontSize: 13px, fontWeight: '400' }
fonts:
  serif: var(--font-source-serif); display: var(--font-display); sans: var(--font-sans); mono: var(--font-mono)
rounded:
  field: 8px; control: 8px; menu-item: 8px; card: 12px; sheet: 12px; menu: 14px; bubble: 18px; composer: 14px; full: 9999px
spacing:
  grid: 4px; card-padding: 12px 14px; column-gap: 16px; board-padding: 18px 24px; header-height: 56px; sidebar-width: 220px; nav-row-height: 34px; menu-row-height: 32px; dialog-s: 400px; dialog-m: 480px; dialog-l: 640px
---

# Cairn web design

The single entry for UI work. The gallery (`pnpm --filter @cairn/web dev`, `/design.html`) renders this frontmatter on the real tokens and its Doc check compares it with `src/styles/shadcn.css` in both themes; `scripts/ui-page-style-gate.mjs` (prepush) rejects palette colours, arbitrary colour values and inline type outside the design files, and `scripts/ui-debt-gate.mjs` only lets arbitrary sizes shrink. The design direction lives in `docs/design/surfaces/foundation.md`; the reusable-component inventory lives next to the code at `src/components/ui/INVENTORY.md`.

## Surfaces

- `docs/design/surfaces/foundation.md` — direction, colors, typography, layout, icons, brand mark, card radius, dark.
- `docs/design/surfaces/conversation.md` — the Coordinator home: shell and status mark, channels, bubbles, composer, trace, questions, approvals, narrow layout.
- `docs/design/surfaces/tasks.md` — the Tasks panel, task thread panel, task detail page, engine run.
- `docs/design/surfaces/sidebar.md` — the sidebar tree, rows, menus, archived page, collapsed and peek, the shell.
- `docs/design/surfaces/settings.md` — the settings list, forms, segmented controls, model routing, pickers, diagnostics.
- `docs/design/surfaces/computers.md` — the computers panel, fleet badge, tray page.
- `docs/design/surfaces/first-run.md` — the first-run setup page (C9).
- `docs/design/surfaces/chrome.md` — buttons, SidePanel, empty state, dialogs, menus, ⌘K, slash and @ lists.
- `docs/design/surfaces/motion.md` — the motion table, reduced motion, texture.

## Rules

Short, checkable rules for any change under `apps/web/src`; name the ids you checked. Check: `M` an assertion or measurement, `G` an existing gate or test, `H` a human check against the reference shots. The long tail of a rule lives in the surface file that owns it. A rule enters through the A/B check in `docs/design/rule-ab.md` or by copying a measured value; one that stops changing output is deleted.

| Id | Rule | Check |
|---|---|---|
| P1 | Start from a reference: name the surface, open its shots in `docs/design/references/<surface>/` before code; the wrap-up shows a reference-versus-ours row per state. | H |
| P2 | A feature touching a main surface (first run, Coordinator chat, thread list and sidebar, thread and review, settings) needs a page draft before code; backend-only and single-setting changes exempt. | H |
| P3 | List component x state before coding: empty, loading, error, offline, long content, pending question, 390px, dark, transition; seed what the stack cannot produce. | H |
| P4 | Drafts and fixtures use real copy and real-looking data, never lorem ipsum or `Item 1`. | H |
| P5 | Fixture screenshots (`?scenario=`) are labelled as fixture evidence and never stand in for the live stack. | H |
| P6 | Before code, the brief answers the design-cairn craft questions: what grows, which states, which finishing rules, which spec measures each answer. | H |
| C1 | One fact, one wording: a status comes from one selector and is not restated differently elsewhere on the page. | M text of one entity is identical across header, list and footer |
| C2 | No capability, no placeholder: never render a block for a feature that is not available; one line says what is off and the action to enable it. | M no element text matching `^[\s—·-]+$`; no empty fixed-ratio block |
| C3 | Hidden means no space: an element shown on hover or focus takes no layout when hidden. | M gap between consecutive short chat messages is 16 to 24px |
| C4 | Every icon-only control has a visible tooltip and an accessible name. | M hover 600ms shows a tooltip; axe `button-name` |
| C5 | No raw error text reaches the user: map it to a plain sentence saying what to do next; raw text lives in a tooltip or details. | M toast and banner text does not match `\(.*\)$`, `Error:`, `\b[45]\d\d\b` |
| C6 | Developer switches (feature flags, release buttons) never sit on a user page; they live behind the dev route or dev mode. | H |
| C7 | A disabled control says why next to it. | M disabled composer has adjacent explanatory text |
| C8 | Show connection and agent state where the user acts, on the composer line, not only on a settings page. | H |
| C9 | First run is a setup page before the first project: two live-status steps (models, confirm settings), unskippable, closing into the conversation. | G `e2e/first-run-setup.spec.ts`, `e2e/first-run-checklist.spec.ts` |
| C10 | A row that stands for work shows state and age, grouped by what needs the user; per-surface details live in the surface files. | H |
| C11 | Question chips show only option labels; `推荐` and the description live in the tooltip and accessible description; digits pick nothing. | G `e2e/chief-home-questions.spec.ts`, `e2e/chief-home-tray.spec.ts`, `e2e/chief-thread-report.spec.ts`, `e2e/info-card-report.spec.ts` |
| C12 | An empty state is one sentence and at most one primary action. | G `ui-page-style-gate` |
| C13 | Below 640px the Coordinator home floats three controls at the top: menu, the status mark, and the `任务` button with its count badge. | G `e2e/chief-home-narrow-shell.spec.ts` |
| C14 | The task thread panel is the conversation, not a dashboard: head, transcript, composer; no stepper, dashboard card or extra footer between them. | G `e2e/chief-home-thread-panel.spec.ts`, `e2e/chief-home-side-chat.spec.ts`, `e2e/chief-home-thread-usage.spec.ts`, `e2e/info-card-report.spec.ts` |
| C15 | A task is named by its title wherever a person reads it; the sequence number shows only in the `#` picker and the `#n` it inserts. | G `e2e/chief-thread-report.spec.ts`, `e2e/chief-stream-markdown.spec.ts`, `test/segments-mention-nav.test.ts` |
| C16 | A message carries no agent label; an agent mention in an old message is its name in plain text. | G `e2e/agent-identity-chip.spec.ts`, `test/segments-mention-nav.test.ts` |
| C17 | Historical daily reports render read-only; no buttons and no new reports are generated. | G `e2e/chief-daily-report.spec.ts` |
| C18 | After sending, the user's message and the reply's start are in the viewport; a jump-to-latest control appears after scrolling away. | M latest reply top is inside the viewport after send |
| C19 | A user-data picker with more than 10 options filters as you type; build it from `components/filter-picker.tsx`. | G `e2e/picker-filter.spec.ts` |
| C20 | A model is named with its provider wherever it is picked or shown as the pick. | G `e2e/picker-filter.spec.ts` |
| C21 | A picker of something invisible (sound, haptics, timing) lets the user experience the real artifact in place, never a description alone. | H |
| C22 | A diagnostic action opens a small popover on click (spinner, what is checked) that switches in place to the result; no persistent check status, no reflow, no toast. | G `e2e/providers-subscription-verification.spec.ts`, `e2e/provider-test-connection.spec.ts` |
| C23 | What the user already sees stays put while a live surface updates: no remount and no offset change until it settles. | G `e2e/chief-live-stability.spec.ts` |
| C24 | A change the user makes shows in the same frame; a failure puts the row back and says so. | M `e2e/chief-home-tasks-panel.spec.ts` (Mark done lands / fails) |
| C25 | No inert UI: a control offering fewer than two real choices, or a label that only says something cannot be done, is not rendered. | M `e2e/settings-routing.spec.ts` (C25 test) |
| V1 | Colors, sizes, radii and shadows come from tokens; no hex, no arbitrary pixel values. | G `ui-drift-gate`, `ui-debt-gate` |
| V2 | Fonts are Source Serif 4, Instrument Sans and JetBrains Mono only. | M `e2e/design-rules-measure.spec.ts`: computed `font-family` of every text node is in the set (CJK fallbacks allowed) |
| V3 | No AI-default styling: no gradients, glow, gradient text, frosted blur panels, decorative blobs, emoji as icons or labels, or one radius and shadow stamped on every block. | M no `linear-gradient`, `radial-gradient` or `conic-gradient` in new CSS; G `test/anti-slop-foundations.test.ts`, `test/unslop-signs.test.ts` |
| V4 | Not everything is a card: a list is rows in one divided `ListCard`; no card inside a card; one card corner per page. | M `e2e/design-rules-measure.spec.ts`: nested `[data-slot=card]` count is 0 |
| V5 | Three roles carry colour: ochre = waiting on you (focus ring, switch on), green = running dot, rust = failure; all else ink; exceptions: task tint, count badge, PR state. | G `ui-drift-gate`, `test/anti-slop-foundations.test.ts`; H |
| V6 | One primary action per screen, the `primary` Button; card actions are text links; sibling settings actions share `outline`. | M `e2e/design-rules-measure.spec.ts`: at most one filled `primary` outside dialog footers on each main surface; `e2e/settings-routing.spec.ts` |
| V7 | Elevation is `--e1`, `--e1-lift`, `--e2` or `--e3` only; no second ring, no raw `box-shadow`. | G `ui-drift-gate` |
| V8 | Spacing is on the 4px grid. | G `ui-debt-gate`; M computed margins and paddings are multiples of 4 |
| V9 | Icons are lucide from the project icon set; never invent an icon name. | G `pnpm typecheck` |
| V10 | Pages compose existing pieces before building their own. | G `ui-page-style-gate`, `ui-drift-gate` |
| V11 | A project carries no colour: its chosen icon or a name-derived neutral glyph; only a person's `SeededAvatar` may be a tinted letter. | M; G `test/anti-slop-foundations.test.ts`, `test/avatar-tint.test.ts`, `e2e/avatar-initial.spec.ts` |
| V12 | At most 2 non-neutral hue families per screen beyond the V5 roles (decoded avatars, provider marks, user content and the V11 tint excluded). | M |
| V13 | Type budget: sizes from the token steps, at most 6 per screen; at most 3 font weights; at most 9 size and weight pairs. | M |
| V14 | Icon uniformity: lucide stroke 1.75, sizes 16, 20 or 22px by role. | M; G `test/icon-stroke.test.ts` |
| V15 | Badge budget: at most 3 tinted short-text elements per screen (keycaps excluded); the task glyph tile and chip are not counted. | M |
| V16 | No texture or gradient on surfaces; ink grain only on the brand spiral and the filled-button specks. | M; G `test/anti-slop-foundations.test.ts` |
| V17 | A speaker is not repeated: consecutive messages from one speaker show at most one avatar per speaker change. | M |
| V18 | Like rows fold: three or more sibling rows with the same status sit under one section heading. | M |
| V19 | A placeholder is not content: no text node consists only of `—`, `·` or `-`. | M; G `e2e/design-rules-measure.spec.ts` |
| V20 | An object list is rows in one card, not a grid of identical cards; the results panel's preview row and the Apps and IM connector grids are the exceptions. | M; G `e2e/design-rules-measure.spec.ts`: no grid or stack of three or more outlined 12px-corner cards outside the results panel |
| V21 | No hover shadows or elevation; a hover background covers the whole row or control. | G `ui-drift-gate` G8 |
| V22 | Sentence case and normal tracking: no uppercase labels; `letter-spacing` normal on every text node. | M; G `test/unslop-signs.test.ts` |
| V23 | No weight of 800 or more and no italic in chrome; emphasis is weight or ink step. | M; G `test/unslop-signs.test.ts` |
| V24 | Motion names its properties: no `transition-all`, no hover transform, no transitions on layout properties; reduced motion honoured. | M; G `test/unslop-signs.test.ts` |
| V25 | Text keeps the platform's default font smoothing: no `-webkit-font-smoothing` or `antialiased` utilities. | G `test/font-smoothing.test.ts` |
| V26 | The `/tray` popover is operating system chrome: system font, system accent, OS light and dark — the one exception to V2, V3 and V5. | H real Mac capture in the `desktop-mac` run |
| V27 | Every count, time and figure renders in tabular figures. | M `e2e/texture-tabular-figures.spec.ts` |
| V28 | Dark layers separate by surface lightness, not stroke; an outlined group fills with `card` in dark. | M `test/dark-text-tertiary-contrast.test.ts` |
| V29 | A status glyph sits on the optical centre of its box. | M `e2e/texture-glyph-alignment.spec.ts` |
| V30 | A row of controls or fields fills its card: no blank region of 40% of a row's width at one side while a sibling spans full width; one-line sentences exempt. | M `e2e/design-rules-measure.spec.ts`: blank region beside content |
| L1 | At most 2 distinct hues in a list, the accent included, except the Tasks panel's PR line. | M distinct chromatic hue buckets in the container is <= 2 |
| L2 | Status in a row is a monochrome glyph or a muted text tag; only the state that needs the user may take the accent: a 6px dot, no number. | M `e2e/sidebar-visual.spec.ts`: every project-row glyph color is neutral, the only chromatic mark is the needs-you dot, a status row has `aria-description` |
| L3 | No colored letter or tinted tile for a project or type in a list row; a person or agent may carry its `SeededAvatar`. | M no row descendant outside `[data-slot="avatar"]` has a chromatic background and a one-letter text; `.project-avatar` count is 0 |
| L4 | The title gets the row: at least 80% of a task row's width, or 55% when the row carries meta or menu. | M `title.width / row.width` is >= 0.55 for every sidebar project row |
| L5 | The sidebar is a tree under the Coordinator row: ungrouped projects, group folders, `新建项目`; pinned rows above the footer; archived projects on the flat page. | G `test/sidebar-projects.test.ts`, `test/tasks-sections.test.ts`, `e2e/sidebar-archived.spec.ts`; M header order in the DOM |
| L6 | A sidebar row holds no time text; a task's age shows in the Tasks panel. | M no `aside` row text matches a duration |
| L7 | The open row carries one subtle emphasis step, never a color change or a hue border. | M every row's border color is neutral |
| L8 | A child row carries a tree guide under the parent icon's centre; siblings share one trunk, the last child ends in the elbow. | M `e2e/sidebar-visual.spec.ts`: guide x 22, elbow at the icon centre, continuous trunk, none below the last child |
| L9 | Row geometry copies the measured reference: 34px rows on a 36px pitch, 14px labels, 22px hover actions, no collapsed rail, a 56px footer. | M `e2e/sidebar-visual.spec.ts`, `e2e/paper-sidebar.spec.ts` |
| T1 | One language per screen: UI strings go through `t()`, no English inside Chinese labels; use the `CONTEXT.md` glossary term for thread, task and agent. | M no Latin word of 4+ letters inside a CJK string unless it is a glossary term |
| T2 | Copy says what happened and what to do, in the user's words; errors say how to fix, empty states what is missing. | H |
| T3 | No text node contains a backtick; code renders as `<code>`. | M; G `e2e/design-rules-measure.spec.ts` |
| T4 | Copy is plain: no exclamation mark, emoji or hype word in UI strings; a one-sentence title ends without a period. | M; G `test/unslop-signs.test.ts` |
| A1 | Click targets are at least 24px on desktop and 44px on touch. | M hit area, also under `pointer: coarse`; `e2e/design-rules-measure.spec.ts` measures the Tasks panel checkbox |
| A2 | Keyboard focus is visible (`--focus-ring`); `prefers-reduced-motion` respected; animate only `opacity` and `transform` except the named Growth utilities. | M |
| A3 | axe reports 0 violations at `wcag2a/aa/21aa/22aa` in light and dark. | M `e2e/a11y-axe.spec.ts` |
| A4 | Loading shows nothing for 150 to 300ms, then a skeleton in the final shape whose rows sit at the loaded tops. | M Tasks and Made: `tops()` of the skeleton rows equal the loaded rows' in `e2e/chief-home-tasks-panel.spec.ts`; other panels H |
| R1 | Every state in P3 is checked at 1440px and 390px, light and dark; no horizontal scroll at 390. | M `e2e/design-rules-measure.spec.ts`: `scrollWidth <= innerWidth` at 390px |

## Which component to use

| Surface to build | Use | Do not |
|---|---|---|
| Button / icon button | `components/ui/button.tsx` | Do not write a new `<button>` + homemade classes |
| Input (with button/icon: `components/ui/input-group.tsx`) / multi-line input | `components/ui/input.tsx` / `components/ui/textarea.tsx` | Do not place a bare `<input>` / `<textarea>` (except deliberate-native markings); do not stuff a bare `Input` into a homemade composition box |
| Task-status chip (five states) | `components/ui/status-chip.tsx` (retirement canonical table = spec/22 §5, #942) | Do not write a new `.chip--*` class family (pinned by ui-drift-gate G3) |
| Switch / tabs | `components/ui/switch.tsx` / `components/ui/tabs.tsx` | — |
| Count / label pill | `components/ui/badge.tsx` (the status color family) | The five task states go through `status-chip.tsx`; do not mix the two vehicles |
| Empty state | `components/ui/empty.tsx` | Do not hand-write an empty-state copy block per site |
| Confirm / regular dialog | `components/ui/alert-dialog-shell.tsx` / `components/ui/dialog-shell.tsx` | Do not hand-roll `OverlayMount` + `useEscClose` |
| Anchored floating surface (dropdown / menu / popover) | `dropdown-menu.tsx` (menu family) / `popover.tsx` (panel family, cross-component anchoring via the Content's `anchor`) / `dialog.tsx` (centered modal family) | Do not build a homemade positioning shell (floating-shell.tsx was deleted with #1010) |
| Single-select dropdown (pick one value) | `components/ui/select.tsx` (registry compound family, #1010) | Do not use the native `<select>` (pops the system menu), do not hand-write trigger-button + popup per surface |
| Checkbox | `components/ui/checkbox.tsx` | Do not place a bare `<input type="checkbox">` — the browser's built-in box is a different family from the in-repo checkbox row |
| Resting box (a card / settings block sitting still on a page) | `components/settings-list.tsx` (`SettingsCard` + `SettingsRow`; `CARD_RADIUS_CLS` for other card-like surfaces) | Do not start a new hand-written `.xxx-card` class — card skin is `bg-card` + `--radius-card` + `--e1` |
| Layout block (a container that wants its own skin) | `components/ui/card.tsx` (the shadcn layout shell; consumers self-override `ring-0` / `py-0` / radius) | Do not use it as a visual primitive — its `ring-1` + `rounded-xl` + `bg-card` mismatches in-repo needs; a real card is a per-face class family |
| Avatar | `components/ui/seeded-avatar.tsx` (picture, else the name's tinted initial, else the fallback image; sizes via SeededAvatar's `className="size-N"`) | Do not use the `avatar.tsx` trio directly — the seed/fallback semantics would be copied apart |
| Form row composition | `components/ui/field.tsx` (FieldGroup + Field + FieldLabel) | Do not hand-arrange forms with `div` + `space-y-*` / `grid gap-*` |
| Hover info bubble / divider | `components/ui/tooltip.tsx` / `components/ui/separator.tsx` | Do not use `<hr>` / `border-t` divs for a divider |
| Shortcut hint chip | the `tooltip.tsx` + `kbd.tsx` composition assembled at the consumer (Kbd inside TooltipContent, the #1008/#983 ruling) | Do not hand-write absolute positioning + show/hide; the key caps in doc body text use `kbd.tsx` directly |
| Toast / lightweight failure feedback | `toast.*` (imperative; `components/ui/toaster.tsx` is already mounted at the App root) | Do not silently swallow mutation errors; surfaces with an in-surface scoped red-line canon (XMON-80/P2) keep going in-surface and do not stack toast on top |
