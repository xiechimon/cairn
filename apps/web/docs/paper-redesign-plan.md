# Paper redesign landing plan

The final direction lives in [`../DESIGN.md`](../DESIGN.md): Paper Dense board · Grouped sidebar · Hybrid type (serif headings + sans body). Reference mockup: [`board-paper-r5.html`](board-paper-r5.html) (open it in a browser and press `3`).

## Principles

- **One surface at a time, one PR each**. Every PR can be merged and rolled back independently, in the order below: tokens first, then the board, then the sidebar, and finally rolled out to the other pages.
- **Light mode first**. The dark theme keeps its current values; a separate mockup round comes last.
- **Intentionally changed visual pins get their pins changed**. The recent CDS series (#1355–#1366) pinned a batch of values (sidebar 288px, panel card 10px, `color-freeze` locked values, and the like). This plan deliberately overturns some of them; each PR updates the corresponding spec in the same diff and states in the PR body "which pin, old value → new value, why".
- **Acceptance for every PR** (repo rules): `pnpm lint` / `pnpm typecheck` / `pnpm spec:parse` / `pnpm exec vitest run --changed` / `pnpm --filter @cairn/web e2e:affected` (default 8398, run `lsof -iTCP:8398` first); screenshots = fixture in both states + real clicks on live, stored in `docs/verify/<ticket>/`, and referenced in the PR body with permanent raw links.

## PR 1 · Switch the light tokens to the Paper values

Change only tokens, not components. After the merge, the light theme's background, text, and accent colors all change at once.

- The `.light` block in `src/styles/shadcn.css`:
  - Audit first: which slot paints the "app background / main panel / task card" (currently the main panel goes through `bg-(--card)`; which slot the card uses must be verified in the PR), then map by role to `canvas #f3eee5` / `sheet #fbf9f5` / `card #fff`.
  - Text ladder: `--foreground` → `ink #2b2620`, `--text-secondary` → `ink-2 #5e564d`, `--text-tertiary` → `ink-3 #746a5f`, `--text-dim` only for decoration.
  - Accent: `--card-button` / `--focus-ring` are currently magenta `#97227e`; change to terracotta `#b4532a`; the derived `--spot-*` colors follow automatically.
  - New semantic tokens: `--running` / `--running-text` / `--running-bar` / `--running-track`, `--accent-hover`, `--project-tile-1..6`. At the same time, give `:root` (dark) values taken from the existing dark ladder.
- Spec to update: `e2e/color-freeze.spec.ts` (the locked values exist to intercept "unintentional" changes; this one is intentional).
- Risk: `--spot-*` has a wide consumer surface (the old-version "brand ink" G6 rule in DESIGN.md); run `node scripts/ui-drift-gate.mjs` first to confirm no new unregistered consumers.

## PR 2 · Font-size tokens + arbitrary-value ratchet

- Add the six font-size keys to the `@theme inline` block of `src/styles/app.css`: `text-page`(18) / `text-heading`(16) / `text-card-title`(14) / `text-ui`(13.5) / `text-meta`(12) / `text-caption`(11.5), multiplied by the existing `--rem-scale` (density switching keeps working); add `font-heading` = `var(--font-source-serif)`. The 14px tier is not called `text-card`: shadcn's `--color-card` already occupies that class name (Tailwind would emit a color).
- Add a third ledger to `scripts/ui-debt-gate.mjs`: occurrence counts of `text-[Npx]` and spacing-class `-[Npx]` arbitrary values (today about 179 font sizes + 273 spacings), frozen into `scripts/ui-debt-baseline.json`, only allowed to go down (reusing the existing D3 mechanism).
- No page changes; this just stops drift from growing. Each later PR converts the arbitrary values in its own area to tokens and re-freezes the baseline as it goes.

## PR 3 · Task cards and board columns

- `src/board/todo-card.tsx`: restructure per the DESIGN.md "Task card" section — title → single-line meta (icon + truncation priority: the tag truncates first, the project name keeps at least 5 characters) → a footer by status; remove the solid buttons from cards (`Button variant="default"`); the `待开始` "start" action becomes hover-floating and takes no height. Also delete the three duplicated badge classNames (around lines 195 / 218 / 227).
- `src/board/board.tsx` + `src/board/columns.ts`: column heading = status icon + serif column name + count, plus on hover (only in the `待开始` column: new tasks always land in this column, and the other columns' plus has no corresponding action).
- Tags: the card no longer renders the solid color block of `components/ui/tag-chip.tsx`; it becomes a tag icon + text, the icon colored by `tag.color` (decided question 2); `TagChip` itself stays for the filter popup. The `e2e/board-filter.spec.ts` card-face contract changes to "tag.color → tag icon color".
- Specs to update: `cds-board.spec.ts`, `card-press.spec.ts`, `board-filter.spec.ts`, `visual-polish.spec.ts`. Grep the class-name pins in `apps/web/e2e` and `integration/` before renaming classes.

## PR 4 · Board top bar

- `src/routes/board-page.tsx` (and wherever the top bar actually lives): 56px; serif "Workbench" + "⚠ N items need your attention" on the left; text buttons "filter" / "schedules" + an ink capsule "New task" on the right; all `nowrap`.

## PR 5 · Grouped sidebar

- `src/board/sidebar.tsx` (the main file, 695 lines) + `src/board/app-sidebar.tsx`: rearrange per the DESIGN.md "Sidebar" section into five segments — workspace row (two icon buttons: search, collapse) → new-task button → workbench / needs my attention / schedules → projects → footer "Resources" collapsible row + user row (machine status on the second line). "Needs my attention" = open the board showing only the `待处理` column (decided question 1); it does not create a new page.
- `src/styles/tokens.css`: `--sidebar-w` 288 → 248.
- `src/board/project-avatar.tsx`: the first-letter tiles take colors in order from `--project-tile-1..6`.
- The expanded state of the resources collapse is stored in `safe-storage` and survives refresh.
- Specs to update: `cds-sidebar.spec.ts` (the 288px pin), `sidebar-visual.spec.ts`, `sidebar-nav.spec.ts`, `sidebar-seam.spec.ts`, `sidebar-search-offboard.spec.ts`, `visual-polish.spec.ts` (collapsed state).

## PR 6 · Merging the three page shells into one

- `src/pages/shell.tsx` (PageShell), `src/resources/shell.tsx` (ResourceShell), and `src/secondary/shell.tsx` (SecondaryShell) each redraw the sidebar + top bar on their own; the title sizes (14 / 16 / 14), content widths (768 / 768 / 766), and background colors all differ. Merge them into one shell using the PR 4 top bar; destination pages in the sidebar lose their meaningless back arrows.
- This is a structural refactor, scheduled after the visual shape settles, to avoid changing structure and style at the same time.

## PR 7 onwards · Rolling out to the other pages

By usage frequency: task detail page → resource pages (machines / skills / MCP / keys / providers) → schedules → project page → dialogs. One PR per page: apply the token and font-size keys, clear that page's arbitrary values, and re-freeze the ratchet baseline.

The remaining pages (project settings / new project, resources and API keys and schedules, team and agent cards) first merge a shared-pieces PR: `--radius-card`, `EmptyState`, the settings list, and the form pieces — rules in the DESIGN.md "Page patterns" section; afterwards each page PR only composes these pieces and builds no cards, empty states, or forms of its own.

## Last · Dark

A separate mockup round (the same Paper structure in warm deep paper); after it is finalized, change the `:root` block and the `color-freeze` dark locked values.

## Decided questions

1. **What "needs my attention" opens**: the board filtered to the `待处理` column; no standalone inbox page. Lands in PR 5 (the sidebar nav item) + the board's status filter.
2. **Tag colors**: keep the user's custom tag colors, paint them on the card's tag icon, and use the body ink for the tag name; the card no longer shows a solid color block. `TagChip` stays for other surfaces like the filter popup. Landed in PR 3.
3. **Dark timing**: after the light PRs 1–5 merge, do a separate dark mockup round before changing it.
