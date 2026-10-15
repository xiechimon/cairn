# ui-cds-board (PR-4)

Claude Desktop redesign PR-4: board bare lanes + panel cards.

## Changes
- Columns: no border/radius/shadow (tier-0 bare lanes on `--background`)
- Cards: `--radius-panel` **10px**, `--panel-shadow`, hover lift −1.5px + `--panel-shadow-hover` (200ms `--ease-out-expo`)
- Header control height **32px**
- Enter animation deferred (fights #1255 column scroll restore on remount)
- Colors frozen

## Evidence
- `before/` / `after/` board screenshots
- `after/metrics-after.json`
- e2e: `cds-board.spec.ts` + updated visual-polish / board-dnd pins
