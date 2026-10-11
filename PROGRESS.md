# PROGRESS — #1153 tracer 持续派发环端到端

## 理解（任务 0，2026-10-11）

目标：在 mea 真栈上把「投喂 chief → 拆卡 → 并发实现 → PR → CI 红自动修 → 绿进 review → 静默死机换机续跑」跑穿，实物证据落 `docs/verify/1153/`。
顺序：升级 mea 栈到 main（含四前置）→ 补 GitHub 连接（CI 磨绿硬前置）→ 起第二 daemon（换机认领者）→ 找 3 个真 bug → 投喂 → 观察并发/磨绿 → SIGSTOP 换机 → 归档开 PR。
最大风险：① relay 通道（glm-5.3）跑不动真 build——先小步探针；② mea 无 github_connection 行且 OAuth 回调不指向 mea——用产品自有 seal 通道手工落 token 行（可逆，删行即恢复）；③ WSL 宿主睡眠/闪断——远端长命令带 ServerAliveInterval，证据即产即传回 Mac。

## 关键事实（侦察所得，file:line）

- 阈值：`MACHINE_STALE_OFFLINE_MS=150_000`（machines.ts:690）+ scheduler tick 15s；claimed 步释放 `BUILD_ABANDONED_STEP_MS=120_000` 且 machine offline（builds.ts:964,1070）→ SIGSTOP 后预计 ~165–195s 释放；释放即 wake，B 机 75s 长轮询立即重领。
- 每步收尾自动 commit+push conv 分支（runner.ts:1457，需 agent 有「推送分支」工具——试点-glm5.3 有）；worktree base=origin/conv 分支（workspace.ts 头注）→ 换机续跑可恢复。
- build 不得钉选（pinnedMachineId=null）才会跨机重领；钉选机离线 → 失败收尾不换机（builds.ts:1032）。chief 派发默认不钉。
- CI 磨绿（ci-loop.ts）：60s 轮询 PR checks；pending 不动、红派 `[ci-fix]` 修复步（同 conv 同分支）、绿推 review；同 build 连修 3 轮仍红 → failed；空 checks 宽限 300s。**读 checks 靠 openGithubToken = github_connection 行，mea DB 现为 0 行（硬缺口）**。
- token 闸：API 全走 `Authorization: Bearer <PACMAN_TOKEN>`；SSE 两端点可用 `?token=`。mea 的 token 在 `~/.pacman-519/token.txt`。
- SecretBox keyfile：`<dataDir>/secretbox.key`（config.ts:126）= mea `/home/measure/.pacman/server/secretbox.key`。
- 并发上限写位：PATCH machines（routes-resources.ts:151，#1108，值域 1..16）——可短暂调小演示「第 N+1 步不领」，用毕恢复 3。
- daemon 非交互 enroll：`cli.ts start -f --api-key <k> --team <id> --name <n> --server <url>`（cli.ts:107-110）。
- pi 后端已内置 relay 兼容自学习（pi.ts:868-897：400 → max_tokens/无 store 回落），9999 shim 单元已不存在 = 已退役，provider 直连 relay（112.80.47.186:8783/v1，openai-completions）是现行形态。
- **PR 是 build agent 用机器上的 gh CLI 自己开的**（github-probe.ts 头注：「机器 gh 梯在前——agent 开 PR 用的就是它」）；产品侧只读探测回填 prNumber。mea 的 gh 已登录 xiechimon（repo+workflow scope）✅。
- **pr-evidence.yml 对一切 PR 生效且无豁免**（opened/edited/synchronize/reopened 全触发）→ 真仓 build PR 的 body 必缺六节 → 该 check 恒红 → 会污染磨绿环（fix agent 只有 git 凭证改不了 body……实际 gh 登录态在机器上，理论上能改，但不可靠）。**对策：真仓卡在卡文本明令「只推分支不开 PR」（done 后无 PR 直进 review，ci-loop 头注）；磨绿环走 dogfood 仓（唯一 check = gate.yml，5s，确定性：fail.marker 在 = 红）**。
- dogfood 仓 gate 语义（.github/workflows/gate.yml）：head 有 `fail.marker` → exit 1；无 → pass。main 现绿。README.md **缺尾换行**（末字节 `.`，sha e30915f）= 真实小缺陷候选。仓里 #1150 遗留 PR #1 仍 OPEN（不动它，非本次产物）。
- 并发闸：claim 面按 machine.maxConcurrent 过滤（machines.ts claimCandidates）；PATCH /api/machines/:id 可写 1..16（routes-resources.ts:151）。队列演示配方：A 机 cap 暂置 1 → 3 卡 = 1 claimed + 2 pending（#1108 投影可见），取证后恢复 3。
- chief 步不占槽（#1148）→ cap=1 时 chief 回合仍可跑。chief create_todo 带 projectId（chief-tools.ts:429）→ 卡可跨项目分派。
- 机器 A cgroup = `/user.slice/user-1000.slice/user@1000.service/app.slice/pacman-daemon.service`（3 pid），chief daemon 是**另一个 cgroup**（7 pid，全程不碰）；SIGSTOP/CONT 脚本 `/tmp/1153/sigstop-a.sh` / `sigcont-a.sh` 按 cgroup.procs 清单操作。
- 步释放时序（任务 4 预期）：SIGSTOP → 心跳停 → ≤150s+tick(15s) 翻 offline → claimed 步 `BUILD_ABANDONED_STEP_MS=120s` 且 machine offline → releaseClaimedStep → wake → B 机 75s 长轮询立即重领；合计约 165–195s。
- **drawio 退役口径冲突裁决**：brief 说「不要再画 drawio 图（2026-10-11 起退役）」，但 main @21a10d3c 的 `.github/PULL_REQUEST_TEMPLATE.md` 与 pr-pacman 技能仍要求 What 嵌 `.drawio.svg`。pr-evidence 闸只强制 Verified/Upstream 两节 + 嵌图 200（图属 review 层，skill 表自认「gate passes a text-only body」）。**按 brief（票面即规格）执行：不画图、What 嵌截图（raw SHA 永久链）**；PR 里注明该偏离。
- ci-loop 轮询已在升级后的 server 上实测每 60s 一行 `ci pr-checks sweep`（journalctl，任务 3 证据源之一）。
- mea 现状：dev-server/dev-web/daemon/daemon-chief 四 unit active；仓在 fdb191e，落后 origin/main(21a10d3c) 11 提交，**无 lockfile/依赖变更**，有一个新迁移 0034；机器 mea-wsl 在线（cap 3，runtimes pi+claude-code）、DESKTOP-N9CSRE4 离线（陈旧行，不动）；agent 试点-glm5.3（relay-186/glm-5.3）；chief 行存在；pacman-db-backup.service 处于 failed（dmit 179.255.103.75:22 超时，本地腿成功——**先前已坏，非本次引入，只记录不修**）。
- daemon-chief unit enroll 的是 Mac 的 server（100.125.21.46:8787），与本 E2E 无关，**全程不碰**（SIGSTOP 只打 pacman-daemon.service 的 cgroup，严格区分两者）。

## 决定与解释（「建议」级偏离记录）

- 「换机续跑」用 mea 上第二个 daemon（独立 PACMAN_HOME `/home/measure/.pacman-1153b`、独立机器身份）实现：机制面（presence 翻转、步释放、重领、tip 对账）全在 server 侧，第二认领者不要求异硬件；比在 Mac 起 daemon 少一层代理/tailnet 变量。收工清理该一次性进程与目录。
- GitHub 连接：OAuth 流需要 GitHub App 回调 URL 含 mea 地址（不可改，需用户浏览器操作），改走产品自有密封通道——在 mea 上用仓内 tsx + `upsertGithubConnection`（github-connection.ts 唯一写点）+ 既有 keyfile 落一行，token 用用户自己的 gh token（与 Mac 栈 DB 里那行同族同密封形态）。可逆：删行即恢复。token 值不回显、不落证据。
- UI 截图走 mea vite :5173（bound 0.0.0.0，pull 后即最新代码）；:8787 同源 dist 陈旧（10-08），不作为证据面。

## 检查单

- [x] 任务 0：栈探活 + 前置核对（#1136/#1148/#1149/#1150 全 CLOSED，PR #1146/#1182/#1189/#1183 全 MERGED）+ 本文件
- [x] A：mea 栈升级（停 unit → DB 备份 `~/backups/pacman/manual-pre1153-20261011T054902Z.db.gz` → ff pull fdb191e→21a10d3c → 起 unit → 迁移 35 行含 0034 → 401/200 健康探针）
- [x] B：github_connection 落行（xiechimon，repo+workflow scope，经仓内 seal 通道；token 值不回显不落盘）+ repos 代理读面 200
- [x] B2：server 出站代理（dev-server unit 加 HTTPS_PROXY/NO_PROXY/NODE_OPTIONS preload，原件备份 `~/pacman-1153-ops/pacman-dev-server.service.orig`，收工恢复）
- [x] C：relay 隧道（Mac 后台 ssh -R，`/tmp/1153-tunnel-loop.sh`，pid 文件 /tmp/1153-tunnel.pid）+ provider baseUrl 切 `http://127.0.0.1:18783/v1`（原值 `http://112.80.47.186:8783/v1`，收工恢复）+ LLM 冒烟 200/"ok"/3.5s
- [x] D：dogfood 项目注册（`zOizAlw_UGDkUE-pUYqFz`）+ 机器 B enroll（`Pakgtz1UfmlmMqC2Pq4xe` mea-wsl-b，已干净 SIGTERM 离线；key 存 mea `~/.pacman-1153b/enroll-key.txt`，任务 4 前再启）
- [x] 证据脚手架：`/tmp/1153/{shot.mjs,snap.sh,watch-machines.sh}`；基线快照 `docs/verify/1153/snapshots/20261011T061341Z-baseline/`（双钟 + SQLite + API + 看板截图）
- [x] E：真 bug 选定（子代理侦察 5 候选，取机械度最高 3 条）：①docs/spec/09-前端风格统一-A6.md:131-132 死链接少 `../`；②apps/web/src/i18n/en.ts:839 「创建标签」错译 Create labels→Create tags；③dogfood README 缺尾换行（+fail.marker 注入红腿）。弃 #5（删仓根 plan.md/BLOCKED.md）——BLOCKED.md 是本任务自己要维护的文件，删除自相矛盾；#3（documents.ts diff 计数边界）留作备用。
- [x] 投喂：chief 线程 `chief-01a129a0-adb1-7be4-ac54-e794a4cd6dc5`（06:22Z POST /chief/threads）；A 机 cap 已暂置 1（队列演示，取证后恢复 3）；chief 步 claimed 心跳活（step PQLSX6xg）
- [x] 任务 1：投喂 chief → 拆卡。证据 `task1-feed/`：01 抽屉思考中截图、02 api-todos 三卡、03 看板三卡、04 chief 的 3×create_todo（projectId 正确）+2×run_builds（dispatchReason 逐字）
- [~] 任务 2：cap=1 生效已有 SQLite 实证（cards-dispatched 快照：al7X pending 无 machineId + 两卡 claimed/done 交替）；**队列 UI 截图窗口两次错过**（首窗 ~40s、二窗秒级），watcher 等 chief 补救回合双重重派的自然窗口
- [x] 任务 3：CI 磨绿全链跑穿。证据 `task3-grind-green/`：checks-red.json（gate×2 failure @06:31:47/59）、checks-green.json（gate×2 success @06:33:55/59）、server-journal（06:33:30 appended=1 / 06:34:30 skipped=1 在飞不叠派 / 06:35:31 advanced=1）、fix 步 prompt `[ci-fix]` 头行、todo phase building→review、卡详情截图（红腿+修复预案逐字）
- [x] 缺陷票 **#1195**：agent 自切非 conv 分支开 PR（#5/#7 真交付+checks 绿）但产物闸按 conv 分支计零改动判 build failed、chief 收 [wake:failed] 误导补救（卡 4/5 首轮全中）
- [~] 任务 4：leg-3 完整拿到「冻结 07:20:45Z → 翻转 07:23:17Z（last presence 07:20:40，≤150s+tick 判据内）→ 步释放（claimed→pending）」+ A 复活后上行全被 `404 (not yours)` 拒（跨机守卫实证）；释放步因我启 B 慢了一拍落「本轮无人认领」fail（原因逐字落盘，诚实记录）。leg-4 冻结在 claim+30s 仍晚于 fix 步 ~20s 的中段 push（glm 太快）→ CONT 放弃该腿冻结（无翻转），leg-4 正常跑完作第三绿腿。**clean-resume 腿改 leg-5：withPlan=true，plan 步先落 conv 边界提交，build 步收尾才 push（分钟级窗口），freeze 在 build 步 claim+60s**
- [ ] 任务 5：证据归档 docs/verify/1153/ + index + 栈恢复原状 + PR（六节 body，closes #1153 在 commit 尾行，不自动合）

## 执行日志

- 2026-10-11 13:30~14:00 侦察完成（上文事实全部实测所得）；本文件初版。
