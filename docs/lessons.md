# 错误台账

过程中出过错、后来又修好的事，每一类记一行。规则：每一行必须有防护，防护按下面的阶梯取最高可行级；能做成机器检查的不许只停在文字。设计依据见 ian 在 2026-10-22 确认的方案「过程错误复盘机制」。

## 阶梯

1. 架构或类型让它写不出来
2. lint、脚本闸、测试、CI 检查
3. AGENTS.md 或提示词里的规则
4. 技能
5. 记忆（只对 Claude 线程有效，最软）

## 写法

- 一类错一行，同类合并，不开重复行。
- 新闸必须拿那次真实失误做负对照：旧错在新闸下变红，才算落地。
- 「拦截」记防护实际挡下的次数，「复发」记同类错又出现的次数。复发大于 0 说明这一层不够硬，升一级。
- 做不成机器检查的，在「备注」写明原因。

## 台账

| 类别 | 首次来源 | 级别 | 防护 | 拦截 | 复发 | 备注 |
|---|---|---|---|---|---|---|
| web PR 推送前漏跑 ui-debt 与 dead-class 两道闸，CI 红两轮 | PR #1523 (2026-10-22) | 2 | `pnpm prepush` 与 CI 共用 `scripts/prepush.mjs`，`scripts/prepush.test.mjs` 检查入口一致 | 1 | 0 | #1533：`mt-[3px]` 负对照触发 D5，移除后静态检查转绿；dead-class 在 CI 保持咨询性 |
| 误称 e2e 本地跑不了，其实记忆里已有绕法 | Claude 线程 (2026-10-22) | 5 | 记忆：先查记忆再说做不了 | 0 | 0 | 机器检查做不到，属判断错误 |
| 只把图放进文件库、没有直接附在回复里 | Claude 线程 (2026-10-22) | 5 | 记忆 | 0 | 0 | 机器检查做不到 |
| 开 PR 后挂着等 CI，不收工 | Claude 线程 (2026-10-22) | 3 | 项目指令：开 PR 打开 auto-merge 后收工 | 0 | 0 | 行为类，CI 不看线程动作 |
| 等 ian 排优先级而停住 | Claude 线程 (2026-10-22) | 5 | 记忆：自己选顺序直接做 | 0 | 0 | 机器检查做不到，属判断错误 |
| 新写入的注释（pi 实测会加注释） | #1520 | 2 | PR #1539：`scripts/comment-discipline-gate.mjs`（CI 咨询性检查）加派活提示 `docs/agent-dispatch-prompts.md` | 0 | 0 | 另有 `.husky/banned.txt` 禁词检查拦特定词 |
| 驱动脚本断言前没等元素出现就 `count()`，掩码行还没渲染就判 0 行，随后先猜「截图 mask 参数导致」改了一轮才隔离出真因 | #1478 (2026-10-24) | 2 | `drive.mjs` api-key 探针先 `waitFor` 掩码行再计数；不等就数的写法在全新栈上 10 次跑红 4 次（偶发），加等待后 5 次全 PASS；偶发失误做不成确定的负对照 | 0 | 0 | 猜因先改属判断错误，机器拦不住；可拦的半边是探针不等就数 |
| 后台长任务用 `( ... & )` 或 nohup 起，工具调用一返回就被杀，随后还告诉 ian 任务在跑 | Claude 线程 (2026-10-22) | 2 | `scripts/dispatch-agent.mjs` start 脱离进程组启动并立即核对进程写状态文件，汇报前 `check` 读状态文件；负对照在 `scripts/dispatch-agent.test.mjs`（CI 独立 job）：旧写法直起的任务 check 报进程不存在 | 0 | 1 | 复发 1（先 pi，后 codex）后由 #1556 升级到级别 2 |
| 解 `ci.yml` 冲突后，新步骤落在了另一个 job 里，推送前没看 hunk 所在 job | PR #1540 (2026-10-23) | 2 | `scripts/ci-job-structure-gate.mjs` 对照 `scripts/ci-job-structure-baseline.json` 钉住每个 job 的命名步骤，CI check job 装机前一步与 `pnpm prepush` 共用；负对照 = #1540 错误 hunk（freshness 步落进 comment-discipline-gate）在 `scripts/ci-job-structure-gate.test.mjs` 变红 | 1 | 0 | #1557 落地，级别 5 升 2；首拦：rebase 后 baseline 漏跟上游步骤迁移，闸拦下后才补 |
| 写文件前没查目标是否已存在，覆盖了已有的 `retro` 技能（从 git 恢复） | Claude 线程 (2026-10-22) | 5 | 记忆：新建技能先 `ls` 目标目录 | 0 | 0 | 本次靠 git 里的历史救回；机器检查做不到 |
| 规则文字里写进了禁词，被提交前禁词检查拦下 | PR #1539 (2026-10-23) | 2 | `.husky/banned.txt` 提交前检查 | 1 | 0 | 检查生效，无需追加防护 |
| 评审里反复出现的同类问题 | #1528 | 2 | #1528 盘点后逐类开子票 | 0 | 0 | 盘点清单出来后并入本表 |
| shell 命令用 zsh 只读变量 `status` 接退出码，中断了后续清理 | #1533 (2026-10-23) | 3 | 工具命令变量使用任务专属前缀，遵循现有执行规则 | 0 | 0 | 已移除负对照文件；交互工具命令不属于仓内受检脚本，无法由仓内 lint 覆盖 |
| 改界面主题变量只跑了 lint 与 typecheck，没跑 e2e，PR 上 CI 红约 60 条（写死旧值的测试加一处真实对比度问题） | PR #1551 (2026-10-23) | 5 | 记忆 pacman-ui-theme-needs-e2e | 0 | 0 | 待升到级别 2：样式或共享 UI 变更时 pnpm prepush 自动跑 e2e:affected，见 #1555 |
| 拿随手画的示意稿当界面设计，没先看真实界面，被 ian 指出太简陋 | Claude 线程 (2026-10-22) | 5 | 记忆：界面类先截真实界面再出方案 | 0 | 0 | 机器检查做不到，属判断错误 |
| 一次发图超过线程附件上限，5 张被静默跳过 | Claude 线程 (2026-10-22) | 5 | 记忆 thread-attachment-cap | 0 | 0 | 上限在 hearthbot 工具里，本仓管不到 |
| 新测试夹具遗漏必填字段或外键父行，未进入待验证路径 | #1513 (2026-10-23) | 2 | `build-provenance.test.ts` 先断言建 build 返回 201，旧库迁移用真实外键链建数据 | 2 | 0 | 负对照：缺 spec 时建 build 失败，缺 todo 父行时 SQLite 拒绝插入；补齐后迁移与反馈测试通过 |
| 从同步回调赋值的局部变量读取结果，被 TypeScript 缩窄为 never | #1513 (2026-10-23) | 1 | runner 将技能解析结果保存在显式类型的对象属性中；`pnpm typecheck` 检查消费面 | 1 | 0 | 负对照：原局部变量的 injected 读取报 TS2339；对象属性承接回调后通过 |
| shared 新导出追加在文件末尾，未遵循字母排序 | #1511 (2026-10-23) | 2 | Biome organizeExports 与从 shared 包入口导入的 trajectory-pack 测试 | 1 | 0 | 真实负例为 trajectory-pack 导出排在 webhook 后；移动导出时匹配了错误的冒号，曾漏掉导出，由包入口测试拦住；改用实际文本锚点后复验 |
| 测试夹具把 persona 显示名当成持久化枚举值 | #1511 (2026-10-23) | 1 | trajectory-pack 正向夹具使用 `satisfies TrajectoryPack` 及其 input 类型 | 1 | 0 | 原值 CodeReviewer 被运行时 schema 拒绝；改为 code_reviewer，并以类型约束提前拦截相同错误 |
| 用 `pkill -f <模式>` 收后台 vite，模式命中自己所在的 shell 命令行，把整条命令连同后续步骤一起杀掉 | Claude 线程 (2026-10-23) | 5 | 记忆：起后台进程时记 PID（`echo $! > pidfile`），按 PID 收，不用 `pkill -f`；直接起 `node_modules/.bin/vite`，不经 pnpm 包一层 | 0 | 0 | 属 agent 自身 shell 操作，仓库闸看不到 |
| 云端容器的 Playwright 缺 `chromium_headless_shell-1243`，integration 的浏览器用例在 pre-push 全红，看着像代码坏了 | Claude 线程 (2026-10-23) | 5 | 记忆：云端先把 `/opt/pw-browsers/chromium` 软链到缺失的 headless shell 路径；看板筛选 3 例在旧版 chromium 上换回 main 也失败，不算本次改动 | 0 | 0 | 待升级：SessionStart 钩子自动建软链 |
| 本地 `origin/main` 引用过期，`pnpm prepush` 把几百个别人的改动算进本次差异，纯文档推送也跑了全量测试并失败 | PR #1566 (2026-10-23) | 5 | 记忆：推送前先 `git fetch origin main` | 0 | 0 | 待升到级别 2：`scripts/prepush.mjs` 的 `changedPaths()` 在默认基线下先 fetch 一次 origin main，负对照用过期引用的克隆 |
| 新颜色值写进 tokens.css，ui-drift 闸只在 CI 跑，推上去才红 | PR #1580 (2026-10-23) | 2 | `scripts/prepush.mjs` 共用清单加入 `ui-drift-gate.mjs`，本地 pre-push 与 CI（`pnpm prepush --ci`）同一入口，`scripts/prepush.test.mjs` 钉住 | 0 | 0 | 负对照：#1580 首版 tokens.css 四行 hex 在该闸下报 G2 红，挪进 shadcn.css 后转绿 |
| 官网和文档写了 npm 上不存在的包名（`npx @xiechimon/cairn` 返回 404），访客照抄直接报错 | PR #1568 (2026-10-23) | 2 | `scripts/npm-command-gate.mjs` 在 CI 里查 README、site/、web 界面里 npx / npm i 用到的包名，npm 404 即红 | 0 | 0 | 负对照：对含 `npx @xiechimon/cairn` 的 site/index.html 跑闸为红，改回 `@xiechimon/pacman` 后为绿；闸自身首版的 pathspec 漏扫 site/ 根目录文件，也由这次负对照发现 |
| 改看板列样式后只跑了 board-dnd 一条 spec，首版修复打破 cds-board 的「列静止无圆角」断言；查下去发现 board.tsx 的 e2e:affected 家族表根本不含 cds-board 等 4 条看板 spec，prepush 也拦不住 | 拖拽列直角修复 (2026-10-24) | 2 | `scripts/e2e-affected.mjs` BOARD 家族补 cds-board / paper-board- / paper-card / quota-wait-board | 0 | 0 | 负对照：`--dry-run -- apps/web/src/board/board.tsx` 旧表选中这 4 条为 0，新表为 4；`--check-coverage` 仍报 32 条无家族的 spec，待升：#1599 补全并把 coverage 检查接进 prepush |
| 测试直接展开 GitHub 端口的 unknown 应答体，运行时测试通过编译却失败 | #1405 P4-0 (2026-10-24) | 1 | 保留 GateRaw.body 的 unknown 边界，夹具通过 comparePages 的有类型 extra 参数覆写字段；pnpm typecheck 拦截未知体展开 | 1 | 0 | 真实负对照：展开 res.body 报 TS2698；改用 extra 参数后通过，未放宽端口类型 |
| 派活前没查重：派 #1569、#1578 给 codex/pi 时，同机另一个 Claude 会话已在 /tmp/pm-1569-*、/tmp/pm-1578-* 做同票，#1569 白做一版 | #1569/#1578 (2026-10-24) | 2 | `scripts/dispatch-agent.mjs start --ticket <N>` 查系统 tmp 目录下的 git 工作目录、origin 分支、open PR、codex/pi/grok 进程，命中即拒绝启动，`--force` 才放行；纯函数 `scripts/dispatch-dedupe.mjs` 由 `scripts/dispatch-dedupe.test.mjs`（CI dispatch-agent-test job）钉住数字边界、排除自身、gh 不可用 | 0 | 0 | 负对照：对 1569 跑 `start --ticket 1569` 命中 /tmp/pm-1569-*（分支 obs/1569-langfuse-selfhost）并以退出码 1 拒绝；不带 `--ticket` 仍不查，靠派活提示 `docs/agent-dispatch-prompts.md` 要求带上 |
| 新脚本把只调用一次的查询拆成独立私有函数，`single-use-helper-gate` 报 5 处 | 派活查重 #1569/#1578 (2026-10-24) | 2 | `scripts/single-use-helper-gate.mjs`（`pnpm prepush` 与 CI 共用） | 1 | 0 | 负对照：首版 `scripts/dispatch-agent.mjs` 的 tempWorkdirs 等 5 个单次调用函数报红；收进导出的 `collectTicketSources` 后为 0 |
