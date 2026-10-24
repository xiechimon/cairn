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
| 导出目标只比较路径文本，符号链接父目录可绕过源库保护 | #1514 (2026-10-24) | 1 | 导出器比较真实父目录下的目标路径与数据库及 WAL/SHM 路径；真实 sqlite 命令测试覆盖符号链接父目录 | 1 | 0 | 负对照：旧文本比较允许 alias/server.db 替换测试源库，真实路径比较后拒绝且库字节不变 |
| 把引擎原始会话当成统一 transcript，Pi 工具结果校验失败且 Claude 信封被跳过 | #1514 (2026-10-24) | 2 | `trajectory-export.test.ts` 经根命令导出 Pi toolResult 与 Claude assistant 信封并断言消息全集和扩展字段 | 1 | 0 | 负对照：旧解析器在 toolResult 的 role 校验失败；按既有 daemon 口径映射 system，并接受 Claude 消息信封后通过 |
| 导出裁决与落库动作不一一对应：先漏确认与批准，后按 side 推动作，把审核关口的 revision 标成 restart | #1514 (2026-10-24) | 1 | 动作直接取 build_feedback.kind 列，导出器不再有 side 到动作的映射；diff 契约收 revision；`trajectory-export.test.ts` 断言结构化驳回、带 actor 的过闸宣告、gate_verdict、build 侧 revision 与 restart 分开，并插入 actor 为空的同文案宣告断言不进裁决 | 2 | 1 | 负对照：旧导出缺 confirm/approve；复发时旧导出把 build 侧 revision 输出为 restart，测试变红，取 kind 后通过 |
| 根脚本直接启动 tsx CLI，在禁止监听本地 socket 的环境中因 IPC 失败 | #1514 (2026-10-24) | 1 | 根脚本使用 `node --import tsx` 加载器；导出测试经 `node --import tsx src/trajectory-export-cli.ts` 执行，与根脚本同一加载方式 | 1 | 0 | 负对照：旧 tsx CLI 在 createIpcServer 报 EPERM，Node 加载器不建立该 IPC，根命令相关测试通过 |
| 复用依赖时并行运行 pnpm，自动依赖校验重装 node_modules 导致正在运行的测试丢包 | #1514 (2026-10-24) | 3 | 复用依赖的本轮验证命令显式设置 `PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false`，复制完成后再启动检查 | 1 | 0 | pnpm 12 不读取尝试过的 npm_config 开关；改用其 PNPM_CONFIG 开关后 typecheck/lint/spec:parse 通过。属于 agent 外部命令调度，仓内类型或 lint 无法约束，未改全局配置或锁文件 |
| 输入模型推导只覆盖一种会话形状，多模型运行无法通过导出契约 | #1514 (2026-10-24) | 2 | `trajectory-export.test.ts` 注入第二个计费模型，分别用 Pi 形状（带 provider）和 Claude Code 形状（只有 message.model）断言 input.model；Claude 形状按 daemon 账单口径补 claude-code 前缀 | 2 | 1 | 负对照：旧实现只接受一条 token_usage；复发时 Claude 帧缺 provider，input.model 缺失整包 schema 失败，测试变红，补前缀后通过。会话形状来自外部引擎，类型层拦不住 |
| 批量导出把单个 build 的会话缺失当成整批失败，时间窗内其余 build 也导不出 | #1514 (2026-10-24) | 2 | 缺会话的 build 抛专用跳过错误，时间窗导出跳过并在汇总输出 `skipped=N (session_missing=N)`，--build 单个导出仍报错退出；`trajectory-export.test.ts` 用三个 build 夹一个缺文件的断言两种行为 | 1 | 0 | 负对照：旧实现整批报 Step session missing 退出码 1，测试变红；跳过计数后通过。daemon 在文件缺失或超体积时本就不上传会话 |
| 起子进程的 CLI 测试逐条手写超时，漏写的一条吃默认 5 秒，全量跑时偶发超时 | #1514 (2026-10-24) | 1 | `trajectory-export.test.ts` 在文件级用 `vi.setConfig({ testTimeout: 30_000 })`，逐条超时参数删除，同文件新增测试无从漏写 | 1 | 0 | 负对照：「selects builds by creation time」起两个子进程、无超时参数，实测 4851ms 贴近 5 秒上限，一次全量跑红；文件级超时改为 100ms 时该条超时变红，恢复 30 秒后连续全绿 |
