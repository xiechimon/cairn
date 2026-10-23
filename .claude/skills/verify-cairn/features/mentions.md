# @提及(composer + 新建任务,#311/#327)

用户在 composer 或新建任务对话框引用其他实体(agent/todo/skill/project/machine):点工具条「提及」钮开五分组 MentionPicker(任务/技能/Agents/项目/机器,多选累积 + 插入 (N) 底条),或在 textarea 键入 `@` 触发内联 agents 补全。选中的提及序列化为 token 落进文本——agent → `[名](agent:{id})`、任务 → `#seq`——随消息/任务 spec 提交,执行面(Segments 渲染)解析回 chip。规格源:r9 §3.2(todos.dev 实测)。

## Sub-features

- `mention-button-opens-picker` composer / 新建任务工具条「提及」钮(`button[aria-label="提及"]`)点击开 MentionPicker 弹层(`.mention-picker` 或 `.mention-inline`)。
- `mention-five-groups` picker 五分组:任务/技能/Agents/项目/机器,每组行带 `(N)` 计数;数据源 live = useTodos/useSkills/useMembers/useProjects/useMachines 投影,fixture = fixture.todos/resources。
- `mention-multi-select` 多选累积,底条「插入 (N)」确认插入 N 个 token。
- `mention-inline-at` composer textarea 键入 `@` 触发内联 agents-only 补全(`.mention-inline`),按 `@partial` 过滤,Enter/点击插入,Esc 关。
- `mention-serialization` 选中提及序列化:agent → `[名](agent:{id})`、任务 → `#seq`;落进 draft/spec 文本。
- `mention-render-back` 提交后执行面/详情 spec 渲染把 token 解析回 chip(Segments 组件)。

## How to get to it (user POV)

- composer(详情页运行/确认面)工具条「提及」钮 → picker;或 textarea 键入 `@`。
- 新建任务对话框(看板「新建任务」)工具条「提及」钮 → picker(落 spec textarea)。
- 驱动(`vp.mjs list mentions` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive mentions mention-picker`:提及钮 picker 与 `@` 内联补全;`--` 后给 todoId 时加 composer 路径。

## Driving it with verify-cairn

Preconditions:

1. `launch.mjs` 起隔离栈,`doctor.mjs` 全 PASS。提及是纯 UI + 文本序列化,无需 daemon。
2. live 面需有可引用实体:seed 至少一个 agent(`POST /api/teams/{t}/agents`)+ 一个 todo(看板新建或 seed),否则 picker 分组计数为 0(仍可开,只显空)。

- **跑法。** `node <skill>/scripts/drive-mentions.mjs`(只跑新建任务对话框路径,自足)或 `node <skill>/scripts/drive-mentions.mjs <todoId>`(追加 composer 的 picker + 内联 `@` 两条路径;todo 需可编辑相位,seed 走 `setup-review-seed.mjs`)。**前置:至少一个 agent**,否则 Agents 组 0 计数(seed 会建)。
- **picker 路径。** 详情页 composer 或新建任务对话框 → 点 `button[aria-label="提及"]` → `.mention-picker`/`.mention-inline` 可见 → 选 Agents 分组一行(分组行 `.mention-row--top[aria-label^="Agents"]` → 条目 `.mention-row--entry`)→ 底条「插入 (1)」→ textarea/spec 出现 `[名](agent:{id})` token。
- **内联 @ 路径。** composer textarea(live editable 面)键入 `@` → `.mention-inline` 内联 listbox 出现 → 继续键入过滤 → 选行 → token 落 caret 位。
- **真值。** 提交后 `GET /api/todos/{id}` 的 spec 或 conversation message content 含序列化 token(`[名](agent:` / `#seq`);详情 spec 渲染面出现 chip。

- **验证状态(2026-09-28)**:主仓脚本化 probe 已补——`drive-mentions.mjs` 10 checks 全绿(对话框 picker + composer picker + 内联 @ 三条路径),证据归档 `docs/verify/311/2026-09-28T13-29-24-524Z-mentions/`。

## Gotchas

- 序列化格式是文本约定(`[名](agent:{id})`),不是结构化字段——执行面「解析」= 文本渲染回 chip,agent 读文本即知引用,无 server 侧 mention 表。
- 内联 `@` 补全只在 live editable composer 面(fixture 静态 div 无 textarea);picker 钮两面都有。
- picker 数据源 agnostic:live 走 REST hooks 投影,fixture 走 fixture.todos/resources——drive 时确认在 live 面(URL 不带 `?scenario=`)。
- 空分组仍让 picker 开(显 0 计数,r9 §2.2 首层)——别把「0 计数」当死钮。
