# Paper settings list: account page and agent overview

`capture.mjs` loads `/app/account?scenario=13` and
`/app/resources/agents/r3-builder?scenario=agent-detail` at 1440x900, DPR 2,
in light and dark, from a vite dev server of the branch under test. `before`
is `origin/main` at 4c976cfd, `after` is this branch. `<label>-rows.json`
holds each card child's height, top border, bottom border and background, plus
the card's radius, background and box-shadow.

Row heights (px, card children top to bottom):

| page | before | after |
| --- | --- | --- |
| account | head 120, rows 49 / 57 / 41 / 41 | 52 / 52 / 52 |
| agent overview | head 120, rows 49 / 75 / 57 / 41 / 41 / 41 | 65 / 52 / 52 / 52 / 52 |

The agent 职责 row is 65px because its sub-line wraps to two lines.

Before: rows filled `#ebe4d8` with `#ece5da` top borders, a white 120px block
holding only the avatar, 16px corners and a `ring-foreground/10` outline.
After: no row fill, dividers only between rendered rows (`divide-y`, 1px
`--border`), 12px corners, a 1px `--border` ring.

| file | what it shows |
| --- | --- |
| `before-light-account.png`, `after-light-account.png` | account page, light |
| `before-dark-account.png`, `after-dark-account.png` | account page, dark |
| `before-light-agent.png`, `after-light-agent.png` | agent overview, light |
| `before-dark-agent.png`, `after-dark-agent.png` | agent overview, dark |
| `after-light-account-editing.png`, `after-dark-account-editing.png` | 编辑名称 open: input, 保存, 取消 |
