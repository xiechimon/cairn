---
colors:
  canvas: '#e7e6e1'; sheet: '#ecebe6'; card: '#e5e4df'; popover: '#f8f7f3'; hover: 'rgb(0 0 0 / 0.06)'; line: 'rgb(0 0 0 / 0.1)'; rule: 'rgb(0 0 0 / 0.1)'; divider: 'rgb(0 0 0 / 0.1)'
  ink: '#181818'; ink-2: '#545454'; ink-3: '#545454'; ink-4: '#545454'; icon: '#545454'; accent: '#9a6500'; primary: '#181818'; on-primary: '#ecebe6'
  on-accent: '#ffffff'; count-badge: '#376dd6'; count-badge-ink: '#ffffff'; accent-hover: '#f7ecd2'; menu-hover: 'rgb(0 0 0 / 0.05)'; backdrop: 'rgb(0 0 0 / 0.4)'
  running: '#5f8f4f'; running-text: '#3f6c35'; running-bar: '#55833f'; running-track: '#d9d9d4'; danger-line: '#d98c7d'; pebble-waiting: '#d49a1c'; pebble-review: '#5379a0'
  pebble-working: '#5f8f4f'; pebble-idle: '#545454'; pebble-resolved: '#b8b7b3'; tint-working: '#d2e4ff'; tint-working-soft: '#e6eefb'; tint-working-ink: '#2f55a8'
  tint-wait: '#f3e6c8'; tint-wait-soft: '#f8efdc'; tint-wait-ink: '#6e4900'; tint-quiet: '#dad9d5'; tint-quiet-soft: '#e0dfda'; tint-quiet-ink: '#545454'; tint-fail: '#f5ddd6'; tint-fail-soft: '#f9e8e3'; tint-fail-ink: '#9c3627'
colors-dark:
  canvas: '#1b1c1b'; sheet: '#151615'; card: '#1f201f'; popover: '#2c2d2c'; hover: 'rgb(255 255 255 / 0.075)'; line: 'rgb(255 255 255 / 0.1)'; rule: 'rgb(255 255 255 / 0.1)'; divider: 'rgb(255 255 255 / 0.1)'
  ink: '#ededed'; ink-2: '#b0b0b0'; ink-3: '#b0b0b0'; ink-4: '#b0b0b0'; icon: '#b0b0b0'; accent: '#ebb550'; primary: '#ededed'; on-primary: '#151615'
  on-accent: '#1a1404'; count-badge: '#376dd6'; count-badge-ink: '#ffffff'; accent-hover: '#33290f'; menu-hover: 'rgb(255 255 255 / 0.075)'; backdrop: 'rgb(0 0 0 / 0.5)'
  running: '#82b46f'; running-text: '#9cc78b'; running-bar: '#6fa35c'; running-track: '#262726'; danger-line: '#8c4a3e'; pebble-waiting: '#e0a838'; pebble-review: '#7fa3cc'
  pebble-working: '#82b46f'; pebble-idle: '#b0b0b0'; pebble-resolved: '#434443'; tint-working: '#223a5e'; tint-working-soft: '#1d2d49'; tint-working-ink: '#9cbcf2'
  tint-wait: '#3d3014'; tint-wait-soft: '#2e2510'; tint-wait-ink: '#f2cf86'; tint-quiet: '#2a2b2a'; tint-quiet-soft: '#222322'; tint-quiet-ink: '#b0b0b0'; tint-fail: '#4a2a24'; tint-fail-soft: '#3a2420'; tint-fail-ink: '#f09a88'
typography:
  greeting: { fontFamily: serif, fontSize: 32px, fontWeight: '360' }; page-title: { fontFamily: serif, fontSize: 18px, fontWeight: '600' }; brand: { fontFamily: serif, fontSize: 18px, fontWeight: '500' }; response: { fontFamily: serif, fontSize: 16px, fontWeight: '400', lineHeight: '22px' }; reply: { fontFamily: reply, fontSize: 16px, fontWeight: '400', lineHeight: '30px' }
  heading: { fontFamily: display, fontSize: 18px, fontWeight: '600' }; card-title: { fontFamily: sans, fontSize: 16px, fontWeight: '600', lineHeight: '22px' }; ui: { fontFamily: sans, fontSize: 14px, fontWeight: '400' }
  meta: { fontFamily: sans, fontSize: 14px, fontWeight: '400' }; caption: { fontFamily: sans, fontSize: 12px, fontWeight: '500' }; code: { fontFamily: mono, fontSize: 13px, fontWeight: '400' }
fonts:
  serif: var(--font-source-serif); display: var(--font-display); sans: var(--font-sans); mono: var(--font-mono); reply: var(--font-songti-serif)
rounded:
  field: 8px; control: 8px; menu-item: 8px; card: 12px; sheet: 12px; menu: 14px; bubble: 18px; composer: 14px; full: 9999px
spacing:
  grid: 4px; card-padding: 12px 14px; column-gap: 16px; board-padding: 18px 24px; header-height: 56px; sidebar-width: 220px; nav-row-height: 34px; menu-row-height: 32px; dialog-s: 400px; dialog-m: 480px; dialog-l: 640px
---

# Cairn web design

The single entry for UI work. `/design.html` (`pnpm --filter @cairn/web dev`) is the living style guide rendering this frontmatter on the real tokens (`src/styles/shadcn.css`); `scripts/ui-page-style-gate.mjs` rejects palette colours, arbitrary colour values and inline type outside design files, and `scripts/ui-debt-gate.mjs` only lets arbitrary sizes shrink. Run `node scripts/design-rules-for.mjs <paths>` to print all applicable rules (`DESIGN.md` + `foundation.md` + `motion.md` + the touched surface file). Procedures live in three skills: `.claude/skills/design-cairn/SKILL.md` (UI brief & build workflow), `.claude/skills/options-prototype-cairn/SKILL.md` (grayscale options for owner pick), and `.claude/skills/cairn-design-review/SKILL.md` (read-only surface, diff & motion review). The machine-checked primitive manifest lives at `src/components/ui/INVENTORY.md`.

## Surfaces

| Surface | Rules & spec | Reference shots | Owns |
|---|---|---|---|
| Foundation | `docs/design/surfaces/foundation.md` | — | direction, colors, type, spacing, icons, brand, copy, a11y, dark |
| Coordinator chat | `docs/design/surfaces/conversation.md` | `docs/design/references/coordinator-chat/` (Claude.ai, Claude Duet) | home shell, status mark, channels, bubbles, composer, trace, questions, approvals, narrow |
| Tasks & thread | `docs/design/surfaces/tasks.md` | `docs/design/references/thread-review/` (t3code, Amp) | Tasks panel, task thread panel, task detail, engine run |
| Sidebar & shell | `docs/design/surfaces/sidebar.md` | `docs/design/references/thread-list-sidebar/` (t3code, Amp) & `docs/design/references/archived-projects/` (Claude.ai, Linear) | sidebar tree, rows, menus, archived page, peek, shell |
| Settings & models | `docs/design/surfaces/settings.md` | `docs/design/references/settings/` (Amp, t3code) | settings list, forms, segmented controls, routing, pickers, diagnostics |
| Computers & tray | `docs/design/surfaces/computers.md` | `docs/design/references/settings/` | computers panel, fleet badge, `/tray` |
| First run | `docs/design/surfaces/first-run.md` | `docs/design/references/first-run/` (Amp) | two-step setup before first project (C9) |
| Chrome & menus | `docs/design/surfaces/chrome.md` | — | buttons, SidePanel, empty state, dialogs, menus, submenus, ⌘K, slash/@ |
| Motion & texture | `docs/design/surfaces/motion.md` | — | motion table, reduced motion, growth, texture |

## Rules

Scope: `apps/web/`

Short, checkable rules for any change under `apps/web/`; name the ids you checked. Check: `M` an assertion or measurement, `G` an existing gate or test, `H` a human check against reference shots. A rule enters from a real audit finding or measured value and stays only while it changes output. Process rows live below; surface and shared rows live in `## Rules` under `docs/design/surfaces/` and print via `node scripts/design-rules-for.mjs <paths>`.

| Id | Rule | Check |
|---|---|---|
| P1 | Start from a reference: name the surface, open its shots in `docs/design/references/<surface>/` before code; the wrap-up shows a reference-versus-ours row per state. | H |
| P2 | A feature touching a main surface (first run, Coordinator chat, thread list and sidebar, thread and review, settings) needs a page draft before code; backend-only and single-setting changes exempt. | H |
| P3 | List component x state before coding: empty, loading, error, offline, slow network, rapid repeated input, long content, pending question, 390px, dark, transition; seed what the stack cannot produce. | H |
| P4 | Drafts and fixtures use real copy and real-looking data, never lorem ipsum or `Item 1`. | H |
| P5 | Fixture screenshots (`?scenario=`) are labelled as fixture evidence and never stand in for the live stack. | H |
| P6 | Before code, the brief answers the design-cairn craft questions: what grows, which states, which finishing rules, which spec measures each answer. | H |
| P7 | Accept visual changes by real rendered pixels (before/after screenshots and `e2e/visual-baseline.spec.ts`), never by computed styles or source reading alone. | M `e2e/visual-baseline.spec.ts`; G `visual-baseline-gate`; H |

## Which component to use

| Surface to build | Use | Do not |
|---|---|---|
| Button / icon button | `components/ui/button.tsx` | Do not write a new `<button>` + homemade classes |
| Input (with button/icon: `components/ui/input-group.tsx`) / multi-line input | `components/ui/input.tsx` / `components/ui/textarea.tsx` | Do not place a bare `<input>` / `<textarea>` (except deliberate-native markings); do not stuff a bare `Input` into a homemade composition box |
| Task-status chip (five states) | `components/ui/status-chip.tsx` | Do not write a new `.chip--*` class family (pinned by ui-drift-gate G3) |
| Switch / tabs | `components/ui/switch.tsx` / `components/ui/tabs.tsx` | — |
| Count / label pill | `components/ui/badge.tsx` (the status color family) | The five task states go through `status-chip.tsx`; do not mix the two vehicles |
| Empty state | `components/ui/empty.tsx` | Do not hand-write an empty-state copy block per site |
| Confirm / regular dialog | `components/ui/alert-dialog-shell.tsx` / `components/ui/dialog-shell.tsx` | Do not hand-roll `OverlayMount` + `useEscClose` |
| Anchored floating surface (dropdown / menu / popover) | `dropdown-menu.tsx` (menu family) / `popover.tsx` (panel family, cross-component anchoring via the Content's `anchor`) / `dialog.tsx` (centered modal family) | Do not build a homemade positioning shell |
| Single-select dropdown (pick one value) | `components/ui/select.tsx` (registry compound family) | Do not use the native `<select>`, do not hand-write trigger-button + popup per surface |
| Checkbox | `components/ui/checkbox.tsx` | Do not place a bare `<input type="checkbox">` |
| Resting box (card / settings block) | `components/settings-list.tsx` (`SettingsCard` + `SettingsRow`; `CARD_RADIUS_CLS` for other card-like surfaces) | Do not start a new hand-written `.xxx-card` class — card skin is `bg-card` + `--radius-card` + `--e1` |
| Layout block (container wanting its own skin) | `components/ui/card.tsx` (layout shell; consumers override `ring-0` / `py-0` / radius) | Do not use it as a visual primitive; a real card is a per-face class family |
| Avatar | `components/ui/seeded-avatar.tsx` (picture, else tinted initial, else fallback; sizes via `className="size-N"`) | Do not use `avatar.tsx` directly |
| Form row composition | `components/ui/field.tsx` (`FieldGroup` + `Field` + `FieldLabel`) | Do not hand-arrange forms with `div` + `space-y-*` / `grid gap-*` |
| Hover info bubble / divider | `components/ui/tooltip.tsx` / `components/ui/separator.tsx` | Do not use `<hr>` / `border-t` divs for a divider |
| Shortcut hint chip | `tooltip.tsx` + `kbd.tsx` (`Kbd` inside `TooltipContent`) | Do not hand-write absolute positioning + show/hide; key caps in body text use `kbd.tsx` |
| Toast / lightweight failure feedback | `toast.*` (`components/ui/toaster.tsx` at App root) | Do not swallow mutation errors; surfaces with an in-surface error canon keep going in-surface and do not stack toast |

## Performance

Cairn adopts [Core Web Vitals](https://web.dev/articles/vitals) per surface on the fixture stack, with `CLS = 0` on transient status/hints/validation/loading (`C34`) and zero main-thread long tasks `> 50 ms` while typing (`C36`), plus supporting `FCP` and `TTFB` reporting:

| Metric | Cairn threshold | Spec |
|---|---|---|
| [LCP](https://web.dev/articles/lcp) | ≤ 2.5 s per surface & thread switch (`C37`) | `e2e/web-vitals-perf.spec.ts` |
| [INP](https://web.dev/articles/inp) | ≤ 200 ms p98; pending state paints ≤ 200 ms on 400 ms slow network (`C35`); 0 typing tasks > 50 ms (`C36`) | `e2e/web-vitals-perf.spec.ts` |
| [CLS](https://web.dev/articles/cls) | ≤ 0.1 per surface load (`C37`); `= 0` on transient hints/status (`C34`) | `e2e/web-vitals-perf.spec.ts`, `e2e/no-layout-shift.spec.ts` |

## Adopted standards

Audited in [ui-guidelines-adoption-2026-11-27.md](../../docs/research/ui-guidelines-adoption-2026-11-27.md), preferring newcomer calm on conflicts:

| Standard | Surface scope | Enforcement |
|---|---|---|
| Vercel Web Interface Guidelines & Rauno `interfaces.rauno.me` | `foundation.md` (`C38`–`C42`, `C44`, `A7`, `T6`, `V31`) | `test/ui-guidelines-static.test.ts`, `e2e/design-rules-measure.spec.ts` |
| W3C WCAG 2.2 AA (`target-size`, `focus`, dragging, `error`, `labels`) | `foundation.md` (`A3`, `A8`–`A10`), `settings.md` | `e2e/a11y-axe.spec.ts`, `e2e/providers-order.spec.ts`, `e2e/design-rules-guidelines.spec.ts` |
| Apple macOS HIG (window, menu, tray, notifications, offline) | `computers.md` (`V26`, `C45`) | `test/ui-guidelines-static.test.ts`, `apps/desktop/scripts/app-menu.test.mjs` |
| W3C `clreq` & Chinese Copywriting Guidelines (`T1`, `T7`) | `foundation.md`, `apps/web/src/i18n/en.ts` | `test/ui-guidelines-static.test.ts`, `test/unslop-signs.test.ts` |
| Emil Kowalski & Jakub Krehel craft skills | `motion.md` (`V24`), `apps/web/src/` | `e2e/design-rules-measure.spec.ts` |
