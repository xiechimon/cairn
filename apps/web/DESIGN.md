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

Scope: `apps/web/`

Short, checkable rules for any change under `apps/web/`; name the ids you checked. Check: `M` an assertion or measurement, `G` an existing gate or test, `H` a human check against the reference shots. A rule enters through the A/B check in `docs/design/rule-ab.md` or by copying a measured value; one that stops changing output is deleted.

The rows below are the process rules; the rows for a surface live in the `## Rules` section of the surface file that owns them under `docs/design/surfaces/` (each section opens with the `Scope:` prefixes that load it), and `foundation.md` holds the shared visual, copy and accessibility rows. `node scripts/design-rules-for.mjs <paths>` prints only the rows the given files need — briefs paste that block instead of pointing at the whole table. No row appears twice; `apps/web/test/anti-slop-foundations.test.ts` pins the format, the per-row checks and the scope prefixes.

| Id | Rule | Check |
|---|---|---|
| P1 | Start from a reference: name the surface, open its shots in `docs/design/references/<surface>/` before code; the wrap-up shows a reference-versus-ours row per state. | H |
| P2 | A feature touching a main surface (first run, Coordinator chat, thread list and sidebar, thread and review, settings) needs a page draft before code; backend-only and single-setting changes exempt. | H |
| P3 | List component x state before coding: empty, loading, error, offline, slow network, rapid repeated input, long content, pending question, 390px, dark, transition; seed what the stack cannot produce. | H |
| P4 | Drafts and fixtures use real copy and real-looking data, never lorem ipsum or `Item 1`. | H |
| P5 | Fixture screenshots (`?scenario=`) are labelled as fixture evidence and never stand in for the live stack. | H |
| P6 | Before code, the brief answers the design-cairn craft questions: what grows, which states, which finishing rules, which spec measures each answer. | H |

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
