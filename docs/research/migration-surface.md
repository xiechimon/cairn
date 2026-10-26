<!-- XMON-11 | source: research/migration-surface @ def4b57 | the body text is verbatim unchanged; deviations are inserted in place as `Deviation annotation` blocks -->

> **Check-in note (XMON-11; parent ticket XMON-3 ruling A4=A)**
> This file is #409's migration-surface inventory report. The body is **taken verbatim from** `research/migration-surface` branch's `def4b57`
> (`docs/research/migration-surface.md`, 2026-09-29 17:49 +0800; the report self-declares baseline `origin/main @ 8c30775`).
> Reason for merging into `main`: every acceptance's third item must extract an e2e list per this file's §3 and appendices A/B, so the ledger must be queryable on the trunk.
> **The body is not rewritten** — it is a snapshot at the #409 point in time, whose value lies in being comparable line by line against the current tree; wherever it disagrees with the current tree,
> a `Deviation annotation` block is marked **in place**, the original text unchanged. Every annotation block states the commit the recheck was based on.
> This recheck commit: `9a0613b` (2026-10-01 00:13 +0800), **77 commits** later than the report's baseline.

# Migration surface inventory: ui primitive consumption matrix + css dependency graph + three-surface pin-point list

> Ticket: #409 (the research ticket for map #406 `apps/web component architecture switch to shadcn/ui`).
> Purpose: supply facts for the slicing strategy and the e2e re-pinning strategy — who consumes which primitive, which of the 23 css depend on which others,
> what selectors the three-surface pinning (web e2e class assertions / integration locator / visual geometry assertions) pins,
> and a difficulty grading for absorbing the piecemeal css files.
> Method: pure local code reading (grep + transcribing import statements file by file); no server started, no tests run.
> Baseline: `origin/main @ 8c30775` (2026-09-29; #394 new-task-no-title surface + #401 shortcut groups already merged).
> 140 tsx / 23 css (consistent with the map notes).

## Deviation overview (recheck @ `9a0613b`, 2026-10-01)

This file was written at `8c30775`. Between it and `9a0613b` lie 77 commits (`git log --oneline 8c30775..HEAD` is **77** lines in total),
and the migration under map #406 has already broken ground in a large area — the report's premise of `migration not started, grade before scheduling` no longer holds. The following commits invalidate the body's judgments:

| commit | Content | Invalidated body section |
|---|---|---|
| `84ff110` | web(414) main surface shadcn-ized — `components/ui/` adapter layer enters the repo + four-column reconciliation (#416) | §1 primitive matrix, §2.2 primitive layer |
| `cfa962e` | web(435) value canonical merged into `shadcn.css` + `tokens.css` demoted to alias layer + cleaned 16 dead tokens (#449) | §2.1 token caliber, appendix C |
| `f73fef6` | web(419) mention-picker dangling tokens reconnected to the in-repo single source (#427) | §2.1 `5 dangling tokens` whole item |
| `dfc5809` | web(425) B1 popover family absorbed into shadcn/Base UI — three adapter layers + shell swap (#454) | §1.1 law 2, §2.2 `ui/dialog.css` |
| `aa1314b` | web(426) token-gate + machine-authorize both switched to shadcn components (B2 warm-up) (#474) | §4 two `low difficulty` pieces |
| `839f59e` | web(423) resources domain fully switched to shadcn — the first real domain (#481) | §4 resources row |
| `2b6bf61` | web(453) search-panel (⌘K) migrated to the DialogShell viewport-root variant (#467) | §2.3 domain-layer import edges |
| `3511dc3` | web(468) ⌘J changed to toggle + the `KbdHint` primitive enters the repo (#475) | §1 primitive list |
| `06f7ef9` `fd25629` `7ccdcf2` `417f714` `8f6825c` `2234522` etc. | board / detail / chief / sidebar moving and reordering one after another | all §3 three-surface counts, appendix A |

**How to read**: this file's **method** is not outdated (calibers, the three-layer css skeleton, the family laws, the absorption-grading caliber); what is outdated are the **numbers** and **member tables**.
Read the corresponding section's `Deviation annotation` before citing any number.

## 0. Caliber

- **import file count** = the number of tsx/ts files whose grep of `ui/<name>` hits and which are outside the `ui/` directory (manually rechecked to exclude pure comment mentions).
- **JSX instance count** = occurrences of `<Component` (line-end breaks caused by prop folding are counted).
- **css dependency edge** = transcribing the `^import .*\.css` original text file by file (45 edges), no basename guessing — `detail/overlays.css` and `overlays/overlays.css` are same-name but different objects, and basename matching would conflate their two consumption surfaces (this inventory actually hit that once mid-way and corrected it).
- **Pin point** = `locator('.…')` class selector (web e2e and integration use the same caliber); geometry assertion = `boundingBox` call sites + the `page.evaluate` probe expects inside the visual spec.

## 1. ui/ primitive consumption matrix

`apps/web/src/ui/` has 7 primitives 6 css (avatar has no css, a pure behavior primitive: dicebear generation + onError fallback, visual size given by the consumption surface's per-face css).

| Primitive | Style | import files | JSX instances | Consumption file distribution |
|---|---|---|---|---|
| Button | button.css (41 decl) | **22** | **38** / 21 files | everywhere: board 3, chief 2, detail 5, overlay 4, pages 3, resources 2, routes 3 |
| Card | card.css (6 decl) | **0** | **0** | **dead primitive** — see §1.1 |
| Chip | chip.css (25 decl) | 2 | 2 | detail/dhead.tsx, resources/parts.tsx |
| DialogShell | dialog.css (126 decl) | 11 | 11 | 11 dialogs 1 shell each (chief 2, detail 4, resources 3, routes 2) |
| Input | input.css (24 decl) | 6 | 12 | token-gate, search-panel, 4 create dialogs (create-provider one place 6 points) |
| TagChip | tag-chip.css (14 decl) | 1 | 1 | only detail/fresh-block.tsx |
| Avatar | — (no css) | 9 | 12 | sidebar, todo-card, detail 2, overlays 2, pages 1, routes 2 |

Button consumption top: overlay/new-task-dialog 6 points, detail/overlays 5 points.

> **Deviation annotation (recheck @ `9a0613b`)** — the matrix is already distorted, because the primitive layer **forked into two layers**:
>
> 1. `apps/web/src/ui/` is still the old primitive layer: `button` / `card` / `chip` / `input` / `tag-chip` / `kbd-hint` (six pieces each with same-name css)
>    + `avatar` (no css).
> 2. `apps/web/src/components/ui/` is the **shadcn adapter layer** entered since #414, 14 pieces in total: `alert-dialog` `alert-dialog-shell`
>    `badge` `button` `card` `dialog` `dialog-shell` `dropdown-menu` `empty` `floating-shell` `input` `popover`
>    `switch` `tabs`. **The same semantic name coexists in two layers** — `Button` is two sets, consumers import their own.
> 3. `DialogShell` has moved out of `ui/` to `components/ui/dialog-shell.tsx` (`ui/dialog.css` is now self-imported by it);
>    added `ui/kbd-hint.tsx` (#468); `ui/avatar.tsx` has left `ui/README.md`'s primitive table.
>
> Current values (same caliber as left: import path exact-match; JSX uses the word boundary `<Name\b`, slightly under-counting the original text's prefix match):

| Primitive | Definition site | import file count | JSX instances |
|---|---|---|---|
| Button | `ui/button.tsx` (old layer) | 18 | two layers counted together |
| Button | `components/ui/button.tsx` (shadcn layer) | 8 (6 business + `dialog.tsx` / `alert-dialog.tsx` two same-layer adapters) | two layers counted together |
| Chip | `ui/chip.tsx` | 1 | 1 |
| Card | `ui/card.tsx` (old layer) | **0** (dead) | 0 |
| Card | `components/ui/card.tsx` (shadcn layer) | 4 | 5 |
| Input | `ui/input.tsx` (old layer) | 8 | 14 |
| Input | `components/ui/input.tsx` (shadcn layer) | 2 | 2 |
| TagChip | `ui/tag-chip.tsx` | 6 | 4 |
| KbdHint | `ui/kbd-hint.tsx` | 3 | 3 |
| Avatar | `ui/avatar.tsx` | 12 | 15 |
| DialogShell | `components/ui/dialog-shell.tsx` | 16 | 14 |

> Repo-wide `<Button` is **49** occurrences, old-layer / new-layer mixed, not split per layer this round — the moved surfaces already use tailwind utility classes,
> and the primitive count's power to indicate slicing cost is weaker than at the original point in time.

### 1.1 Four native facts (directly affecting selection / slicing)

1. **Card is a dead primitive.** `ui/card.tsx` exports `Card` (tone: card/inset/elevated), repo-wide 0 import, 0 JSX; card.css is imported only by card.tsx itself. The real `card`s are **7 per-face class families**, all bypassing the primitive and writing domain css directly:
   - `res-card`/`res-rowcard` (resources.css: the machines/secrets/skills/mcp-servers 4-page row cards)
   - `prj-set-card` (pages.css: project settings), `prj-task-card` (pages.css: project task card)
   - `sched-card` (pages.css: schedule list card), `team-agent-card` (secondary.css: team grid card)
   - `account-card` (secondary.css), `authorize-card` (machine-authorize.css)
   Migration meaning: landing shadcn Card is not `replacing the Card primitive` but **creating a new component + absorbing the 7 scattered families**; card.tsx/card.css can retire directly.
2. **The DialogShell family has one big deserter.** overlay/new-task-dialog.tsx **no longer uses DialogShell** after #394 (the title-less single-field surface) — hand-rolled OverlayMount + ClickCatcher + Esc three-piece set (the family law #67/#127 original shape), only keeping the `.new-task-dialog` class name as the e2e anchor. It is also TagChip's former second-largest consumption surface; after #394 fixed the tag vocabulary, TagChip has only fresh-block left. **The dialog family actually = DialogShell 11 shells + new-task-dialog 1 hand-rolled shell**; at migration this 12th surface either gets absorbed back into the family or becomes its own work item.
3. **per-face class name = e2e locate alias** (ui/README rule 2 in writing). Example: dhead.tsx renders `<Chip variant={tone} className="detail-chip--{tone}">` and keeps the outer `.detail-chip` base class — e2e locates clicks by `.detail-chip`. Same-family aliases are all over the repo (token-gate-input/-submit, fresh-tag-chip, new-task-dialog…). **When migrating a component the class alias must be kept verbatim or e2e re-pinned in sync** — this is the contract surface between the three-surface pinning (§3) and the component layer.
4. **1 dead import**: routes/account-page.tsx imports `Button` that is never rendered (#148 account-page cleanup residue, lint did not catch).

> **Deviation annotation (recheck @ `9a0613b`)** — three of the four native facts have been overturned:
>
> - **Law 1 `Card is a dead primitive` → half-invalid.** The old `ui/card.tsx` is indeed dead now (0 consumption), but #414's
>   shadcn `components/ui/card.tsx` is consumed by 4 files: `board/todo-card.tsx`, `overlay/token-gate.tsx`,
>   `resources/parts.tsx`, `routes/machine-authorize-page.tsx` (5 JSX positions). The original `Card landing = new component
>   + absorb 7 scattered families` direction is right; `card.tsx/card.css can retire directly` holds only for the **old layer**.
> - **Law 2 `new-task-dialog deserter` → already reclaimed.** `overlay/new-task-dialog.tsx` now `import { DialogShell }
>   from '../components/ui/dialog-shell.js'` (line 30, rendered at line 227). The dialog family is now **12 shells all inside DialogShell**,
>   no longer `11 shells + 1 hand-rolled shell`; the original `this 12th surface either absorb or separate` fork has been walked.
> - **Law 3 (per-face class name = e2e locate alias) → still holds, and has been promoted to a repo-level policy.** `ui/dialog.css`'s header notes the
>   **#411 alias-first policy**: at the #425 shell-swap mechanism the `.dlg-*` class names were `kept verbatim`. `.dlg`'s e2e pin sites went 67 → **69**.
> - **Law 4 `account-page.tsx dead import` → already cleaned** (`routes/account-page.tsx` has no `Button` import now).

Also: overlay/token-gate.tsx's source comment mentions `the style body lives in ui/input.css / ui/button.css`, easily mis-read by grep as a direct css import — measured it only imports components, no seam violation.

## 2. css dependency graph

The 23 css files fall into three layers. Dependency edges all come from static imports at the top of tsx (no css `@import`s another css; the only `@import` is app.css importing tailwindcss).

> **Deviation annotation (recheck @ `9a0613b`)** — the three-layer skeleton is still there, the members changed:
>
> - css total is still **23**, but 3 added and 3 removed: **removed** `board/sidebar.css`, `overlay/token-gate.css`, `routes/machine-authorize.css`;
>   **added** `styles/shadcn.css`, `ui/kbd-hint.css`, `routes/agent-detail.css`. `board/sidebar.css`'s
>   `.sidebar-row` / `.rail-row` rules now live in `overlays/overlays.css`.
> - `@import` is no longer `the only app.css importing tailwindcss`: `styles/app.css` is now `@import "tailwindcss"` +
>   `@import "./shadcn.css"` two lines. `shadcn.css` is not directly imported by any tsx, injected only through app.css.
> - Static `^import .*\.css` edge count **45 → 37**.

### 2.1 Global layer (main.tsx directly imports 4 files)

| File | Size | Role |
|---|---|---|
| styles/tokens.css | 16.4K, 119 distinct tokens (:root = dark default L11, .light mirror L231) | the only token source |
| styles/fonts.css | 22 decl | @font-face + --font-inter |
| styles/motion.css | 35 decl | motion tokens/keyframes |
| styles/app.css | tailwind @import + `@theme inline` mapping (--color-* → tokens.css variables) + global focus-ring absorption (#388) | tailwind v4 entry |

Token flow measured (full src grep `var(--`):

- **119 defined / 109 consumed / 19 dead tokens** (defined-but-unused): `--active-text` `--blue-400` `--card-ghost-border` `--chip-active-bg` `--chip-active-border` `--col-dot-building` `--col-dot-confirm` `--col-dot-idle` `--col-dot-planning` `--col-dot-review` `--disabled-fg` `--indigo-400` `--nav-bg` `--send-disabled` `--space-1..4` `--space-6`. The col-dot five-state whole family + the space spacing family are fully dead — cleanable before migration.
- **5 consumed but undefined repo-wide** (no fallback, 20 var() references in total): `--surface-base` `--border` `--ring` `--text` `--text-muted` — **all held exclusively by overlay/mention-picker.css**. That file is the opposite-shore token names carried in when #311 ported from the reference app; #334 only tokenized the radius; css variables undefined and no fallback = IACVT (background/border these non-inherited properties fall to initial — panel background transparent, border disappears; color survives unbroken by inheritance luckily). **This is an existing defect and a migration must-answer**: mention-picker must reconnect tokens whether or not it migrates.
- detail.css's `var(--color-danger, #dc2626)` / `var(--color-warning, #f59e0b)` carry fallbacks, a self-sufficient form, not on the defect list; fonts.css's --font-inter and detail.css's --detail-pane-right are locally defined locally used.
- tsx inline `style` consuming `var(--`: **0 places** — token consumption is 100% through css files, no inline token coupling at the component layer.

> **Deviation annotation (recheck @ `9a0613b`)** — the token pipeline has been wholly replaced (`#435`, landing `#412` P2b ruling):
>
> - **Value canonical moved**: the only value-holding file for color tokens is already `styles/shadcn.css` (shadcn official semantic vocabulary + in-repo fill-in families coexisting);
>   `tokens.css` demoted to **alias layer + non-color layer** (motion / font stack / shadow / radius still belong to it). Name-by-name attribution see
>   `docs/research/412-token-mapping.md`.
> - **Counting caliber changed**, the original `119 defined / 109 consumed` is no longer comparable. Current: `tokens.css` + `shadcn.css` define **153** names in total;
>   full-src consumption **129** names (judged by `var(--x)` only) / **135** names (judging tailwind shorthand `-(--x)` too).
> - **Dead tokens: 19 → 0.** The original 19 names were cleaned as whole families by `#449` (`--col-dot-*` left with the idle/confirm/building three states only, all consumed).
>   Recheck caliber: tokens.css + shadcn.css defined-but-unused, **counting both `var(--x)` and tailwind shorthand `-(--x)` consumption forms**,
>   and excluding the tailwind `@theme` namespace (`--color-*` / `--radius-*`, consumed indirectly through utility classes and not to be counted dead).
>   Judging only by the `var(--` single form would mis-record `--badge-attention` (consumed at `board/todo-card.tsx:123`'s `bg-(--badge-attention)`) as dead.
>   Repo-wide within css the only defined-but-unused is `styles/fonts.css:37`'s `--font-jetbrains-mono`.
> - **Dangling tokens: 5 → 0.** `overlay/mention-picker.css`'s `--border` / `--text` / `--text-muted` /
>   `--surface-base` / `--ring` were reconnected to the in-repo single source by `#427`; that file now references them **0 times**. The original `this is an existing defect and a migration must-answer` is closed.
> - **Global-layer four-file sizes also changed**: `tokens.css` 16.4K → **5.9K** (111 lines, color values migrated out); added `styles/shadcn.css`
>   **15.6K** (355 lines), not directly imported by tsx, injected only through `styles/app.css`'s `@import "./shadcn.css"`
>   (TW4 consumes `@theme` only in a stylesheet containing `@import "tailwindcss"`). `fonts.css` 1.0K / `motion.css` 4.8K / `app.css` 4.3K.
> - The self-sufficient fallbacks (non-defect) remain only `detail/detail.css`'s `--color-danger` / `--color-warning` (2 each, with hex fallback).

### 2.2 Primitive layer (ui/ 6 files, each self-imported with its tsx)

button.css ← button.tsx; card.css ← card.tsx (dead); chip.css ← chip.tsx + **tag-chip.tsx double-import**; dialog.css ← dialog-shell.tsx; input.css ← input.tsx; tag-chip.css ← tag-chip.tsx.

> **Deviation annotation (recheck @ `9a0613b`)** — the primitive layer is now 7 css files (original 6 + `kbd-hint.css`), with one edge changed:
> `dialog.css ← components/ui/dialog-shell.tsx` (the tsx defining it changed directory). The rest unchanged:
> `button.css ← button.tsx`, `card.css ← card.tsx` (**dead**), `chip.css ← chip.tsx + tag-chip.tsx double-import`,
> `input.css ← input.tsx`, `tag-chip.css ← tag-chip.tsx`, `kbd-hint.css ← kbd-hint.tsx`.
>
> Also: after `#425` `ui/dialog.css` no longer holds shell-level rules — `.dlg-backdrop` / `.dlg` / `.dlg-head` / `.dlg-title` /
> `.dlg-close` / `.dlg-body` / `.dlg-foot` retired with the adapter layer; the shell mechanism switched to Base UI Dialog and geometry is carried by adapter-layer utility classes
> (values aligned with the old rules one by one). This file now only keeps the `dlg-form-*` form family, the selector-driven exit recipe
> (`.dlg-shell[data-ending-style]` / `.dlg-viewport[data-ending-style]`) and the viewport root container, plus each per-face dialog class.

### 2.3 Domain layer (13 pieces) — the full import-edge table

| css | decl count | tsx importing it | Covered surface |
|---|---|---|---|
| board/board.css | 257 | board/board.tsx, routes/board-page.tsx | board columns/drag/topbar |
| board/sidebar.css | 241 | board/sidebar.tsx | sidebar tree + rail narrow bar (reused globally through shell) |
| chief/chief.css | 464 | chief/chief-drawer.tsx, chief/chief-settings.tsx | chief drawer + settings |
| detail/detail.css | 852 | routes/todo-detail-page.tsx (route-level single import) | task detail 3 panes + transcript/diff/spec-block |
| detail/overlays.css | 404 | detail/{accept-dialog, branch-dialog, right-pane, stop-confirm-dialog}.tsx | detail-domain popover content + right-pane static section (dlg-* content family) |
| overlay/overlay.css | 278 | overlay/{new-task-dialog, delete-confirm, delete-project-confirm, more-menu}.tsx | popover batch A (#66): new task + delete confirm + ⋯menu (slimmed after #394) |
| overlay/mention-picker.css | 223 | overlay/mention-picker.tsx, detail/segments.tsx | mention popover (dead-token surface, §2.1) |
| overlay/token-gate.css | 30 | overlay/token-gate.tsx | token-gate page (smallest piece) |
| overlays/overlays.css | 241 | overlays/{search-panel, chip-popover, plan-dropdown, dismiss}.tsx | popover batch B (#67): ⌘K search + status popover + plan dropdown |
| pages/pages.css | 899 | pages/{project-new, project, project-settings, schedules}-page.tsx | 4 pages/* pages (largest piece) |
| resources/resources.css | 326 | resources/shell.tsx (shell-mode single import) | machines/providers/secrets/skills/mcp-servers 5 pages |
| routes/machine-authorize.css | 41 | routes/machine-authorize-page.tsx | machine-authorize page (independent small piece) |
| secondary/secondary.css | 389 | secondary/shell.tsx (shell-mode single import) | account/team/api-keys 3 pages |

Structure observations:
- **Shell mode two places**: resources/shell.tsx and secondary/shell.tsx each single-import the domain css and embed AppSidebar — the routes/ account/team/api-keys three pages have 0 css imports themselves, their styles injected wholly through secondary.css.
- **Route-level direct import two places**: todo-detail-page.tsx imports detail.css, board-page.tsx imports board.css (domain components themselves do not import, the route holds the bottom line).
- **overlay/ and overlays/ are two directories** (the popover batch #66/#67 historical shape), plus detail/overlays.css makes three "overlays"-named objects — name normalization can be done incidentally at migration.

> **Deviation annotation (recheck @ `9a0613b`)** — the domain layer is still 13 pieces, two members changed:
>
> - **Removed**: `overlay/token-gate.css`, `routes/machine-authorize.css` (`#474` switched both to shadcn components).
> - **Added**: `routes/agent-detail.css` (route-level direct import by `routes/agent-detail-page.tsx`, same shape as detail.css / board.css).
> - After `board/sidebar.css` was delisted, `board/board.css` itself also slimmed into `the residual layer after the #414 pilot`: only the cross-domain shared pieces
>   (`.project-avatar` / `.chief-fab`), the un-migrated `.board-notify-banner*`, and behavior-state rules (drag lock-select / lift shadow / drop-tint).
> - The three structure observations still hold, each gaining one example: **shell mode** still `resources/shell.tsx` / `secondary/shell.tsx` two places;
>   **route-level direct import** 2 → **3** (+`routes/agent-detail-page.tsx` → `agent-detail.css`);
>   **three overlays-named objects** (`overlay/`, `overlays/`, `detail/overlays.css`) still not normalized.
> - The `tsx importing it` full table above is wholly outdated; current values follow the **37** edges of `grep -rn --include='*.tsx' --include='*.ts' -E "^import .*\.css"`.

## 3. Three-surface pin-point list

### 3.1 web e2e class assertions (apps/web/e2e/, 50 specs, 1278 expects)

- **872 `.locator('.…')` class pins, pinning 302 distinct selectors** (including `.x .y` composites and `[attr]` combinations). 46/50 specs have class pins.
- Non-class locate is rare: getByRole ×8, getByText ×3, getByLabel/Placeholder ×0, data-testid ×0; aria-label combinations inside locator ×43. **The class name is the only scaled locating mechanism** — the shadcn switch (class names all replaced) is a full-scale re-pin on this surface, no lucky surface.
- Pin-density top 5 specs: dead-buttons 119 (76 distinct, the full-site dead-button census surface), provider-add-dialog 51, chief-settings 49, project-tasks-toolbar 36, detail-3pane 34 / dialog-viewport 34.
- Selector-family distribution (300 distinct by prefix): prj-* 42, dlg-* 35, chief-* 23, res-* 18, board-* 18, new-task-* 14, sched-* 13, sidebar-* 11, detail-* 10, team-* 9, delete-* 9, doc-* 8, search-* 7, diff-* 6, account-* 6, token-gate-* 5, rail-* 5, overlay-* 5, chat-* 5…… (full per-file list in appendix A)
- Single-selector heat top: `.dlg` ×67 (the 11 DialogShell shared shell class, the hottest single point), `.dlg-provider-preset` ×20, `.sidebar-row` ×17, `.dlg-title` ×16, `.diff-expand` ×12, `.chief-pick-row` ×11.

> **Deviation annotation (recheck @ `9a0613b`)** — this surface grew the most in this recheck; the original counts are all outdated:

| Item | Original @ `8c30775` | Current @ `9a0613b` |
|---|---|---|
| spec count | 50 | **66** |
| `expect(` sites | 1278 | **1871** |
| `locator('.…')` sites | 872 | **1200** |
| distinct selectors | 302 | **479** |
| specs with class pins | 46 / 50 | **61 / 66** |
| getByRole / getByText | 8 / 3 | 13 / 8 |
| getByLabel / getByPlaceholder | 0 / 0 | 0 / 0 |
| `data-testid` | 0 | **first appearance**: `e2e/github-issue-writeback.spec.ts` uses `[data-testid="source-issue-*"]` |
| aria-label combos in locator | 43 | 53 |

> The conclusion's direction is unchanged: **the class name is still the only scaled locating mechanism**. Density top 5 changes to dead-buttons **127 sites / 95 distinct**,
> `agent-detail` **77 / 41**, `provider-add-dialog` 51, `chief-settings` 49, `project-new-dir-browser` 38
> (`detail-3pane` and `dialog-viewport` tie at 36 right behind). The hottest single point `.dlg` 67 → **69**.
>
> Family distribution recomputed (caliber: take the `^\.[a-z0-9]+-` prefix directly from the distinct selector string, composites not starting with a `-`-bearing class are unclassified —
> not **fully identical** to the original `first-class merge` caliber, for magnitude reference only): `prj-*` 52, `dlg-*` 38, `agent-*` 35, `chief-*` 29,
> `team-*` 26, `board-*` 25, `res-*` 23, `chat-*` 18, `detail-*` 15, `new-*` 14, `sidebar-*` 12, `sched-*` 12.
> `agent-*` is its own new family (paired with `routes/agent-detail.css` + #497 etc.), absent from the original family table. The original table would change wholesale under any caliber recomputation, not reproduced cell by cell.

### 3.2 integration locator (integration/test/, vitest + playwright)

- 3 files use class locators, **59 sites pinning 40 distinct selectors** in total: m5-web-e2e.test.ts 38 (28 distinct), task-meta-e2e.test.ts 13 (12 distinct), m7-branch-dialog-e2e.test.ts 8 (6 distinct). The other 13 integration tests do not hit UI.
- Highly same-family with web e2e (.todo-card/.board-new-task/.new-task-*/.dlg-*/.detail-*/.sched-*/.doc-*), i.e. the same batch of class names is pinned by both surfaces — changing one class name shatters both surfaces.
- Non-class: getByRole ×2, the rest isolated text locates.

> **Deviation annotation (recheck @ `9a0613b`)** — the pin site count **has not moved a character**: still 3 files, **59 sites**. What changed is distinct and the denominator:
>
> - distinct **40 → 36**: m5-web-e2e 28 → **24**, task-meta-e2e 12 → **10**, m7-branch-dialog-e2e 6 → **6**.
> - `integration/test/` now has **17** `*.test.ts` (the original 16); still the same 3 hit UI, the other 14 do not.
> - The `highly same-family with web e2e, pinned by both surfaces, change one and both shatter` judgment still holds.

### 3.3 Visual geometry assertions

- **`toHaveScreenshot` 0 places repo-wide** — the `visual specs` do not land screenshot baselines; all are **numeric geometry / computed-style assertions**, so re-pinning = changing numbers and selectors, no bitmap re-baselining involved.
- Two dedicated visual specs, both through `page.evaluate` probes (getComputedStyle + getBoundingClientRect):
  - visual-polish.spec.ts: 30 expects, 4 evaluate probes. Pins card/column/notification-bar/menu border=0 + radius=12px + shadow/ring recipe (#161 edge family), sidebar and main same-base (#390), scrollbar shape, rail borderRight/shadow.
  - sidebar-visual.spec.ts: 19 expects, 7 probes. Pins .sidebar-row selected-state inset (top/bottom 2px, radius 6px), row-width = sidebar clientWidth, sidebarWidth=240, online-dot positioning, hover color consistency.
- **boundingBox 36 sites across 8 behavior specs**: board-dnd 10 (drag geometry), providers-tabs 6, shell-consistency 5, dialog-viewport 4, chief-panel 3, segmented-controls 3, user-menu-trigger 3, collapse-family 2.
- Visual-surface probe selectors concentrate in the sidebar/board two families (.board-sidebar .sidebar-row* .sidebar-online-dot .sidebar-kbd .board-topbar .board-main .board-scroller) — **the sidebar is the densest geometry-pinned domain**.

> **Deviation annotation (recheck @ `9a0613b`)**:
>
> - `toHaveScreenshot` still **0 places repo-wide** — `visual specs do not land screenshot baselines` is one of the few facts in this recheck that **did not change at all**.
> - `visual-polish.spec.ts`: 30 expects → **31**; `page.evaluate` probes 4 → **1** (probes converged).
>   `sidebar-visual.spec.ts`: 19 expects / 7 probes, **verbatim identical to the original**.
> - `boundingBox`: **36 sites across 8 specs → 63 sites across 13 specs**. The 6 added specs:
>   `agent-create-model`, `agent-detail`, `board-overflow`, `chief-fab`, `skills-readonly`, `team-org-chart`.

### 3.4 The re-pinning meaning of the three-surface convergence

- The hottest re-pin single point = `.dlg` (67 web e2e sites + integration same-family) — it pins ui/dialog.css's shell base class, shared by 11 DialogShell consumption surfaces; whether the shadcn Dialog shell swap keeps the alias (keep `.dlg` or re-pin wholesale) is the first ruling.
- The per-face alias (§1.1 law 3) and the three-surface pinning are the two ends of one contract: the component layer changes implementation and the alias survives ⇒ all three surfaces zero changes; the alias does not survive ⇒ 853+59+geometry surfaces re-pin in sync. **The re-pinning-strategy ticket can quantify the two options' costs directly from this.**

> **Deviation annotation (recheck @ `9a0613b`)** — the conclusion still holds, and has been validated for one round by execution: the `.dlg` alias is indeed kept (69 pin sites zero changes),
> and the `#411 alias-first policy` wrote it into a repo-level rule. The original `the re-pinning-strategy ticket can quantify the two options' costs directly` step has been walked by #425's choice
> (shell-swap mechanism + keep alias); the two options no longer stand side by side.

## 4. `one domain one style` piecemeal distribution and absorption difficulty grading

Visual-density caliber: the proportion of declarations containing color/background/shadow/border/radius/font/outline/opacity/filter (repo-wide domain css has no pure layout shell — the lowest sidebar 26% still carries a solid-color recipe).

| css | decl | visual % | cover | absorption difficulty | Reason |
|---|---|---|---|---|---|
| overlay/token-gate.css | 30 | 47% | single page | **low** | already Button/Input-primitivized, remainder only shell layout |
| routes/machine-authorize.css | 41 | 51% | single page | **low** | single page single card (authorize-card family 1 site) |
| overlay/mention-picker.css | 223 | 48% | mention popover | **medium (must fix first)** | dead-token surface (§2.1), must reconnect tokens before migration to have a real baseline |
| board/board.css | 257 | 28% | board | **medium** | layout-heavy (columns/drag/scroll), but board-dnd 10 boundingBox sites pin drag geometry |
| board/sidebar.css | 241 | 26% | sidebar+rail | **medium** | repo-wide most geometry-sensitive: sidebar-visual 19 expects + collapse/shell two specs co-pin |
| overlays/overlays.css | 241 | 36% | search/popover/dropdown | **medium** | search-* 7 + chip-popover + plan-dropdown family; ⌘K panel shape independent |
| resources/resources.css | 326 | 33% | 5 pages | **medium** | res-* 18 selectors / res-card row cards; 5-page same-family absorbed in one go |
| overlay/overlay.css | 278 | 34% | new task + delete + menu | **medium** | slimmed after #394; new-task-dialog 18.6K and already desertered DialogShell family (§1.1 law 2), strongly standalone |
| secondary/secondary.css | 389 | 37% | 3 pages | **medium** | account/team/keys three pages + team-agent-card/account-card two card families |
| detail/overlays.css | 404 | 41% | detail popover content | **medium** | shell already lifted to ui/dialog.css, the dlg-* content family follows the DialogShell migration |
| chief/chief.css | 464 | 38% | chief | **high** | chief-* 22 selectors + chief-settings 49 pin sites (single-spec density #3) |
| detail/detail.css | 852 | 33% | task detail everywhere | **high** | largest technical depth: transcript/diff/spec-block component-level vision (diff-* family double-spec co-pin) + todo-detail-page.tsx 41K the repo's largest single file |
| pages/pages.css | 899 | 38% | 4 pages | **high** | largest piece: prj-* 42 selectors (biggest family) + sched-* 13, project-new github/repo dual flow |

Grading total: **low 2 / medium 9 (including 1 must-fix-first) / high 3** — of the 13 domain pieces none is a pure layout shell.
Suggested slice order (for the blueprint ticket's reference, not a ruling): the two low-difficulty pieces (token-gate, machine-authorize) as the pilot warm-up — small surface, few pins (token-gate spec 16 sites but only 6 selectors), already partly primitivized; among medium difficulty, resources or secondary as the first `real domain` (shell-mode single css import, clean absorption boundary); the three high pieces (chief/detail/pages) left until the token pipeline and re-pinning strategy stabilize.

> **Deviation annotation (recheck @ `9a0613b`)** — the grading's **method** (visual-density caliber, four difficulty tiers) is still usable, but the member table and slice suggestion have been overtaken by execution progress:
>
> - **The original slice order was largely followed**: `#474` did two low-difficulty warm-ups (token-gate, machine-authorize),
>   `#481` then the first real domain resources (original said resources or secondary; resources was chosen).
>   Those two low pieces **no longer appear** in the table; resources is no longer pending absorption.
> - **One medium item lost its prerequisite**: `overlay/mention-picker.css` dangling tokens fixed by `#427`.
> - **Membership changed**: removed 2 (token-gate / machine-authorize), added 1 (`routes/agent-detail.css`, not in original grading),
>   `board/sidebar.css` dropped.
> - The three high pieces (chief / detail / pages) **remain**; per `#522` (`docs/417`) batch table, rollout continues.
> - Both columns of the original were recomputed under **the same convention** and can be compared directly. The decl convention is taken from this repo's `docs/spec/16-shadcn-rollout-batch-table-and-acceptance-criteria.md` §7
>   count command (`grep -cE '^[[:space:]]*[-a-zA-Z]+[[:space:]]*:.*;'`); visual share uses the original rule (decl lines whose properties hit
>   color/background/shadow/border/radius/font/outline/opacity/filter):

| css | decl @ `8c30775` | decl @ `9a0613b` | visual % @ `9a0613b` (original value) | status |
|---|---|---|---|---|
| pages/pages.css | 899 | 1094 | 38%(38%) | not migrated |
| detail/detail.css | 852 | 955 | 33%(33%) | not migrated |
| secondary/secondary.css | 389 | 491 | 34%(37%) | not migrated |
| chief/chief.css | 464 | 470 | 37%(38%) | not migrated |
| detail/overlays.css | 404 | 420 | 41%(41%) | shell lifted, content family not migrated |
| resources/resources.css | 326 | 363 | 35%(33%) | domain switched to shadcn (#481), this file still exists |
| overlays/overlays.css | 241 | 238 | 37%(36%) | not migrated (sidebar rules merged here) |
| overlay/overlay.css | 278 | 240 | 35%(34%) | not migrated |
| overlay/mention-picker.css | 223 | 227 | 49%(48%) | not migrated (dangling tokens fixed, #427) |
| board/board.css | 257 | **64** | 35%(28%) | board migrated to shadcn (#414), this file is now the residual layer |
| board/sidebar.css | 241 | **—** | —(26%) | **file deleted**, rules merged into overlays/overlays.css |
| ui/dialog.css | 126 | 93 | 44% | shell-level rules retired (#425), form family and per-face classes remain |
| overlay/token-gate.css | 30 | **—** | —(47%) | **file deleted** (#474 switched to shadcn components) |
| routes/machine-authorize.css | 41 | **—** | —(51%) | **file deleted** (#474 switched to shadcn components) |
| routes/agent-detail.css | — | 185 | 40% | **added**, not in the original grading |
| styles/shadcn.css | — | 210 | —(value file, this caliber does not apply) | **added** (#435 value canonical) |
| ui/kbd-hint.css | — | 21 | 38% | **added** (#468) |

> The visual-% recomputed values fall within ±3 percentage points of the original line by line, showing the original caliber is reproducible; `board/board.css`'s 28% → 35% is the file's denominator shrinking after slimming,
> not more recipes.

## Appendix A: web e2e class pins per-file full table (46 specs, baseline 8c30775)

Columns = spec (without .spec.ts)|pin sites|distinct count|distinct selectors (first class, composites merged by first class).

> **Deviation annotation (recheck @ `9a0613b`)** — this appendix is the 46-spec full table at the `8c30775` point in time, **not to be used as the current list**:
> current e2e is **66** specs, of which **61** have class pins; every row's `sites / distinct / selectors` may have changed
> (example: dead-buttons 119 → 127 sites, 76 → 95 distinct; added `agent-detail`, `agent-create-model`, `project-new-dir-browser`,
> `team-org-chart`, `skills-readonly` and a batch of specs are missing whole rows).
> **This table is kept as-is** — its value is exactly `comparison against the current tree`. For a current list, re-run per the §3.1 deviation block's caliber.
> The appendix title's `baseline 8c30775` is the original's own, unchanged.

| spec | sites | distinct | selectors |
|---|---|---|---|
| account-team-cleanse | 21 | 12 | .account-avatar .account-card .account-delete .account-logout .account-swap .account-switch .secondary-link .team-agent-card .team-chart-empty .team-create-agent .team-layout-tab .team-members |
| avatar-dicebear | 21 | 15 | .chip-popover .chip-popover-row .chip-popover-section--selected .dlg-agent-avatar .prj-task-avatar .rail-user .search-panel .search-row-icon--agent .sidebar-row .sidebar-user .team-agent-avatar .team-agent-card .team-create-agent .todo-agent-avatar .user-menu-head |
| board-dnd | 9 | 4 | .board-drag-overlay .board-scroller .board-sidebar .todo-card-action--ghost |
| brand-typo | 1 | 1 | .res-back |
| chief-panel | 11 | 7 | .chief-composer-bar .chief-drawer .chief-example .chief-examples .chief-stream .chief-switcher .secondary-fab |
| chief-settings | 49 | 15 | .chief-agent-row .chief-dlg-charter-input .chief-dlg-ghost .chief-dlg-primary .chief-edit-btn .chief-model-menu .chief-model-row .chief-model-row-provider .chief-pick-empty .chief-pick-input .chief-pick-name .chief-pick-row .dlg .dlg-close .dlg-title |
| chip-assign | 25 | 12 | .chief-pick-check .chief-pick-empty .chief-pick-input .chief-pick-name .chief-pick-row .chip-popover .chip-popover-edit .chip-popover-section--selected .detail-chip .dlg .dlg-close .dlg-title |
| collapse-family | 28 | 10 | .board-column .board-column--collapsed .board-column-collapse .board-column-count .board-column-strip .rail-group .rail-row .sidebar-group .sidebar-group--collapsed .sidebar-subrow |
| dead-buttons | 119 | 76 | .account-avatar .account-swap .board-guide .board-guide-pop .board-guide-wrap .board-new-task .board-topbar-actions .btn--overlay .chat-collapse .chat-tool-pill .chief-head-actions .chief-pick-row .composer-toolbar .delete-confirm .delete-confirm-delete .detail-head-action .detail-head-icon--more .detail-right .dlg .dlg-agent-avatar .dlg-agent-swap .dlg-title .doc-empty .doc-select-wrap .keys-create .keys-docs .keys-empty .more-menu .more-menu-item .new-task-close .new-task-dialog .new-task-discard .new-task-discard-drop .new-task-discard-keep .new-task-spec .new-task-tools .overlay .overlay-title .plan-dropdown .plan-dropdown-row .prj-branch-chip .prj-file-row .prj-files-seg-tab .prj-files-share .prj-history-row .prj-set-avatar .prj-set-change .prj-task-card .prj-task-row .prj-tasks-view-btn .rerun-agent-label .rerun-agent-name .rerun-agent-row .rerun-switch .res-doclink .res-dot .res-empty .res-empty-desc .res-grow .res-new .res-row-more .res-rowcard .res-rowcard--mcp .res-sort .res-sort-menu .res-sort-row .sched-card .sched-card-menu .sched-card-menu-row .sched-card-more .sched-empty .sched-empty-docs .sched-empty-new .sidebar-user .team-create-agent .user-menu |
| detail-3pane | 34 | 16 | .chat-plan-open .detail-center .detail-head .detail-head-icon--more .detail-right .detail-tab .detail-tabs .detail-tabs-group .dlg .dlg-token-total .doc-pane .doc-pane-body .doc-select-wrap .plan-dropdown .plan-dropdown-row .right-empty |
| dialog-viewport | 34 | 24 | .chief-agent-row .chief-dlg-ghost .chief-dlg-primary .chief-edit-btn .chief-pick-list .dlg .dlg-accept-cancel .dlg-accept-done .dlg-agent-create .dlg-body .dlg-branch-body .dlg-enroll-apikey .dlg-enroll-keylink .dlg-enroll-toggle .dlg-provider-create .dlg-provider-custom .dlg-provider-model-add .dlg-secret-create .dlg-seg-tab .dlg-sync .res-add .res-new .team-create-agent .todo-card-branch |
| diff-full-file | 20 | 6 | .diff-expand .diff-full .diff-hunk-head .diff-line .diff-line--add .diff-no--new |
| file-viewer | 12 | 6 | .prj-file-content .prj-file-row .prj-file-row--active .prj-files-seg-tab .prj-files-viewer .prj-history-row |
| hotkeys | 18 | 9 | .chief-composer-input .chief-drawer .new-task-dialog .new-task-project-name .new-task-spec .search-input-row .search-panel .sidebar-kbd .sidebar-row |
| machine-add-dialog | 22 | 12 | .dlg .dlg-close .dlg-enroll-apikey .dlg-enroll-browserlink .dlg-enroll-cmd .dlg-enroll-copy .dlg-enroll-desc .dlg-enroll-keylink .dlg-enroll-lead .dlg-enroll-toggle .dlg-title .res-add |
| machines-local | 1 | 1 | .res-row-title |
| newtask-project-select | 18 | 6 | .board-new-task .new-task-dialog .new-task-project .new-task-project-menu .new-task-project-name .new-task-project-row |
| newtask-single-field | 12 | 7 | .board-new-task .new-task-dialog .new-task-input .new-task-spec .new-task-tag-add .new-task-tags .todo-card-title |
| notify-banner | 9 | 4 | .board-notify-banner .board-notify-banner-action .board-notify-banner-body .board-notify-banner-title |
| overlay-focus | 12 | 7 | .board-new-task .new-task-dialog .overlay-mount .page-new-action .sched-form-cancel .sched-form-close .sched-form-overlay |
| plan-diff-full-file | 20 | 6 | .diff-expand .diff-full .diff-hunk-head .diff-line .diff-line--add .diff-no--new |
| project-empty-new-task | 8 | 6 | .new-task-dialog .new-task-project-name .new-task-spec .prj-task-row .prj-tasks-empty .prj-tasks-empty-new |
| project-files-local-disabled | 12 | 4 | .page-tab .prj-files-disabled .prj-files-pane .prj-task-row |
| project-new-github | 31 | 13 | .prj-new-gh-auth .prj-new-gh-disconnect .prj-new-gh-empty .prj-new-gh-error .prj-new-gh-link .prj-new-gh-login .prj-new-gh-picker .prj-new-gh-row .prj-new-gh-search .prj-new-repo-input .prj-new-repo-menu .prj-new-repo-menu-row .prj-new-repo-swap |
| project-new-repo | 22 | 7 | .prj-new-error .prj-new-gh-auth .prj-new-gh-link .prj-new-repo-menu .prj-new-repo-menu-row .prj-new-repo-swap .prj-new-submit |
| project-settings-delete | 13 | 11 | .delete-confirm--project .delete-confirm-cancel .delete-confirm-close .delete-confirm-delete .delete-confirm-input .delete-confirm-prompt .delete-confirm-summary .delete-confirm-title .prj-set-danger-label .prj-set-danger-title .prj-set-delete |
| project-tasks-toolbar | 36 | 9 | .prj-task-card .prj-task-row .prj-tasks-empty .prj-tasks-filter .prj-tasks-menu .prj-tasks-menu-row .prj-tasks-nomatch .prj-tasks-search .prj-tasks-view-btn |
| provider-add-dialog | 51 | 13 | .dlg .dlg-close .dlg-provider-back .dlg-provider-badge .dlg-provider-create .dlg-provider-custom .dlg-provider-model-add .dlg-provider-note .dlg-provider-preset .dlg-provider-search .dlg-provider-seg-tab .dlg-title .res-new |
| provider-oauth | 22 | 6 | .dlg .dlg-provider-badge .dlg-provider-note .dlg-provider-oauth-error .dlg-provider-preset .res-new |
| reject-chain | 18 | 13 | .chat-plan-title .chat-streaming-label .composer-send .detail-chip .detail-head-action .diff-hunk-head .diff-line--add .doc-file-row .doc-pane-select .doc-range-chip .doc-range-wrap .version-menu--sub .version-menu-row |
| rerun-close-family | 9 | 4 | .overlay .overlay-back .overlay-close .overlay-title |
| search-focus | 11 | 9 | .rail-row--selected .search-group-label .search-input-row .search-panel .search-row .search-row--selected .search-row--todo .sidebar-row .sidebar-row--selected |
| search-result-rows | 7 | 6 | .detail-shell .search-panel .search-row .search-row--selected .search-row--todo .sidebar-row |
| secret-add-dialog | 13 | 6 | .dlg .dlg-close .dlg-secret-create .dlg-secret-note .dlg-title .res-new |
| segmented-controls | 23 | 14 | .chief-tab .dlg .dlg-seg-tab .page-tab .prj-files .prj-files-seg-tab .prj-tasks-view-btn .sched-form-freq .sched-form-freq-tab .sched-form-freq-tab--active .team-layout-tab .team-layout-tab--active .todo-card-branch .user-menu-seg |
| shell-consistency | 18 | 10 | .board-sidebar .board-sidebar--collapsed .chief-drawer .rail-row .sidebar-row .sidebar-subrow .sidebar-team-collapse .sidebar-team-name .team-plan .team-upgrade |
| sidebar-nav | 15 | 9 | .board-sidebar .rail-install .rail-row .sidebar-install .sidebar-row .sidebar-subrow .sidebar-team-name .sidebar-team-row .sidebar-user |
| sidebar-search-offboard | 2 | 2 | .search-panel .sidebar-row |
| skills-readonly | 13 | 7 | .res-empty .res-empty-desc .res-empty-hint .res-empty-title .res-new .res-primary .res-rowcard |
| team-create-agent | 16 | 9 | .dlg .dlg-agent-configure .dlg-agent-create .dlg-agent-warn .dlg-close .dlg-title .team-chart-empty .team-create-agent .team-layout-tab |
| theme-toggle | 2 | 1 | .user-menu-seg |
| title-band-clicks | 4 | 4 | .res-back .res-new .secondary-back .secondary-head-right |
| token-gate | 16 | 6 | .board-sidebar .token-gate .token-gate-error .token-gate-input .token-gate-submit .token-gate-title |
| user-menu-nav | 4 | 3 | .sidebar-user .user-menu .user-menu-row |
| user-menu-trigger | 8 | 4 | .rail-user .sidebar-user .user-menu .user-menu-seg |
| visual-polish | 2 | 2 | .board-scroller .board-sidebar--collapsed |

## Appendix B: integration class pins per-file full table (3 specs, baseline 8c30775)

| spec | sites | distinct | selectors |
|---|---|---|---|
| m5-web-e2e | 38 | 28 | .board-column .board-column-name .board-new-task .chat-bubble .chat-note .chat-plan-title .chat-scheduled .composer-input .composer-send .detail-chip .detail-head-action .detail-shell .dlg-accept-done .doc-file-row .doc-pane-select .doc-range-chip .doc-range-wrap .new-task-spec .new-task-start .page-new-action .sched-card .sched-form .sched-form-freq-tab .sched-form-save .todo-card .todo-card-link .todo-card-title .version-menu-row |
| task-meta-e2e | 13 | 12 | .board-new-task .detail-shell .fresh-tags .new-task-dialog .new-task-input .new-task-save .new-task-spec .new-task-tag-add .new-task-tags .todo-card .todo-card-link .todo-card-title |
| m7-branch-dialog-e2e | 8 | 6 | .detail-right .dlg-branch-value .dlg-dir--input .dlg-machine .dlg-machine-menu .plan-dropdown-row |

> **Deviation annotation (recheck @ `9a0613b`)** — the site count column (38 / 13 / 8 = 59) **is fully identical to the current value**; the distinct column current:
> m5-web-e2e 28 → **24**, task-meta-e2e 12 → **10**, m7-branch-dialog-e2e 6 → **6** (total 40 → **36**).

## Appendix C: dead tokens and dangling tokens full list

- Dead tokens (defined in tokens.css, zero consumption full src, 19): --active-text, --blue-400, --card-ghost-border, --chip-active-bg, --chip-active-border, --col-dot-building, --col-dot-confirm, --col-dot-idle, --col-dot-planning, --col-dot-review, --disabled-fg, --indigo-400, --nav-bg, --send-disabled, --space-1, --space-2, --space-3, --space-4, --space-6.
- Dangling tokens (consumed but undefined repo-wide, 5, all in overlay/mention-picker.css): --border (5 sites), --text (5 sites), --text-muted (5 sites), --surface-base (4 sites), --ring (1 site).
- Self-sufficient fallbacks (non-defect): detail.css's --color-danger/--color-warning (2 each, all with hex fallback); fonts.css's --font-inter and detail.css's --detail-pane-right are locally defined locally used.

> **Deviation annotation (recheck @ `9a0613b`)** — three current states:
>
> - **Dead tokens: 19 → 0.** `#449` cleaned 16 names. Of the original 19, the `--col-dot-*` five states now only have the idle / confirm / building three
>   definitions (planning / review deleted), and all three **have live consumption sites** (`src/board/columns.ts:52,60,67`'s `dot:` values) —
>   definitions at `styles/shadcn.css:143–145` (`.light` mirror 283–285). Re-run under §2.1 deviation block's composite caliber, within `tokens.css` +
>   `shadcn.css` the defined-but-unused is **0**; repo-wide within css only `styles/fonts.css:37`'s `--font-jetbrains-mono` remains.
> - **Dangling tokens: 5 → 0.** The whole item was resolved by `#427`; `overlay/mention-picker.css` now references them 0 times.
> - **Self-sufficient fallbacks**: `detail/detail.css`'s `--color-danger` / `--color-warning` are still there (2 each, with hex fallback);
>   one added same-nature form `secondary/secondary.css:429`'s `var(--card-border-hover, var(--text-tertiary))`.
>   `--font-inter` / `--detail-pane-right` unchanged.