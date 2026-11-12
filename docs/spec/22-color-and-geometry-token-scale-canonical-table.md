# 22 · Color and Geometry Token Scale Canonical Table (#912)

> Kept sections only. The header of the full volume said it was superseded in part (ADR 0012 / #980) and that §1.1 and §3 stay in effect. ADR 0012 is not in this tree, so those two sections are kept here as the contract an agent can read. The rest of the volume (the #912-era measurement tables, the geometry canon, the prototype callback list and the §5 retirement ledger) described work that has landed and is deleted; it stays in git history.

## 1.1 Slots unchanged, only values flip

A name-level diff measured 111 color slots, **0 added, 0 retired** — the finalized palette c.css is a 1:1 value replacement of the #787/#813 slot architecture, confirming ADR 0010 D1's "what flips is the values inside the slots, not the slots". #915's value-flip execution is therefore **pure value replacement**: move each color slot's held value in `shadcn.css`'s `:root` (dark) and `.light` (light) to the c.css corresponding value, the slot names and the `@theme inline` Tailwind mapping (`--color-*`) zero change.

- **Flips**: dark 107 slots, light 103 slots take new values (incl. the six coalesced alias slots `--surface-inset`/`--card-bg`/`--popover-bg`/`--text-primary`/`--code-bg`/`--danger`, whose values flip together with the canonical slot they directly reference).
- **Unchanged**: dark 2 slots, light 6 slots — theme-constant values (`--overlay-scrim` `rgb(0 0 0 / 0.6)`, `--text-on-veil` white; the light side also has `--primary-foreground`/`--destructive-foreground`/`--text-on-accent`/`--spot-disabled-fg` exactly equal to the current value). Unchanged ≠ no flip needed, it is the finalized value exactly equal to the current value.
- **Retirement candidate**: 2 slots (`--toggle-track`/`--toggle-knob`) — invisible to a name-level diff (both files have them), but their only consumer is the per-face CSS handwritten toggle zeroed by D3 (see §1.6). **Retired**: #952 deleted the two slots from shadcn.css (the execution point of the §4-2 ruling).

## 3. Carrier rule (Tailwind class writing)

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
