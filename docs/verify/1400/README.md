# #1400 evidence: one meaning for 待处理

Base build = `89cc029` (origin/main before this change). Branch build = `claude/elegant-ride-0ynxia`.

## Live probe: `drive-1400-chip-word.mjs`

Pure live stack (server + vite dev, scratch `PACMAN_HOME`), no daemon, no LLM. Seeds one project, three todos (fresh `todo`, `queued`, `confirm`; the last two set with `UPDATE todo SET phase` on the scratch SQLite) and a daily schedule on the fresh todo. Light theme, real clicks.

| leg | stack | result | folder |
|---|---|---|---|
| branch, `--expect=new` | 8791 / 5273 | 16/16 PASS | `new/` |
| base `89cc029`, `--expect=old` | 8792 / 5274 (worktree) | 15/15 PASS (records 待处理 on todo / queued) | `old/` |

Each folder holds `result.json` (checks, SQLite rows, API reads) and the screenshots:

- `01-board.png`: fresh and queued cards in 待开始, the confirm card in 待处理.
- `02-detail-{fresh,queued,confirm}.png`: detail header chip.
- `03-search.png`: ⌘K rows for `verify 1400`.
- `04-schedules.png`: the schedule card on the fresh todo.
- `05-project.png`: project task row status.

## e2e

- `e2e-old-leg.txt`: `e2e/phase-chip-words.spec.ts` on `89cc029`. 4 failed (`Received: "待处理"` on detail header, search rows, project rows, schedule cards), 1 passed (board columns).
- `e2e-new-leg.txt`: `phase-chip-words` + `agent-detail` + `paper-project-page` on the branch. 55 passed.
- `e2e-affected.txt`: `pnpm e2e:affected` on the branch. `phase.ts` is a shared surface, so it fell back to the full suite: 1078 passed, 4 failed.
- `e2e-preexisting-on-base.txt`: the 4 failing tests on `89cc029` with `--repeat-each=3`. `accent-typo` sidebar mark fails 6/6 (`mask-size` computes `100%`, the spec wants `100% auto`), `segmented-controls` sched freq 3/3 and page-tab 2/3 (the mouse still rests on the idle option after re-navigation). The same failures occur without this change.

## Rerun

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1400-chip-word.mjs            # branch
# base: launch that worktree's stack with VERIFY_REPO_ROOT / VERIFY_RUN_DIR / VERIFY_PORT=8792 / VERIFY_WEB_PORT=5274
node .claude/skills/verify-pacman/scripts/drive-1400-chip-word.mjs --expect=old
```
