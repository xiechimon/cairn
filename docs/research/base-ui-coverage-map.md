# pacman × Base UI coverage map: hand-rolled surface ledger, per-surface cost, and batch schedule

> Baseline: `633afa37` (= origin/main, data captured 2026-10-03; every number in this document is re-runnable with the §9 commands).
> Produced by: the t-0057 thread (read-only inventory, no product code touched).
> Axis: **whether the interaction semantics goes through an official Base UI component**. This is two separate ledgers from spec 16's
> `are the raw controls absorbed into `components/ui`` — a surface can be ledger-clean on the spec 16 axis and still hand-rolled on this axis. The most typical example is the
> `components/ui/select.tsx` primitive itself: it is assembled from Button + FloatingShell and hand-writes role=listbox,
> on the spec 16 axis it is a `primitive`, on this axis it is the core of the largest gap family.
> Upstream rulings: #410 (primitives = base), spec 16 §3 (`from B1 onward every shadcn component is pulled in its base shape`),
> ADR 0009 + #656 (motion converges to shadcn defaults, woven in per domain).
> Documentation verification: the Base UI official docs checked on demand via Context7 (`/websites/base-ui_react`), each semantic conclusion gives
> its source; the installed component directory read from this checkout's `node_modules/.pnpm/@base-ui+react@1.8.0_*/node_modules/@base-ui/react/`
> (the real artifact, not from memory).

## 0. Conclusion overview

1. **Coverage is higher than the ticket preset.** The shared shells (dialog/alert-dialog two-generation shells), Button (49 files), Input (16),
   Tabs (including the segmented-control canonical), Switch, the Avatar/Badge adapter layers, and Popover (filter-panel) are already on official components.
   The real gaps concentrate in **6 families**: the Select/listbox family, the Menu/popover mechanism family, the Checkbox family, drawer,
   the tooltip surface, and the collapsible family — the first four have explicit official counterparts, the last two are product-ruling surfaces.
2. **spec 16's `B3/B4 not started` reading is already outdated.** XMON-24 (detail, #593), XMON-23 (chief, #588),
   XMON-25 (pages, #607), XMON-75 (dropdown/checkbox unification, #570), XMON-72 (checkbox closure, #600) etc. have already landed the
   B4 high-three structural switch: repo-wide raw controls went from spec 16's ledger 171 down to **71 (corrected caliber, §1.2)**,
   and old `ui/`-layer primitive consumption went from 16 files/17 sites down to **3 files/3 sites**. The spec 16 ledger body is stuck at the XMON-28 (#547)
   point in time and needs a rebase (§2).
3. **Three official components sit idle in the repo while the hand-rolled counterparts are right beside them.** `components/ui/dropdown-menu.tsx`
   (a complete Base UI Menu registry wrapper with Portal+Positioner+data-open animation complete) has 0 consumption sites, while
   `overlay/more-menu.tsx` hand-writes role=menu; `dialog.tsx`, `alert-dialog.tsx` two wrappers are likewise
   0 consumption sites (shell duty already carried by the dialog-shell / alert-dialog-shell adapter layers). `ui/button.tsx` is a dead file
   (0 consumption sites). Hygiene surface in §3.10 / U0.
4. **#656 (motion direction B) and this map's gap surfaces are the same batch of files.** #656's ticket names 14 tsx (now measured 17, §5.3),
   highly overlapping with the Select family / Menu family / drawer / OverlayMount old generation; and the Base UI official components ship
   `data-open/data-closed` + shadcn default animation — **switching to the official component automatically achieves #656's mechanism goal**.
   Going separately = touching the same surface twice, two rounds of pixel verification. Conclusion: **merge at the execution layer (one acceptance), separate at the ticket layer** (§7).
5. **There is a boundary; it is not `migrate everything`.** mention-picker / search-panel / chip-popover / dir-browser content layers,
   hidden file inputs, textarea, separator, KbdHint, ClickCatcher (UX ruling), toast (sonner, #631
   already ruled) — these either have no official drop-in, or already have an in-repo ruling, or are pure presentation; §3.9 states the no-migration reason item by item.

**Overview table** (details and file:line evidence in §3, comparison and semantic judgment in §4, cost in §5, batches in §6):

| Surface | Current mechanism | Base UI official counterpart | Judgment | Batch |
|---|---|---|---|---|
| Select primitive + 6 hand-rolled listbox sibling surfaces | FloatingShell (Dialog non-modal) + ClickCatcher + Button rows | **Select** (complete component family) | gap, semantic superset | U2 |
| more-menu (role=menu) | FloatingShell + fixed capture coordinates | **Menu** (wrapper already in repo, idle) | gap | U3 |
| user-menu (sidebar popover) | OverlayMount old generation + ClickCatcher + useEscapeClose | **Popover / Menu** | gap (mechanism generation gap) | U3 |
| sched-form-overlay (centered popover) | useOverlayMount + ClickCatcher self-drawn | **Dialog** (DialogShell family) | gap (out-of-family self-drawn) | U3 |
| chief-drawer | OverlayMount + `aside.anim-drawer` | **positioned Dialog** (official guidance) or Drawer.Root | gap, three-way mechanism pending ruling | U4 |
| ui/checkbox + filter-panel three-state row + branch-dialog knob | real native input + self-drawn skin | **Checkbox** (span+hidden input, indeterminate first-class) | gap (deliberate, but the official gives the same `for free`) | U1 |
| 41 `title=` + KbdHint hover chip | native tooltip / pure CSS hover | **Tooltip** | product-ruling surface, default no-migrate | U6 |
| sidebar group collapse / board column collapse / transcript row collapse | aria-expanded hand-rolled (ARIA correct) | **Collapsible** | low payoff, default not batched | U7 |
| toaster (sonner) | shadcn official recipe | Toast (exists) | **already ruled (#631), no-migrate** | — |
| mention-picker / search-panel / chip-popover / dir-browser content layers | FloatingShell or DialogShell mechanism + hand-rolled content | no drop-in (Combobox needs to own the input) | boundary declaration | — |
| sidebar 9 + filter-panel 6 + resources dialogs 14 raw buttons | raw controls | Button (component already official, ledger not absorbed) | spec 16 axis residual | U5 |
| ui/button (dead), dialog.tsx / alert-dialog.tsx / dropdown-menu.tsx (idle), ui/README.md (outdated) | — | — | hygiene surface | U0 |

## 1. Ledger caliber and baseline recheck

### 1.1 Task brief's known facts rechecked item by item (all hold, two refined)

| Known fact | Recheck result |
|---|---|
| `@base-ui/react ^1.8.0` in web deps | holds (`apps/web/package.json:19`) |
| 13 files import it | holds (§3.1 list checked file by file) |
| 10 sub-packages used | refined: **9 component sub-packages + 2 tool sub-packages** — alert-dialog (×2 files) / avatar / button / dialog (×3: dialog.tsx, dialog-shell, floating-shell) / input / menu / popover / switch / tabs, plus merge-props + use-render (both badge.tsx:1-2) |
| checkbox.tsx hand-rolled (only imports cn) | holds, and is **a documented deliberate hand-roll** (file header 1-4: a real native input carries keyboard/form/screen-reader, the visual rides a self-made tile) — but Base UI Checkbox gives the same semantics (§4), so the reason is not a permanent exemption |
| select.tsx hand-rolled (only uses useState) | holds — but note it is not `forgotten to migrate`: it is the **family-law component** built by XMON-75 (FloatingShell + ClickCatcher + Esc, absolute anchored wrap, file header 10-17), part of the repo's popover vocabulary |

### 1.2 Raw-control ledger correction: script 75 → real 71

`node scripts/count-raw-controls.mjs` currently reads 75, of which **4 are comment text mis-counted by substring matching**
(that script does not strip comments):

| Mis-counted site | Original comment shape |
|---|---|
| `components/ui/checkbox.tsx:2` | `` `<input type="checkbox">` `` in the header comment |
| `components/ui/select.tsx:5` | `` native `<select>` `` in the header comment |
| `routes/api-key-create-dialog.tsx:118` | `` `<input type="checkbox">` `` in the XMON-75 migration note comment |
| `routes/agent-detail-page.tsx:314` | `` `<select>` `` in the XMON-75 migration note comment |

**Corrected repo-wide ledger (633afa37 measured, caliber = four kinds of raw controls after stripping comments)**:

| Domain | button | input | select | textarea | total |
|---|---|---|---|---|---|
| resources | 16 | 0 | 0 | 2 | 18 |
| board | 15 | 1 | 0 | 0 | 16 |
| overlay | 10 | 0 | 0 | 1 | 12 (more-menu 5 · new-task-dialog 4 · mention-picker 3) |
| overlays | 6 | 0 | 0 | 0 | 6 (search-panel 4 · plan-dropdown 1 · dismiss 1) |
| pages | 5 | 0 | 0 | 0 | 5 (project-new-page 3 · project-page 1 · schedules-page 1) |
| chief | 2 | 0 | 0 | 2 | 4 |
| detail | 0 | 2 | 0 | 2 | 4 (composer 2 · branch-dialog 1 · review-dialog 1) |
| routes | 0 | 1 | 0 | 1 | 2 (agent-detail-page's inline rename input + textarea) |
| components | 1 | 1 | 0 | 0 | 2 (model-select-core 1 · ui/checkbox body 1) |
| ui (old primitive bodies) | 1 | 1 | 0 | 0 | 2 |
| **total** | **56** | **7** | **0** | **8** | **71** |

**Of the 71, 11 are not gaps on the Base UI axis** (this axis's net ledger = 60): textarea 8 (Base UI has no textarea
component; shadcn's Textarea is also a pure style shell), hidden file input 2 (`detail/composer.tsx:148`,
`overlay/new-task-dialog.tsx:440` — the native-trigger standard pattern), `overlays/dismiss.tsx`'s
ClickCatcher 1 (a transparent fullscreen button is a **deliberate UX primitive**, floating-shell.tsx:14-17 header states in writing
`switching it is a UX change, not a mechanical migration`). **Native `<select>` is 0 repo-wide** — XMON-75's `native select
zeroed` claim holds after the comment-stripping recheck.

### 1.3 The three dynamic-concatenation landing sites (grep literal zero-hit ≠ nonexistent)

| Concatenation shape | Landing site | Nature |
|---|---|---|
| `` `btn--${variant}` `` | `ui/button.tsx:34` | old-primitive dead file (0 consumption sites), the concatenation retires with the file |
| `` `${prefix}-wrap/select/shell/menu/row/...` `` | `components/ui/select.tsx:75-135` | **surface-hook family**: consumers pass a prefix (sched-form ×3, agent-skill / agent-runtime / agent-model, agent cascade ×2), e2e and the surface css all pin this layer of hooks — when migrating to the official component the class hooks must keep producing the same output (#411 alias-first) |
| `` `${codeClassName}--link` `` | `detail/segments.tsx:47` | content-rendering hook (chat-code--link / doc-code--link), not a control surface, not in the ledger |

### 1.4 Installed official component directory (1.8.0 artifact, 47 entries)

accordion / alert-dialog / autocomplete / avatar / button / checkbox / checkbox-group /
collapsible / combobox / context-menu / csp-provider / dialog / direction-provider / drawer /
field / fieldset / floating-ui-react / form / input / internals / menu / menubar / merge-props /
meter / navigation-menu / number-field / otp-field / popover / preview-card / progress / radio /
radio-group / scroll-area / select / separator / slider / switch / tabs / toast / toggle /
toggle-group / toolbar / tooltip / types / unstable-use-media-query / use-render / utils.

More than the upstream directory the task brief transcribed: **navigation-menu, otp-field, preview-card** (plus provider/tool-class
entries) — the comparison follows this artifact directory as authoritative throughout.

## 2. spec 16 current-state correction (rebase reading)

The spec 16 ledger body (§0 status column, §5.2 consumption-site table, §6.5 raw-control ledger) is stuck at **XMON-28 (#547)**,
plus the #561 closure-row partial update; later landings were not written back. Item-by-item reconciliation:

| spec 16 record | 633afa37 measured | landing evidence (commit / PR) |
|---|---|---|
| B4 high-three `not started`, 11 tsx consumption sites left, raw controls 83 | chief / detail / pages structural switch **already landed**; three-domain raw controls left 13 (chief 4 · detail 4 · pages 5) | XMON-24 detail 12 files 42 controls (`134de3bf` #593), XMON-23 chief 20 controls (`b5609a9c` #588), XMON-25 pages 35+5 controls (`980e43a3` #607) |
| §5.2 old-primitive consumption 16 files / 17 sites | **3 files / 3 sites**: `resources/create-provider-dialog.tsx:34` (ui/input), `resources/create-secret-dialog.tsx:11` (ui/input), `routes/agent-detail-page.tsx:93` (ui/chip) | XMON-23/24/25 each ticket closure; ui/button consumption zeroed (the file became dead) |
| §6.5 repo-wide raw controls 171 | **71** (corrected caliber §1.2) | ditto + XMON-75 dropdown/checkbox unification (`804bfef9` #570), XMON-72 checkbox closure (`61f4de2f` #600), filter-panel rebuild (`296b7179`), board drag redo (`ee636a5f` #618) |
| segmented control = hand-rolled `.team-layout-tabs` | **Tabs variant="segmented" canonical** (XMON-103, `bb1370d6` #585): `routes/team-page.tsx:135-145`, `resources/providers-page.tsx:154` | already on Base UI Tabs |
| resting box has no primitive | **Panel primitive** (XMON-104, `de3dff33` #587, cva skin tiers) | presentation, no Base UI counterpart needed |
| toast has no surface | **sonner toaster** (#631, `43528c48` #635) + #638 (26 site wiring) in progress | §3.8 ruling surface |
| e2e 66 spec / 61 with class pins (§6.4, `8c30775` point) | **83 spec files** | `ls apps/web/e2e/*.spec.ts` |
| domain css size table (§5.1, `fa54bbad`) | drifted: chief 841→**1100 lines** (470→591 decl), pages 1927→**1984** (1094→1110), detail 1913→**1925** (955→925), secondary 924→**814** (488→426), board 140→**183**; added profile-card.css 150, components/ui/{checkbox,select}.css 45/81 | §9 re-run commands |

Two leftover rulings' status updates:

- **§6.5 `resources create-* excluded surfaces left for the parent ticket to rule`** — parent ticket #417 already closed (2026-09-30, mis-closed by PR #522's
  squash, recorded in the repo's CLAUDE.md), the ruling left hanging. This map's U5 folds it into the `raw-control ledger zero` batch.
- **#414 pilot slice `sidebar 9 sites`** — still there (`board/sidebar.tsx` corrected 9 raw buttons, all sidebar
  nav row / search row / rail toggles), assigned to U5.

Old `ui/` layer retirement status: button.tsx+button.css **dead file**; dialog-shell.tsx already deleted with B1;
chip 1 consumption site, input 2; `ui/dialog.css` (246 lines/93 decl) **still alive** — the `.dlg-*` family
per-face geometry canonical, output alias classes by `components/ui/dialog-shell.tsx` (that file's 13-15 comment);
`ui/README.md` content outdated (still lists the deleted dialog-shell row).

## 3. Hand-rolled surface list (repo-wide scan)

### 3.1 Control group: surfaces already on Base UI

| Component | Sub-package | Consumer file count | Notes |
|---|---|---|---|
| `ui/button.tsx` | button | **49** | repo-wide button canonical |
| `ui/dialog-shell.tsx` | dialog | **17** | B1 popover shell (.dlg alias + dlg-viewport two tiers), animation already data-open-ized |
| `ui/input.tsx` | input | 16 | |
| `ui/seeded-avatar.tsx` → `ui/avatar.tsx` | avatar | 15 (+1 inner) | XMON-14 adapter layer |
| `ui/floating-shell.tsx` | dialog (**non-modal**) | 8 | anchored popover family common base: `modal={false}` + Portal container re-anchor + role=dialog (floating-shell.tsx:50-68); Esc through the Base UI layer stack |
| `ui/tag-chip.tsx` → `ui/badge.tsx` | merge-props + use-render | 6 (+5 inner) | |
| `ui/kbd-hint.tsx` → `ui/kbd.tsx` | — (registry presentation) | 5 (+2 inner) | hover/focus CSS chip, see §3.6 |
| `ui/tabs.tsx` | tabs | 4 | providers-page / chief-settings / agent-detail-page / team-page; includes the segmented tier canonical |
| `ui/checkbox.tsx` | — (hand-rolled) | 4 | **gap**, see §3.3 |
| `ui/card.tsx` | — (presentation) | 4 | layout container, no official-component counterpart needed |
| `ui/select.tsx` | — (hand-rolled) | 3 | **gap core**, see §3.2 |
| `ui/switch.tsx` | switch | 3 | machines-page / agent-detail-page / account-page |
| `ui/alert-dialog-shell.tsx` | alert-dialog | 2 | internally also uses use-esc.ts (the old Esc hook's only consumer) |
| `ui/panel.tsx` | — (presentation, cva) | 2 | XMON-104 |
| `ui/empty.tsx` | — (presentation) | 2 | |
| `ui/popover.tsx` | popover | **1** | the only consumption site = `board/filter-panel.tsx:45` (merged into the repo-wide popup vocabulary at rebuild, `a6234e9b`) — the official Positioner generation currently has only this surface |
| `ui/toaster.tsx` | — (sonner) | 1 (App.tsx mount) | §3.8 |
| `ui/dialog.tsx` | dialog | **0 (idle)** | §3.10 |
| `ui/alert-dialog.tsx` | alert-dialog | **0 (idle)** | §3.10 |
| `ui/dropdown-menu.tsx` | menu | **0 (idle)** | complete Menu registry wrapper: Portal + Positioner (side/align/offset) + Popup with data-open/data-closed animate-in/out + Group/Label/Item family — **exactly #656's target animation shape**, enabled by U3 |

FloatingShell direct consumers (8 files): select.tsx, plan-dropdown, skills-page (sort menu),
chief-model-select, dhead (chip-popover anchor), more-menu, mention-picker, agent-detail-page:467.
ClickCatcher consumers (15 files): the list above + sidebar, chief-drawer, new-task-dialog, schedules-page,
project-new-page, project-page, dir-browser, account-page.

### 3.2 Gap family A: Select / listbox family (the largest family)

**Primitive**: `components/ui/select.tsx` — trigger button (Button ghost) + FloatingShell + ClickCatcher +
`role="listbox"` menu + Button rows `role="option"` (75-138). Geometry law (header comment 10-17):
absolute, expanding downward flush to the wrap's left edge, z 30 above ClickCatcher's 29; surface css writes overrides with the `.ui-select-menu.<prefix>-menu`
composite selector.

**Consumption instances (7 sites / 3 files + 1 reused component)**:

| prefix | site | surface |
|---|---|---|
| `sched-form` ×3 | `pages/schedules-page.tsx:285,299,310` | schedule date·hour·minute |
| `agent-skill` / `agent-runtime` / `agent-model` | `routes/agent-detail-page.tsx:319,348,357` | agent overview three slots |
| pass-through prefix ×2 | `routes/agent-model-select.tsx:89,130` | create-agent dialog + overview slot's two-level cascade (t-0024 / #617 shape, row-projection law single source in `components/model-select-core.tsx`, converged by #626) |

**Hand-rolled sibling surfaces (same semantics, not going through the primitive, 6 surfaces)**:

| Surface | Site | Shape |
|---|---|---|
| `.chief-model-menu` | `chief/chief-model-select.tsx:104` | role=listbox `compact model`, FloatingShell + anim-pop; model-select-core header states in writing the chief surface **does not absorb the shell** (two-level cascade and flat+search shapes are not isomorphic, product ruling) |
| `.new-task-project-menu` | `overlay/new-task-dialog.tsx:385` | role=listbox project select, aria-expanded at line 369 |
| `.prj-tasks-menu` | `pages/project-page.tsx:244` | role=listbox task view select |
| `.prj-new-repo-menu` | `pages/project-new-page.tsx:449` | role=listbox repo select |
| `.prj-new-gh-picker` | `pages/project-new-page.tsx:492` | GitHub issue select popover |
| plan-dropdown | `overlays/plan-dropdown.tsx` | plan/change + right-pane view picker, FloatingShell + ClickCatcher + Button rows, the `select-and-close law` (#306) |
| skills-page sort menu | `resources/skills-page.tsx` | FloatingShell family member (named in floating-shell.tsx:2-3 header) |

**Official counterpart = Select** (installed 1.8.0 family artifact: Root/Label/Trigger/Value/Icon/Portal/Backdrop/
Positioner/Popup/List/Item/ItemText/ItemIndicator/Group/GroupLabel/Separator/ScrollUpArrow/
ScrollDownArrow/Arrow). Semantic judgment (official docs, base-ui.com/react/components/select.md checked
via Context7):

- **Superset**: keyboard navigation + typeahead, floating-ui positioning, scroll arrows, items API, controlled value/onValueChange
  all built in; the current hand-rolled surface only has click + Esc.
- Two **non-equivalence points to handle explicitly**: ① the official popup by default **overlays the trigger** (macOS-style selected-row alignment),
  while the in-repo geometry law is `expand downward flush to the left edge` — must turn off the default alignment and set Positioner side/align/sideOffset;
  ② form participation goes through a Field hidden input (handbook/forms.md), while the in-repo surfaces mutate via JS rather than a native
  submit, so Field can be skipped (the value still flows through onValueChange).
- Official guidance verbatim: "Select is not filterable, aside from basic keyboard typeahead… **Prefer
  Combobox** when the number of items is sufficiently large" — the model surfaces' tens of rows are within Select's comfort zone;
  only if the chief main-model dialog with a search box is absorbed later would Combobox be involved.

### 3.3 Gap family B: Checkbox family

| Surface | Site | Current mechanism |
|---|---|---|
| `ui/checkbox.tsx` primitive | consumed by 4 files: create-provider-dialog / accept-dialog / stop-confirm-dialog / api-key-create-dialog | a real `<input type="checkbox">` (id passed through to e2e/labelFor) + self-made tile (square 18px solid white check); **no indeterminate support** |
| filter-panel three-state select-all row | `board/filter-panel.tsx:213-236` | raw input + `ref` setting indeterminate + appearance-none Tailwind self-drawn (check/dash overlays); a comment rules `three-state goes through the indeterminate attribute, semantics with keyboard/screen-reader behavior are free` |
| branch-dialog forced-sync knob | `detail/branch-dialog.tsx:159-172` | raw checkbox **pretending to be a switch** (`.dlg-toggle` + knob) — the real counterpart is the in-repo `ui/switch` (Base UI Switch), not Checkbox |

**Official counterpart = Checkbox + CheckboxGroup**. Semantic judgment (base-ui.com/react/components/checkbox.md,
checkbox-group.md checked via Context7): Root renders a `<span>` + **hidden native input**; props include
`name/value/uncheckedValue/form` (form participation), **`indeterminate` first-class**, `parent` +
CheckboxGroup `allValues` (parent three-state auto-managed), `data-checked/data-unchecked/data-indeterminate`
style hooks. Conclusion: **the `free semantics` premise holds for the official component too** — the hand-rolled version's reason (native keyboard/form/screen-reader)
is not an exemption; the difference is on the e2e locating surface (real input → hidden input: `toBeChecked` still assertable, `.check()`
clicking the input directly must change to clicking the Root) and the id landing (the hidden input can keep consuming the id).

### 3.4 Gap family C: Menu / popover mechanism family (with three mechanism generations)

**The three mechanism generations** are this family's real problem — the same class of popover, with three generations of mechanism coexisting in the repo:

| Generation | Mechanism | Surviving surfaces |
|---|---|---|
| old generation | `OverlayMount` (useOverlayMount manual keep-alive) + ClickCatcher + useEscapeClose | sidebar user-menu (sidebar.tsx:264-270), chief-drawer (§3.5), dir-browser (dir-browser.tsx:17,119-121 `popover family law #67/#127`), sched-form-overlay (schedules-page.tsx:224), project-page / project-new-page / account-page each popover |
| transition generation | FloatingShell (Base UI Dialog non-modal) + ClickCatcher + per-surface self-managed positioning CSS | select family, more-menu, plan-dropdown, mention-picker, chip-popover (dhead anchor), skills sort |
| official generation | official-component Portal + **Positioner** (floating-ui anchoring) | only filter-panel (Popover) |

Specific surfaces:

- **more-menu** (`overlay/more-menu.tsx:53-57`): role=menu, fixed capture coordinates, 5
  Button ghost rows (copy/ban/delete etc.). **Official counterpart = Menu, and the wrapper is already in the repo** (dropdown-menu.tsx,
  §3.1) — enabling it gives Positioner anchoring + data-open animation + focus management + typeahead.
- **user-menu** (`detail/user-menu.tsx`): content panel (identity header + appearance row + 3 Link nav rows),
  the popover mechanism lives in sidebar (old generation). **The appearance-theme segment = 2×ghost Button + data-active**
  (user-menu.tsx:73-88, XMON-24 comment) — coexisting with XMON-103's Tabs-segmented canonical as two segment shapes;
  official counterpart = Popover (panel) or Menu (row semantics), the theme segment can migrate with Tabs-segmented or ToggleGroup.
- **sched-form-overlay** (`pages/schedules-page.tsx:224`): centered popover self-drawn skin (anim-fade),
  not going through the DialogShell family — the only out-of-family centered popover example. Official counterpart = Dialog (absorbed into DialogShell to rejoin the family).
- **chip-popover** (`overlays/chip-popover.tsx:31`): role=dialog content panel (project header + task row +
  execution dialog row + edit assignment), dhead anchored via FloatingShell. The content layer has no official counterpart (info panel), the mechanism layer
  follows the family.

### 3.5 Gap family D: chief-drawer

`chief/chief-drawer.tsx:272-273`: `<OverlayMount open={open} exitMs={DRAWER_EXIT_MS}>` +
`<aside className="chief-drawer anim-drawer">` — manual keep-alive + hand-written keyframes (motion.css's
drawer-in 300ms). A 35.5K single file, right-docked vertical panel (ADR 0004 / #447), N-key scoped hotkey (#645),
the threads-switch popover uses ClickCatcher.

Official judgment (two verbatim sources checked via Context7):

- dialog.md usage guidance: "**A panel that slides in from the edge of the screen and doesn't need
  gesture support is a positioned Dialog.**" — chief-drawer has no gesture need (desktop dock panel,
  opened/closed by fab/hotkey), so per official guidance it should use the **non-modal Dialog mechanism** (same law as FloatingShell, the docked positioning CSS
  unchanged).
- drawer.md: Drawer.Root supports `modal={false}` + `disablePointerDismissal` + `swipeDirection` —
  the Drawer component is only worth it if gestures/snap points are wanted later.

#656 requires enter/exit to switch to `data-open/data-closed`-driven — the hand-rolled aside cannot get those two attributes, **the mechanism must change**,
three options: non-modal Dialog mechanism (recommended) / Drawer.Root / hand-attach data attributes (against ADR 0009 D1 `manual-mechanism retirement`
direction, not recommended).

### 3.6 Gap family E: Tooltip surface (product ruling)

- **41 native `title=`** (about 30 files; top: agent-detail-page 3, todo-detail-page / skills /
  secrets / mcp-servers / schedules / detail-overlays / chat-markdown 2 each) — unstyled, system delay,
  light/dark theme not following the repo; **e2e zero pins** (`getAttribute('title')` 0 hits repo-wide).
- **KbdHint** (`components/ui/kbd-hint.tsx`): hover/focus-visible pure-CSS floating chip
  (`[:is(:hover,:focus-visible)>&]` + visibility/opacity 120ms), aria-hidden (screen-reader semantics carried by the host
  control's aria-label); header states in writing: resting hidden via visibility is **the hotkeys.spec toBeHidden
  probe dependency**.
- `ui/kbd.tsx:15` already has the registry's `in-data-[slot=tooltip-content]:` variant — **dangling** (no in-repo
  tooltip-content slot; it only takes effect once the ui/tooltip component lands).

Official counterpart = Tooltip (Trigger+Portal+Positioner+Popup). Migrating or not is a **product ruling**: native
title is zero JS zero maintenance; a unified design language needs a new registry component + 41 per-surface changes + KbdHint mechanism migration (hotkeys.spec
probe rewrite). Default recommendation **no-migrate** (U6 only keeps the ruling question).

### 3.7 Gap family F: Collapsible family (low payoff, default not batched)

Four hand-rolled collapses, ARIA all correct (aria-expanded + persistence): sidebar group collapse (sidebar.tsx:117-187,
GROUP_STORAGE_KEYS localStorage persistence + chevron rotate + rail twin state), board #147 column-collapse family
(board.tsx:3), transcript row collapse (transcript.tsx:133-140), new-task-dialog project section
(new-task-dialog.tsx:369). The official Collapsible offers height animation + presence management; it only pays off if, under ADR 0009
direction B, repo-wide collapse unifies onto the shadcn default animation language — no such need now, boundary declared (U7 not scheduled).

### 3.8 Surfaces with an official counterpart but an existing in-repo ruling (no-migrate, recorded)

- **Toast = sonner**: `ui/toaster.tsx` header (#631) states in writing `shadcn's official toast implementation is sonner —
  this component is its official recipe adapted to this repo's shape` (theme mirror + popover-family skin slot + bottom-left offset for the drawer).
  Base UI Toast exists, but migrating = overturning #631 + interrupting #638 (26 toast.error wiring, in progress) —
  **pure churn, no-migrate**. The shadcn registry's toast canonical is sonner anyway, so it does not conflict with `shadcn components pulled in base shape`
  (spec 16 §3): that sentence constrains components whose registry has a base shape.
- **Segmented control = Tabs variant="segmented"** (XMON-103 canonical): already on Base UI Tabs, not a gap;
  the user-menu theme segment is a **repo-internal consistency** problem (two segment shapes coexisting), converged onto the canonical with U3, no new component needed.

### 3.9 Boundary declaration: no official drop-in or non-interactive semantics (no-migrate, reason per item)

| Surface | Reason |
|---|---|
| mention-picker content layer (`overlay/mention-picker.tsx`) | centered 400-width two-layer drill-in + multi-select accumulation + insert(N) footer — an **entity-selector dialog**, not input completion. Combobox/Autocomplete require the component to own an input, while mention's host is the external composer textarea (the picker "never touches the editor", header). The mechanism layer is already Base UI Dialog (FloatingShell). `mention-inline` (:365) same family. If the inner `search box + row table` wants typeahead later, Combobox can be evaluated locally, not batched |
| search-panel content layer | mechanism = DialogShell (official); result rows are content, no counterpart |
| chip-popover / dir-browser / new-task-discard content layers | ditto; dir-browser's **mechanism** is the OverlayMount old generation, assigned to the U4 retirement surface, the content layer (folder row table) is reasonably hand-rolled |
| hidden file input ×2 | `composer.tsx:148`, `new-task-dialog.tsx:440` — native-trigger standard pattern, Base UI has no counterpart |
| textarea ×8 | Base UI has no textarea component (shadcn Textarea is also a pure style shell); absorption is a spec 16 axis (pure style), not this axis |
| ClickCatcher | deliberate UX primitive (outside-click only closes the popover, does not pass through), floating-shell.tsx:14-17 states in writing `switching it is a UX change`. **Note**: when migrating to official Select/Menu, the official outside-press semantics = close the surface and the event continues to the layer below — each surface either accepts the official semantics (UX change, needs confirmation) or keeps the catcher layer. This is the per-surface ruling point for U2/U3, not a mechanical item |
| separator | `chip-popover-divider` etc. div+css, zero behavior semantics; official Separator exists but the componentization payoff ≈ 0 |
| ScrollArea | repo-wide no self-drawn scrollbar skin (detail.css:1036's only hit is a comment); native scroll is the status-quo ruling |
| Field / Form / Fieldset | the repo-wide only `<form>` = token-gate:71; forms mutate via JS not native submit; the hand-rolled dlg-form-* label pattern is enough. Official Field's payoff (hidden-input form participation / validate) has no current consumption scene |
| Radio / RadioGroup / Slider / NumberField / Meter / Progress / ContextMenu / Menubar / Toolbar / NavigationMenu / OtpField / PreviewCard / Autocomplete / Combobox | repo-wide no corresponding hand-rolled surface: `type="radio"/range/number` 0 hits, `onContextMenu` 0 hits, progress/meter 0 hits — N/A |

### 3.10 Dead files and hygiene surface

| File | Status | Suggested handling |
|---|---|---|
| `ui/button.tsx` + `ui/button.css` | **0 consumption sites** (dead file; only 3 in-repo comment mentions of the old variant lineage) | delete |
| `components/ui/dialog.tsx` | 0 consumption sites (dialog-shell connects to the primitive directly) | delete or keep as the registry re-pull base — a small in-batch ruling; 633afa37 just did an "orphaned primitive variants" cleanup, leaning delete |
| `components/ui/alert-dialog.tsx` | 0 consumption sites (alert-dialog-shell connects to the primitive directly) | ditto |
| `components/ui/dropdown-menu.tsx` | 0 consumption sites but **fully usable** | keep, enabled by U3 (more-menu) |
| `ui/README.md` | outdated (lists the deleted dialog-shell; `new code must use primitives` points at a layer already half retired) | rewritten to retirement-state notes with U0 |
| `ui/input.tsx` + `ui/chip.tsx` | 2 / 1 consumption sites each | delete after U5 absorption (input → components/ui/input; chip → tag-chip or keep-ruling) |
| `ui/dialog.css` | **alive** (.dlg-* per-face geometry canonical) | untouched (B1 caliber) |
| `overlay/use-esc.ts` | 1 consumption site (alert-dialog-shell) | retire after U4 verifies the Base UI layer stack equivalence |

## 4. Per-surface comparison table (official component × semantic equivalence × migration nature)

Migration nature four tiers: **mechanical** (structural swap, behavior semantics unchanged) / **pixel** (geometry canonical needs Positioner translation + per-surface
bbox comparison) / **UX ruling** (behavior semantics differ, needs confirmation) / **product ruling** (migrating or not is itself a product decision).

| Surface | Official component | Semantic equivalence judgment | Migration nature | Main blocker |
|---|---|---|---|---|
| Select primitive (7 instances) | Select | superset (keyboard/typeahead/positioning/scroll arrows all added); controlled value/onPick one-to-one mapping; unsetLabel clear row = a normal Item(value=null) | pixel + UX | the popup's default trigger overlay must be turned off; `flush-to-left expansion` translated to Positioner; ClickCatcher semantics (§3.9); 7 prefix-hook groups all kept (#411) |
| hand-rolled listbox siblings ×6 | Select | ditto; model-select-core row-projection law unchanged (#626 single source in core, shell migration does not touch it) | pixel + UX | the chief surface's `does not absorb shell` is a product ruling (model-select-core header) — migrating to the Select component ≠ unifying the shell, per-surface skin kept |
| plan-dropdown | Select (view-picker semantics) | equivalent; the `select-and-close law` = Select's native behavior | pixel | fixed coordinates → Positioner |
| more-menu | Menu (wrapper in repo) | superset (focus loop/typeahead/submenu); role=menu kept | pixel + UX | fixed capture coordinates → Positioner anchoring; disabled-row semantics (Ban-row conditional disable) mapped to Menu.Item disabled |
| user-menu | Popover or Menu | the panel contains nav Link rows + theme segment — Menu supports rendering item as Link; Popover fits the `content panel` reality better | pixel + UX | mechanism in sidebar (old generation), the popover anchor law v3 (#611 `clearance measured from the top of the trigger line box`) expressed via Positioner offset; 8 files/24 pin sites |
| theme segment (in user-menu) | Tabs-segmented canonical (in-repo) or ToggleGroup | not a view switch but a setting item — either works | mechanical | consistency ruling with the XMON-103 canonical |
| sched-form-overlay | Dialog (DialogShell family) | equivalent (centered modal popover) | pixel | self-drawn skin (8 css hits) merged into the .dlg family or kept per-face |
| chief-drawer | non-modal Dialog mechanism (official guidance) / Drawer.Root | official guidance verbatim assigns focused Dialog; no gesture need | pixel + UX | 35.5K single file; always-docked layout unchanged, only the enter/exit mechanism swaps; #656 tightly coupled (U4) |
| ui/checkbox | Checkbox | equivalent superset: hidden input gives the same form/screen-reader semantics, indeterminate fills the hand-rolled gap; the label-fallback aria-label kept | mechanical + pixel | e2e locating surface (real input → hidden input); the tile skin (square 18px white check) translated to the data-checked hook; checkbox-unified.spec assertion layer rewritten |
| filter-panel three-state row | Checkbox (indeterminate + parent optional) | official indeterminate first-class, the ref technique retires | mechanical | that surface has a comment with ruling tone (`free`) — migrating to the official is equally free, recommend migrate; if not, record as declared keep |
| branch-dialog knob | **Switch** (in-repo existing component) | the semantics are switch to begin with (knob shape) | mechanical | dlg-toggle css 5 hits retired; behavior pins through the merge/reject chain spec |
| tooltip surface | Tooltip | official = design-language unification + controllable delay/theme | **product ruling** | 41 per-surface + KbdHint mechanism (hotkeys.spec toBeHidden probe depends on the visibility technique) |
| collapsible family | Collapsible | hand-rolled ARIA already correct; official adds height animation/presence | product ruling (default no-migrate) | payoff is only mechanism unification |
| toaster | Toast | sonner = shadcn official recipe, already ruled (#631) | **no-migrate** | — |

## 5. Per-surface cost

### 5.1 Probe-surface status (establish the ruler first)

- `toHaveScreenshot` = **0** — this repo has no screenshot-comparison probe; the `pixel probe` entity = **bbox geometry assertions
  18 files** + **getBoundingClientRect assertions 21 files** (overlapping), plus the human eye-check surface of `docs/verify/` evidence PNGs
  (after a636fb09 evidence capture became opt-in, full runs no longer rewrite PNGs).
- Cross-cutting specs (every batch hits them): dead-buttons (28.9K, #222 `dead-button must not render` law), hotkeys (33.7K),
  escape-wiring, dialog-viewport, shell-consistency, shadcn-primitives, visual-polish, brand-typo.
- `title=` attribute e2e zero pins; the `dlg-viewport` class hook now 0 hits (spec 16-era 34 pin sites already digested by the
  B1/follow-up re-pins).

### 5.2 Per-surface cost table

| Surface | css size (lines/decl or hook hits) | e2e pins (files/sites) | geometry probe | est lane-day |
|---|---|---|---|---|
| Select primitive + siblings | select.css 81/44; surface-hook css hits ≈103 (ui-select 21 · sched-form 28 · agent-* 19 · prj-new-repo/gh 27 · prj-tasks 5 · chief-model 1 · new-task-project 1) | broad `-menu` hooks touch **21 files**; per-surface: project-new-repo 4/18 · newtask-project-select 2/5 · project-tasks-toolbar 1/8 · chief-drawer-model 1/4 · project-new-github 1/4 · sched-form-overlay 1/8 | agent-create-model ✓bbox · agent-detail ✓bbox · segmented-controls ✓ | **3** (split into 3 PRs) |
| more-menu | overlay.css hooks 19 | 3/7 | dead-buttons cross-cut | 0.5 |
| user-menu | detail.css `.user-menu` family | **8/24** | user-menu-trigger ✓bbox | 1 |
| chip-popover | overlays.css hooks 18 | 5/12 | chip-hotzone (rect geometry) | (with the mechanism family 0.5) |
| plan-dropdown | overlays.css hooks 12 | 2/9 | — | 0.5 |
| search-panel | overlays.css `.search-*` 9 | 6/12 | search-focus ✓bbox | mechanism already official, untouched |
| mention-picker | mention-picker.css **405/225** + hooks 32 | 1/1 (+inline 1/1) | mention-picker-center (rect-center pin) | boundary no-migrate; animation trails #656 |
| chief-drawer | chief.css **1100/591** (the domain css ≈ the drawer body) | 8/19 | chief-panel ✓bbox · chief-fab ✓bbox | 1.5 |
| sidebar (9 raw btn + group collapse) | board.css 183/84 + in-tsx Tailwind (RAIL_ROW family) | sidebar-nav / sidebar-seam (rect) / sidebar-visual (rect) / collapse-family 1/7 / hotkeys | ✓rect ×3 | 1 |
| filter-panel (6 btn + three-state 1) | Tailwind self-drawn (domain css hooks 0) | board-filter (rect, filter-dimension 1/5) | ✓rect | 0.5 |
| checkbox primitive | checkbox.css 45/25 | checkbox-unified 1/1 | ✓bbox | 0.5 |
| branch-dialog knob | ui/dialog.css `.dlg-toggle` 5 | class hooks 0 (behavior through the merge/reject chain) | — | 0.25 |
| sched-form-overlay | pages.css hooks 8 | 1/8 | — | 0.5 |
| dir-browser | pages.css hooks | **2/29** (project-new-dir-browser · project-new-fs-pick) | — | mechanism follows U4 |
| resources create dialogs (14 btn + 2 old input) | resources.css 706/362 (domain-shared) | provider-add-dialog · secret-add-dialog · machine-add-dialog · skills-write · provider-oauth | — | 1 |
| tooltip surface | 0 css (native title) + kbd-hint Tailwind | **0** | hotkeys toBeHidden (KbdHint mechanism) | 0 before ruling |
| toast (sonner) | shadcn.css skin slot | 2 files (agent-detail · composer-wire-reject) | — | no-migrate |
| dead-file cleanup | ui/button.css 59/28 etc. | 0 | 0 | 0.25 |

### 5.3 Motion surface (#656's ledger, for merge comparison)

`anim-*|overlay-mount|OverlayMount` consuming tsx now measured **17 files** (#656's ticket records 14, capture-time difference):
beyond the ticket's 14 (dialog-shell / floating-shell / select / search-panel / dismiss / more-menu /
new-task-dialog / mention-picker / chief-model-select / chief-drawer / schedules-page /
project-new-page / project-page / dir-browser), 3 added: **sidebar.tsx, alert-dialog-shell.tsx,
todo-detail-page.tsx**. `use-overlay-mount.ts` and `styles/motion.css` (207 lines) still exist;
ADR 0009's guardrail acceptance = these consumption points grep to zero + motion.css shrinks to the D4 kept surface.

## 6. Batch table + dependency order (U series)

The batch-slicing principle carries over from spec 16: **by domain + one acceptance**, not by directory. Each batch's acceptance = spec 16 §2 template's five items
(all switched to official components / the domain's e2e all green / zero pixel drift on the visual probes — re-pin locators per #411 caliber without changing assertions /
verify-pacman evidence archived to `docs/verify/<ticket>/` / un-migrated residual declaration) + each batch's extra items.
Concurrency discipline: at most 2 lanes (spec 16 B4 lesson); each lane a private E2E_PORT; each PR locally runs the full e2e
(83 specs, ~1.5min, cheap — the thing to guard is concurrent stepping-on-each-other, not duration).

| Batch | Content | Parallel | Dependency | Extra items |
|---|---|---|---|---|
| **U0 hygiene** | delete ui/button.tsx+css; idle-wrapper ruling (suggest delete dialog.tsx / alert-dialog.tsx, keep dropdown-menu for U3); ui/README.md rewritten to retirement state | parallel with U1 | none | zero behavior surface: three gates + full e2e = acceptance |
| **U1 Checkbox surface** | ui/checkbox → Base UI Checkbox (class hooks / id passthrough kept); branch-dialog knob → ui/switch; filter-panel three-state row migrated to indeterminate or declared keep (in-batch ruling) | 1 lane | none | checkbox-unified assertion-layer rewrite (locating surface); board-filter green; tile-skin pixel comparison |
| **U2 Select/listbox family** | U2a: select.tsx primitive swapped to Base UI Select (external API and prefix hooks unchanged, geometry law translated to Positioner); U2b: sibling surfaces absorbed or swapped per surface (prj-tasks / prj-new-repo / prj-new-gh / new-task-project / plan-dropdown / skills sort / chief-model-menu) | U2a serial first; U2b 2 lanes within the domain (pages+overlay ∥ chief) | U2a → U2b; ClickCatcher per-surface ruling (§3.9) | the heaviest-pinned surface (21 files touched); the in-repo geometry law `popup does not overlay the trigger` written into U2a acceptance; the model-select-core law untouched |
| **U3 Menu/popover mechanism family** | more-menu → enable dropdown-menu.tsx; user-menu → Popover/Menu + theme segment onto the XMON-103 canonical; sched-form-overlay → DialogShell family or keep self-drawn (in-batch ruling); **same lane incidentally absorbs each surface's anim-* → data-open/data-closed (#656 tail)** | can parallel with U2b off-domain | no hard dependency; shares lane with #656 | user-menu anchor law v3 (#611) Positioner expression; sidebar popover mechanism leaves the OverlayMount old generation |
| **U4 drawer + old-generation retirement (= #656 closing PR)** | chief-drawer mechanism three-way ruling (recommend non-modal Dialog); OverlayMount / use-overlay-mount.ts / use-esc.ts retire with their last consumer; motion.css shrinks to ADR 0009 D4 | 1 lane | **U3 complete** (old-generation consumers zeroed is the precondition); dir-browser / schedules / project-* mechanics already migrated with U2b/U3 | ADR 0009 guardrail acceptance: `anim-*|overlay-mount|OverlayMount` grep zero (current 17 files); spinner/hover-press/tab indicator the D4 kept surface values unchanged |
| **U5 raw-control ledger zero + spec 16 rebase** | resources create-* 14 btn + 2 old ui/input (old ui/ layer retirement: chip 1 site ruling); sidebar 9; filter-panel 6; spec 16 ledger write-back (§2 reconciliation table lands into that volume, or declares this map the new reading and spec 16 archived) | 2 lanes (resources ∥ board) + docs same lane | none | the #422 excluded-surface hanging ruling closes here; sidebar nav row Link vs Button shape ruling |
| **U6 Tooltip (ruling question)** | default no-migrate; if ruled migrate: ui/tooltip.tsx registry component + 41 per-surface + KbdHint mechanism migration + kbd.tsx dangling variant activated | — | user/product ruling | hotkeys.spec toBeHidden probe rewrite |
| **U7 Collapsible (declaration)** | default not batched; boundary declared (ARIA already correct) | — | — | — |

**Schedule suggestion** (lane-day total ≈ 9.5, 6 calendar days, including ruling waits):

| Day | lane 1 | lane 2 |
|---|---|---|
| D1 | U0 hygiene (half day) | U1 Checkbox surface |
| D2 | U2a Select primitive (serial first) | U1 finish / pixel comparison |
| D3 | U2b pages+overlay domain | U2b chief domain |
| D4 | U3 menu/popover mechanism family (#656 tail same lane) | U5 resources dialogs |
| D5 | U4 drawer + old-generation retirement (#656 closing PR) | U5 sidebar/filter-panel |
| D6 | spec 16 rebase (docs) + full regression | buffer / pixel recheck |

U6/U7 take no schedule, awaiting ruling.

## 7. Relationship-question conclusion: B3/B4 × #656 × Base UI gaps, merged or separate

**Fact one: the `merge into B3/B4` question's premise already expired.** spec 16's B3/B4 structural surfaces have been landed by XMON-23/24/25/
72/75 (§2 reconciliation), so B3/B4 as `not-started future batches` no longer exist; their residuals (resources excluded surface,
sidebar 9 sites) are raw-control ledger items, absorbed by U5. So the Base UI gaps do not need `merging with B3/B4` — the only object left to merge
with is #656.

**Fact two: #656's schedule premise likewise expired, and its file set heavily overlaps this map's gap surfaces.** #656 (with ADR 0009
D5) wrote its schedule shape as `woven into spec 16's B3/B4 per-domain batches` — but B3/B4's structural switch landed before it was even filed,
the weave-in target does not exist; what actually remains is one **per-domain motion-mechanism path** (17 tsx), which with this map's Select family /
Menu family / drawer / OverlayMount old generation is almost the same file list (overlap 14/17).

**Fact three: switching to the official Base UI component automatically completes #656's mechanism goal.** The official components (Select/Menu/Dialog/Popover)
ship `data-open/data-closed` with the shadcn default animation values (the in-repo dropdown-menu.tsx wrapper's Popup
class string is exactly the new-canonical shape ADR 0009 retro-ratified); conversely if #656 goes first and changes anim-* into
animate-in/out + hand-attached data attributes on the hand-rolled shell, then U2/U3 swap the hand-rolled shell for the official component — **the same surface two structural changes,
two pixel verifications, two full e2e runs**, and the intermediate state (hand-rolled shell + official animation classes) is a transitional shape to be immediately overturned.

**Conclusion: merge at the execution layer, separate at the ticket layer.**

- **The overlapping surfaces (Select family, Menu/popover family, drawer, OverlayMount retirement) form one `per-domain mechanism closure`
  path**: each domain's PR does in one pass `structural swap to the official component + animation onto data-open/data-closed + the domain's anim-* zeroed`,
  one acceptance (spec 16 §2 template + ADR 0009 guardrail grep). Maps to U2b / U3 / U4; #656's closing PR = U4
  (motion.css shrink + use-overlay-mount.ts deletion + consumption-point zero), and #656's ticket is suggested to be expanded or re-linked along the U series
  (**this is a schedule-shape adjustment to an already-ruled execution ticket, left to the user to decide**).
- **Non-overlapping surfaces go separately**: U1 (checkbox, no animation overlap), U5 (raw-control ledger + spec 16 rebase, purely structural),
  U0 (hygiene), U6/U7 (ruling surfaces) have no file overlap with #656, independent batches, no waiting.
- **Order guardrails**: U2a (Select primitive) serial first — it is the common base of the 7 consumption instances + siblings; U4 must
  come after U3 (the OverlayMount last-consumer zero is the precondition for deleting the mechanism).

## 8. Ticket draft (if map tickets are cut)

Converge into 4 execution tickets + 1 ruling ticket by the rule `same block of work, same batch of verification = one ticket`; every ticket's acceptance contains spec 16 §2's
five-template items + this map's corresponding-section extra items; the ticket scope follows this map's file:line lists (re-run
§9 capture against the then-current main before starting, mark baseline drift in place).

1. **U-A `web: Base UI coverage — checkbox face + dead-primitive hygiene`**
   Scope: §3.3 three surfaces + §3.10 dead-file list. Acceptance: checkbox-unified / board-filter / merge-reject chain green;
   ui/button deletion three gates green; bbox pixel comparison zero drift; evidence `docs/verify/<ticket>/`. Dependency: none.
2. **U-B `web: Base UI coverage — select/listbox family onto official Select`**
   Scope: §3.2 whole family (primitive core swap + 6 siblings + cascade regression). Split into 2-3 PRs (U2a serial first). Acceptance:
   the 21 specs touching `-menu` hooks all green with unchanged assertions (#411); 7 prefix-hook groups output verbatim;
   ClickCatcher per-surface rulings recorded in PR bodies; agent-create-model / agent-detail / segmented-controls
   bbox zero drift. Dependency: independent of U-A, may parallel; the ClickCatcher semantic ruling.
3. **U-C `web: menu/popover/drawer mechanism convergence + motion batch tail (#656)`**
   Scope: §3.4 + §3.5 + §5.3 (including #656's 17-file motion ledger). Acceptance: the dropdown-menu wrapper has consumption sites;
   `anim-*|overlay-mount|OverlayMount` grep zero; motion.css shrinks to ADR 0009 D4;
   use-overlay-mount.ts / use-esc.ts deleted; hotkeys / escape-wiring / user-menu 8 files 24 sites /
   chief-drawer 8 files 19 sites pins all green. Dependency: U-B (the Select family leaves the old mechanism first); **the #656 ticket adjustment needs
   user confirmation**.
4. **U-D `web: raw-control ledger closure + spec 16 rebase`**
   Scope: the spec 16-axis portion of §1.2 corrected ledger's 60 net sites (resources 14 + sidebar 9 + filter-panel 6 +
   old ui/ layer 3 consumption sites) + spec 16 ledger write-back (§2 reconciliation table). Acceptance: the corrected-caliber census zeroes outside the boundary-declared surfaces
   (textarea/file-input/ClickCatcher); spec 16 consistent with the tree; the #422 hanging-ruling closure recorded.
5. **U-E `web: tooltip unification — product decision`** (ruling ticket, default no-migrate)
   Material: §3.6 (41 title= / KbdHint mechanism / kbd.tsx dangling variant / e2e zero pins) + §4 row.
   Output: migrate (new ui/tooltip + per-surface + probe rewrite) or declare the boundary (record into this map's §3.9).

## 9. Capture commands (all re-runnable)

```sh
# Corrected raw-control ledger (§1.2) — 71 after comment strip; the script's raw value 75 includes 4 comment texts
node scripts/count-raw-controls.mjs   # script raw value
grep -rn '<button\|<input\|<select\|<textarea' apps/web/src --include='*.tsx' \
  | grep -vE ':[0-9]+:\s*(//|\*|/\*)' | grep -vE '\{/\*'   # corrected caliber (71)

# Base UI consumption surface (§3.1)
grep -rn "@base-ui/react" apps/web/src --include='*.tsx'
# per-component consumption file count (new primitives; old primitives use the from '(\.\./)+ui/<p>\.js' shape)
grep -rlE "components/ui/<p>\.js'|from '\./<p>\.js'|from '\./ui/<p>\.js'" apps/web/src --include='*.tsx'

# installed official component directory (§1.4, main-checkout pnpm artifact path)
ls <repo>/node_modules/.pnpm/@base-ui+react@1.8.0_*/node_modules/@base-ui/react/

# domain css size (§2 table)
find apps/web/src -name '*.css' | sort | while read f; do \
  printf "%-46s %5s lines %5s decl\n" "${f#apps/web/src/}" "$(wc -l < "$f")" \
  "$(grep -cE '^[[:space:]]*[-a-zA-Z]+[[:space:]]*:.*;' "$f")"; done

# popover-family mechanism generations (§3.4)
grep -rln "floating-shell.js'" apps/web/src --include='*.tsx'      # transition generation 8
grep -rln "from '.*dismiss.js'" apps/web/src --include='*.tsx'     # ClickCatcher 15
grep -rln 'anim-\|overlay-mount\|OverlayMount' apps/web/src --include='*.tsx'  # motion ledger 17

# e2e pins (§5)
ls apps/web/e2e/*.spec.ts | wc -l                                  # 83
grep -rln 'toHaveScreenshot' apps/web/e2e/ | wc -l                 # 0
grep -rln 'boundingBox' apps/web/e2e/ | wc -l                      # 18
grep -rln 'getBoundingClientRect' apps/web/e2e/ | wc -l            # 21
grep -rl -- '<surface-hook>' apps/web/e2e/ | wc -l                 # per-surface (§5.2 table listed values)

# Base UI semantic sources (§4): Context7 /websites/base-ui_react three checks —
#   checkbox.md (span+hidden input / indeterminate / parent+allValues / name/value/uncheckedValue/form)
#   select.md (component-family anatomy / items / typeahead-only / popup default overlays trigger / Combobox guidance) + handbook/forms.md (Field hidden input)
#   dialog.md usage guidance (edge panel without gesture = positioned Dialog) + drawer.md (modal=false + disablePointerDismissal)
```