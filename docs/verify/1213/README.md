# #1213 双执行源（ADR 0017）live 验收证据

probe：`drive-1213-dual-source.mjs`（verify-pacman 定制探针；栈 = launch.mjs 隔离
实例 server 8791 + web 5273 + 独立 PACMAN_HOME；真 daemon ×2 + stub LLM 自回收）。
结果：**15/15 checks PASS**（`result.json`）。

## 场景

真值远端 = 公共仓 `octocat/Hello-World`（cloneUrl 派生
`https://github.com/octocat/Hello-World.git`，匿名 clone/fetch）。本地加速位种子 =
该仓的真克隆，`master` 引用故意回退到旧提交 `553c207`（真值 tip =
`7fd1a60`）——新鲜度判定的活证据：本地源落后时，材料化后 worktree 仍须落在
远端 tip。

| 腿 | 动作 | 判据（证据文件） |
|---|---|---|
| server 松绑 | POST github 项目（无 localPath）→ PATCH 挂加速位 → SQLite 行 | `patch-localpath.json` / `sqlite-project-row-localpath.json`：githubRepo 与 localPath 并存；server 只验绝对路径形态，不验存在性（路径活在执行机） |
| web 最小面 | 设置页（浏览器真用户路径）字段显示 server 真值 → 改值保存 → PATCH 落库 | `settings-field-before.png` / `settings-field-after.png` / `project-record-after-ui.json` |
| daemon A（本机加速位可见机） | build 1 认领 → workspace 物化 | `daemon-a-source-log.txt`：`[workspace] Repo source: local-path <path>`；`daemon-a-repo-state.json`：基座 origin 重指真值 URL；conv worktree HEAD = `7fd1a60`（fetch 到远端 tip，非本地旧 sha `553c207`） |
| localPath 失格 | PATCH localPath → 不存在路径（票面动作） | `sqlite-project-row-badpath.json` |
| daemon B（失格机，基座缺位） | build 2 认领 → 静默回落 | `daemon-b-source-log.txt`：`[workspace] Repo source: github-clone (local-path <path> not found)`；`daemon-b-repo-state.json`：基座 = 真 GitHub clone，worktree HEAD = `7fd1a60` |

两腿 build 步终态 = `failed`（stub LLM 零改动 → 产物闸红）属预期——材料化
seam 在会话之前，本票验收面 = 选源日志 + git 实物，与步成败无关。

## 复跑配方

```sh
node .claude/skills/verify-pacman/scripts/launch.mjs          # 起隔离栈
node .claude/skills/verify-pacman/scripts/drive-1213-dual-source.mjs
node .claude/skills/verify-pacman/scripts/cleanup.mjs
```

需要真 GitHub 网络（clone/fetch 匿名可达）。双 daemon 各持各的 api-key（#895
gotcha）；杀 A 后等 80s 过僵尸 claim 窗再派 build 2（#1025 gotcha）——脚本内置。

## 单元 / e2e 面

- server：`apps/server/test/project-dual-source.test.ts` 14/14（POST/PATCH/claim
  载荷三面）+ 既有 60 回归全绿。
- daemon：`apps/daemon/test/workspace-source.test.ts` 8/8（归一化、双条件三态、
  TOCTOU 回落、默认分支重钉、零漂移）。
- web：`apps/web/e2e/project-settings-local-path.spec.ts` 2/2（live-stub 钉 wire
  body：保存 `{localPath:'<path>'}`、清空 `"localPath":null` 显式键、hosted 不
  显示）；affected e2e 全量 917 绿。
