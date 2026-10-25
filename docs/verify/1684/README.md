# #1684 verify evidence — narrow-screen (360/390px) walkthrough fix

The walkthrough and fixes were done on the fixture build (`vite build --mode fixture` +
`vite preview`). The "before" shots come from a separate build of HEAD source (port 8402);
the "after" shots come from the working-tree build (port 8401). The breakpoint is
uniformly ≤640px (the `NARROW_QUERY` in `app-sidebar.tsx` and the
`@media (max-width: 640px)` block in `styles/app.css`) — 767 was not chosen because
paper-topbar.spec pins the full top bar at 680px as narrow desktop width, and the first
full e2e run went red on that collision before the breakpoint was narrowed (same-round
ledger row in docs/lessons.md).

## Problem list (measured in the walkthrough, before-*.png)

- **P1 The sidebar eats most of the viewport**: at 390px the expanded sidebar is 248px;
  the board top-bar actions (filter / `定时` / new task, x=350~583) are entirely clipped
  out of the viewport by the sheet's overflow-hidden and cannot be reached. The paper
  pages share the disease (the account page content column is squeezed to x=894).
- **P2 The reading column is clipped**: PageShell's 768px reading column (`w-192`) has
  no narrow-screen clamp and is horizontally cut down to a fraction of the ~300px
  available width.
- **P3 The search panel leaves the screen on the left**: 520px fixed width + `-ml-65`
  centring puts it at x=-80 on a 360 viewport (before-search-360.png); the input is
  unreachable.
- **P4 Touch targets below 44px**: chief FAB 40px, detail header buttons 28px,
  composer tool/send 30/32px, sidebar rail rows 32px.
- **P5 Missing bottom safe area**: the `index.html` viewport meta lacks
  `viewport-fit=cover`, so the FAB/floating windows sit on the 8px bottom edge and
  `env(safe-area-inset-*)` is always 0.

Dialog surfaces (AI review dialog, merge dialog, new-task dialog, chief floating window)
were measured to already clamp with `max-w-[calc(100dvw-1rem)]` — closable at 360, no
overflow. The new spec's M6/M7 are regression pins.

## Fixes (after-*.png, light/dark × 360/390)

- Sidebar forces rail at ≤640px (`useSyncExternalStore` + matchMedia, no write-back to
  persisted state); rail track width 48px, rows 44px.
- Board top bar hides the workbench title and the `定时` entry on narrow screens (the
  rail already covers navigation); action buttons get min-height 44px.
- PageShell reading column gets `w-192 max-w-full`.
- Search panel: `-ml-65` replaced by `-translate-x-1/2` +
  `max-w-[calc(100vw-2rem)]` (geometry unchanged value-by-value at 1440).
- Detail header / paper top bar / composer tool·send·stop / thread copy button get
  ≥44px on narrow screens.
- FAB 44px; FAB and chief window right/bottom use
  `max(0.5rem, env(safe-area-inset-*))`.

## Recording (walkthrough-390.webm)

390px touch walkthrough: board column horizontal scroll → task detail (phase chip
dialog open/close) → merge dialog open/close → ⌘K search open/close → chief FAB
open/minimize → account page scroll.

## e2e

`apps/web/e2e/mobile-narrow.spec.ts`: M1 board rail + top-bar actions stay in the
viewport, M2 paper reading column is not clipped, M3 detail touch targets ≥44px,
M4 chief FAB/floating window, M5 search panel in the viewport and closable, M6 AI
review dialog, M7 merge dialog — parameterized at 360 and 390. Before the fix M1–M5
had 10 red cases; after the fix all 14 pass. Registered in the family table of
`scripts/e2e-affected.mjs` (six families: BOARD/SIDEBAR/DETAIL/CHIEF/OVERLAYS/PAGES).
