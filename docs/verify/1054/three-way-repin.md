# #1054 three-way contrast: old pin → new pin → probe measurement (#910 ruling 5 / #986 process)

Method: `probe/probe-evidence.mjs` (archived in this directory) runs the same script against two fixture stacks
(`vite build --mode fixture` + `vite preview`) —
before = origin/main @ `5d9d91d6` (a throwaway detached worktree, port 8412),
after = this branch (port 8413). Radius is read via `getComputedStyle().borderTopLeftRadius`,
once per theme (dark/light). Raw output = `measure-before.md` / `measure-after.md`
(JSON versions included); screenshots = `shots/` (same-name before/after pairs).

## Re-pin faces (the four spots where e2e absolute-value pins moved)

| face | spec pin (old → new) | before measured | after measured |
| --- | --- | --- | --- |
| board-column (the column container) | visual-polish.spec `0px` → `14px` (both themes) | 0px / 0px | 14px / 14px |
| drag-card (the drag clone) | board-dnd.spec `0px` → `14px` (both themes, the resolveStyle expected value) | 0px / 0px | 14px / 14px |
| user-menu panel | visual-polish.spec `0px` → `10px` (both themes) | 0px / 0px | 10px / 10px |
| spec-block brief card | spec-brief-card.spec `0px` → `10px` | 0px / 0px | 10px / 10px |

Reference rows (untouched, proving the measurement convention): todo-card = 14px same value on both sides (the registry Card, already ruled in L1 #1058); composer = 0px same value on both sides, chat-bubble = 0px same value on both sides, chief-composer = 0px same value on both sides (the three are ledger-registered deviations; this ticket **does not touch visuals** — they carry a `(registered deviation, stays)` annotation in measure-*.md).

## Unpinned faces (the rendered value moved but e2e has no absolute-radius assertion; the probe archives them)

| face | before | after |
| --- | --- | --- |
| chief TabsList (role=tablist) | 0px | 10px |
| chief tab indicator (the sliding pill) | 0px | 8px |
| chief settings-face secondary-bg card family (62px row cards ×2, the probe scans blocks by rendered color) | 0px | 14px |
| chief settings-face row buttons (44px, Button-carried) | 0px | 10px |
| mention-picker insert button corner radius (Button-carried reference) | 10px | 10px (geometry untouched; what moved is the ink, see ../1055/) |

Other unpinned faces (gate banner / TURN_TOOLS / switcher tray / sample card / icon tile /
SEARCH_BOX / token-gate input / EMPTY_CARD / charter block / dashed empty state) changed at class level
in a single point; basis and per-site reasoning in `docs/spec/27-consumer-surface-shapes-and-brand-ink-ledger.md` §2;
segmented-controls.spec pill tracking (position/size ≤1px, no radius) and chief-settings.spec inset assertions
stayed green after the change (this branch e2e:affected 663 passed).

## Gate two-way verification (gate-demo-*.txt in this directory)

1. `gate-demo-1-red.txt` — a line of unregistered `rounded-none` square-corner box is stuffed into a consumption file: red, exit 1.
2. `gate-demo-2-green.txt` — the same line registered into the ledger: green, exit 0.
3. `gate-demo-3-stale-red.txt` — the line is fixed (rounded-lg) but the ledger entry stays: STALE red, exit 1.
4. `gate-demo-4-green.txt` — the entry is deleted with the fix in the same PR: green, exit 0.
