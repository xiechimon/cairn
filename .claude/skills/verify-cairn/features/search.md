# Search (sidebar ⌘K panel)

Users open the global panel from the sidebar search row; typing filters tasks: result rows = task title + project sub-line + time tag; hits converge live, Esc / outside click closes.

## Sub-features

- `search-open` the sidebar `.rail-row[aria-label="搜索"]` (resident in the collapsed state too) opens `.search-panel`; the panel's `.search-input-row input` is the focus position.
- `search-match` typing filters live todos, hit rows are `.search-row--todo` (title `.search-row-title` + project sub-line `.search-row-sub`).
- `search-nav` clicking a result row enters the task detail (`/app/todo/:id`).

## How to get to it (user POV)

- The ⌘K shortcut (any shell page; input is focused on open).
- The expanded sidebar `搜索` row (`button.sidebar-row`, carrying a ⌘K badge); collapsed state is `.rail-row[aria-label="搜索"]`.
- Driving (`vp.mjs list search` lists all cases and usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive search search`: ⌘K, type the title, the hit row is visible.
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive search project-line`: the result row's second line is the task's own project; requires a fresh stack (the first drive after launch, otherwise it refuses to run).

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` stack up + `doctor.mjs` fully PASS.
- At least one task to search — the probe seeds it itself via public REST (creating the project `搜索验证` + one task with a timestamped title); the seeding is not the path under test.

- **Search hit.** ⌘K -> type the target title. Run `node <skill>/scripts/drive.mjs search`. Chain: ⌘K opens the panel (the hotkey listener registers in a passive effect, a lost key needs a re-press, copy the e2e search-focus.spec.ts recipe) -> fill `.search-input-row input` -> the `.search-row--todo` row containing the target title is visible. Evidence `02-search-results.png` + `result.json` (searchTarget field).
- **Sidebar row entry.** Manually after the probe: in the expanded state click `button.sidebar-row` (carrying the `搜索` copy) / in the collapsed state click `.rail-row[aria-label="搜索"]`, the panel opens the same.
- **Enter detail.** Manually after the probe: click the hit row, the URL changes to `/app/todo/<id>` (the detail-page live surface itself is not in the map; only the route jump is asserted, not the detail content).

## Gotchas

- **The sidebar row selector splits by state**: expanded state is `button.sidebar-row` (no aria-label), collapsed state is `.rail-row[aria-label="搜索"]`; the default is expanded, taking rail-row as the only entry always times out at 30s. ⌘K has no such pitfall.
- The first ⌘K press may land before hydration (the listener registers in a passive effect): a lost key needs a re-press, stop once the panel is visible, do not blind-press (a double toggle closes it back).
- The panel filtering is client-side over the current todos query set — a just-created task may not have converged via SSE/refetch, wait a beat before asserting; after REST seeding the probe waits 10s.
- Assert rows with `.search-row--todo` + title text, do not count all `.search-row` (the panel also has non-task row shapes).
- The input is inside `.search-input-row`; reopening the panel after close is retained-mount (the input is not cleared), do not be fooled by the previous run's leftovers in consecutive verifications.
