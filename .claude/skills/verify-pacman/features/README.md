# pacman 验证 feature map

本目录是 pacman 用户可见行为的验证正源。驱动前先读本索引,再按 feature 文件当配方执行。map 漏掉的入口 = 验证不完整:顺手的入口验过 ≠ 整个 feature 验过。

Control Glass 五条旅程(新建任务 / 派发 / 看 diff / 请求修改 / 合并)的入口、动作、终态在 [glass-journeys.md](./glass-journeys.md)。点击脚本在 `.cursor/skills/verify-pacman/scripts/glass.mjs`,流程与判断在 `.cursor/skills/verify-pacman/SKILL.md`。cursor 侧 `features/` 链到本目录,不另存一份。

变更历史:`../changelog/` 每票一文件(`<日期>-<票号>.md`,skill 面与 feature map 面同文件;车道记新条目 = 新建文件,不改本行)。原「Last updated:」单行链已按 #1039 退役,历史逐条迁入 changelog。

- #1030：local 项目 Files tab 开闸（推翻 spec 12 out-of-scope）。新增条目 project-files-local.md + 定制 probe `scripts/drive-1030-local-files.mjs`：三相位（local 真仓五读面 + 浏览器 tab 开闸/chip=HEAD/查看器/历史、hosted 对照零回归、删仓后不可达降级 + API 404+reason）。**live 验 20/20 PASS，证据 docs/verify/1030/**。fixture 面回归 = e2e project-files-local.spec（4 条；旧 disabled 钉子退役）。
- #952：散件收尾（routes/components 残余清零 + ui/ 目录终删 + toggle 删槽 + spec-22 撞号）。新增定制 probe `scripts/drive-952-finale.mjs`：dialog-shell 语义载体（role=dialog 可及名 / 三 testid / 关闭钮）+ create-agent 表单族几何（label 12/18/0.01em、Input 32、提交钮 w-full）+ agent 详情-记忆-权限 REST/PATCH 真值链 + account 语言行 border-0 与组织图创建槽 svg 12（#947 遗留补丁实物）+ 运行时退役审计（退役选择器零规则、--toggle-track/--toggle-knob computed 为空）+ 双主题 token 对比度 6 对。**live 验证据 docs/verify/952/**。fixture 面回归 = apps/web 全量 e2e（811 条）。
- #701：审核关口人肉打回（B-C12）——review 静息态更多菜单「请求修改」行 + `.dlg-reject` 弹层 / composer 直发，都走 revision 动作面（review→planning 边与 #330 自动回流共用），chip 经 SSE 即时翻、产物不删不孤儿化。新增 review-reject.md + 定制 probe `scripts/drive-review-reject.mjs`。**live 验 22/22 PASS，证据 docs/verify/701/**。fixture/stub 面回归 = e2e review-reject.spec（动作面路由/菜单弹层/相位边界/steer 边界/409 保稿 5 条）。
- #645：抽屉头部新主题 + 挂裸键 N（抽屉作用域）+ KbdHint 的 N 悬浮提示（below 落位）+ aria-keyshortcuts。新增定制 probe `scripts/drive-chief-new-thread-key.mjs`（fixture 面钉不住的火/作用域/输入态守卫全在 live：关态裸 N 不触发 ×2、composer 聚焦 n 归打字员 ×2、发送建线程后裸 N 落新主题视图、切换器 popover 随 N 收、徽标静息/悬浮/aria）。**live 验 12/12 PASS，证据 docs/verify/645/**。fixture 面回归 = e2e hotkeys.spec 27/28 两条（徽标 + 关态负向）。
- #741：agent 身份可点进设置——抽屉 robot 行身份 chip（头像+名字，整块 anchor → `/app/resources/agents/<id>`）+ agent 提及 chip（segments 单源，抽屉与详情页 transcript 两消费面）。新增定制 probe `scripts/drive-agent-identity.mjs`：铺底全走公开 REST（provider/agent/PATCH chief 绑定/POST chief threads），再以 api-key + machine enroll 的**假机器**认领 chief 回合步、PUT transcript.json（assistant 终稿行内嵌提及 wire）、POST done——零 daemon 零 LLM 拿到真回合数据面；浏览器面钉渲染/href/hover 正典/点击导航/键盘 Tab+Enter/提及 chip 全链。`--expect=old` 取 origin/main before 基线（身份 chip 零出现、提及 chip 死 span 零导航）。**live 验 9/9 PASS + before 3/3 PASS，证据 docs/verify/741/**。fixture 面回归 = e2e agent-identity-chip.spec（8 条）+ chief-stream-markdown.spec F-R1 href 钉 / F-R15 live mock 全链。
- XMON-41：新任务快捷键 N → C（键位随票维护）。新增定制 probe `scripts/drive-newtask-key.mjs`（正负成对：新键开 / 旧键 ×5 不开，三条渲染路径各一对 + 输入态守卫 + 侧栏行入口 + 保存全链；旧提交栈加 `--expect=old` 取基线对照）；`drive-hotkeys.mjs` 与 hotkeys.md / board-new-task.md 的角标与开面键同步改 C。live 验 18/18 PASS（subject）+ 12/12 PASS（基线，正负对照），hotkeys 全链复跑 14/14 PASS，证据原在 `docs/verify/XMON-41/`（该目录已按用户拍板于 2026-10-01 删除，此处只留验证结论）。
- #485：新增 agent-detail.md 条目 + 定制 probe `scripts/drive-agent-detail.mjs`（团队页卡链接 → 详情三 tab → 名称/职责/模型/权限四处编辑各对一次 server 真值 → 创建弹窗选模型落库）。**live 验 21/21 PASS，证据 docs/verify/485/**。fixture 面回归 = e2e agent-detail.spec + agent-create-model.spec。

- spec 12 / #362 G2-T2：补 local 项目 daemon 执行面条目 local-daemon-executor.md（硬链接镜像 clone + conv 分支推回用户仓库 + merge 步 ff-only 落地 + github per-step token argv 纪律 + Files tab 禁用占位）；配方 = integration g2t2-local-lifecycle 等四面，live re-probe 待补。
- spec 12 / #361 G2-T4：补 GitHub 连接认证 + repo picker 条目 github-oauth-picker.md + 定制 probe `scripts/probe-github-oauth.mjs`（API 段 + chromium UI 段，authorize 双形自适应）；local-repo-api.md 回补 T4 落地指引。
- #366 详情页 3-pane 重排：branch-sync 入口从头部弹层迁到右 pane 型选→静止 section，drive-branch-sync.mjs 与 integration 判别式同步改道；token/运行历史两弹层退役为右 pane section，仍未铺 live 配方。
- spec 13 / #367：技能页只读本地目录面——新增 skills-page.md 条目；launch.mjs 增第四隔离轴 PACMAN_SKILLS_DIR=<HOME_DIR>/skills——不隔离会现扫用户真 ~/.agents/skills；「已知未入图面」的管理页清单移除技能。
- spec 13 / #368：MCP 本地 config 只读面——新增 mcp-servers.md 条目与 probe `drive-mcp.mjs`（API 投影 + 写面 404 + 密钥值不出接口 + SQLite 无表 + UI 只读钉扎），daemon 执行面配方指向 integration m4b-mcp-e2e（slug 解析 + 真连外部 MCP + 降级行族）。
- spec 14 / #371：skills 执行面注入——新增 skills-injection.md 条目；daemon 侧行为无 UI 面，canonical 证据走 integration 真栈探针（skills-inject-e2e）而非 launch.mjs。
- #389 快捷键组：新增 hotkeys.md 条目 + 定制 probe `scripts/drive-hotkeys.mjs`（新建 dialog 双面 + Space 呼出总管抽屉焦点断言 + 输入态负向 + 侧栏角标；键位 XMON-41 起 N → C）；Gotchas 登记 OverlayMount mounted 滞后一帧的开后聚焦坑（ref callback 载首焦 + [open] effect 兜重开，NewTaskDialog/ChiefDrawer 已收同律）。
- spec 12 / #360 G2-T3：补新建项目表单 web 面条目 project-new-form.md + 定制 probe `scripts/drive-project-new-form.mjs`；local-repo-api.md 的「UI 入口待回补」交叉引用改为已落地。
- spec 11 / #354 先行地图（合流自 main）：补三面条目——providers runtime tabs (providers-tabs.md)、machines 本机行 + switches (machines-local-row.md)、添加服务商 picker (provider-picker.md) + 三个先行 probe (drive-providers-tabs/drive-machines-local/drive-provider-picker.mjs)。先行语义 (spec 11 A12)：probe 先于实现票落地，红态 = 验收清单（FAIL detail 逐条指 spec 条款），实现票验收 = 转绿；跑序纪律见 Baseline。
- spec 12 / #359 G2-T1：补本地仓库项目与 GitHub 连接 server API 面条目 local-repo-api.md + 定制 probe `scripts/probe-local-repos.mjs`，live 验 11/11 PASS。
- 同日 M7 功能闭环维护：补 6 个 M7 新功能条目——AI 审核发起 review-modal、@提及 mentions、标签 tags、附件 attachments、分支同步 branch-sync、失败面发送 failed-send；stop-button.md 补 #318 统一 start dialog 步骤；drive-stop.mjs 修 #318 过时（点开始后先经 overlay-panel 选先做规划）；stub-llm-verify.mjs 修 Node ≥v20 close 事件 bug（req.on close→res.on close + responded 守卫）。mentions/tags 本会话 live 验通过，attachments/branch-sync/failed-send user path 从合并代码核实、live re-probe 待补。

## Baseline preconditions

- 先跑 `launch.mjs`:隔离栈就绪(默认 web `http://127.0.0.1:5273/app`、api `http://127.0.0.1:8791`、全新 scratch 库、seed 单用户 Owner,无 auth)。
- 全新库是每个 launch 的保证(probe `api-key` 依赖空态);重验 = 重 launch,不是复用旧库。注册表里带 `fresh-stack` 的 case,栈上已经 drive 过别的 case 时 `vp.mjs drive` 拒跑(exit 2),提示 `vp.mjs cleanup` 后重 `vp.mjs launch`。
- 端口被占(8791/5273)→ 别的 lane,换 `VERIFY_PORT`/`VERIFY_WEB_PORT`,不杀。
- **worktree 在 `.claude/worktrees/` 下时,launch 之后的改动不会被 vite 送出**:`apps/web/vite.config.ts` 的 `watch.ignored: ['**/.claude/**']` 命中这类 worktree 的每个文件。改代码后先 `vp.mjs cleanup` 再 `vp.mjs launch`,否则驱动的是 launch 时刻的代码(#1402 负对照实测:植入回归后不重 launch,drive 照样 PASS)。
- `doctor.mjs` 全 PASS 才开 drive。
- 永不驱动非本验证起的实例(用户 dev 栈 8787/5173 在跑也不碰)。
- spec 11 三先行 probe 跑序:`drive-providers-tabs`(pi 空态断言要求库内无 custom provider)→ `drive-provider-picker`(e2e 会建 provider)→ `drive-machines-local`(幂等,次序任意)。跑反 = tabs 空态假红。

## Driving conventions

- 驱动一律走单一入口 `node .claude/skills/verify-pacman/scripts/vp.mjs drive <feature> [case]`(#1402);`vp.mjs list [feature]` 列出已登记的 case 及其前置。各 feature 文件里写的脚本命令仍可直跑,但新 case 先登记进 `../vp-registry.json`,不新建按票号命名的脚本。每份 feature 文件在「How to get to it (user POV)」末尾列出驱动它的 `vp.mjs drive <feature> <case>`(没有 current case 的写明,判 stale 的注明原因);注册表闸(`scripts/vp-registry-gate.mjs`,自测里跑)核对这些行都指向已登记的 case、有 recipe 的 feature 都有这一行。
- 一律 live 面:URL 不带 `?scenario=`(那是 fixture 面)。
- 选择器优先稳定句柄:`data-route`、`data-column-list`、`data-todo-id`、aria-label、类名;不用坐标/tab 序。
- UI 证据 = 截图(1440×732,与 e2e 同口径)+ `result.json` 的逐条 checks。
- 变更类证明必须有第二只眼:`GET /api/...` JSON 真值 + SQLite 只读行(见各 feature 文件)。
- **机制类声称**(CSS/动效、落盘/wire 格式、schema、shim 流量、判据字段)的第二只眼 = **编译产物 / 运行时实物**,不是源码、配置或依赖清单——声称→实物→实案路径表见 SKILL.md「机制生效验收:实物判据(硬规则)」。
- 收尾 `cleanup.mjs` 回收栈;证据默认落**主仓** `.claude/verify-evidence/`(不落 worktree),该目录 gitignored。
- **证据交付必须归档进 PR**:在 PR 分支的检出上跑 `vp.mjs archive <票号> --from <证据目录>`,把证据目录归档进 `docs/verify/<票号>/` 并 commit(只拷贝,目标已存在即拒绝,不手工 `cp`;`result.json` + 截图,多组证据加 README 索引),PR body 以 commit SHA 永久链引用(推送后 `vp.mjs links <票号>` 打印;链接形态见 SKILL.md「证据归档纪律」)。运行期证据落 `.claude/verify-evidence/`(gitignored);**证据未随 PR 进仓引用的 verify 声明视为未验证**。
- 报告跳过的入口时要带尝试过的命令与未满足的前置;不得把「从别的入口验过」当成「该入口已验」。

## Feature entry contract

每个 feature 文件:H1 标题 + 一段用户视角描述,然后固定四个 H2(顺序不变):

1. `Sub-features` — 短 ID + 一行行为。
2. `How to get to it (user POV)` — 每个用户入口。
3. `Driving it with <harness>` — 先 `Preconditions:`,再成对 bullet:用户动作 + 精确命令 + 可观测结果。
4. `Gotchas` — 会浪费或废掉一次验证的坑。

map 不写实现细节,只写用户路径、稳定句柄、必要状态、命令、可观测证明。

## Features

- [Control Glass 五条旅程](./glass-journeys.md) 新建任务、派发给总管、审核 diff、请求修改、合并。一键脚本 `node .cursor/skills/verify-pacman/scripts/glass.mjs`。
- [新建任务(工作台)](./board-new-task.md) 工作台 shell 渲染(#351 起 4 列)、新建任务 dialog、无项目自动建默认项目、持久化三重真值。
- [API 密钥](./api-keys.md) 空态建密钥、一次性明文、掩码行、DB 存哈希不存明文。
- [搜索](./search.md) 侧栏入口 → 面板输入 → 命中任务行。
- [主题](./theme.md) pacman-theme 持久化,light/dark 双向。
- [停止钮(详情页)](./stop-button.md) 全栈在跑(server+web+真 daemon+stub LLM 门控轮)的中断链:#318 统一 start dialog→streaming→确认弹层→正在停止…→已取消→gate 回落;定制 probe `scripts/drive-stop.mjs`(#308)。
- [AI 审核发起(详情页)](./review-modal.md) confirm/review 相位 composer「AI 审核」钮→560 模态选 Agent→发起→审核步入队+REVIEW_ANNOUNCEMENT;定制 probe `scripts/drive-review.mjs`(#312);blocking 自动修订回路 `scripts/drive-review-blocking.mjs`(#330/#332)。
- [审核关口人肉打回(详情页)](./review-reject.md) review 静息态更多菜单「请求修改」→`.dlg-reject` 弹层/composer 直发→revision 动作面→review→planning+重规划步入队+chip SSE 即时翻+产物保留(#701);定制 probe `scripts/drive-review-reject.mjs`。**2026-10-03 live 验 22/22 PASS,证据 docs/verify/701/**。
- [@提及(composer+新建任务)](./mentions.md) 提及钮开五分组 picker / textarea 键入 `@` 内联补全→选实体→序列化 token(`[名](agent:{id})`/`#seq`)落文本(#311/#327)。**2026-09-28 live 验通过**。
- [标签(新建任务+详情meta)](./tags.md) 新建任务 footer 标签钮→面板 pill toggle+内联新建→tagIds 随 createTodo;详情 fresh meta 渲染 TagChip(#309/#323);看板卡自 #445 起也渲染标签 chip(旧「看板卡不渲染」校准退役)。**2026-09-28 live 验通过(#445 后卡面律更新,待复验)**。
- [附件(composer+新建任务)](./attachments.md) 添加附件钮(原生文件触发)→三步上传(grant→host→token)→`![名](attachment:…)` 注入 spec→执行面 agent 可读(#310/#331)。live re-probe 待补。
- [分支同步(详情页右 pane section)](./branch-sync.md) 右 pane 型选→「分支与 PR」静止 section(#366 前为头部弹层)→选机器→同步钮→`POST branch-sync`→daemon git/worktree 执行→结果卡 pending→synced(#319/#328)。#366 后全链 live re-probe 待补。
- [详情页 3-pane 结构与右 pane 视图](./detail-right-pane.md) 240|fluid|488 三栏贴合、头部单图标、tab 组退役、型选四视图(文档/分支/Token/历史)静止 section、fresh 空占位、composer 唯一卡片;定制 probe `scripts/drive-detail-pane.mjs`(#366)。
- [失败面发送(详情页 composer)](./failed-send.md) failed 相位 composer 发送反馈→`{action:"restart"}`→新 build(withPlan 承接)+反馈入会话+failed→queued;相位门只收 failed(#320/#322)。live re-probe 待补。
- [本地仓库项目与 GitHub 连接(server API 面)](./local-repo-api.md) `POST /api/projects kind=local` 三态校验(live fs+真 git)+旧 hosted 面不回归+`GET /api/github/repos` 未连接 404+github_connection 表形(SQLite 只读);定制 probe `scripts/probe-local-repos.mjs`(spec 12 / #359)。**2026-09-28 live 验 11/11 PASS**。
- [新建项目表单(web 面)](./project-new-form.md) 菜单两行(GitHub/本地文件夹,hosted 创建入口移除)+名称回填(basename/repo 段,手改不覆盖)+本地路径 400 红色错误行+focus spot 系收编(--focus-ring)+三条创建链 API/SQLite 双真值;定制 probe `scripts/drive-project-new-form.mjs`(spec 12 / #360;OAuth picker 已落地,见 github-oauth-picker 条目)。
- [GitHub 连接认证 + repo picker(新建项目)](./github-oauth-picker.md) 未认证 = 认证钮 + 手动兜底;已认证 = picker 弹层(搜索/单选回填/断开);authorize 双形自适应(env 未配 400 内联 / 已配 200 URL 形状);手动兜底建 github 项目全链;定制 probe `scripts/probe-github-oauth.mjs`(spec 12 / #361)。
- [local 项目 daemon 执行面](./local-daemon-executor.md) 硬链接镜像 clone→worktree→conv 分支 push 回用户仓库→merge 步 conv 分支更新即落地(#1211:用户主检出分支/reflog/工作树零变化,脏区不阻断)+github per-step token 不进 argv(PATH shim 捕获);配方 = `integration/test/g2t2-local-lifecycle.test.ts` 等四面(spec 12 / #362)。live re-probe 待补。
- [模型服务 runtime tabs(providers 页)](./providers-tabs.md) spec 11 A1-A4/A7 先行地图：tablist pi/Claude Code + `?runtime=` 同步 + header 卡安装态 + pi = custom providers models[] 投影 + model-sources API 双真值 + facade / chevron 负向 (#353/#354)；定制 probe `scripts/drive-providers-tabs.mjs`。**实现票落地前红态**。
- [机器页本机行 + 品牌 mark + shell 开关](./machines-local-row.md) spec 11 A8/A9/A7：本机行 server seed (kind='local', name=hostname) 钉首不可删 + per-runtime 品牌 mark 只读 (data-enabled 两态，#503/#887) + 行内唯一活控件 = 机器层 shell 开关翻转写回 shellEnabled (API + SQLite 双真值，幂等，XMON-113) + 添加机器流程不变 + facade / chevron 负向 (#353/#354)；定制 probe `scripts/drive-machines-local.mjs`。**#357 实现落地：15/15 PASS，证据 docs/verify/357/**。
- [添加服务商 picker dialog](./provider-picker.md) spec 11 A5/A6：「新建」开 picker — 页面无 preset 投喂负向 + 搜索客户端过滤 38 项 + 显示名 canon 名称节点等值 (spec 名单) + OAuth 徽标仅族表已接线族 (现仅 github-copilot) / openai-codex 未接线行禁用+「暂未开通」注记 (#385) / xai 行负向 + xai oauthLabel 密钥表单正向 + api_key 族密钥表单 + 自定义端点 disclosure 展开现有表单 + 创建链回归护栏 (#353/#354)；定制 probe `scripts/drive-provider-picker.mjs`。
- [技能页(本地目录现扫面)](./skills-page.md) 技能 = server 本地目录现扫投影:放含 SKILL.md 的子目录→刷新即现,新建/编辑经界面弹窗(XMON-114:topbar「新建」+ 空态主钮 + 行点击编辑)、无导入入口,空态指路目录,id = frontmatter name 回落目录名(spec 13 #367)。栈隔离第四轴 `PACMAN_SKILLS_DIR`(launch.mjs 已带)。
- [MCP 页(只读本地 config 面)](./mcp-servers.md) `~/.claude.json` mcpServers 段投影列表+只读钉扎(无新建/更多入口、写面 404、密钥值不出接口、SQLite 无 mcp_server 表);定制 probe `scripts/drive-mcp.mjs`(#368);daemon 执行面配方 = integration m4b-mcp-e2e。
- [skills 执行面注入(daemon)](./skills-injection.md) PACMAN_SKILLS_DIR 扫描→`<available_skills>` catalog 追加进 systemPrompt→agent read SKILL.md 按需加载(#371,spec 14)。daemon 侧无 UI 面,canonical 证据 = integration 真栈探针(skills-inject-e2e)。
- [Agent 详情编辑面](./agent-detail.md) 团队页 Agent 卡(链接)→ `/app/resources/agents/<id>` 三 tab(概览/记忆/权限)；概览名称行内编辑 + 职责 + 模型选择器落 `PATCH agents/{aid}`，权限 6 开关 + 密钥 + MCP 勾选同路径；创建弹窗两态(有服务商 = 内联模型槽，无 = 告警 + 外链)；定制 probe `scripts/drive-agent-detail.mjs`(#485)。**证实 live 21/21 PASS，证据 docs/verify/485/**。
- [快捷键组(新任务 C + 空格呼出总管)](./hotkeys.md) 侧栏「新任务」行 C 角标 + 全局 C 开 dialog(board/project 自有面,其余路由 AppSidebar 全局 dialog 同 live save 路径;XMON-41 起 N → C) + Space 呼出抽屉草稿框持焦 + 输入态/按钮态守卫负向 + 抽屉开态裸 N = 新主题(#645,钮载 N 悬浮提示 + aria-keyshortcuts);定制 probe `scripts/drive-hotkeys.mjs`(#389)、键位专测 `scripts/drive-newtask-key.mjs`(XMON-41) 与 `scripts/drive-chief-new-thread-key.mjs`(#645)。fixture 面回归 = e2e hotkeys.spec。
- [chief 派发判定:判定权归chief判说可推翻](./chief-dispatch-judgment.md) run_builds 的 withPlan = chief 逐次派发判定(缺省 = 先规划 fail-safe,服务端零判定规则)+ dispatchReason 回执理由(随工具调用落 transcript 可审计、响应回显;提示词责令回执写明「我判为直接修/先规划,因为 X」,用户可就地一句话推翻且只影响这一次)+ claim 载荷静态 systemPrompt 派发判定节(Mika 判断纪律原句 + 三条可判信号 + 审阅关口恒在,不按设置合成、无写死直执行指令)+ 设置槽死态三面(Agent tab 无「派发方式」行 / PATCH 单独 dispatchWithPlan 400 / 封套无该键);定制 probe `scripts/drive-903-dispatch-judgment.mjs`(#903 / ADR 0014)。**2026-10-08 live 验 12/12 PASS,证据 docs/verify/903/**。
- [角色名册+verify 步+三视角 fan-out+split_todo](./persona-verify.md) 六员 persona 自动 seed(全新库首启,契约/档位/模型位缺省留空)+ assignment 四槽(REST 与 chief relay 双路)+ verify 步(review 关口入队,幂等,verdict 消息行,chip「验证中」,三态渲染含证据条目)+ AI 审核三视角 fan-out(浏览器真点击,无 agentId 提交,三步各挂 persona meta header,blocking 去重闸)+ split_todo 拆解波次(子卡/依赖边/父方案文档/父停 confirm/父自动收);定制 probe `scripts/drive-1250-persona-verify.mjs`(#1250 / ADR 0018)。**2026-10-12 live 验 27/27 PASS,证据 docs/verify/1250/**。fixture 面回归 = e2e persona-verify.spec(三态渲染+证据条目+弹层 fan-out 行零渲染负向钉)。
- [项目「历史」提交详情面](./project-commit-detail.md) 历史行点击开该提交的文件级 diff(新读端点 GET commits/{sha} = 第一父 diff + DiffFileBlock 渲染复用 + 选中态 (projectId, sha) + 不可达 404+reason 人话降级;根提交全新增/merge 第一父/空提交定义态三口径);定制 probe `scripts/drive-1102-commit-detail.mjs`(#1102)。**2026-10-10 live 验 25/25 PASS,证据 docs/verify/1102/**。

## 已知未入图面(验到这些别声称 map 覆盖)

- 任务详情页(`/app/todo/:id`)——live 面已铺:3-pane 结构与右 pane 四视图(detail-right-pane)、停止链(stop-button)、AI 审核发起(review-modal)、@提及(mentions)、附件(attachments)、分支同步(branch-sync,#366 起右 pane section 入口)、失败面发送(failed-send)。未铺:plan/changes/diff 文档面内容渲染、transcript 流渲染、编辑分配弹层。
- 总管抽屉/设置(`button[aria-label="总管"]` FAB 有 live wiring;#1260 起模型/机器槽随绑定 Agent 收编只读,其余数据面未铺)。
- 团队密钥管理页(routes 均在,fixture e2e 有覆盖,live 配方未铺)。技能页已入图 = skills-page.md；MCP 页已入图 = mcp-servers.md(#368)；机器/模型服务两页已铺三面(#354 先行地图:providers-tabs/machines-local-row/provider-picker——spec 11 实现票落地前红态,配方见各 feature 文件)。
- 看板拖拽改相(`PATCH /api/todos/:id`,#160)——fixture e2e 有 board-dnd 覆盖。
- 定时(schedules)增删改、项目设置页——fixture e2e/dead-buttons 覆盖,live 配方未铺。
- daemon 侧(`pnpm dev:daemon`)——需要真机器注册流程,超出 UI 验证范围;唯一已铺条目 = skills-injection(经 integration 真栈 harness,不经 launch.mjs)。

新功能落地后把入口补进 map(`/maintain-verification-skill`)。
