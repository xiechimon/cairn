# Paper project page (#1397): evidence

The project page 任务 / 文件 tabs on the Paper page patterns. Shots are
1440x900 at DPR 2, light and dark, from a `vite build --mode fixture` bundle
served by `vite preview` (before = origin/main 3f3ea2d, after = this branch):

    node docs/verify/1397/capture.mjs <before|after> http://127.0.0.1:<port>

| shot | what it shows |
| --- | --- |
| `*-tasks-list.png` | scenario prj-tasks, list layout: one review task, one done task |
| `*-tasks-grid.png` | same, grid layout (`pacman.projectTasksLayout=grid`) |
| `*-tasks-empty.png` | scenario r2-24b, project without tasks |
| `*-files-viewer.png` | scenario prj-local-files, README.md selected in the tree |
| `*-history-detail.png` | same, 历史 segment, first commit open in the detail pane |
| `*-files-github.png` | live build with stubbed `/api`: GitHub project, files live on GitHub |

`before-metrics.json` / `after-metrics.json` hold the measured boxes. Light
theme, after vs before:

- 任务 body: the 768px reading column (`page-col`) like every other list page; before it bled across the 1150px sheet.
- task list: one white `--radius-card` (10px) card of 52px rows with dividers between rows; before, 36px grey tiles (`bg-muted/50`, 10px corners) with a gap between them.
- task row: title 13.5px (`text-ui`, was 14px), a meta line `#seq · 相对时间` in 12px ink-3, and the status as icon + word in the phase ink (审核 terracotta, 已完成 ink-3) in place of the decorative checkbox. Done titles drop to ink-3.
- grid card: `--radius-card` 10px (was the registry 14px), status + avatar on top, 14px title.
- empty state: the shared `EmptyState`, bare 24px ink-3 icon (was a 32px beige tile), one 32px primary named 新建任务.
- file tree: selected file is the picker face (white card + 1px ring, was a muted fill); pane stays 276px (`w-69`).
- history row: message 13.5px (was 12px), meta 12px ink-3 (was 11px ink-2); author and time in sans, only the sha in mono, so `c1d2e3f` still fits the 276px pane.
- commit head: message 13.5px (was 13px), meta 12px ink-3 (was 11px).
- `pages/project-page.tsx` carries no arbitrary text or spacing values; debt baseline 51 -> 43 text, 76 -> 69 spacing.

Gate output: `gates.txt`. e2e: `e2e.txt`.
