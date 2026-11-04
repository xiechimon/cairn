# 22 · Color and Geometry Token Scale Canonical Table (#912)

> **superseded-in-part (2026-10-07, ADR 0012 / #980)**: this volume is partially replaced by the nine rulings of "component form aligned with the shadcn official site"; the original text is kept wholesale as the historical ledger, not deleted. Voided surfaces: ① §2.5 / §2.6 component-level geometry canon (the Button tier table / Input square corners / Switch expansion port / override 1–7) — the `components/ui/` geometry takes the registry upstream default as canon, local deviations return to official per the #982 rulings (square corners back to `rounded-lg`, the Button focus ring back to the official ring shape, the brand tier revoked, the tabs handwritten tier revoked; h-8 = 32px measured as the upstream default, kept; override 1's 36px retirement conclusion unaffected); ② §1.7 / §1.8's per-slot C · paper-orchid value measurement tables — the finalized palette already re-selected as **E · Ash Rose** (#988 live review), the value canon switches to the frozen copy `apps/web/e2e/palette-e.css` @ `eaec9481` (branch `ui/988-palette-reselect`, not merged to main), E value-flipping and re-measurement go to the #991 batch table; the 109-slot set per the #987 convergence ruling (7 dead · 30 merged · 72 kept + radius), after convergence execution the slot set is as #991 lands; the `--radius` base 0.875rem → official 0.625rem (the multiplier family verbatim unchanged, calc follows automatically); ③ §5.2 chip five-state's sm geometry tier — StatusChip rewritten as a #983 zero-skin adapter layer, the sm tier deleted, `data-tone` + the five pairs of `--chip-*` token slots kept (the ten-slot conditional ruling sees #987 §3.4-E); ④ the header's "palette canon palette-c.css" "upstream canon ADR 0010 D1/D2, #909 C · paper-orchid" pointers — demoted to historical reference, the new caliber source of truth = ADR 0012 + #987 (convergence table) + #988 (E finalized). §3's carrier rule (hex/rgb forbid oklch, token classes first, forbid new per-face CSS) and §1.1's "slots unchanged, only values flip" inheritance law **remain in effect**. New caliber source of truth: `docs/adr/0012-align-with-official-form-keep-baseui-no-handwritten-styles-hue-e-final.md`.

> Status: **ruled and in effect** (2026-10-05, #912 wayfinder task output). This volume is the sole data-source of truth for the per-domain construction tickets — each domain batch (#913 batch table v2) only consumes, never rules on its own; color-value flipping and dual-mode finalization (#915) and probe re-pinning (#921) all take this volume + the #909 finalized palette as authoritative. The palette source of truth is now the frozen copy `apps/web/e2e/palette-c.css` (the t-0909 sandbox retired by #953 per the #908 fog rule, see §0).
> Upstream canon: ADR 0010 (D1 hue re-selection / D2 free geometry redesign / D5.4 hex/rgb notation contract), the #909 ruling (C · paper-orchid finalized, palette canon c.css @ `7340d0ab`), the #910 ruling (pinning-caliber five rulings).
> Data source: color and geometry values all from `apps/web/e2e/palette-c.css` (the #909 finalized palette's frozen byte-level copy, sha1 `beb289f6…`, byte-for-byte identical to c.css @ `7340d0ab` and the main landing `144698cb`); contrast measured pair by pair (not estimated) by `apps/web/e2e/measure-912.mjs` per the WCAG 2.1 luminance ratio, the algorithm byte-for-byte same-sourced as the #909 canon generator `gen-palettes.mjs`, and reconciled pair by pair with the sandbox-era `reports/contrast.md` (reconciliation record `docs/verify/915/`). The #912-era machine-readable measured original lives in main history with the sandbox (`144698cb:library/t-0909/reports/token-scale-912.json`); the finalization-era re-run products land in `docs/verify/953/`.

## 0. Landing Spot and Canonical Status

This volume lands at `docs/spec/22`, reasons:

- `docs/spec/` is the repo's only numbered canonical sequence (00–21), the token-scale canonical table is a reference source of truth long consumed by batches (#913), value flipping (#915) and probes (#921), belonging to the canonical sequence rather than a sandbox product.
- `library/t-0909/` is the #909 prototype sandbox, its retirement timing already listed in #908 fog (retire wholesale after each domain construction ticket absorbs the finalized version). **The retirement was executed by #953**: the sandbox directory deleted from the worktree, all 150 files still recoverable from main history (landing `144698cb`, incl. gen-palettes.mjs and the A/B direction drafts — the "change-of-face regret" fallback path in ADR 0010 still holds per this; `7340d0ab` itself is a pre-squash branch commit, not a main ancestor, content takes `144698cb` as authoritative, the two c.css byte-for-byte identical, verified). A two-piece set moved to the permanent tool surface: `measure-912.mjs` (this appendix's rule) and `palette-c.css` (the c.css frozen copy, ADR 0010 D1's data source continues to be carried by it).
- Numbering follows main's tail +1 at merge time (collision discipline same rule as drizzle migration): if a parallel lane lands volume 22 first, this volume renumbers to the new tail, references updated in sync.

This volume governs "each token's canonical value and measured evidence", not construction order (in #913), not the pinning carrier (in #910 / ADR 0010 D5). Where values conflict with spec/16's old caliber, this volume wins (spec/16 already marked superseded-in-part).

## 1. Color: c.css → shadcn.css Slot Mapping

### 1.1 Architecture conclusion: slots unchanged, only values flip

A name-level diff measured 111 color slots, **0 added, 0 retired** — the finalized palette c.css is a 1:1 value replacement of the #787/#813 slot architecture, confirming ADR 0010 D1's "what flips is the values inside the slots, not the slots". #915's value-flip execution is therefore **pure value replacement**: move each color slot's held value in `shadcn.css`'s `:root` (dark) and `.light` (light) to the c.css corresponding value, the slot names and the `@theme inline` Tailwind mapping (`--color-*`) zero change.

- **Flips**: dark 107 slots, light 103 slots take new values (incl. the six coalesced alias slots `--surface-inset`/`--card-bg`/`--popover-bg`/`--text-primary`/`--code-bg`/`--danger`, whose values flip together with the canonical slot they directly reference).
- **Unchanged**: dark 2 slots, light 6 slots — theme-constant values (`--overlay-scrim` `rgb(0 0 0 / 0.6)`, `--text-on-veil` white; the light side also has `--primary-foreground`/`--destructive-foreground`/`--text-on-accent`/`--spot-disabled-fg` exactly equal to the current value). Unchanged ≠ no flip needed, it is the finalized value exactly equal to the current value.
- **Retirement candidate**: 2 slots (`--toggle-track`/`--toggle-knob`) — invisible to a name-level diff (both files have them), but their only consumer is the per-face CSS handwritten toggle zeroed by D3 (see §1.6). **Retired**: #952 deleted the two slots from shadcn.css (the execution point of the §4-2 ruling).

### 1.2 Measurement method

- Algorithm: the WCAG 2.1 relative luminance ratio `(Lhi+0.05)/(Llo+0.05)`, sRGB channels. Same-sourced as #909's `gen-palettes.mjs`; `color-mix(in srgb, …)` and semi-transparent `rgb(… / α)` are resolved per the browser compositing rule then quantized to 8-bit integer channels before measuring (consistent with rendered pixels).
- Thresholds: `text` 4.5 (body AA) / `ui` 3 (UI components and graphical objects, WCAG 1.4.11) / `hairline` 1.5 (the distinguishable hairline floor) / `info` report-only (soft hairlines, decoration dots, disabled states, semi-transparent tints, retirement candidates — not AA-gated).
- Role pairs: each slot measured against "the background it actually renders on" (the better-colors discipline), not uniformly against the page background. Semi-transparent overlays (sidebar/seg hover, accent/danger-soft, scrim) first composited onto the real base color before measuring.
- Result: all AA-gated pairs (text/ui) in both modes pass — dark 88 pairs min 3.46:1 (`--menu-icon` on popover), light 88 pairs min 3.05:1 (`--ring`/`--text-dim` on background). **0 gated pairs fail.**

### 1.3 report-only family explanation

The 21 report-only slots are not AA-gated, reasons fall into four classes:

- **Soft hairline** (`--border`/`--border-default`/`--card-border`/`--overlay-divider`/`--dialog-ring`/`--range-chip-border`/`--dash-border`): the finalized version deliberately uses low-contrast soft separators (dark ≈1.2:1, light ≈1.1:1), a structural hint not a "distinguishable boundary"; distinguishable boundaries are carried by `--border-strong`/`--input` (1.5-gated, dark 1.56 / light 1.52 pass). WCAG 1.4.11 only constrains "visual information necessary to understand the content", soft separators are not that.
- **Decoration dot** (`--col-dot-confirm`): the confirm-column dot is decorative redundancy, semantics carried by the text label, same shape as #909's report-only.
- **Disabled state** (`--spot-disabled`/`--spot-disabled-fg`/`--primary-disabled`): disabled states are not accepted per 4.5, only require distinguishability (along the #787 P0 caliber).
- **Semi-transparent tint** (`--sidebar-hover`/`--sidebar-active`/`--seg-hover`/`--accent-soft`/`--danger-soft`/`--drop-tint-base`/`--drop-tint-hover`/`--overlay-scrim`): interaction-state light tints and the scrim, composited over underlying content and vary with content, no single AA pair.

### 1.4 Flip execution caliber (for #915)

- The value source of truth = the "New value (c.css finalized)" column of this volume's §1.7/§1.8 tables; #915 when flipping moves c.css's held values into shadcn.css by slot, must not hand-type or re-copy hex from this volume's tables (this volume's tables are measured evidence, c.css is the value source of truth).
- Notation contract: hex/rgb only, forbid oklch (ADR 0010 D5.4, see §3.2). c.css measured all hex/rgb zero oklch, naturally compatible.
- The six P0 semantic slots (`--spot-soft`/`--accent-soft`/`--danger-soft`/`--spot-text-on-tint`/`--spot-disabled`/`--spot-disabled-fg`) keep the `color-mix` formula shape unchanged, the mix source `--card-button` follows automatically after flipping (#787 formula inheritance) — #915 only flips `--spot-text-on-tint`'s actual value and the `--card-button` source, the formula slots zero change.

### 1.5 Component-surface measured (real shadcn components consume multiple slots, measured rendering pairs)

#### Dark

| Component surface | Role pair (fg on bg) | Measured | Threshold | Result | Note |
| --- | --- | --- | --- | --- | --- |
| Switch — unchecked (OFF) | `--foreground on --input` | 9.08:1 | 3 | PASS | thumb on track; OFF track = --input (dark renders bg-input/80 over surface) |
| Switch — checked (ON) | `--primary-foreground on --primary` | 14.17:1 | 3 | PASS | thumb on track |
| Switch — track state flip | `--input on --primary` | 9.08:1 | 3 | PASS | OFF→ON track color = primary state carrier (WCAG 1.4.11) |
| Input — border on page bg | `--input on --background` | 1.56:1 | 1.5 | PASS | field boundary hairline (state also carried by focus ring) |
| Button brand — label on fill | `--text-on-accent on --card-button` | 8.24:1 | 4.5 | PASS | brand solid-fill label |

#### Light

| Component surface | Role pair (fg on bg) | Measured | Threshold | Result | Note |
| --- | --- | --- | --- | --- | --- |
| Switch — unchecked (OFF) | `--background on --input` | 1.52:1 | 3 | below 3 | thumb on track; OFF track = --input (dark renders bg-input/80 over surface) |
| Switch — checked (ON) | `--background on --primary` | 16.71:1 | 3 | PASS | thumb on track |
| Switch — track state flip | `--input on --primary` | 11.03:1 | 3 | PASS | OFF→ON track color = primary state carrier (WCAG 1.4.11) |
| Input — border on page bg | `--input on --background` | 1.52:1 | 1.5 | PASS | field boundary hairline (state also carried by focus ring) |
| Button brand — label on fill | `--text-on-accent on --card-button` | 7.41:1 | 4.5 | PASS | brand solid-fill label |

### 1.6 Retirement candidates (invisible to a name-level diff, consumers orphaned by the D3 per-face zeroing) — retired (#952 deleted the slots)

- `--toggle-track`: only consumer = detail/overlays.css .dlg-toggle (per-face, D3-zeroed) → shadcn Switch
- `--toggle-knob`: only consumers = .dlg-toggle-knob + secondary.css (per-face, D3-zeroed) → shadcn Switch

Execution record: both slots deleted from `shadcn.css`'s dark/light two sections in #952 (whole-repo grep consumption points = 0, excluding historical evidence archives under docs/verify); the "retirement candidate" status bit in the §1.7/§1.8 tables is the measured record at the #915 flip time point, kept as-is.

### 1.7 Dark per-slot mapping and measurement

| Slot | Status | Old value (shadcn current) | New value (c.css finalized) | Role pair (fg on bg) | Measured | Threshold | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--background` | Flips | `#17171a` | `#1e1b16` | `--foreground on --background` | 14.17:1 | 4.5 | PASS |
| `--foreground` | Flips | `#eae8ee` | `#ede9e1` | `--foreground on --background` | 14.17:1 | 4.5 | PASS |
| `--card` | Flips | `#1e1e22` | `#25221d` | `--card-foreground on --card` | 13.09:1 | 4.5 | PASS |
| `--card-foreground` | Flips | `#eae8ee` | `#ede9e1` | `--card-foreground on --card` | 13.09:1 | 4.5 | PASS |
| `--popover` | Flips | `#1e1e22` | `#25221d` | `--popover-foreground on --popover` | 13.09:1 | 4.5 | PASS |
| `--popover-foreground` | Flips | `#eae8ee` | `#ede9e1` | `--popover-foreground on --popover` | 13.09:1 | 4.5 | PASS |
| `--primary` | Flips | `#e5e5e5` | `#ede9e1` | `--primary-foreground on --primary` | 14.17:1 | 4.5 | PASS |
| `--primary-foreground` | Flips | `#171717` | `#1e1b16` | `--primary-foreground on --primary` | 14.17:1 | 4.5 | PASS |
| `--secondary` | Flips | `#26262b` | `#2d2a24` | `--secondary-foreground on --secondary` | 11.81:1 | 4.5 | PASS |
| `--secondary-foreground` | Flips | `#eae8ee` | `#ede9e1` | `--secondary-foreground on --secondary` | 11.81:1 | 4.5 | PASS |
| `--muted` | Flips | `#26262b` | `#2d2a24` | `--muted-foreground on --muted` | 6.55:1 | 4.5 | PASS |
| `--muted-foreground` | Flips | `#b0afb6` | `#b3afa8` | `--muted-foreground on --background` | 7.86:1 | 4.5 | PASS |
| `--accent` | Flips | `#26262b` | `#2d2a24` | `--accent-foreground on --accent` | 11.81:1 | 4.5 | PASS |
| `--accent-foreground` | Flips | `#eae8ee` | `#ede9e1` | `--accent-foreground on --accent` | 11.81:1 | 4.5 | PASS |
| `--destructive` | Flips | `#e05a5a` | `#ffaab9` | `--destructive-foreground on --destructive` | 7.52:1 | 4.5 | PASS |
| `--destructive-foreground` | Flips | `#17171a` | `#47242b` | `--destructive-foreground on --destructive` | 7.52:1 | 4.5 | PASS |
| `--border` | Flips | `#26262b` | `#2d2a24` | `--border on --background` | 1.2:1 | — | report-only |
| `--input` | Flips | `#35353d` | `#3f3c36` | `--input on --background` | 1.56:1 | 1.5 | PASS |
| `--ring` | Flips | `#908f96` | `#928f88` | `--ring on --background` | 5.32:1 | 3 | PASS |
| `--column` | Flips | `#17171a` | `#1e1b16` | `--foreground on --column` | 14.17:1 | 4.5 | PASS |
| `--col-bg` | Flips | `#17171a` | `#1e1b16` | `--foreground on --col-bg` | 14.17:1 | 4.5 | PASS |
| `--col-head-text` | Flips | `#cdccd2` | `#d3cfc7` | `--col-head-text on --col-bg` | 11.05:1 | 4.5 | PASS |
| `--sidebar-hover` | Flips | `rgb(255 255 255 / 0.05)` | `rgb(255 252 248 / 0.05)` | `--sidebar-hover on --surface` | 1.16:1 | — | report-only |
| `--sidebar-active` | Flips | `rgb(255 255 255 / 0.1)` | `rgb(255 252 248 / 0.1)` | `--sidebar-active on --surface` | 1.36:1 | — | report-only |
| `--surface` | Flips | `#1e1e22` | `#25221d` | `--foreground on --surface` | 13.09:1 | 4.5 | PASS |
| `--surface-secondary` | Flips | `#26262b` | `#2d2a24` | `--foreground on --surface-secondary` | 11.81:1 | 4.5 | PASS |
| `--surface-tertiary` | Flips | `#35353d` | `#3f3c36` | `--foreground on --surface-tertiary` | 9.08:1 | 4.5 | PASS |
| `--surface-elevated` | Flips | `#1e1e22` | `#25221d` | `--foreground on --surface-elevated` | 13.09:1 | 4.5 | PASS |
| `--surface-hover` | Flips | `#26262b` | `#2d2a24` | `--foreground on --surface-hover` | 11.81:1 | 4.5 | PASS |
| `--surface-press` | Flips | `#35353d` | `#3f3c36` | `--foreground on --surface-press` | 9.08:1 | 4.5 | PASS |
| `--text-secondary` | Flips | `#cdccd2` | `#d3cfc7` | `--text-secondary on --background` | 11.05:1 | 4.5 | PASS |
| `--text-tertiary` | Flips | `#b0afb6` | `#b3afa8` | `--text-tertiary on --background` | 7.86:1 | 4.5 | PASS |
| `--text-dim` | Flips | `#908f96` | `#79756f` | `--text-dim on --background` | 3.75:1 | 3 | PASS |
| `--border-default` | Flips | `#26262b` | `#2d2a24` | `--border-default on --background` | 1.2:1 | — | report-only |
| `--border-strong` | Flips | `#35353d` | `#3f3c36` | `--border-strong on --background` | 1.56:1 | 1.5 | PASS |
| `--card-button` | Flips | `#cba6f7` | `#d89cfc` | `--text-on-accent on --card-button` | 8.24:1 | 4.5 | PASS |
| `--text-on-accent` | Flips | `#17171a` | `#1e1b16` | `--text-on-accent on --card-button` | 8.24:1 | 4.5 | PASS |
| `--focus-ring` | Flips | `#cba6f7` | `#d89cfc` | `--focus-ring on --background` | 8.24:1 | 3 | PASS |
| `--col-dot-idle` | Flips | `#9ea3ae` | `#c0b8aa` | `--col-dot-idle on --background` | 8.73:1 | 3 | PASS |
| `--col-dot-confirm` | Flips | `#e9a23b` | `#eea953` | `--col-dot-confirm on --background` | 8.53:1 | — | report-only |
| `--col-dot-building` | Flips | `#4e81ee` | `#59c5ff` | `--col-dot-building on --background` | 8.87:1 | 3 | PASS |
| `--col-dot-done` | Flips | `#5ec26a` | `#73d18f` | `--col-dot-done on --background` | 9.19:1 | 3 | PASS |
| `--badge-attention` | Flips | `#e9a23b` | `#eea953` | `--badge-attention-fg on --badge-attention` | 6.59:1 | 4.5 | PASS |
| `--badge-attention-fg` | Flips | `#17171a` | `#422b0d` | `--badge-attention-fg on --badge-attention` | 6.59:1 | 4.5 | PASS |
| `--badge-done` | Flips | `#5ec26a` | `#73d18f` | `--badge-done on --background` | 9.19:1 | 3 | PASS |
| `--badge-idle` | Flips | `#9ea3ae` | `#c0b8aa` | `--badge-idle on --background` | 8.73:1 | 3 | PASS |
| `--project-avatar-bg` | Flips | `#e97b35` | `#ff9b78` | `--project-avatar-fg on --project-avatar-bg` | 6.55:1 | 4.5 | PASS |
| `--project-avatar-fg` | Flips | `#ffffff` | `#47261a` | `--project-avatar-fg on --project-avatar-bg` | 6.55:1 | 4.5 | PASS |
| `--agent-avatar-bg` | Flips | `#26262b` | `#2d2a24` | `--foreground on --agent-avatar-bg` | 11.81:1 | 4.5 | PASS |
| `--chip-idle-bg` | Flips | `#26262b` | `#2d2a24` | `--chip-idle-fg on --chip-idle-bg` | 6.55:1 | 4.5 | PASS |
| `--chip-idle-fg` | Flips | `#9ea3ae` | `#b3afa8` | `--chip-idle-fg on --chip-idle-bg` | 6.55:1 | 4.5 | PASS |
| `--chip-plan-bg` | Flips | `#363140` | `#3e333c` | `--chip-plan-fg on --chip-plan-bg` | 6.74:1 | 4.5 | PASS |
| `--chip-plan-fg` | Flips | `#cba6f7` | `#e0afff` | `--chip-plan-fg on --chip-plan-bg` | 6.74:1 | 4.5 | PASS |
| `--chip-confirm-bg` | Flips | `#33221b` | `#422b0d` | `--chip-confirm-fg on --chip-confirm-bg` | 7.6:1 | 4.5 | PASS |
| `--chip-confirm-fg` | Flips | `#f2c24b` | `#f4b973` | `--chip-confirm-fg on --chip-confirm-bg` | 7.6:1 | 4.5 | PASS |
| `--chip-done-bg` | Flips | `#14291c` | `#193822` | `--chip-done-fg on --chip-done-bg` | 7.84:1 | 4.5 | PASS |
| `--chip-done-fg` | Flips | `#5ec26a` | `#8ddba2` | `--chip-done-fg on --chip-done-bg` | 7.84:1 | 4.5 | PASS |
| `--chip-failed-bg` | Flips | `#351c1a` | `#47242b` | `--chip-failed-fg on --chip-failed-bg` | 7.52:1 | 4.5 | PASS |
| `--chip-failed-fg` | Flips | `#dd524c` | `#ffaab9` | `--chip-failed-fg on --chip-failed-bg` | 7.52:1 | 4.5 | PASS |
| `--fail-fg` | Flips | `#d98b4a` | `#ffaf94` | `--fail-fg on --card` | 8.91:1 | 4.5 | PASS |
| `--seg-active` | Flips | `#35353d` | `#3f3c36` | `--foreground on --seg-active` | 9.08:1 | 4.5 | PASS |
| `--seg-hover` | Flips | `rgb(255 255 255 / 0.05)` | `rgb(255 252 248 / 0.05)` | `--seg-hover on --surface` | 1.16:1 | — | report-only |
| `--tab-chip-bg` | Flips | `#1e1e22` | `#25221d` | `--foreground on --tab-chip-bg` | 13.09:1 | 4.5 | PASS |
| `--stop` | Flips | `#dd524c` | `#ffaab9` | `--stop on --background` | 9.56:1 | 3 | PASS |
| `--diff-add-bg` | Flips | `#16281d` | `#193822` | `--diff-add-fg on --diff-add-bg` | 6:1 | 4.5 | PASS |
| `--diff-add-fg` | Flips | `#478266` | `#66c483` | `--diff-add-fg on --diff-add-bg` | 6:1 | 4.5 | PASS |
| `--diff-del-bg` | Flips | `#2e1c1a` | `#47242b` | `--destructive on --diff-del-bg` | 7.52:1 | 4.5 | PASS |
| `--dialog-bg` | Flips | `#1e1e22` | `#25221d` | `--foreground on --dialog-bg` | 13.09:1 | 4.5 | PASS |
| `--dialog-box-bg` | Flips | `#1e1e22` | `#25221d` | `--foreground on --dialog-box-bg` | 13.09:1 | 4.5 | PASS |
| `--dialog-row-bg` | Flips | `#26262b` | `#2d2a24` | `--foreground on --dialog-row-bg` | 11.81:1 | 4.5 | PASS |
| `--dialog-ring` | Flips | `#35353d` | `#3f3c36` | `--dialog-ring on --dialog-bg` | 1.44:1 | — | report-only |
| `--range-chip-bg` | Flips | `#26262b` | `#2d2a24` | `--foreground on --range-chip-bg` | 11.81:1 | 4.5 | PASS |
| `--range-chip-border` | Flips | `#35353d` | `#3f3c36` | `--range-chip-border on --range-chip-bg` | 1.3:1 | — | report-only |
| `--toggle-track` | Retirement candidate | `#35353d` | `#3f3c36` | `--toggle-knob on --toggle-track` | 10.99:1 | — | report-only |
| `--tile-orange-bg` | Flips | `#33221b` | `#422b0d` | `--tile-orange-fg on --tile-orange-bg` | 7.6:1 | 4.5 | PASS |
| `--tile-orange-fg` | Flips | `#f2c24b` | `#f4b973` | `--tile-orange-fg on --tile-orange-bg` | 7.6:1 | 4.5 | PASS |
| `--tile-indigo-bg` | Flips | `#363140` | `#3e333c` | `--tile-indigo-fg on --tile-indigo-bg` | 6.74:1 | 4.5 | PASS |
| `--tile-indigo-fg` | Flips | `#cba6f7` | `#e0afff` | `--tile-indigo-fg on --tile-indigo-bg` | 6.74:1 | 4.5 | PASS |
| `--tile-hero-bg` | Flips | `#33221b` | `#422b0d` | `--foreground on --tile-hero-bg` | 10.96:1 | 4.5 | PASS |
| `--pill-idle-bg` | Flips | `#26262b` | `#2d2a24` | `--foreground on --pill-idle-bg` | 11.81:1 | 4.5 | PASS |
| `--dash-border` | Flips | `#35353d` | `#3f3c36` | `--dash-border on --surface` | 1.44:1 | — | report-only |
| `--row-selected` | Flips | `#26262b` | `#2d2a24` | `--foreground on --row-selected` | 11.81:1 | 4.5 | PASS |
| `--row-icon-bg` | Flips | `#35353d` | `#3f3c36` | `--foreground on --row-icon-bg` | 9.08:1 | 4.5 | PASS |
| `--overlay-divider` | Flips | `#26262b` | `#2d2a24` | `--overlay-divider on --popover` | 1.11:1 | — | report-only |
| `--overlay-select-indigo` | Flips | `#363140` | `#3e333c` | `--spot-text-on-tint on --overlay-select-indigo` | 6.74:1 | 4.5 | PASS |
| `--pick-selected-bg` | Flips | `#363140` | `#3e333c` | `--pick-selected-fg on --pick-selected-bg` | 6.74:1 | 4.5 | PASS |
| `--pick-selected-fg` | Flips | `#cba6f7` | `#e0afff` | `--pick-selected-fg on --pick-selected-bg` | 6.74:1 | 4.5 | PASS |
| `--chief-tab-bg` | Flips | `#26262b` | `#2d2a24` | `--foreground on --chief-tab-bg` | 11.81:1 | 4.5 | PASS |
| `--chief-tab-active` | Flips | `#35353d` | `#3f3c36` | `--foreground on --chief-tab-active` | 9.08:1 | 4.5 | PASS |
| `--notify-icon-bg` | Flips | `#35353d` | `#3f3c36` | `--card-button on --notify-icon-bg` | 5.28:1 | 3 | PASS |
| `--menu-icon` | Flips | `#71717a` | `#79756f` | `--menu-icon on --popover` | 3.46:1 | 3 | PASS |
| `--toggle-knob` | Retirement candidate | `#ffffff` | `#ffffff` | `--toggle-knob on --toggle-track` | 10.99:1 | — | report-only |
| `--overlay-scrim` | Unchanged | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | `--overlay-scrim on --background` | 1.15:1 | — | report-only |
| `--text-on-veil` | Unchanged | `#ffffff` | `#ffffff` | `--text-on-veil on --overlay-scrim` | 19.67:1 | 4.5 | PASS |
| `--spot-soft` | Flips | `#363140` | `#3e333c` | `--spot-text-on-tint on --spot-soft` | 6.74:1 | 4.5 | PASS |
| `--accent-soft` | Flips | `rgb(203 166 247 / 0.14)` | `rgb(216 156 252 / 0.14)` | `--accent-soft on --surface` | 1.32:1 | — | report-only |
| `--danger-soft` | Flips | `rgb(224 90 90 / 0.14)` | `rgb(255 170 185 / 0.14)` | `--danger-soft on --surface` | 1.36:1 | — | report-only |
| `--spot-text-on-tint` | Flips | `#cba6f7` | `#e0afff` | `--spot-text-on-tint on --spot-soft` | 6.74:1 | 4.5 | PASS |
| `--spot-disabled` | Flips | `#8670a2` | `#906ba3` | `--spot-disabled-fg on --spot-disabled` | 2.75:1 | — | report-only |
| `--spot-disabled-fg` | Flips | `#ddc5fa` | `#e6bffd` | `--spot-disabled-fg on --spot-disabled` | 2.75:1 | — | report-only |
| `--primary-disabled` | Flips | `#8670a2` | `#906ba3` | `--spot-disabled-fg on --primary-disabled` | 2.75:1 | — | report-only |
| `--drop-tint-border` | Flips | `#cba6f7` | `#d89cfc` | `--drop-tint-border on --column` | 8.24:1 | 3 | PASS |
| `--drop-tint-base` | Flips | `rgb(203 166 247 / 0.05)` | `rgb(216 156 252 / 0.05)` | `--drop-tint-base on --column` | 1.08:1 | — | report-only |
| `--drop-tint-hover` | Flips | `rgb(203 166 247 / 0.1)` | `rgb(216 156 252 / 0.1)` | `--drop-tint-hover on --column` | 1.2:1 | — | report-only |
| `--surface-inset` | Flips | `#17171a` | `#1e1b16` | `--foreground on --surface-inset` | 14.17:1 | 4.5 | PASS |
| `--card-bg` | Flips | `#1e1e22` | `#25221d` | `--card-foreground on --card-bg` | 13.09:1 | 4.5 | PASS |
| `--popover-bg` | Flips | `#1e1e22` | `#25221d` | `--popover-foreground on --popover-bg` | 13.09:1 | 4.5 | PASS |
| `--text-primary` | Flips | `#eae8ee` | `#ede9e1` | `--text-primary on --background` | 14.17:1 | 4.5 | PASS |
| `--code-bg` | Flips | `#26262b` | `#2d2a24` | `--foreground on --code-bg` | 11.81:1 | 4.5 | PASS |
| `--danger` | Flips | `#e05a5a` | `#ffaab9` | `--danger on --background` | 9.56:1 | 3 | PASS |
| `--card-border` | Flips | `#26262b` | `#2d2a24` | `--card-border on --card` | 1.11:1 | — | report-only |

### 1.8 Light per-slot mapping and measurement

| Slot | Status | Old value (shadcn current) | New value (c.css finalized) | Role pair (fg on bg) | Measured | Threshold | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `--background` | Flips | `#efece5` | `#f4efe7` | `--foreground on --background` | 16.71:1 | 4.5 | PASS |
| `--foreground` | Flips | `#15140f` | `#120f09` | `--foreground on --background` | 16.71:1 | 4.5 | PASS |
| `--card` | Flips | `#e7e3da` | `#efe9e1` | `--card-foreground on --card` | 15.86:1 | 4.5 | PASS |
| `--card-foreground` | Flips | `#15140f` | `#120f09` | `--card-foreground on --card` | 15.86:1 | 4.5 | PASS |
| `--popover` | Flips | `#e7e3da` | `#efe9e1` | `--popover-foreground on --popover` | 15.86:1 | 4.5 | PASS |
| `--popover-foreground` | Flips | `#15140f` | `#120f09` | `--popover-foreground on --popover` | 15.86:1 | 4.5 | PASS |
| `--primary` | Flips | `#171717` | `#120f09` | `--primary-foreground on --primary` | 18.32:1 | 4.5 | PASS |
| `--primary-foreground` | Unchanged | `#fafafa` | `#fafafa` | `--primary-foreground on --primary` | 18.32:1 | 4.5 | PASS |
| `--secondary` | Flips | `#e7e3da` | `#e8e3da` | `--secondary-foreground on --secondary` | 14.96:1 | 4.5 | PASS |
| `--secondary-foreground` | Flips | `#15140f` | `#120f09` | `--secondary-foreground on --secondary` | 14.96:1 | 4.5 | PASS |
| `--muted` | Flips | `#ddd8cc` | `#e8e3da` | `--muted-foreground on --muted` | 10.12:1 | 4.5 | PASS |
| `--muted-foreground` | Flips | `#55534a` | `#35312a` | `--muted-foreground on --background` | 11.3:1 | 4.5 | PASS |
| `--accent` | Flips | `#e2ded4` | `#e8e3da` | `--accent-foreground on --accent` | 14.96:1 | 4.5 | PASS |
| `--accent-foreground` | Flips | `#15140f` | `#120f09` | `--accent-foreground on --accent` | 14.96:1 | 4.5 | PASS |
| `--destructive` | Flips | `#c73e3e` | `#9d2c4c` | `--destructive-foreground on --destructive` | 7.25:1 | 4.5 | PASS |
| `--destructive-foreground` | Unchanged | `#ffffff` | `#ffffff` | `--destructive-foreground on --destructive` | 7.25:1 | 4.5 | PASS |
| `--border` | Flips | `#e2ded4` | `#e8e3da` | `--border on --background` | 1.12:1 | — | report-only |
| `--input` | Flips | `#cbc5b6` | `#c9c4bc` | `--input on --background` | 1.52:1 | 1.5 | PASS |
| `--ring` | Flips | `#86826f` | `#8d8980` | `--ring on --background` | 3.05:1 | 3 | PASS |
| `--column` | Flips | `#efece5` | `#f4efe7` | `--foreground on --column` | 16.71:1 | 4.5 | PASS |
| `--col-bg` | Flips | `#efece5` | `#f4efe7` | `--foreground on --col-bg` | 16.71:1 | 4.5 | PASS |
| `--col-head-text` | Flips | `#57534e` | `#57534c` | `--col-head-text on --col-bg` | 6.68:1 | 4.5 | PASS |
| `--sidebar-hover` | Flips | `rgb(28 25 23 / 0.05)` | `rgb(28 25 20 / 0.05)` | `--sidebar-hover on --surface` | 1.1:1 | — | report-only |
| `--sidebar-active` | Flips | `rgb(28 25 23 / 0.1)` | `rgb(28 25 20 / 0.1)` | `--sidebar-active on --surface` | 1.22:1 | — | report-only |
| `--surface` | Flips | `#e7e3da` | `#efe9e1` | `--foreground on --surface` | 15.86:1 | 4.5 | PASS |
| `--surface-secondary` | Flips | `#ddd8cc` | `#e8e3da` | `--foreground on --surface-secondary` | 14.96:1 | 4.5 | PASS |
| `--surface-tertiary` | Flips | `#ddd8cc` | `#e0dbd2` | `--foreground on --surface-tertiary` | 13.87:1 | 4.5 | PASS |
| `--surface-elevated` | Flips | `#e7e3da` | `#efe9e1` | `--foreground on --surface-elevated` | 15.86:1 | 4.5 | PASS |
| `--surface-hover` | Flips | `#e2ded4` | `#e8e3da` | `--foreground on --surface-hover` | 14.96:1 | 4.5 | PASS |
| `--surface-press` | Flips | `#ddd8cc` | `#e0dbd2` | `--foreground on --surface-press` | 13.87:1 | 4.5 | PASS |
| `--text-secondary` | Flips | `#44403c` | `#35312a` | `--text-secondary on --background` | 11.3:1 | 4.5 | PASS |
| `--text-tertiary` | Flips | `#57534e` | `#57534c` | `--text-tertiary on --background` | 6.68:1 | 4.5 | PASS |
| `--text-dim` | Flips | `#a8a29e` | `#8d8980` | `--text-dim on --background` | 3.05:1 | 3 | PASS |
| `--border-default` | Flips | `#e2ded4` | `#e8e3da` | `--border-default on --background` | 1.12:1 | — | report-only |
| `--border-strong` | Flips | `#cbc5b6` | `#c9c4bc` | `--border-strong on --background` | 1.52:1 | 1.5 | PASS |
| `--card-button` | Flips | `#8839ef` | `#7f2da7` | `--text-on-accent on --card-button` | 7.41:1 | 4.5 | PASS |
| `--text-on-accent` | Unchanged | `#ffffff` | `#ffffff` | `--text-on-accent on --card-button` | 7.41:1 | 4.5 | PASS |
| `--focus-ring` | Flips | `#8839ef` | `#7f2da7` | `--focus-ring on --background` | 6.47:1 | 3 | PASS |
| `--col-dot-idle` | Flips | `#9ea3ae` | `#645b4c` | `--col-dot-idle on --background` | 5.84:1 | 3 | PASS |
| `--col-dot-confirm` | Flips | `#e9a23b` | `#faab3f` | `--col-dot-confirm on --background` | 1.67:1 | — | report-only |
| `--col-dot-building` | Flips | `#4e81ee` | `#00648c` | `--col-dot-building on --background` | 5.73:1 | 3 | PASS |
| `--col-dot-done` | Flips | `#5ec26a` | `#006f36` | `--col-dot-done on --background` | 5.51:1 | 3 | PASS |
| `--badge-attention` | Flips | `#e9a23b` | `#faab3f` | `--badge-attention-fg on --badge-attention` | 6.46:1 | 4.5 | PASS |
| `--badge-attention-fg` | Flips | `#17171a` | `#4c2e00` | `--badge-attention-fg on --badge-attention` | 6.46:1 | 4.5 | PASS |
| `--badge-done` | Flips | `#5ec26a` | `#006f36` | `--badge-done on --background` | 5.51:1 | 3 | PASS |
| `--badge-idle` | Flips | `#9ea3ae` | `#645b4c` | `--badge-idle on --background` | 5.84:1 | 3 | PASS |
| `--project-avatar-bg` | Flips | `#e97b35` | `#cd5f37` | `--project-avatar-fg on --project-avatar-bg` | 4.5:1 | 4.5 | PASS |
| `--project-avatar-fg` | Flips | `#ffffff` | `#310a00` | `--project-avatar-fg on --project-avatar-bg` | 4.5:1 | 4.5 | PASS |
| `--agent-avatar-bg` | Flips | `#e7e3da` | `#e8e3da` | `--foreground on --agent-avatar-bg` | 14.96:1 | 4.5 | PASS |
| `--chip-idle-bg` | Flips | `#e7e3da` | `#e8e3da` | `--chip-idle-fg on --chip-idle-bg` | 5.98:1 | 4.5 | PASS |
| `--chip-idle-fg` | Flips | `#4d5562` | `#57534c` | `--chip-idle-fg on --chip-idle-bg` | 5.98:1 | 4.5 | PASS |
| `--chip-plan-bg` | Flips | `#dacbdd` | `#dfcfd9` | `--chip-plan-fg on --chip-plan-bg` | 7.64:1 | 4.5 | PASS |
| `--chip-plan-fg` | Flips | `#6d28d9` | `#562071` | `--chip-plan-fg on --chip-plan-bg` | 7.64:1 | 4.5 | PASS |
| `--chip-confirm-bg` | Flips | `#fffbed` | `#ffe5c8` | `--chip-confirm-fg on --chip-confirm-bg` | 5.53:1 | 4.5 | PASS |
| `--chip-confirm-fg` | Flips | `#a85923` | `#825100` | `--chip-confirm-fg on --chip-confirm-bg` | 5.53:1 | 4.5 | PASS |
| `--chip-done-bg` | Flips | `#ecfdf3` | `#c2f5ce` | `--chip-done-fg on --chip-done-bg` | 8.38:1 | 4.5 | PASS |
| `--chip-done-fg` | Flips | `#15803d` | `#004c23` | `--chip-done-fg on --chip-done-bg` | 8.38:1 | 4.5 | PASS |
| `--chip-failed-bg` | Flips | `#fcf3f2` | `#ffdce1` | `--chip-failed-fg on --chip-failed-bg` | 8.87:1 | 4.5 | PASS |
| `--chip-failed-fg` | Flips | `#ca3a32` | `#6b1f33` | `--chip-failed-fg on --chip-failed-bg` | 8.87:1 | 4.5 | PASS |
| `--fail-fg` | Flips | `#cc7c2e` | `#833a1f` | `--fail-fg on --card` | 6.72:1 | 4.5 | PASS |
| `--seg-active` | Flips | `#ddd8cc` | `#e0dbd2` | `--foreground on --seg-active` | 13.87:1 | 4.5 | PASS |
| `--seg-hover` | Flips | `rgb(28 25 23 / 0.05)` | `rgb(28 25 20 / 0.05)` | `--seg-hover on --surface` | 1.1:1 | — | report-only |
| `--tab-chip-bg` | Flips | `#e7e3da` | `#efe9e1` | `--foreground on --tab-chip-bg` | 15.86:1 | 4.5 | PASS |
| `--stop` | Flips | `#dd524c` | `#9d2c4c` | `--stop on --background` | 6.33:1 | 3 | PASS |
| `--diff-add-bg` | Flips | `#eaf1e8` | `#c2f5ce` | `--diff-add-fg on --diff-add-bg` | 6.45:1 | 4.5 | PASS |
| `--diff-add-fg` | Flips | `#499771` | `#005f2d` | `--diff-add-fg on --diff-add-bg` | 6.45:1 | 4.5 | PASS |
| `--diff-del-bg` | Flips | `#f8e6e4` | `#ffdce1` | `--destructive on --diff-del-bg` | 5.72:1 | 4.5 | PASS |
| `--dialog-bg` | Flips | `#e7e3da` | `#efe9e1` | `--foreground on --dialog-bg` | 15.86:1 | 4.5 | PASS |
| `--dialog-box-bg` | Flips | `#e7e3da` | `#efe9e1` | `--foreground on --dialog-box-bg` | 15.86:1 | 4.5 | PASS |
| `--dialog-row-bg` | Flips | `#ddd8cc` | `#e8e3da` | `--foreground on --dialog-row-bg` | 14.96:1 | 4.5 | PASS |
| `--dialog-ring` | Flips | `#cbc5b6` | `#c9c4bc` | `--dialog-ring on --dialog-bg` | 1.44:1 | — | report-only |
| `--range-chip-bg` | Flips | `#e7e3da` | `#e8e3da` | `--foreground on --range-chip-bg` | 14.96:1 | 4.5 | PASS |
| `--range-chip-border` | Flips | `#cbc5b6` | `#c9c4bc` | `--range-chip-border on --range-chip-bg` | 1.36:1 | — | report-only |
| `--toggle-track` | Retirement candidate | `#cbc5b6` | `#c9c4bc` | `--toggle-knob on --toggle-track` | 1.73:1 | — | report-only |
| `--tile-orange-bg` | Flips | `#f0e5d5` | `#ffe5c8` | `--tile-orange-fg on --tile-orange-bg` | 5.53:1 | 4.5 | PASS |
| `--tile-orange-fg` | Flips | `#e9a23b` | `#825100` | `--tile-orange-fg on --tile-orange-bg` | 5.53:1 | 4.5 | PASS |
| `--tile-indigo-bg` | Flips | `#dacbdd` | `#dfcfd9` | `--tile-indigo-fg on --tile-indigo-bg` | 7.64:1 | 4.5 | PASS |
| `--tile-indigo-fg` | Flips | `#6d28d9` | `#562071` | `--tile-indigo-fg on --tile-indigo-bg` | 7.64:1 | 4.5 | PASS |
| `--tile-hero-bg` | Flips | `#f8ead8` | `#ffd099` | `--foreground on --tile-hero-bg` | 13.42:1 | 4.5 | PASS |
| `--pill-idle-bg` | Flips | `#ddd8cc` | `#e8e3da` | `--foreground on --pill-idle-bg` | 14.96:1 | 4.5 | PASS |
| `--dash-border` | Flips | `#cbc5b6` | `#c9c4bc` | `--dash-border on --surface` | 1.44:1 | — | report-only |
| `--row-selected` | Flips | `#e2ded4` | `#e8e3da` | `--foreground on --row-selected` | 14.96:1 | 4.5 | PASS |
| `--row-icon-bg` | Flips | `#ddd8cc` | `#e0dbd2` | `--foreground on --row-icon-bg` | 13.87:1 | 4.5 | PASS |
| `--overlay-divider` | Flips | `#e2ded4` | `#e8e3da` | `--overlay-divider on --popover` | 1.06:1 | — | report-only |
| `--overlay-select-indigo` | Flips | `#dacbdd` | `#dfcfd9` | `--spot-text-on-tint on --overlay-select-indigo` | 7.64:1 | 4.5 | PASS |
| `--pick-selected-bg` | Flips | `#dacbdd` | `#dfcfd9` | `--pick-selected-fg on --pick-selected-bg` | 7.64:1 | 4.5 | PASS |
| `--pick-selected-fg` | Flips | `#6d28d9` | `#562071` | `--pick-selected-fg on --pick-selected-bg` | 7.64:1 | 4.5 | PASS |
| `--chief-tab-bg` | Flips | `#ddd8cc` | `#e8e3da` | `--foreground on --chief-tab-bg` | 14.96:1 | 4.5 | PASS |
| `--chief-tab-active` | Flips | `#e7e3da` | `#e0dbd2` | `--foreground on --chief-tab-active` | 13.87:1 | 4.5 | PASS |
| `--notify-icon-bg` | Flips | `#dacbdd` | `#dfcfd9` | `--card-button on --notify-icon-bg` | 4.96:1 | 3 | PASS |
| `--menu-icon` | Flips | `#1c1917` | `#120f09` | `--menu-icon on --popover` | 15.86:1 | 3 | PASS |
| `--toggle-knob` | Retirement candidate | `#ffffff` | `#ffffff` | `--toggle-knob on --toggle-track` | 1.73:1 | — | report-only |
| `--overlay-scrim` | Unchanged | `rgb(0 0 0 / 0.6)` | `rgb(0 0 0 / 0.6)` | `--overlay-scrim on --background` | 5.48:1 | — | report-only |
| `--text-on-veil` | Unchanged | `#ffffff` | `#ffffff` | `--text-on-veil on --overlay-scrim` | 6.27:1 | 4.5 | PASS |
| `--spot-soft` | Flips | `#dacbdd` | `#dfcfd9` | `--spot-text-on-tint on --spot-soft` | 7.64:1 | 4.5 | PASS |
| `--accent-soft` | Flips | `rgb(136 57 239 / 0.14)` | `rgb(127 45 167 / 0.14)` | `--accent-soft on --surface` | 1.24:1 | — | report-only |
| `--danger-soft` | Flips | `rgb(199 62 62 / 0.14)` | `rgb(157 44 76 / 0.14)` | `--danger-soft on --surface` | 1.24:1 | — | report-only |
| `--spot-text-on-tint` | Flips | `#6d28d9` | `#562071` | `--spot-text-on-tint on --spot-soft` | 7.64:1 | 4.5 | PASS |
| `--spot-disabled` | Flips | `#ae7de7` | `#ac78be` | `--spot-disabled-fg on --spot-disabled` | 3.4:1 | — | report-only |
| `--spot-disabled-fg` | Unchanged | `#ffffff` | `#ffffff` | `--spot-disabled-fg on --spot-disabled` | 3.4:1 | — | report-only |
| `--primary-disabled` | Flips | `#ae7de7` | `#ac78be` | `--spot-disabled-fg on --primary-disabled` | 3.4:1 | — | report-only |
| `--drop-tint-border` | Flips | `#8839ef` | `#7f2da7` | `--drop-tint-border on --column` | 6.47:1 | 3 | PASS |
| `--drop-tint-base` | Flips | `rgb(136 57 239 / 0.05)` | `rgb(127 45 167 / 0.05)` | `--drop-tint-base on --column` | 1.08:1 | — | report-only |
| `--drop-tint-hover` | Flips | `rgb(136 57 239 / 0.1)` | `rgb(127 45 167 / 0.1)` | `--drop-tint-hover on --column` | 1.16:1 | — | report-only |
| `--surface-inset` | Flips | `#efece5` | `#f4efe7` | `--foreground on --surface-inset` | 16.71:1 | 4.5 | PASS |
| `--card-bg` | Flips | `#e7e3da` | `#efe9e1` | `--card-foreground on --card-bg` | 15.86:1 | 4.5 | PASS |
| `--popover-bg` | Flips | `#e7e3da` | `#efe9e1` | `--popover-foreground on --popover-bg` | 15.86:1 | 4.5 | PASS |
| `--text-primary` | Flips | `#15140f` | `#120f09` | `--text-primary on --background` | 16.71:1 | 4.5 | PASS |
| `--code-bg` | Flips | `#ddd8cc` | `#e8e3da` | `--foreground on --code-bg` | 14.96:1 | 4.5 | PASS |
| `--danger` | Flips | `#c73e3e` | `#9d2c4c` | `--danger on --background` | 6.33:1 | 3 | PASS |
| `--card-border` | Flips | `#e2ded4` | `#e8e3da` | `--card-border on --card` | 1.06:1 | — | report-only |


## 2. Geometry

Geometry canon values from c.css's geometry block (`--radius` family / `--pad-*` / `--row-h` / `--label-*` / `--title-*` / four tiers of shadow) and tokens.css's non-color layers. #909 froze the shadcn component geometry byte for byte (the prototype `components/ui/` and apps/web byte-identical) — geometry redesign is only expressed through token value flipping, the component class structure unchanged. So this section's component-level geometry = the shadcn upstream default + recorded in-repo deviations, radius/shadow change wholesale with the token flip.

### 2.1 radius ladder

`--radius` is the radius base, flipping from the current 0.625rem (10px) to the finalized 0.875rem (14px). The Tailwind radius family goes through the official multiplier shape (shadcn.css `@theme inline`), flipping the base one tier carries the whole family:

| Radius tier | Multiplier | Current (--radius 10px) | Finalized (--radius 14px) |
| --- | --- | --- | --- |
| `rounded-sm` | 0.6× | 6px | 8.4px |
| `rounded-md` | 0.8× | 8px | 11.2px |
| `rounded-lg` | 1× (= --radius) | 10px | 14px |
| `rounded-xl` | 1.4× | 14px | 19.6px |
| `rounded-2xl` | 1.8× | 18px | 25.2px |
| `rounded-3xl` | 2.2× | 22px | 30.8px |
| `rounded-4xl` | 2.6× | 26px | 36.4px |

Independent radius slots (non-multiplier family):

| Slot | Current | Finalized | Use |
| --- | --- | --- | --- |
| `--edge-radius` | 12px | 14px | the raised-surface hairline ring radius (#139 unified border language) |
| `--radius-popover` | 10px | 12px | the popover family radius |

Behavior rationale: C · paper-orchid is an editorial/craft temperament, the 14px large radius + layered soft shadows are the #909 user-live-review-finalized geometry language (the soft direction, one of the loosest of the three). Component radius is not changed piece by piece, uniformly derived through the `--radius` flip — avoiding per-component radius drift, and letting the concentric-radius rule "radius aligns outer = inner + padding" (better-ui) hold automatically with the multiplier family.

### 2.2 spacing ladder

The repo has no `--spacing` override, uses the Tailwind v4 default 4px base (`spacing-N` = N×4px: 1=4, 1.5=6, 2=8, 2.5=10, 3=12, 4=16, 5=20, 6=24, 8=32 …). Semantic density tokens (new in the finalized version, current apps/web has no such names):

| Slot | Value | Use |
| --- | --- | --- |
| `--pad-card` | 16px | card/panel inner padding |
| `--pad-page` | 28px | page-level whitespace |
| `--row-h` | 40px | list row height |

The prototype dialog's measured spacing (reference, not token): form column gap 12px, action row gap 8px, panel padding 16px. Density caliber: C is the loosest of the three directions (#909 ruling), the 40px row height = 32px control + 4px×2 vertical padding, self-consistent with the shadcn control default height (see §2.5/§2.6).

### 2.3 font-size ladder

The repo has no `--font-size`/`--text-*` override, uses the Tailwind v4 default text ladder. Body = 14px (`text-sm`, base.css body).

| Tailwind tier | px / line-height |
| --- | --- |
| `text-xs` | 12 / 16 |
| `text-sm` | 14 / 20 (body) |
| `text-base` | 16 / 24 |
| `text-lg` | 18 / 28 |
| `text-xl` | 20 / 28 |

Semantic text tokens (new in the finalized version):

| Slot | Value | Use |
| --- | --- | --- |
| `--label-size` | 12px | control/field label size (= text-xs) |
| `--label-spacing` | 0.01em | label letter-spacing |
| `--label-transform` | none | label has no uppercase transform (deliberately drops all-caps) |
| `--title-weight` | 590 | title weight (Inter variable font) |
| `--title-tracking` | -0.02em | title letter-spacing |
| `--font-label` | var(--font-sans) | label font stack |

Font: Inter (sans, `--font-sans`) + JetBrains Mono (monospace, `--font-mono`). The prototype control label / primary button measured 13px (arbitrary `text-[13px]`), hint 12px — the arbitrary-value allowance surface sees §3.1.

### 2.4 shadow ladder

The finalized version flips four shadow tiers (c.css held values, one copy per mode), continuing tokens.css's kept tiers:

**Flipped tiers (c.css held values):**

| Slot | Dark | Light | Use |
| --- | --- | --- | --- |
| `--card-shadow` | `0 2px 6px rgb(0 0 0 / 0.24)` | `0 2px 8px rgb(28 25 23 / 0.08)` | card resting shadow (small-card family) |
| `--edge-shadow` | `0 8px 24px rgb(0 0 0 / 0.4)` | `0 8px 24px rgb(28 25 23 / 0.14)` | raised-surface shadow (popover/panel/fab) |
| `--plate-shadow` | `none` | `0 6px 16px rgb(0 0 0 / 0.12)` | handwritten overlay plate shadow |
| `--dialog-shadow` | `0 12px 32px rgb(0 0 0 / 0.45)` | `0 12px 32px rgb(28 25 23 / 0.18)` | modal dialog shadow |

**Kept tiers (tokens.css held values, c.css does not hold, #915 untouched):**

| Slot | Value | Note |
| --- | --- | --- |
| `--drag-shadow` | `0 8px 24px rgb(0 0 0 / 0.18)` | drag-floating clone, theme-constant |
| `--chief-shadow` | dark `0 4px 24px rgb(0 0 0 / 0.35)` / light `0 4px 24px rgb(28 25 23 / 0.16)` | chief drawer |
| `--fab-shadow` | `var(--edge-shadow)` alias | follows the edge-shadow flip |
| `--edge-ring` | `inset 0 0 0 1px var(--border-default)` | structural hairline ring (not a shadow, follows the border value flip) |

Behavior rationale: C · paper-orchid uses layered soft shadows to manage hierarchy (better-ui "shadows manage hierarchy / borders manage structure"). `--plate-shadow` flips from #854's hard-offset tier (light `4px 4px 0`, zero blur) to the soft blur tier (`0 6px 16px`) — the hard-offset plate is the previous direction's (Herdr purple) language, retired with the D1/D2 hue-and-geometry redesign; the dark-side `--plate-shadow` stays `none` (the dark "wireframe carries the weight" caliber unchanged, #854 user ruling).

### 2.5 shadcn component-level geometry defaults

#909 froze component geometry, the following is the source of truth (components only consume tokens, no per-component geometry changes):

**Button** (`components/ui/button.tsx`, size ladder):

| size | Height | Radius | Font size | Horizontal padding |
| --- | --- | --- | --- | --- |
| `default` | h-8 = 32px | rounded-lg = 14px | text-sm = 14px | px-2.5 = 10px |
| `xs` | h-6 = 24px | rounded-[min(--radius-md,10px)] = 10px | text-xs = 12px | px-2 = 8px |
| `sm` | h-7 = 28px | rounded-[min(--radius-md,12px)] = 11.2px | text-[0.8rem] = 12.8px | px-2.5 = 10px |
| `lg` | h-9 = 36px | rounded-lg = 14px | text-sm = 14px | px-2.5 = 10px |
| `icon` | size-8 = 32px | rounded-lg = 14px | — | — |
| `icon-xs` | size-6 = 24px | min(--radius-md,10px) = 10px | — | — |
| `icon-sm` | size-7 = 28px | min(--radius-md,12px) = 11.2px | — | — |
| `icon-lg` | size-9 = 36px | rounded-lg = 14px | — | — |

(Button radius changes wholesale with the `--radius` flip: default/lg from current 10px → finalized 14px; xs/sm capped by the `min()` ceiling at 10 / 11.2px.)

**Input** (`components/ui/input.tsx`): height h-8 = 32px, radius `rounded-none` (square corners), border `border-input`, padding px-2.5 (10px) / py-1 (4px), font size text-base (16px) → md:text-sm (14px), `min-w-0`.

**Switch** (`components/ui/switch.tsx`): default h-[18.4px] w-[32px], sm h-[14px] w-[24px]; thumb default size-4 (16px) / sm size-3 (12px), `rounded-full`. track/thumb colors consume `--input` (unchecked) / `--primary` (checked) / `--background`·`--foreground` (thumb), the measured contrast sees §1.5.

### 2.6 explicit override list (each item with its behavior rationale)

The following are explicit deviations from the shadcn upstream default or old-repo geometry, the construction batches execute per this, no self-ruling:

| # | Override item | Value / caliber | Behavior rationale |
| --- | --- | --- | --- |
| 1 | **36px input-family retirement** | the old `src/ui/input.css .input` (height 36px, radius 0) and `dialog.css .dlg-input` (36px) are not kept; the canonical control height = the shadcn Input default **h-8 = 32px** | ① D3 makes shadcn components carry all interactive elements and zeroes per-face CSS — the `.input`/`.dlg-input` carrier itself retires, the 36px value has no attachment point; ② the Button default and Input unify to 32px, a single control-height source of truth, self-consistent with the 40px `--row-h` (32 control + 4×2 padding); ③ #909 froze shadcn component geometry, 32px is the default already rendered in the user-live-review-finalized C direction, taking 36px is instead an unauthorized deviation from the finalization. When a taller control is really needed use a size ladder tier (lg = h-9 = 36px), do not mint another 36px dead value. The 4px shrink is a deliberate result of D2 free geometry redesign, not a regression. |
| 2 | **Button focus ring** | `focus-visible:[outline:2px_solid_var(--focus-ring)]` + `outline-offset-2`, replacing the upstream `outline-none` + gray ring | the repo-level #388 focus-ring canon (2px solid + offset 2); the ring color `--focus-ring` semantically separated from `--card-button` into its own name (#435 D3), the value flips with the brand |
| 3 | **Button brand tier** | new `variant=brand`: `bg-(--card-button) text-(--text-on-accent)`, hover `brightness-[1.07]`, disabled `bg-(--spot-disabled)` | the in-repo brand solid-fill tier (the track-A3 ui/Button primary equivalent migration slot, #423/#426); hover uses brightness not lowered opacity (disabled carried by pointer-events-none, hover does not hit) |
| 4 | **Button transition narrowed** | `transition-[color,background-color,border-color,filter]`, replacing `transition-all`/`transition-colors` | TW's transition-all attribute list includes outline-color, swallowing the focus ring into the transition start value (#15 probe measured) |
| 5 | **Button type default** | `type` defaults to `button` (not submit) | prevents implicit submit inside forms (same rule as the in-repo ui/button) |
| 6 | **Input square corners** | `rounded-none` (upstream default `rounded-md`) | follows the old `.input` square-corner language (old input.css `border-radius:0`), #909 froze it as-is. **No inline behavior-rationale record** — a batch wanting a rounded input must go back to the visual-direction ticket for a supplementary ruling, not change it on its own (see §4 callback item) |
| 7 | **--plate-shadow light-side softening** | light `4px 4px 0` (hard offset) → `0 6px 16px` (soft blur) | C · paper-orchid's layered soft-shadow language replaces #854's hard-offset plate language (the previous Herdr-purple direction), see §2.4; the dark side keeps `none` |

## 3. Carrier Rule (Tailwind Class Writing)

### 3.1 class writing rule

- **token utility classes first**: consuming color uses `bg-(--slot)`/`text-(--slot)`/`border-(--slot)` (the Tailwind v4 CSS-variable shorthand, `bg-(--x)` = `bg-[var(--x)]`), radius uses the `rounded-sm…4xl` multiplier tiers, spacing uses the `spacing-N` 4px ladder. A role with a token must use the token, bare values forbidden (better-colors: "a role with no token gets a token added", not writing an arbitrary value).
- **when arbitrary values are allowed**: only (a) one-off geometry sizes outside the ladder (e.g. Switch `w-[32px]`, Button sm `text-[0.8rem]`, control label `text-[13px]`), (b) `min()`/`calc()` compound shapes (e.g. Button xs/sm's `rounded-[min(var(--radius-md),10px)]`). **Color arbitrary values are a bad smell** — a color role with no token first adds a token, never writes `bg-[#hex]`.
- **forbid new per-face CSS, forbid new bare controls** (the #908 cross-lane discipline): during construction styles can only become Tailwind classes on shadcn components. The `.dlg-*` alias remnants are disposed per the #910 ruling 3 (state-class assertions go to behavior, the carrier changes to `aria-*`/`data-state`).

### 3.2 token notation: hex/rgb, forbid oklch

- Source-of-truth contract (ADR 0010 D5.4, inheriting #910 ruling 4's full inheritance of #411): token held values uniformly in hex/rgb notation, **forbid oklch**. Reason: the e2e value probes (computed-style probe + `apps/web/e2e/png.ts` luma probe) parse by rgb string regex, the `oklch()` function channel is misread by the regex → false red.
- `color-mix(in srgb, …)` **allowed**: it is resolved to rgb by the browser at render time, computed-style reads back an rgb string, the probes read normally. The six P0 semantic slots' color-mix formulas kept (§1.4).
- c.css measured all hex/rgb zero oklch, the contract naturally compatible — #915 value-flipping will not introduce oklch.

### 3.3 oklch old-pit disposition (ticket Q&A)

The ticket asked "does the old pit of oklch being misread by the probe regex disappear with the probe rewrite". Answer: per the #910 ruling 4, the probe tool surface **fully inherits #411, no rewrite** (`toHaveScreenshot` stays 0 spots, keeps the two narrow calibers — the computed-style probe + the png.ts luma probe), so the hex/rgb notation contract **survives, not lifted by a tool rewrite**. This volume fixes it as a carrier rule: as long as the probes read computed values by rgb regex, the token notation locks hex/rgb. When #921's probe-dump tool does re-pinning, the inline values also take this volume's hex/rgb measured values as authoritative.

## 4. Prototype Conflicts / Callback Items

This volume and the #909 finalized prototype are overall consistent (palette, geometry tokens, component geometry all from c.css and the frozen components). The following spots need construction-period attention or a callback to the visual-direction ticket (#909) / value-flip ticket (#915):

1. **light-mode Switch unchecked thumb contrast a touch soft** (measured finding, not a gated failure): the shadcn Switch light-mode OFF-state thumb (`bg-background` #f4efe7) on the track (`bg-input` #c9c4bc) = **1.52:1**, below the 3:1 for UI components. But the state carrier is the track color flip (OFF `--input` → ON `--primary` = **11.03:1**, see §1.5) + thumb position, WCAG 1.4.11's "state distinguishable" is satisfied by the track flip; the thumb's low contrast is a consistency polish item under the light-mode soft-hairline language, not an AA-gated failure. **Disposition**: do not change the palette (better-colors report-not-repaint + the palette already finalized by #909); if #915/batches judge the OFF-state thumb too weak, a 1px border or shadow can be added to the thumb (component-level, not touching token values), but must go back to the visual-direction ticket for a supplementary ruling, not added on its own.
2. **`--toggle-track`/`--toggle-knob` retirement** (already executed to completion by #952): the two slots' only consumers are the D3-zeroed per-face handwritten toggles (`detail/overlays.css` `.dlg-toggle`, `secondary.css`), orphaned after migrating to shadcn Switch. **Disposition**: delete the two slots from shadcn.css (not moved into the new palette) — #915's flip window did not touch them (construction frozen), #952's global slot-deletion window executed the landing (tokens.css never held the two slots anyway).
3. **Input square corners with no inline rationale** (§2.6 override 6): `rounded-none` follows the old language but the component has no comment recording the behavior rationale. A batch wanting a rounded input must go back to the visual-direction ticket for a supplementary ruling.
4. **Geometry token landing spot**: `--pad-card`/`--pad-page`/`--row-h`/`--label-*`/`--title-*` are newly named tokens in the finalized version (current apps/web has none). #915/the first batches must decide which file these new geometry tokens land in — this volume gives the values and use, the landing spot follows #915 value-flip ticket's non-color-layer caliber (tokens.css currently holds non-color tokens, the natural landing spot).

## 5. Old ui/ Primitive Retirement Canon Table (#942)

> Status: **ruled and in effect** (2026-10-06, #942 wayfinder task output, the ledger and consumption points grep re-checked point by point @ b38e70d7). The 12 domain tickets (#943–#953) only execute this table, no self-design. This section governs "what component each old `src/ui/` primitive and `ui/dialog.css` alias migrates to, what carrier the e2e pin switches to, which ticket executes"; color/geometry values are not pinned here — uniformly from this volume's §1.7/1.8 (after the #915 flip) and the §2 ladder.

### 5.0 Execution general rules

- **Retirement-scope boundary = rule address.** Only classes and primitive components whose rules live in `src/ui/` (chip.css / input.css / dialog.css) belong to this table. Same `dlg-` prefix but rules living in domain CSS are per-face classes (`dlg-accept-*`, `dlg-enroll-*`, `dlg-branch-*`, `dlg-history-*`, `dlg-token-*`, `dlg-provider-*` (except the create/seg-tab/model-add three), `dlg-skill-*`, `dlg-ghissues`, `dlg-agent-*` (except create), `dlg-reset-*`, `dlg-machine-*`, `dlg-toggle*` etc.) and go to each domain ticket's per-face CSS zeroing ledger, **not this table**; the `--toggle-track`/`--toggle-knob` two-slot retirement follows the §1.6 + §4-2 existing rulings.
- **Correction to the old ledger**: the #908/#913 reconnaissance ledger "old primitive consumption 20 files 24 spots" counted two classes of surfaces that should not be in the account — ① the already-shadcn-ified `components/ui/input.js` imports (16 spots, e.g. the overlay/ three, skills-page, filter-panel, which are not retirement targets, already canonical shape); ② prefix-only-same per-face class consumption points. This table's §5.1 point-by-point ledger re-draws the boundary by "rule address", domain tickets take this table as authoritative, no longer chasing the ghost points in the old ledger (e.g. #944's "skills-page chip/input consumption" is really a shadcn Input, no action).
- **Ordering** (#913 ruling 3): consumption-surface migration = each domain ticket migrates with the change (#910 ruling 2, the same PR completes class retirement + spec re-pin); the `ui/` directory terminal deletion + dialog-shell shell-level alias removal + `.dlg-shell`/`.dlg-viewport` mechanism inlining = #952 (the only ticket holding the `components/ui/` existing-component change authorization); terminal-state reconciliation = #953.
- **Carrier and replacement class land in the same PR**: the semantic carrier (role/label/text, #910 tier one) depends on no new attribute, so domain tickets can re-pin first; points needing a new carrier (`data-tone`, testid) have the carrier land on the DOM with the StatusChip component / execution ticket, the spec pinning it re-pins in the same PR — two tickets never change the same spec at different times.
- **Alias-class remnants are legal**: a class name retiring from the CSS rules ≠ immediately removed from the DOM. Before the execution domain completes per-face zeroing, alias classes (`detail-chip--*`, `search-row-chip` etc.) survive via className passthrough; the existing "grep consumption points = 0 before #952 deletes the `ui/` directory" rule unchanged.
- **ghost-tier row-button neutralization = seven channels** (#908 comment-6001887439 ruling 3; shape reference #943's `ROW_BTN`/`RAIL_BTN`, resources/parts.tsx's `GHOST_ROW_BTN_CLS`): when a row button lands on the Button ghost base the seven channels neutralize at once — hover bg (incl. the `dark:` variant) · `aria-expanded` bg + text · hover text · press translate (the same variant chain `active:not-aria-[haspopup]:translate-y-0`) · gap/px · font-weight · border. Missing the hover-text channel gets caught red by the accent-typo family's computed-color probe (#943 proved).

### 5.1 consumption-surface point-by-point ledger (grep re-check @ b38e70d7)

**Chip primitive (`ui/chip.tsx`) — 3 files 3 spots**:

| # | Consumption point | Shape | Target component (§5.2) | e2e carrier judgment | Executing ticket |
| --- | --- | --- | --- | --- | --- |
| C1 | `detail/dhead.tsx` | md, `detail-chip--<tone>` alias passthrough, wrapped in a `.detail-chip` ghost Button | StatusChip default | the chip copy = tier-one text (`reject-chain`/`review-reject`'s toHaveText keeps semantics verbatim); the trigger surface `.detail-chip`/`.detail-chip-chevron` is detail per-face, to #945 for joint disposal | #945 |
| C2 | `overlays/search-panel.tsx` | mini, `search-row-chip` positioning-class passthrough | StatusChip size="sm" | copy is tier-one text; `search-row-chip`'s positioning duty becomes an inline utility (overlays.css zeroed in the same PR) | #949 |
| C3 | `routes/agent-detail-page.tsx` | mini, no alias | StatusChip size="sm" | `agent-detail.spec`'s `.chip` locator ×2 → row-scope `getByText` (behavior assertion semantics unchanged) | #952 (**this ticket's sample already implemented**, see §5.6) |

Same-name different-family (`mention-chip--*`, `composer-chip--*`, `chip-popover-*`, `agent-identity-chip`, `spec-chip--*`, KbdHint) are not the five-state primitive, go to each domain's per-face ledger. The five-state tone's sole semantic source = `phase.ts`'s `PHASE_UI.tone`, the StatusChip API aligns to that field name.

**Old Input primitive (`ui/input.tsx`, 36px) — 2 files 8 spots**:

| # | Consumption point | Count | Target component (§5.3) | e2e carrier judgment | Executing ticket |
| --- | --- | --- | --- | --- | --- |
| I1 | `resources/create-provider-dialog.tsx` | 6 | components/ui Input | getByLabel / placeholder attribute assertions unchanged | #944 |
| I2 | `resources/create-secret-dialog.tsx` | 2 | components/ui Input | same as above | #944 (**this ticket's sample already implemented**, see §5.6) |

**shadcn Input carrying the old `.dlg-form-input` class (mixed shape) — 2 files 3 spots**:

| # | Consumption point | Count | Disposition | Executing ticket |
| --- | --- | --- | --- | --- |
| I3 | `resources/skill-dialog.tsx` | 2 | drop the class, component unchanged (geometry is already the canonical h-8) | #944 |
| I4 | `routes/create-agent-dialog.tsx` | 1 | drop the class | #952 |

**`ui/dialog.css` form/button/segmented-family consumption surface — 11 files** (per-class disposition sees §5.4):

| File | Mounted dialog.css classes | Executing ticket |
| --- | --- | --- |
| `resources/create-provider-dialog.tsx` | dlg-form,-foot,-label,-input,-note,-seg,dlg-provider-seg-tab,dlg-provider-create,dlg-provider-model-add | #944 |
| `resources/create-secret-dialog.tsx` | dlg-form,-foot,-label,-input,-textarea,dlg-secret-note,dlg-secret-create | #944 (spot-checked as landed) |
| `resources/skill-dialog.tsx` | dlg-form,-foot,-label,-input,-textarea,-note,-primary | #944 |
| `routes/create-agent-dialog.tsx` | dlg-form,-foot,-label,-input,dlg-agent-create | #952 |
| `detail/branch-dialog.tsx` | dlg-form-foot,-label,-seg,dlg-seg-tab | #945 |
| `detail/review-dialog.tsx` | dlg-form-foot,-actions,-label,chief-dlg-ghost | #945 |
| `detail/reject-dialog.tsx` | dlg-form-foot,-actions,-label,chief-dlg-ghost | #945 |
| `detail/right-pane.tsx` | dlg-form-label | #945 |
| `chief/chief-drawer.tsx` | dlg-form-foot,-actions,chief-dlg-primary,chief-dlg-ghost | #950 |
| `chief/chief-agent-dialog.tsx` | dlg-form-foot,-actions,chief-dlg-primary,chief-dlg-ghost | #950 |
| `chief/edit-charter-dialog.tsx` | dlg-form,-foot,-actions,chief-dlg-charter-input,chief-dlg-primary,chief-dlg-ghost | #950 |

**Carrier layer (`components/ui/` adapter layer, not a domain-ticket surface)**: `dialog-shell.tsx` (imports dialog.css + outputs the `.dlg-shell`/`.dlg-viewport` mechanism classes and the shell-level aliases `.dlg`/`.dlg-head`/`.dlg-title`/`.dlg-close`/`.dlg-body`/`.dlg-foot`/`.dlg-backdrop`), `alert-dialog-shell.tsx` (`.dlg-shell`) → #952 (§5.5).

### 5.2 chip five-state → StatusChip (`components/ui/status-chip.tsx`, #942 lands the component)

- **Precedent shape**: same shape as TagChip (lands on the existing registry Badge, no self-built registry component) and SeededAvatar (registry Avatar adapter layer) — local adapter, zero CSS, skins all token utility classes.
- **Does not go the registry semantic-skin route** (destructive/secondary etc.): the five pairs of `--chip-*` slots are 1:1 flip slots in §1.7/1.8 (0 retired), the contrast measured and finalized; the registry semantic skins would abandon the measured slots, and the plan/confirm two states have no semantic counterpart in the registry tiers. Badge only lends the geometry skeleton (h-5 / rounded-4xl / px-2 / text-xs / font-medium / shrink-0 / whitespace-nowrap).
- **Geometry canon**: the default tier = the Badge registry default (h-5 20px, replacing the old md 18px); the `size="sm"` tier (replacing the old mini 14px) = `h-4 px-1.5 text-[10px]` (16px, precedent = tag-chip's todo-card row-flush 16px tier). The 18→20, 14→16 growth is a deliberate D2 free-geometry-redesign result, not a regression; when some consumption surface's row box really cannot fit, dispose per the tag-chip per-face exception rule (the component header comment records the behavior rationale, the domain ticket self-rules).
- **Color canon**: the `bg-(--chip-<tone>-bg) text-(--chip-<tone>-fg)` five-pair utilities (§3.1 token classes first; values flip with #915, this table does not pin values). tailwind-merge overrides the Badge base skin's bg-primary/text-primary-foreground two slots, same technique as TagChip.
- **API**: `<StatusChip tone="idle|plan|confirm|done|failed" size?="default|sm" className?>` — the old prop name `variant` changes to `tone` (aligned with the `PHASE_UI.tone` field name, avoiding confusion with Badge's variant skin axis); `className` passthrough (alias classes survive until the execution domain retires).
- **State carrier (#910 ruling 3 gray zone: state-class assertions go to behavior)**: the `data-tone="<tone>"` attribute replaces the `.chip--<tone>` state class; copy assertions go through the tier-one text carrier. The `.chip`/`.chip--*` class-name locators retire.
- **Visual-assertion disposal**: the old 18/14px geometry pins and `--chip-*` color pins are visual assertions, entirely rewritten per the #910 ruling 3, values from the post-#915-flip §1.7/1.8 measured columns (the probe-dump comparison-table flow, #921 tool).

### 5.3 input 36px old family → shadcn Input / Textarea (the execution details of §2.6-1's fixed values)

- **Target component**: `components/ui/input.tsx` (h-8 32px / rounded-none / border-input / px-2.5 / text-base→md:text-sm). **No per-face geometry override kept** — 36px does not survive in any form of alias, utility or size tier (§2.6-1: the 4px shrink is a D2 deliberate result; a taller control really needed goes through the Button/Input size ladder, no dead value minted).
- **Three execution shapes**: ① old-component import points (I1/I2): import path `'../ui/input.js'` → `'../components/ui/input.js'`, the same PR drops the `.dlg-form-input` on the className; ② mixed points (I3/I4): only drop the `.dlg-form-input` class; ③ bare `<input>`: folded into the Input component (the #851 bare-control ledger, each domain ticket follows its own account, not this table's point-by-point).
- **Focus-ring canon** = the component's own `focus-visible:border-ring` + `ring-3 ring-ring/50`; the old `.input`'s 1px border + hairline ring retire. §2.6-2's 2px outline ring is Button-tier-specific, **not extended to Input**.
- **e2e carrier**: form inputs uniformly `getByLabel` tier-one (`htmlFor`/`id` pairing is a semantic asset, kept — it is not a class-name alias); placeholder assertions = `toHaveAttribute('placeholder', …)` behavior assertion verbatim. The `.dlg-form-input`/`.input` class-name pins measured 0 spots, no re-pin surface.
- **textarea (`.dlg-form-textarea` family, bare control)**: target = `components/ui/textarea.tsx` (registry base-nova component, **#942 already landed**; the only recorded deviation = `rounded-lg`→`rounded-none`, reason: same family as §2.6-6's Input square-corner language + the old `.dlg-form-textarea` radius 0 same-shape migration). Geometry canon = the registry default (`field-sizing-content` + `min-h-16`); the old 88px min-height not kept (D2), the charter tall field keeps the explicit override `min-h-[120px]` (behavior rationale: multi-line editing space for the full charter, #950 executes). The old `resize: vertical` retires (field-sizing auto-growth replaces manual dragging). Consumption points: create-secret-dialog ×1 (sample already implemented), skill-dialog ×1 (#944), edit-charter-dialog ×1 (#950). e2e carrier: labeled ones go through getByLabel; the charter textarea has no label, goes through the dialog-scope `getByRole('textbox')` (the only textbox, chief-settings.spec's `.chief-dlg-charter-input` pin ×2 re-pinned per this).

### 5.4 `ui/dialog.css` `.dlg-*` alias per-class disposition table

Disposition caliber follows the #910 ruling 3 mechanical judgment: behavior assertions keep semantics unchanged, only the carrier changes; visual assertions entirely rewritten per the new canon. "pin count" = the e2e + integration class-name locator measured count @ b38e70d7.

| Class (rule group) | Disposition | Target carrier | e2e re-pin (pin count → carrier) | Executing ticket |
| --- | --- | --- | --- | --- |
| `.dlg-form` | Retire | container utility: `flex flex-col gap-3 px-4 pt-4 pb-3` (current values 12/16px already on the §2.2 ladder, equal-value migration is the canon) | 1 (agent-create-model's geometry boundingBox) → visual assertion, rewritten per the new canon with #952; the structure scope uses getByRole('dialog') | #944/#950/#952 (each their JSX); spec follows #952 |
| `.dlg-form-foot` | Retire | container utility: `flex flex-col px-4 pb-4` | 1 (agent-create-model boundingBox) → same as above | same as above |
| `.dlg-form-actions` | Retire | container utility: `flex justify-end gap-2` | 0 | #945/#950 |
| `.dlg-form-label` | Retire | bare `<label htmlFor>` + utility: `mt-[9px] mb-2 text-[12px] leading-[18px] tracking-[0.01em] text-(--text-primary)` (size/spacing = c.css finalized `--label-size`/`--label-spacing`; after #915 lands the tokens change to `text-(--label-size) tracking-(--label-spacing)`, §4-4). **Does not pull the registry Label component**: label has no interaction mechanism, a bare `<label>` is not on the #851 bare-control list; the getByLabel tier-one carrier depends only on htmlFor/id, not on a component | 0 (label class has no pin; carrier = getByLabel) | #944/#945/#950/#952 |
| `.dlg-form-input` | Retire | the §5.3 Input component | 0 | #944/#952 |
| `.dlg-form-textarea`, `.chief-dlg-charter-input` | Retire | the §5.3 Textarea component (charter adds `min-h-[120px]`) | 2 (chief-settings) → dialog-scope getByRole('textbox') | #944 (secret already implemented by this ticket)/#950 |
| `.dlg-form-note`, `.dlg-secret-note` | Retire | `<p>` + utility: `text-xs leading-4 text-(--text-tertiary)` | 1 (secret-add-dialog toContainText) → tier-one `getByText(/值将加密存储/)`, assertion semantics unchanged | #944 (secret already implemented by this ticket) |
| `.dlg-form-primary`, `.dlg-secret-create`, `.dlg-provider-create`, `.dlg-agent-create`, `.chief-dlg-primary` | Retire | Button `variant="brand"` (§2.6-3 is this migration slot); pinned-bottom exclusive = add `w-full`; the chief inline tier keeps the consumption point's existing `px-3 text-[13px]` utility | 19 (secret 3, provider 7, agent 5, chief-primary 4) → getByRole('button', { name }) tier-one (the button copy is the semantics); disabled/enabled/toBeInViewport are all behavior assertions, semantics unchanged | #944 (secret/provider)/#950 (chief)/#952 (agent); the corresponding pins in dialog-viewport.spec re-pin in the same PR as each button's execution ticket |
| `.chief-dlg-ghost` | Retire | Button `variant="outline"` (the old shape card-border border + surface base ≈ the outline tier's border-border/bg-background; after the #915 flip auto-aligns to the new palette) | 3 (chief-settings, dialog-viewport) → getByRole('button', { name }) | #945 (review/reject)/#950 (chief three) |
| `.dlg-provider-model-add` | Retire | Button `variant="ghost"` + utility: `self-start px-0 text-(--text-secondary)` (old shape: left-pinned, frameless, secondary ink) | 2 (provider-add-dialog, dialog-viewport) → getByRole('button', { name }) | #944 |
| `.dlg-form-seg`, `.dlg-seg-tab`, `.dlg-provider-seg-tab` | Retire | the Tabs component default tier (registry geometry `rounded-lg bg-muted p-[3px] h-8` near-same-shape as the old 30px/3px/8px family, the difference absorbed by D2); the provider block shape = TabsList `w-full` + TabsTrigger `flex-1`. **Not the segmented tier** — that tier's class name binds pages.css `.page-tabs-group`, belongs to the #946 surface, cross-file dependency does not enter the dialog family. Selected-state carrier = `role=tab` + `aria-selected` (Base UI built-in); the `data-active="true"` assertion → getByRole('tab', { selected: true }); hover-tint behavior → TabsTrigger hover utility, `--seg-hover`/`--tab-chip-bg` values follow #915 | 6 (segmented-controls 2, provider-add-dialog 4) → behavior assertion semantics unchanged, locator switches to role/copy; segmented-controls.spec's branch-seg case re-pins with #945, that spec's other family cases untouched | #945 (branch)/#944 (provider) |
| `.dlg-shell`, `.dlg-viewport` (selector mechanism layer: exit recipe + viewport root container) | the dialog.css rules retire, the mechanism **inlined into the adapter layer** utility: shell = `[transition:visibility_0s_linear_var(--dur-overlay)] data-[ending-style]:invisible`; viewport = `fixed inset-0 pointer-events-none [&>*]:pointer-events-auto [transition:visibility_0s_linear_var(--dur-fast)] data-[ending-style]:invisible` (z-index already an adapter-layer argument, no class dependency) | 0 (the two class names have no spec pin; dialog-viewport.spec pins the behavior surface) | #952 (dialog.css terminal deletion point, the components/ui authorization ticket) |

### 5.5 shell-level alias same-family (dialog-shell.tsx output surface, associated registration)

The rule bodies of `.dlg`/`.dlg-backdrop`/`.dlg-head`/`.dlg-head--plain`/`.dlg-title`/`.dlg-close`/`.dlg-body`/`.dlg-foot` already retired with #425 B1; what survives is the **class-name remnant** output by the `dialog-shell.tsx` adapter layer per the #411 alias policy — the #910 ruling 1 already revoked that policy, so they are registered for disposal together (this table governs the ruling, execution goes to #952):

| Alias | Replacement carrier (#910 two-tier system) | pin surface |
| --- | --- | --- |
| `.dlg` (panel) | `getByRole('dialog')` (Popup built-in role=dialog + aria-label=title) | `locator('.dlg')` 80 spots — each domain ticket re-pins with the change (aliases remain in the DOM until #952, re-pin can go first) |
| `.dlg-title` | dialog accessible-name assertion (aria-label) or tier-one text within the dialog scope | 17 spots, same as above |
| `.dlg-close` | `getByRole('button', { name: '关闭' })` (the aria-label already on the component) | 7 spots, same as above |
| `.dlg-head`/`.dlg-body`/`.dlg-foot` | structure container: prefer role-scope (the geometry-relation assertion inside the dialog measures the child element directly); only when a structure hook is really needed add a tier-two testid (`dialog-head`/`dialog-body`/`dialog-foot`, the kebab-case no-prefix rule) | 8 spots (agent-create-model, dialog-viewport), judged point by point at re-pin |
| `.dlg-backdrop` | no carrier need (outside-click close = coordinate-click behavior surface, no locator) | 0 |

The class-name output removal point = #952 (dialog-shell.tsx single point, same PR as the §5.4 mechanism inlining).

### 5.6 sample implementation record (#942, this ticket, the mapping-lossless proof)

Per the ticket, sampled 2 consumption points and implemented, keeping the e2e behavior-assertion semantics unchanged:

- **C3** (`routes/agent-detail-page.tsx` mini chip) → StatusChip `size="sm"`; `agent-detail.spec`'s `.chip` locator ×2 changed to row-scope `getByText` (copy assertion = behavior, semantics unchanged word for word).
- **I2 + the secret-dialog whole family** (`resources/create-secret-dialog.tsx`) → Input ×2 component-swapped and class-dropped, label/note/foot/form utility-ized per §5.4, the bare textarea → Textarea component, the bare button `.dlg-secret-create` → Button brand + `w-full`; `secret-add-dialog.spec` re-pinned: `#dlg-secret-*` → getByLabel (id/htmlFor kept as semantic asset), `.dlg-secret-create` → getByRole('button'), `.dlg-secret-note` → getByText; the shell-level `.dlg`/`.dlg-title`/`.dlg-close` locators **kept this round** (alias retirement belongs to #952, the sample does not overreach into shared components). This point's bare-control count −2 (button + textarea folded in), the `.dlg-*` class consumption zeroed (secret surface).
- 36→32px and chip 14→16px are D2-authorized geometry changes; the two specs have no visual assertions, no value re-pin needed. Evidence (fixture-stack measured + e2e output) in `docs/verify/942/`.

## Appendix: Reproduction

The t-0909 sandbox retirement (#953) already executed this volume's pre-scheduled rule: `measure-912.mjs` moved to the permanent tool surface (same level as the #921 probe-dump tool, `apps/web/e2e/`), the reference path is the current shape below.

```sh
node apps/web/e2e/measure-912.mjs --out <目录>     # 缺省 --out = 当前目录
# 产出:
#   token-scale-912.json          机器可读实测(全槽解析值 + 逐对对比度 + 组件件面)
#   token-scale-912-tables.md     人读完整报告(含汇总)
#   token-scale-912-fragment.md   本册 §1.5–1.8 表格片段(#912 拼接期中间产物；
#                                 本册表格已冻结，封版后复跑只作证据归档，不回拼)
```

Data sources `apps/web/e2e/palette-c.css` (the frozen palette source of truth) and `apps/web/src/styles/{shadcn,tokens}.css`; the algorithm same-sourced as `gen-palettes.mjs` (the #909 canon generator, in main history `144698cb`). The finalized-tree expected reading (#953 measured): each mode flip=0 / new=0 / retired=2 (--toggle-track/--toggle-knob, the #952 sole thaw-window deletion) / unchanged=109, AA-gated 0 fail (dark min 3.46 / light min 3.05) — any deviation is drift, must explain before changing values.
