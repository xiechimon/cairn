# 审核关口人肉打回(详情页,#701 B-C12)

review 静息态(步已收尾、无活跃会话)下人说「不」:任务回 planning 重新规划。此前审核闸的人只能点头——composer「请求修改…」可填可点,发送撞 steer 面 409(无 claimed 步),页面只有一行小字;更多菜单无任何打回入口。打回走服务端动作面 `POST /api/builds/{id}/steps {action:"revision", side:"plan", feedback, clientMessageId}`(confirm 关口驳回同形状复用),流转经 `assertPhaseTransition` 的 review→planning 边(与 #330 blocking 自动回流共用同一条边)。

## Sub-features

- `reject-menu-entry` 更多菜单「请求修改」行(`data-action="reject"`,MessageSquare 图标)——live review 静息态才渲染;fixture 面/其余相位/运行中行不出现(四行捕获几何字节不变,五行面行带按 `:has()` 重钉)。
- `reject-dialog` 弹层(role=dialog 可及名「请求修改」):textbox 必填(空稿「请求修改」确认钮禁用;#951 起 `.dlg-reject`/`.reject-feedback-input`/`.reject-confirm` 类钩退役);提交 = revision 动作面;被拒(409 竞态)弹层不关、原因显在输入行下方(XMON-89 同律)。
- `reject-composer-direct` 静息 review 态 composer 发送 = 同一 revision 动作(占位符「请求修改…」可填即可发);成功清稿,被拒保稿 + `.composer-reject` 提示行。
- `reject-steer-boundary` 运行中(claimed/pending 步在场)review 保持 steer 补话面——打回只在静息关口,两不抢道。
- `reject-landing` 打回落地:phase→planning(chip 经 SSE 失效键即时翻,不 reload)+ 重规划步入队(pending plan 步,prompt 单源 shared `buildReviewRejectPrompt`,交代「改动仍在会话分支、不丢弃既有产物」)+ feedback 行落 transcript(role user)+ plan/分支/latestBuildId 全保留(不删产物、不孤儿化)。

## How to get to it (user POV)

- 任务跑到 review(执行步收尾)后:详情页头部「更多」→「请求修改」→ 弹层填反馈 → 确认。
- 或直接在 composer 输入修改要求 → Enter/发送钮。
- 驱动:本 feature 没有 current case;已登记的都判 stale,不带 `--force` 拒跑(拒跑时打印原因),`vp.mjs list review-reject` 列出 usage:
  - `vp.mjs drive review-reject blocking-revision`:依赖的 setup-review-seed.mjs 建 agent 不带 machineId,ADR 0019 起 400。
  - `vp.mjs drive review-reject human-reject`:依赖的 setup-review-seed.mjs 建 agent 不带 machineId,ADR 0019 起 400。

## Driving it with verify-cairn

Preconditions: `launch.mjs` 起栈(纯 live 栈——无 daemon/无 LLM 依赖,机器 wire 由 seed 与探针经 HTTP 等价直驱);`setup-review-seed.mjs` 推到 confirm(输出 todoId/machineToken)。

- seed 后探针自带 confirm→building→review 驱步(claim + done success):
  `REVIEW_MACHINE_TOKEN=<token> node scripts/drive-review-reject.mjs <todoId>`
- 路径 A:点 `.detail-head-icon--more` → `.more-menu-item[data-action="reject"]` → dialog(role=dialog「请求修改」)填 textbox → role=button「请求修改」;观测 chip `.detail-chip` 不 reload 翻「规划中」(#951 载体迁移;.detail-chip 类钩存活至 #953 终账)。
- 路径 B(探针先经机器 wire 把任务驱回 review):`.composer-input` 填文本 → Enter;观测 chip 翻「规划中」、draft 清空、无 `.composer-reject` 行。
- 真值三面:`GET /api/todos/{id}` phase=planning 且 latestBuildId 不换;`GET /api/builds/{id}/steps` 新 pending plan 步;`GET /api/conversations/{id}/messages` feedback 行;`GET /api/builds/{id}/plans` v1 保留;SQLite `step.prompt` 模板头 =「用户在审核关口请求修改。修改反馈：「」且含「会话分支/不要丢弃既有产物」。
- 2026-10-03 live 验 22/22 PASS,证据 `docs/verify/701/`(7 截图 + result.json)。fixture/stub 面回归 = e2e `review-reject.spec.ts`(5 条:动作面路由/菜单弹层/相位边界/steer 边界/409 保稿)。

## Gotchas

- **打回不能挂消息面**:静息 review 无 claimed 步,`POST /api/conversations/{id}/messages` 恒 409——回归时先钉探针的 `ui-no-reject-hint-line` 与 `A-api-replan-step-pending`。
- **chip 即时翻不 reload** = 真 SSE 失效键路径;`waitChip` 超时是发布链断(setTodoPhase 漏斗 publishTodoDoc),不是渲染问题。
- **改更多菜单行序必须连 overlay.css 的 `:has([data-action="reject"])` 行带规则一起改**,否则五行面上 关闭 行吃 delete 红带、delete 行掉带。
- 弹层反馈必填是有意闸(重规划轮拿它当工作指令);别用空稿「快速打回」。

## Cross-reference

- 同族:#700(daemon verdict 提取面,B-C13)、#702(failed 审核锁死合并路,B-C17)——三半合起来才是「审核闸能闭环」。
- 同边先例:#330 blocking 自动修订回路(`drive-review-blocking.mjs`,review-modal.md)。
- 同形状先例:confirm 关口驳回(r5 §4,`buildReplanPrompt`)、failed 面 restart(failed-send.md)。
