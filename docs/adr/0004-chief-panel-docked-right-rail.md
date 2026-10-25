# ADR 0004 · Chief panel form = docked right rail (3rd deliberate divergence from the original site)

> Status: **superseded by ADR 0013** (2026-10-08, the chief panel form reversed to a floating window; original decision 2026-09-30). This file is kept as the archaeological record: the first reopen trigger "persist open state" was hit, and the #447 motivation was reversed by the same user.
> Source: #447 (triage 2026-09-29 user feedback: the panel should not float, it should dock inline).
> This is the **third deliberate divergence from the todos.dev original site** UI — the original site's panel is a 418px inset floating card (measured from r5 screenshots). The first divergence is ADR 0002, the second ADR 0003.

## Problem Statement

The chief panel is an inset floating card (`position:absolute`, top 42 / right 17 / bottom 16, width 418, radius 12, with shadow), floating above the content. The demand: the panel should not float, it should dock inline — becoming a column of the layout, not an overlay.

Since this geometry is a measured value replicated 1:1 (F1/F2), this change is a deliberate divergence.

## Recon facts (measured 2026-09-30, with sources for each)

| # | Fact | Source |
|---|---|---|
| F1 | Drawer geometry: `position:absolute; top:42px right:17px bottom:16px; width:418px; border-radius:12px; box-shadow:var(--chief-shadow)` | `apps/web/src/chief/chief.css:11-23` |
| F2 | This geometry is the **measured value from upstream r5 screenshots** (replicated 1:1); the source is written in the CSS header comment | `apps/web/src/chief/chief.css:1-7` |
| F3 | A docked form **already exists** (#146), but as component-local `useState`, not persisted, not tied to "how it was opened" | `chief.css:29-36`, `chief-drawer.tsx:119` |
| F4 | **The containing block of the board route is the viewport** (`.board-shell` has no `position`; `#root` and each layer wrapper are also unpositioned); the main columns of the four host shells are `position:relative` | `board.css:10-14`, `app.css:51-56`, `pages.css:15-22`, `resources.css:14-20`, `secondary.css:16-23`, `detail.css:18-25` |
| F5 | There are **two existing precedents** of "edge-docked panel + content yields", both flexbox: the left rail (`flex-none w-60` + `*-main {flex:1}`) and the detail right rail (`--detail-pane-right:488px` + `.detail-body{display:flex}` + `.detail-center{flex:1;min-width:0}` + `.detail-right{flex:none;width:var(...);border-left:1px solid var(--border-default)}`) | `sidebar.tsx:353`, `detail.css:12,114-145` |
| F6 | The site frame has **no CSS grid**; the only frame width variable is `--detail-pane-right`; the sidebar widths are Tailwind-hardcoded `w-60`/`w-10`; `.res-col` 768 / `.secondary-col` 766 are also hardcoded | `tokens.css` (no width variables), `sidebar.tsx:269,353`, `resources.css:79`, `secondary.css:119` |
| F7 | The detail route has a 488px right rail: 1440−240−488−418 = 294px, so center-column yielding is physically impossible | `detail.css:12` |
| F8 | The board's four columns have no min-width (`.board-scroller` = `inset-x-0` + `px-[17px]` + `grid-cols-4 gap-3.5`); yielding 418px drops column width from ~281px to ~176px (**[extrapolated]**, not measured in a browser) | `board.tsx:349` |
| F9 | "Open/closed state" persistence for panels/sidebars **has a ready precedent**: sidebar collapse uses the `pacman.sidebar-collapsed` key + `readCollapsed(localStorage)` read, toggle writes immediately; the drawer's own `fullscreen` is the only state of its kind that is not persisted | `board/app-sidebar.tsx:77,81`, `api/auth.ts:17` |

## Decision

| ID | Decision |
|---|---|
| **D1** | **Single form**: the chief panel has only one form — **docked right rail** (full height, flush against the right edge, border radius zeroed, no shadow). The floating-card form is deleted; #146's "fullscreen / exit fullscreen" button and its form-switching contract are voided together (button deleted). |
| **D2** | **Yielding mechanism = flexbox** (a fixed-width panel with `flex:none` + sibling columns `flex:1; min-width:0` yielding automatically), following the two precedents of the left rail and the detail right rail (F5). **No CSS grid frame is introduced, no new width token is added** (F6). |
| **D3** | **Separation = 1px `--border-default` hairline** (existing repo rule Hairlines Not Shadows, following `.detail-right`'s `border-left`). With the shadow gone, no new separator is invented. |
| **D4** | **Entry animation**: the panel itself keeps the `translateX` slide-in (existing `anim-drawer`); **content snaps instantly, no layout animation**. `prefers-reduced-motion` degradation follows the existing rule. |
| **D5** | **Width pinned at 418px** (the upstream measured value, F1/F2). Drag-to-resize is explicitly out of scope, separate ticket. |
| **D6** | **Applicable shells = the four without a right rail**: board / pages / resources / secondary. The board's containing block is the viewport (F4), so the panel must be given a flex item inside its shell container's flex row; the other three shells naturally live inside `*-main`. |
| **D7** | **Detail route special case = evict the right rail**: that route has a 488px right rail and no room for a 418 rail (F7, 294px margin). The decision is that the chief **occupies the right rail's slot (mutually exclusive)**, the center column width unchanged — today's 418 overlay already sits on top of that 488px right rail, so this is not a regression. |
| **D8** | **Board guardrail**: when the panel is open, give `.board-column` a min-width to preserve information density, and yielding switches to **horizontal scroll**; when the panel is closed, behavior is byte-for-byte unchanged. The guardrail value must be measured during construction; do not copy F8's extrapolation. **(Amended 2026-10-03 by #692: the open-state-only 240px guardrail was upgraded to an all-day single-source token `--board-col-min: 280px` — the fixed pitch measured live on the reference site 2026-10-03; the scrollbar changed from always-hidden back to native auto (overflow must be disclosed); the ≥1440 stationary geometry is unchanged. See the single-source rule in board.css.)** |
| **D9** | **Open state not persisted**: refresh closes it (keeping the status quo `chiefView` default `'none'`). If persistence is ever wanted, do it following F9's sidebar precedent, separate ticket. |

## Premortem (assuming it already failed: the three most likely failure modes + guardrails)

| Failure mode | Guardrail |
|---|---|
| **Board gets crushed**: after yielding 418px the four columns drop from ~281px to ~176px (F8, [extrapolated]), cards squeezed into vertical strips — the most likely death of this plan | D8's min-width + horizontal scroll for the content area; every value is unchanged with the panel closed, so the stationary-state spec is fully preserved |
| **Detail route has no room**: 294px margin, center-column yielding impossible | D7 takes over the right rail slot instead; zero changes to center-column geometry, the `detail-3pane` pinning need not be rewritten |
| **Yielding becomes layout thrash**: content reflow is a layout animation, conflicts with the existing pure-transform entry rule, prone to jitter | D4: content snaps instantly, only the panel transform moves; `prefers-reduced-motion` degradation |

## Consequences

- **Positive**: the panel gets a stable column slot and no longer covers content; the form language unifies with the left rail and detail right rail (same flexbox family + 1px hairline); the form-switching branches (CSS two states + local state + one spec) disappear wholesale — a net code deletion.
- **Negative**: the board and each shell's content area narrows while the panel is open (D8's horizontal scroll is what this cost buys); the detail route gains a special-case branch (panel mount point differs from other shells); upstream replication fidelity yields on one already-measured geometry value.
- **Relationship to the original site**: the third deliberate divergence; what diverges is the **panel-as-overlay** form; the panel's content and behavior contracts (thread switching, composer, Esc layering, focus into composer) are unchanged.
- **Reopen triggers**: panel width adjustability or open-state persistence is wanted; the B4 (shadcn rollout chief domain) migration changes the container structure; upstream todos.dev itself changes the panel form (the foundation of 1:1 replication shifts).
