# AI 审核发起全链(详情页 composer,#312)

用户在待确认或审核关口的 todo 详情页发起一轮 AI 审核:composer 出现「AI 审核」钮 → 点开 560 宽模态(搜索行 + Agent 行 + 可选 focus textarea + 「开始审核」primary 钮)→ 选 Agent 发起 → composer placeholder 替换为「AI 审核进行中…」+ 时间线插发起行。这是 detail 页第二个入图的 live 面。发起 + 入队走 API 即得证(drive-review.mjs,无需 daemon);**真 daemon 执行审核步(claim→done→verdict 落库)与 blocking 自动修订回路另有 drive-review-blocking.mjs 覆盖(见文末 Cross-reference)**。

## Sub-features

- `review-button-visible` confirm/review phase 时 `.composer-ai-review` 渲染可点;其余 phase 不渲染。
- `review-dialog-opens` 点击开 560 宽模态(`[role="dialog"]` 面板含 `style.width=560px`；#952 起 `.dlg-shell` 类名退役，退场 visibility 桥内联成件上 utility),标题「AI 审核」、副标题、搜索行、Agent 行列表、可选 focus textarea、「开始审核」primary 钮居中。
- `agent-list-source` Agent 行 = members 读面 `memberType:"agent"` 行,头像 = initials(无 actor 头像面),副标题 = `modelId ?? '默认'`。
- `selected-row-style` 选中行 `data-on="true"` 套 bg-indigo-500/10(r8 §2.5 实测)。
- `focus-textarea-optional` focus textarea 可空(dialog scope `getByRole('textbox')`;#951 起 `.review-focus-input` 类钩退役),空字符串被 server 视为未填(REV-票-A focus trim 语义)。
- `review-submitted` 点击「开始审核」→ POST `/api/builds/{id}/steps {action:'review', agentId, focus?}` → 模态关闭 → composer placeholder 替为「AI 审核进行中…」→ transcript 顶部出现 `REVIEW_ANNOUNCEMENT` 行 + step 表入队 `kind:'review'` 步 + phase 不动。
- `phase-guard-409` 非 confirm/review phase 调该端点 → 409(`todo/queued/planning/building/done/failed/closed` 一律拒)。

## How to get to it (user POV)

- 任务详情页(`/app/todo/:id`)在 confirm 或 review phase → composer 右下「AI 审核」钮(唯一入口;其他 phase 不渲染)。
- 驱动(`vp.mjs list review-modal` 列出全部 case 与 usage):
  - `node .claude/skills/verify-pacman/scripts/vp.mjs drive review-modal empty-review`:空改动任务的审核与合并行(默认带修复后开关 `--expect=after`)。
  - 判 stale、不带 `--force` 拒跑的 case(拒跑时打印原因):`vp.mjs drive review-modal failed-review-restore`(建 agent 不带 machineId,ADR 0019 起 400);`vp.mjs drive review-modal review-launch`(依赖的 setup-review-seed.mjs 建 agent 不带 machineId,ADR 0019 起 400)。

## Driving it with verify-pacman

Preconditions(比 stop-button 简单,无需 daemon + 门控 stub):

1. `launch.mjs` 起隔离栈(server + web),`doctor.mjs` 全 PASS。
2. seed(provider/agent/project/todo + 一台 machine 走到 plan 完成):
   - `GET /api/teams` 取 teamId;
   - `POST /api/teams/{t}/providers` `{providerId:"stub-gw",label,baseUrl:"http://127.0.0.1:9/v1",api:"openai-completions",authHeader:true,compat:{supportsDeveloperRole:false},models:[{id:"stub-model",name:"stub-model"}]}`(不需要真可达,只是 seed 数据面);
   - `POST /api/teams/{t}/agents` `{displayName:"verify-builder",provider:"stub-gw",modelId:"stub-model"}`;
   - `POST /api/projects` + `POST /api/projects/{p}/todos` 建探针任务(记下 todoId);
   - `POST /api/projects/{p}/builds` 起 build(带 plan);
   - `POST /api/machine/enroll` 注册 machine → 拿 machineToken;
   - `POST /api/machine/tasks/claim` 领 plan step;
   - `POST /api/machine/upload-urls/{stepId}` 拿上传 URL + PUT 上 plan.md 内容;
   - `POST /api/machine/done/{stepId}` 标 plan 成功 → phase 推进 confirm。

- **全链。** Run `REVIEW_MACHINE_TOKEN=<seed 给的 machineToken> node <skill>/scripts/drive-review.mjs <todoId>`(从 repo 根跑,@playwright/test 才解析得到)。**令牌必带**——末尾两条机器侧 check(claim review 步 + done)走真端点,缺令牌时 `Authorization: Bearer undefined` → 认领不到步、两条会红(实测踩过,别误判成产品缺陷)。它完整走:详情页 load → `.composer-ai-review` 出现(截图 01)→ 点击开模态、断言 560 宽 + 标题 + Agent 行可见(截图 02)→ 选默认 Agent(截图 03)→ 点「开始审核」→ 模态关闭、composer placeholder 替为「AI 审核进行中…」、transcript 顶部出现 REVIEW_ANNOUNCEMENT 行(截图 04)→ 三面真值:API(`GET /api/builds/{id}/steps` 含 kind:'review' pending 步 + phase 仍 confirm)+ SQLite(`step` 表含 kind='review' 行 + 至少一条 REVIEW_ANNOUNCEMENT 行)→ API 终态:模拟机器 claim + done(success) → REVIEW_COMPLETE_PLACEHOLDER message 落地 + phase 仍 confirm。证据 `result.json` 12 checks。
- **收尾。** `cleanup.mjs` 收栈(无第四进程)。scratch home 不需手清。

## Gotchas

- 模态 560 宽是 r8 §2.5 显隐律(detail/composer 详情对话框家族是 448 族,审核模态单独 560 族):断言 `style.width === '560px'` 不要断 lib 默认值。
- 选 Agent 行 = `memberType:"agent"` 行;`memberType:"user"` 行(Owner)不显示——别用 `members.length` 计数。
- 「开始审核」primary 钮:文案必须严格匹配「开始审核」(i18n zh 默认);en.ts 同步键「Start review」。phase 错误点击 = 端点 409(无需本地拦)。
- composer placeholder 切换不是钮被 disable——按钮还可见;占位文本切换是审核中态的唯一视觉信号(无进度条面)。
- transcript REVIEW_ANNOUNCEMENT 行 = `role:'user'` + `content === REVIEW_ANNOUNCEMENT`(shared/records 单源常量);不要在端点 log 找文案。
- 终态闭环需 enroll + claim + done 全走一遍机器 API(probe 自带 helper);不要跳过——否则真 findings 上线前的占位闭环不被证。
- **收尾契约是 verdict JSON 而非文案**(实测校准):审核步 done 落的是 `{"kind":"review_verdict","verdict":{conclusion,findings}}` 的 JSON-encoded system message(#330/PR #332 把 #312 时期的纯文案占位「AI 审核已完成」换掉了);daemon 未回传 findings 时走空 verdict 兜底(conclusion=「审核未返回结论」)。probe 曾断言旧文案,2026-09-28 实测库内只有 verdict JSON 后已改写断言——别再把「找不到 AI 审核已完成」当缺陷。
- 重验 = 重 launch + 重新 seed + 新探针任务(provider/agent/api-key 幂等性不保证,别复用旧栈)。

## Cross-reference

- **blocking 自动修订回路(#330/#332)** = 本 feature 的下游延伸,另有专属 probe `scripts/drive-review-blocking.mjs`(需 `REVIEW_MACHINE_TOKEN` env,由 seed 输出)。它验:审核步真 daemon claim→done → findings 含 blocking verdict → `REVIEW_VERDICT_KIND` 消息行落地(结论 + 编号 findings)→ phase 转 planning(自动修订回路)→ edit_plan 调整摘要行。证据 `2026-09-27T02-46-23-223Z-review-blocking/result.json`(23 checks allOk=true)。
- **真 daemon 执行审核步**(非 API 模拟):2026-09-28 本会话实测——confirm phase todo → UI 发起审核 → `review` 步 daemon `claimed`→`done` → conversation 落 `{"kind":"review_verdict",...}` 消息。stub 无真 findings 时 verdict=「审核未返回结论」findings=[],phase 留 confirm 不触发修订(要触发修订需 drive-review-blocking 的特殊 stub 响应)。
- 发起面 selector 注意:`review-button-visible` 的钮 aria-label = 「AI 审核」(`button[aria-label="AI 审核"]`),不是 `.composer-ai-review` 类(drive-review.mjs 用 aria-label 定位)。
