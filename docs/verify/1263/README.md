# Evidence for #1263 — board cards aligned to the deepseek-harness dialog look

Captured on the worktree lane stack (vite dev 5273 + server 8791, isolated
PACMAN_HOME) by `.claude/verify-run/drive-card-face.mjs` (scenario=01 fixture
board, 1440x900, both themes, rest/hover/press states + computed-style dump)
and `shot-live-board.mjs` (seeded live board, no fixture).

## Files

- `before-board-dark.png` / `before-computed.json` — the pre-change card face
  (14px radius, ring only, no hover delta, `cornerShape: superellipse(1)`).
- `after-board-dark.png` / `after-board-light.png` — the aligned board in both
  themes.
- `after-hover-dark.png` / `after-hover-light.png` — the hover tint step
  (`--card-hover`).
- `after-press-dark.png` — the press face (unchanged `--surface-press` step).
- `after-computed.json` — the live computed values: `borderRadius: 18px`,
  box-shadow = ring + `--card-lift` layers, `cornerShape: superellipse(1.5)`,
  `transition: background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1)`.
- `live-board-seeded.png` — the change over real (REST-seeded) data, 6 cards
  across todo/building/done columns.

## Gate results on the branch tree

- `pnpm lint` exit 0, `pnpm typecheck` exit 0, `pnpm spec:parse` PASS.
- Full web e2e (styles are a shared surface, so the affected run is the full
  suite): 923/923 passed. That run includes the re-ruled pins in
  `visual-polish.spec.ts` (radius 18 + `cardLift` assertion), the new hover
  step in `card-press.spec.ts`, and the drag-clone mirror in
  `board-dnd.spec.ts`.
