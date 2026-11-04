# 09 · Frontend Style Unification A6

> Overrides the A3 ruling "overlay-btn does not adopt the Button primitive" (docs/a3/diff-audit.md #1 + apps/web/src/detail/detail.css:1570 comment). A6 treatment path: expand the ghost border token to a single source + expand the Button size grade + fold in the 6 scattered buttons + tokenize the popover radius + doc sync.

> **Time-effectiveness note**: this document was written before the pixel-parity tool `parity/` was removed. The parity acceptance mentioned here (one of the four pinned surfaces, `pnpm parity 229/229`) was the verification means actually executed at the time, and all passed. `parity/` was removed wholesale the same day (#342); the current visual regression gate = the geometry assertions of the `apps/web` playwright e2e visual specs. The three implementation tickets merged as #337 (doc sync) / #339 (popover radius token) / #340 (button fold-in).

## Problem Statement

The living samples of frontend style "inconsistency" fall into four categories:

1. **Doc vs implementation discipline contradiction**: the `DESIGN.md:114` wording "existing pixel-level measured values converge to the ladder" contradicts the `tokens.css:207-209` comment "the replication surface stays put; batch value-equalization would break parity", leaving newly written code without clear guidance.
2. **Scattered popover radius**: 9 occurrences of `border-radius: 10px` across 5 domain css files (overlays/board-guide/secondary/mention-picker/resources/pages), forming a de facto dual track with the `DESIGN.md:126-127` overlay 12px-radius wording.
3. **overlay-btn family scattered × 5**: `detail/overlays.tsx` has 5 direct `<button>` elements using the custom `.overlay-btn[--primary]` class instead of the `ui/button` primitive. A3's then-ruling "keep the family class, do not adopt the Button primitive" rested on three grounds — ghost border token difference / no 30px-height grade / box-sizing — this ADR overrides that ruling and gives the treatment path.
4. **chief-gate-btn single scatter × 1**: `chief/chief-drawer.tsx:224` has a direct `<button>` using the custom `.chief-gate-btn` class instead of the `ui/button` primitive.

## Solution

The A6 ruling:

| ID | Decision | Landing shape |
|---|---|---|
| **P0** | DESIGN.md:114 defers to tokens.css | rewrite DESIGN.md line 114 + strengthen the tokens.css lines 207-209 comment cross-reference |
| **P1** | add `--radius-popover: 10px` | tokens.css :root adds `--radius-popover: 10px` (dark + light same value); the 9 `border-radius: 10px` → `var(--radius-popover)`; DESIGN.md Shapes section adds a new line |
| **P2** | overlay-btn × 5 folded into Button | expand the Button size with a new `overlay: 30px` grade; expand the ghost border token to a single source (`--card-ghost-border` uniformly points to `--card-border`); the 5 overlay-btn spots replaced with `<Button variant="ghost\|primary" size="overlay">` |
| **P3** | chief-gate-btn × 1 folded in | replaced with `<Button variant="primary" size="card" style={{ width: 50, fontSize: 12 }}>` |

## User Stories

1. As a developer, I see the full variant set of the `<Button>` primitive covering the overlay-btn/chief-gate-btn visual states, so that when writing a new overlay button I do not have to invent a new className and can just use `<Button variant="ghost" size="overlay">`.
2. As a reviewer, I see the popover radius referencing the same token `var(--radius-popover)` in all 9 spots, and DESIGN.md explicitly writes the "popover 10px" line, so that a future value change takes effect globally in one spot.
3. As a designer, I see `DESIGN.md:114` and `tokens.css:207` wording aligned (both explicit: "the replication surface stays put, new code goes through tokens"), so that new code has clear guidance instead of a dual track.
4. As a parity verification engineer, I see zero pixel change (zero visual delta) across all overlay-btn/chief-gate-btn/popover-radius spec rows after the A6 fold-in, with evidence entering review.
5. As a regression tester, I see all four pinned surfaces pass with zero regression after A6 — e2e specs + integration locators + parity matrix + visual-spec geometry assertions.

## Implementation Decisions

### Module change list

- `apps/web/src/styles/tokens.css`
  - :root + .light each add `--radius-popover: 10px` (theme-invariant value, explicitly mirrored same-value per the `--text-on-accent` convention)
  - rewrite the lines 207-209 spacing comment to strengthen the DESIGN.md cross-reference
- `apps/web/src/ui/button.tsx`
  - add the `'overlay'` value to `ButtonProps['size']`
  - update the comment to cover the A3 ruling
- `apps/web/src/ui/button.css`
  - add `.btn--overlay { height: 30px; padding: 0 12px; }` (same as compact padding but 30px tall)
  - unify the ghost border token: the `--card-ghost-border` alias points to `--card-border` (merge if the values differ)
- `apps/web/src/detail/overlays.tsx`
  - replace the 5 `<button className="overlay-btn ...">` with `<Button variant="ghost\|primary" size="overlay">`
  - remove the custom-style import dependency
- `apps/web/src/detail/detail.css`
  - delete the `.overlay-btn` / `.overlay-btn--primary` selectors (lines 1570-1590)
  - rewrite the comment: mark A6 as overriding A3
- `apps/web/src/chief/chief-drawer.tsx`
  - replace the 1 `<button className="chief-gate-btn">` with `<Button variant="primary" size="card" style={{ width: 50, fontSize: 12 }}>`
- `apps/web/src/chief/chief.css`
  - delete the `.chief-gate-btn` selector
- `apps/web/src/overlays/overlays.css`
  - the 9 `border-radius: 10px` at lines 405 / 446 / 564 / 499 etc. → `var(--radius-popover)`
  - the 4px at lines 290 / 323 stay untouched (kept)
- `apps/web/src/board/sidebar.css`, `apps/web/src/chief/chief.css`, `apps/web/src/resources/resources.css`, `apps/web/src/detail/overlays.css`, `apps/web/src/overlay/overlay.css`, `apps/web/src/pages/pages.css`, `apps/web/src/overlay/mention-picker.css`, `apps/web/src/secondary/secondary.css`
  - all 9 scattered 10px values converge to the single source `var(--radius-popover)`
- `apps/web/DESIGN.md`
  - rewrite line 114: "existing pixel-level measured values stay put — A3's ruling protects parity; new code always goes through tokens"
  - add a new line between Shapes section lines 126-127: "popover 10px (rounded-popover)"

### Interface decisions

- **No new ui/Toggle primitive** — the prj-tasks-view-btn toggle semantics are out of this ADR's scope
- **No new ui/MenuItem primitive** — plan-dropdown-row is a menu item, not a button; keep as is
- **The 6px domain-default radius stays put** — A3's ruling preserves it
- **Scattered spacing pixel values stay put** — parity protection
- **box-sizing handling**: modern CSS global `*, *::before, *::after { box-sizing: border-box }` is already the `apps/web/src/app.css` default; the overlay-btn 1px border no longer eats box height — verify zero pixel change at the 5 spots before deleting the custom `.overlay-btn` class

## Testing Decisions

### The four pinned surfaces (from wiki `DESIGN.md 驱动的 UI 原语收编`)

Every ticket must pass all four surfaces before reporting done:

1. **apps/web e2e specs** (playwright fixture) — the overlay/overlays/chief route-related specs all enumerated
2. **integration/ package locators** — m5-web-e2e etc.
3. **parity matrix** — 229-row pixel parity, green = zero change
4. **visual-spec computed-style geometry assertions** — the hard contract of radius/height/width/font-size

### The three verify commands (CLAUDE.md project-level hard rules)

- `pnpm lint && pnpm format && pnpm typecheck` — all three gates green
- `pnpm parity` — 229/229 green = zero pixel change evidence
- `apps/web e2e` — relevant specs all pass (during development only run the ticket's few; at PR wrap-up run the full set)

### Acceptance red lines

- P0 done: DESIGN.md line 114 wording is equivalent to the tokens.css:207 comment, both ends cross-reference each other
- P1 done: `grep border-radius: 10px` hits 0 spots under apps/web/src; `grep var(--radius-popover)` ≥ 9 spots; DESIGN.md Shapes section adds the popover 10px line
- P2 done: `grep <button className="overlay-btn"` hits 0; `grep <Button.*size=.overlay` ≥ 5; the `.overlay-btn` CSS selector deleted from detail.css
- P3 done: `grep <button className="chief-gate-btn"` hits 0; `grep <Button.*chief-gate` ≥ 1; the `.chief-gate-btn` CSS selector deleted from chief.css

## Out of Scope

- Normalizing the 6px domain-default radius
- Normalizing the scattered spacing pixel values (17/13/3 etc.)
- Adding a ui/Toggle primitive
- prj-tasks-view-btn / plan-dropdown-row / other pseudo-buttons (focusable elements)
- Normalizing the scattered 4px radius
- Stitch design-system sync (this round's B track needs none — DESIGN.md already has it)

## Further Notes

### Opposition archive (A3 historical ruling + A6 override rationale)

A3 explicitly opposed overlay-btn adopting the Button primitive in `docs/a3/diff-audit.md` ruling #1 and the `detail.css:1570` comment, on three grounds:

1. **ghost border token difference**: `--card-ghost-border #2e2e33` vs `--card-border #27272a` (A3's then-dark values)
   - **A6 override treatment**: expand the ghost token to a single source, making `--card-ghost-border` an alias pointing to `--card-border` (the two values already measured as near neighbors, no visual difference)
2. **no 30px-height primitive grade**
   - **A6 override treatment**: expand `Button size` with the `overlay: 30px` grade (no per-face geometry-stacking conflict)
3. **1px border participates in box arithmetic under content-box**
   - **A6 override treatment**: modern apps/web globally uses box-sizing: border-box, the 1px border no longer eats height — fold in after verifying zero pixel change at the 5 spots

### Premortem (3 causes of death + guardrails)

| Cause of death | Probability | Guardrail |
|---|---|---|
| ghost border color micro-drift after overlay-btn fold-in → parity red | high | enumerate the 5 spots' four pinned surfaces before folding in; `git diff` the pixels before the box-sizing change; the ghost token alias uses a pure alias without changing the value |
| chief-gate-btn differs from the original visual after per-face style stacking | medium | `parity run` + visual-spec comparison before/after; if divergent, switch size=card to a new `inline-card` variant |
| DESIGN.md and tokens.css wording diverge again after the rewrite | low | cross-reference both ends after rewriting (tokens.css comment "see DESIGN.md §Layout & Spacing", DESIGN.md comment "see tokens.css comment") |

### Related

- [docs/a3/diff-audit.md](../a3/diff-audit.md) — A3's then-ruling #1, overridden by this ADR
- [docs/a3/report-detail.md](../a3/report-detail.md) — the detail-domain fold-in report, continued by A6
- wiki `DESIGN.md 驱动的 UI 原语收编` — methodology source
- wiki `Taste Skill` — anti-slop design discipline

## Implementation Status

See the three tickets under `.scratch/a6-frontend-style-unify/issues/`:

- `01-doc-spacing-ladder.md` — P0
- `02-popover-radius-token.md` — P1
- `03-overlay-btn-and-chief-gate-btn-merge.md` — P2 + P3