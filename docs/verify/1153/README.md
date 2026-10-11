# #1153 tracer 持续派发环端到端 — 证据索引

栈坐标：mea（WSL2，tailnet 100.65.44.76）systemd 三件套 @ main `21a10d3c`；server `:8787`（token 闸）、vite `:5173`；机器 A = mea-wsl（`DHS9BRFaSnKYVHx38VyOm`，systemd unit）、机器 B = mea-wsl-b（`Pakgtz1UfmlmMqC2Pq4xe`，一次性 daemon，独立 PACMAN_HOME `/home/measure/.pacman-1153b`）；agent = 试点-glm5.3（relay-186/glm-5.3，经 Mac→mea ssh 反向隧道 :18783）。
时间均 UTC；双钟对时见各快照 `clocks.txt`（Mac/mea 误差 <4s）。

## 任务 1 — 投喂 chief → 拆卡（`task1-feed/`）

| 文件 | 对应 |
|---|---|
| `01-chief-drawer-thinking.png` | 投喂后 chief 抽屉回合在跑（模型思考中） |
| `02-cards-api-todos.json` | 拆卡结果 API JSON（三卡：2×pacman + 1×dogfood，phase/build 关联） |
| `03-board-three-cards.png` | 看板三卡投影 |
| `04-chief-create-todo-run-builds.json` | chief 回合的 3×`create_todo`（projectId 逐字）+ 2×`run_builds`（dispatchReason 逐字） |

## 任务 2 — 并发：排队可见 + 上限生效（`task2-concurrency/`）

| 文件 | 对应 |
|---|---|
| `step-rows-sql.txt` | 步表 SQL 行：cap=1 期间 created→claimed 的等待窗（49s / 2m18s / 2m24s）= 第 N+1 步不领 |
| `queue-watcher-log.txt` | 轮询日志：claimed=1 & pending=1 同现时刻（06:50:13Z） |
| `01-board-queue-cap1.png` / `04-board-queue-window.png` | 看板：cap=1 时一卡执行中、另一卡未进执行列 |
| `02-machines-cap1.png` / `05-machines-1of1-running.png` | 同窗看板/机器面投影 |
| `06-pending-card-detail.png` | 卡详情（记账修复腿完成态，含 conv 分支对账自述） |

## 任务 3 — CI 磨绿：红 → [ci-fix] → 绿 → review（`task3-grind-green/`）

| 文件 | 对应 |
|---|---|
| `checks-red.json` | PR #3 首 head（fail.marker 在）gate×2 failure @06:31:47/59Z |
| `checks-green.json` | 修复 push 后 head gate×2 success @06:33:55/59Z |
| `server-journal-ciloop.txt` | ci-loop 对账行：06:33:30 appended=1（红派修复步）/ 06:34:30 skipped=1（在飞不叠派）/ 06:35:31 advanced=1（绿进 review） |
| `head-shas.txt` | 红/绿 head sha + PR #3 状态 |
| fix 步 prompt `[ci-fix]` 头行 | 见 `../snapshots/*-cards-dispatched/sqlite-rows.txt` 与本报告正文引用 |

## 任务 4 — 静默死机 → 判离线 → 换机续跑（`task4-silent-death/`）

主腿 = leg-8（clean resume，逐字命中验收口径）：

| 文件 | 对应 |
|---|---|
| `leg8-freeze-ts.txt` | 冻结前记录：build 步 claimed+心跳活、plan 边界提交 `b1afaf2b`、冻结时刻 08:39:04Z |
| `freeze-action-leg8.txt` | SIGSTOP 整树动作（cgroup 3 pid，STAT=T）与事后 SIGCONT 时刻 |
| `machine-flip-timeline-leg8.txt` | 3s 间隔机器在线轮询：08:41:14Z mea-wsl online 1→0（最后 presence 08:38:53，≤150s+tick 判据内） |
| `leg8-resume-ts.txt` | 释放（claimed→pending 08:41:2x）→ ungate B 08:41:41 → B 认领 08:42:30 |
| `tip-reconcile-B-leg8.txt` | **tip 对账**：B worktree HEAD = `b1afaf2b` = 死机前最后步边界 = origin conv 分支 tip（冻结期无新提交，见 `branch-commits-at-resume.json`） |
| `resume-commit.json` | B 续跑产出提交 `926d393b`，parents=[`b1afaf2b`] —— 续跑建在死机前进度之上 |
| `B-resume-session-excerpt.txt` | B 会话摘录：认 plan.md → install → 红腿探针复现缺陷 → 修 → 绿腿 → lint/typecheck/回归 → 单文件 commit |
| `01-machines-B-running-1of3.png` / `03-machines-B-resumed-leg8.png` | 机器页：B 执行中 1/3（跨机执行投影） |
| `02-leg5-card-resumed-on-B.png` | leg-5 卡详情（跨机拼接腿） |
| `04-board-after-leg8.png` | 全程结束后看板 |
| `daemonA-zombie-reject-leg8.txt` | A 复活后对已释放步的上行全被 `404 (not yours)` 拒（跨机所有权守卫） |

辅腿（同目录 + `snapshots/`）：
- leg-3：冻结 07:20:45Z → 翻转 07:23:17Z → 步释放；释放步因 B 启用慢一拍落「本轮无人认领」fail（`leg3-release-fail-reason.txt` 逐字）——操作时序教训，诚实记录。
- leg-5：跨机拼接全链（plan+build1 在 A → A 冻结 → B 续跑完成 → PR #16 红 → [ci-fix] 回 A → 绿 → review），`checks-red-leg5.json` / `checks-green-leg5.json` / `leg5-pr16-commits.json`。
- leg-4/6/7：冻结晚于 agent 中段 push 或步完成，未产生释放事件；`freeze-action-leg4.txt` / `freeze-action-leg6.txt` / `freeze-action-leg7.txt` + `leg4-freeze-ts.txt` / `leg5-freeze-ts.txt` / `leg6-freeze-ts.txt` / `leg7-freeze-ts.txt` 逐字记录各腿时刻与判空原因（不剪辑）。

## 收尾（栈恢复原状）

- daemon B 进程已杀、`/home/measure/.pacman-1153b` 归档（`~/backups/pacman/pacman-1153b-home.tgz`）后删除；机 B 行无 DELETE 路由，留作离线陈旧行（与既有 DESKTOP-N9CSRE4 行同形态）。
- 我建的两条 api_key 行已 SQL 删除；github_connection 行经 DELETE API 删除（`connected:false` 回读）；provider baseUrl 回 `http://112.80.47.186:8783/v1`（回读确认）。
- dev-server unit 文件从 `.orig` 恢复（preload/env 注入摘除，`grep -c proxy-preload = 0`）+ daemon-reload + restart；daemon A unit restart；Mac 侧 ssh 反向隧道循环已杀（`tunnel-dead-check:000`）。
- 狗食副产物（dogfood PR #3/#12/#14/#16、pacman conv 分支、review 相位卡）保留作证据，未合并未删除。

## 缺陷票

- #1195：agent 自切非 conv 分支开 PR 时产物闸误报「构建零改动」（卡 #5/#6 首轮实证：PR #5/#7 真交付且 checks 绿，build 仍 failed，chief 收 [wake:failed] 误导补救）。
