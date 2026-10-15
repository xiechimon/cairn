# ui-cds-sidebar (PR-3)

Claude Desktop redesign PR-3: sidebar consumes CDS tokens + motion primitives.

## Changes
- Width `w-(--sidebar-w)` = **288px** (locked)
- Background `--surface-1` (tier-1 mix ⚑); solid right border retired
- Soft hairline via `box-shadow: 1px 0 0 0 var(--border-soft)`
- Row pills: `--cds-radius-lg` (8px), inset-x-2.5, hover 150ms `--ease-out-expo`
- Group headers 14/17; nav `gap-0.5` + `useScrollFade` / `.scroll-fade`
- Colors frozen (`--background` / `--card` hex unchanged)

## Evidence
- `before/` / `after/` screenshots (board + detail)
- `after/metrics-after.json` — width 288, scroll-fade on, pill 8px, borderRight 0
- e2e: `cds-sidebar.spec.ts` + updated seam/visual/detail/chief pins
