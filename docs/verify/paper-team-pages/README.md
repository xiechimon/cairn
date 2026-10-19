# Paper team pages: team grid, org chart, agent detail tabs, create-agent dialog

`capture.mjs` loads each surface at 1440x900, DPR 2, in light and dark, from a
vite dev server of the branch under test. `before` is the branch at 435c2dfd
(origin/main 9a50236c plus the new `team-roster` fixture only), `after` is the
converted branch. `<label>-metrics.json` holds the first agent card's box,
radius, fill and box-shadow, and the grid/chart switch track and selected tab.

Scenarios: `/app/team?scenario=team-roster` (4 agents: two on an online
machine, one on an offline machine, one with no home machine; chief bound to
r3-builder) and `/app/resources/agents/r3-builder?scenario=agent-detail`.

Agent card (light, from the metrics files):

| | before | after |
| --- | --- | --- |
| box | 378 x 76 | 378 x 64 |
| radius | 14px | 10px (`--radius-card`) |
| outline | `ring-foreground/10` | 1px `--border` ring + `0 1px 2px` 4% lift (`--panel-shadow`) |
| lines | name, model + machine, role | name, model · machine, status (icon + colour + label) |

Grid/chart switch (light): before a `--muted` track (#ebe4d8, 28px, 10px
corners) with a `--background` chip; after a `--canvas` track (#f3eee5, 32px,
8px corners) with a white chip and a 1px `--border` ring, the SettingsSegmented
look, moved into the top bar next to 设置 and the 创建 Agent primary.

| file | what it shows |
| --- | --- |
| `before-light-team-grid.png`, `after-light-team-grid.png` | team grid, light: dashed 创建 Agent card gone, action in the top bar |
| `before-dark-team-grid.png`, `after-dark-team-grid.png` | team grid, dark |
| `before-light-team-chart.png`, `after-light-team-chart.png` | org chart, light: Paper nodes, no dashed create node |
| `before-dark-team-chart.png`, `after-dark-team-chart.png` | org chart, dark |
| `before-light-agent-permissions.png`, `after-light-agent-permissions.png` | agent 权限 tab, light: card-title group heads, empty 密钥 row centred |
| `before-dark-agent-permissions.png`, `after-dark-agent-permissions.png` | agent 权限 tab, dark |
| `before-light-agent-memory.png`, `after-light-agent-memory.png` | agent 记忆 tab with no memories: EmptyState |
| `before-dark-agent-memory.png`, `after-dark-agent-memory.png` | agent 记忆 tab, dark |
| `before-light-create-agent.png`, `after-light-create-agent.png` | create-agent dialog, light: FormField labels, boxed controls, 取消 + 创建 row |
| `before-dark-create-agent.png`, `after-dark-create-agent.png` | create-agent dialog, dark |
