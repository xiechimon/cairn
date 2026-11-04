# Paper resource pages

`capture.mjs` loads each page from a fixture build served by `vite preview`
at 1440x900, DPR 2, in light and dark. `before` is `origin/main` at
9a50236c, `after` is this branch. File names are
`<label>-<theme>-<shot>.png`.

| shot | URL | what it shows |
| --- | --- | --- |
| `skills-empty` / `skills-list` | `/app/resources/skills?scenario=01` / `06` | empty state; one skill row |
| `mcp-empty` / `mcp-list` | `/app/resources/mcp-servers?scenario=01` / `07` | empty state; one server row |
| `secrets-empty` / `secrets-list` | `/app/resources/secrets?scenario=01` / `agent-detail-secrets` | empty state; two secret rows (before: the page ignored fixture secrets, so it shows the empty state) |
| `machines-empty` / `machines-list` / `machines-chief` | `/app/resources/machines?scenario=01` / `06` / `machines-chief-state` | empty state; two machines; chief host / running / waiting annotations |
| `machine-detail` | `/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06` | detail as a settings list + danger zone |
| `providers-empty` / `providers-pi` / `providers-cc` / `providers-cc-missing` | `/app/resources/providers?scenario=01` / `06` / `06&runtime=claude-code` / `10-cc-missing&runtime=claude-code` | no source; pi models; Claude Code models; `未安装` head |
| `dialog-skill`, `dialog-skill-import`, `dialog-secret`, `dialog-provider`, `dialog-machine` | as listed in `capture.mjs` | create dialogs |

Before: orange tinted icon tiles on skills / MCP / secrets empty states and
rows, one card per skill / MCP / secret row (16px corners, 62-64px rows),
machines rows at 40px with orange monitor tiles and a dashed full-width
`添加机器` bar,
providers runtime head in a card of its own and slot pills, full-width submit
bars in the secret / skill / import / provider dialogs.

After: every empty state is `EmptyState` (bare 24px ink-3 icon, card-title
heading, one primary button, optional hint). Every list is one settings card
(10px corner, 1px ring) of 52px rows: name + meta left, status and controls
right. Machines: `添加机器` in the top bar, online status = green dot + `在线`.
Machine detail: `状态` / `运行时` / `并发上限` / `整机迁移` rows, then the agent grid,
then a danger zone whose `删除` opens a confirm dialog. Providers: runtime tabs
on the Paper segmented face, runtime head above the model card (`未安装` /
`未登录` in the accent with an alert icon), slot as mono meta on the right.
Create dialogs: FormStack / FormField with 32px boxed controls and a
FormActions footer (`取消` + primary), no full-width bar.
