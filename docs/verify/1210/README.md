# #1210 验收证据 · local 形态执行面 fail-loud（C 兜底）

probe = `.claude/skills/verify-pacman/scripts/drive-1210-local-unreachable.mjs`（随本 PR 进仓）。
两腿取证：`after/` = 本分支栈（8804/5284），`before/` = origin/main 一次性 worktree 栈（8805/5285，`--expect=old` 断言反转）。
结果：after **17/17 PASS**、before **14/14 PASS**（`*/result.json` 的 checks 逐条）。

## 复跑配方

```sh
# 1. after 栈（交付分支 worktree，须已 corepack pnpm install）
VERIFY_PORT=8804 VERIFY_WEB_PORT=5284 node .claude/skills/verify-pacman/scripts/launch.mjs
node .claude/skills/verify-pacman/scripts/drive-1210-local-unreachable.mjs --expect=new

# 2. before 栈（origin/main 一次性 worktree；probe 用交付分支副本，#1035 配方）
git worktree add --detach /tmp/pacman-before-1210 origin/main
cd /tmp/pacman-before-1210 && corepack pnpm install
VERIFY_PORT=8805 VERIFY_WEB_PORT=5285 VERIFY_REPO_ROOT=/tmp/pacman-before-1210 \
  node /tmp/pacman-before-1210/.claude/skills/verify-pacman/scripts/launch.mjs
cd <交付分支 worktree>
VERIFY_REPO_ROOT=/tmp/pacman-before-1210 \
  VERIFY_RUN_DIR=/tmp/pacman-before-1210/.claude/verify-run \
  node .claude/skills/verify-pacman/scripts/drive-1210-local-unreachable.mjs --expect=old

# 3. 收尾：两栈各跑 cleanup.mjs（before 栈带 VERIFY_REPO_ROOT/VERIFY_RUN_DIR 同前缀）
```

回环命令一律 `env -u http_proxy -u https_proxy -u all_proxy NO_PROXY='*'` 前缀（本机代理拦回环）。

## 判读

| 判据 | after（本分支） | before（origin/main） |
|---|---|---|
| 步终态 | failed（不挂起） | failed（同） |
| build.errorMessage | 合成文案：点名机器「verify-1210」+ 仓路径 + 「路径不存在」+ 补法①钉选改回/②GitHub 形态 | `git clone failed (128): fatal: repository '<path>' does not exist` |
| clone 是否尝试 | 否：daemon.log 零 `Cloning` 行，fail-fast elapsed≈1.0s | 是：`Cloning` 行在案，elapsed≈7.0s（withGitNetRetries 1s+5s 退避烧完） |
| workspace 材料化 | 无（基座目录不存在） | 无（clone 失败残目录已自清） |
| 详情页 | 失败卡渲染合成文案全文（`after/leg-a-detail-failed.png`） | 渲染裸 git 错误（`before/leg-a-detail-failed.png`） |
| 腿 B（仓库所在机回归） | `Cloning <路径>` + `Worktree added` + conv worktree README 内容对；终态 failed 仅因 stub 零改动产物闸（`构建零改动`），文案不含不可达串 | 同左（行为零漂移） |
| 凭据面 | local 形态凭证恒 null；errorMessage/日志零 token/password 字样（单测 L5 同断言） | 同 |

## 文件

- `*/result.json` — checks 逐条 ok/label（通过数以本文件与 PR body 引的数字为准，与 result.json 一致）
- `*/leg-a-error-message.txt` — 步 errorMessage 全文（after = 合成文案，before = 裸 git 错误）
- `*/leg-a-build-row.json` / `leg-b-build-row.json` — SQLite build/step 行投影（#920 gotcha：errorMessage 在 build 行，终态看 step 行）
- `*/leg-a-todo-record.json` — REST `GET /api/todos/:id` 真值（phase=failed）
- `*/leg-a-detail-failed.png` / `leg-b-detail-after.png` — 详情页截图（1440×732）
- `*/daemon-console.log` — probe 侧 daemon stdout/stderr；`<daemon home>/daemon.log` 摘录见 result.json checks detail
- `*/leg-b-workspace-state.json` — 基座 origin / conv HEAD git 实物
- `*/leg-a-elapsed-ms.txt` — 步 claim→终态墙钟（fail-fast 与退避烧尽的对照，信息位；确定性判据是 `Cloning` 行有无）
