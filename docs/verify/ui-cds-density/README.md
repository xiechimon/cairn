# ui-cds-density (PR-9)

Claude Desktop redesign PR-9: density / rem-scale toggle.

## Changes
- `density.ts`: comfortable (default) | compact, persisted `pacman-density`
- `[data-density=compact]`: `--rem-scale: 0.9375`, `--pad-card: 8px`, type-scale recompute
- Compact card rhythm: `[data-slot=card] --card-spacing: 0.5rem`; `.todo-card` padding 8px; `.todo-card-meta` 12/16
- Toggle: user-menu density segment + account ProfileRow
- Boot applies stored density beside theme
- Colors frozen

## Evidence
- `before/` / `after/` (comfortable vs compact board/account)
- e2e: `cds-density.spec.ts`
