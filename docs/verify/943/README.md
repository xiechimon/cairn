# #943 board/sidebar domain construction — verification evidence

Ticket: #943 (#908 wave 1 · acceptance template v2's first verification lane). This directory = the artifacts for three of the acceptance's seven items: "probe re-pin", "better-colors measurement", and "verify-pacman evidence archive".

## Contents

| path | content | acceptance item |
| --- | --- | --- |
| `probe-dump/probe-comparison.md` | the #921 tool comparison table (18 specs, 224 visual rows): **KEPT 224 / DRIFT 0 / VIOLATION 0 / NOT-RUN 0** | 2 |
| `probe-dump/probe-dump.json` | the structured full dump (sites/values/rows) | 2 |
| `contrast-943.md` | better-colors dual-theme 32-pair measured table (rendered pairs + token-resolved pairs, WCAG 2.x formula): **0 failures**; includes the notify-body pair caught by measurement and fixed (2.73→10.12) | 3 |
| `live-stack/drive-943-board-sidebar/` | custom probe (`drive-943-board-sidebar.mjs`, enters `.claude/skills/verify-pacman/scripts/` with this PR): A geometry 5 items (incl. A5 card-face project badge with skin — a missed-migration failure mode caught by the spec-axis review, explicitly pinning the rendered skin) + B component slot 1 item + C interaction real-path 14 items + D mechanism 2 items + E contrast dual-theme 2 items = **24 checks all PASS, failures 0**; screenshots 02-07 (board/rail/filter panel/user menu, both themes) + `result.json` + `contrast.json` | 3, 4 |
| `live-stack/drive-board/`, `live-stack/drive-new-task/` | existing probe regression (board layout / new-task full chain persistence): PASS | 4 |
| `local-full-e2e.log` | acceptance item 1 "one local full run before merge" artifact: full e2e on the final code (E2E_PORT=8398) **809 passed (1.9m)**, 0 failed, full log | 1 |
| `build-artifact-grep.txt` | compiled-artifact mechanism evidence: grep over the dist CSS of `vite build --mode fixture` — board.css retired selectors 0 hits, `body[data-board-dragging]` present, the utility class's new carrier present | 4, 5 |

## Reproduction

```sh
# probe comparison table (#921 tool; call node directly — pnpm forwards the `--` verbatim and trips unknown flags)
cd apps/web
node e2e/probe-dump.mjs --specs board-dnd board-dnd-live board-docked-reflow \
  board-filter board-overflow card-press sidebar-nav sidebar-seam \
  sidebar-search-offboard sidebar-visual shell-consistency user-menu-nav \
  user-menu-trigger hotkeys notify-banner chief-fab theme-toggle footer-copy \
  --out ../../docs/verify/943/probe-dump

# live stack (if the default ports are taken, move along — see the skill's port discipline)
VERIFY_REPO_ROOT=<worktree> VERIFY_PORT=8795 VERIFY_WEB_PORT=5277 \
  node .claude/skills/verify-pacman/scripts/launch.mjs
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive.mjs new-task
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/drive-943-board-sidebar.mjs
VERIFY_REPO_ROOT=<worktree> node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

## Scope notes

- Contrast floors: text 4.5, non-text UI 3.0 (better-accessibility); **consumer-face self-made pairs** outside the canon §1.7/1.8 gated pairs are measured against these floors (notify-body is exactly this class; the fix swaps the consumer-face slot reference, token values untouched).
- The two legitimate exclusions of the D1 mechanism scan: chief.css's `.board-shell > [data-base-ui-portal]` dock compound rule (the rule's address is chief.css = the #950 domain; `.board-shell` is a runtime hook) and Tailwind arbitrary-variant compiled selectors (the `.\[...` escaped shape — a utility class is not per-face CSS).
- Drag-tilt carrier: board.css's `transform: rotate(2deg)` migrated to TW v4's `rotate-2`; the computed carrier is now the standalone `rotate` property (`transform` always none), composing with the dnd-kit wrapper's translate into the same pixels; the board-dnd lift-face probe pins the new carrier as `rotate === '2deg'` (that row is KEPT in the probe-dump table).
