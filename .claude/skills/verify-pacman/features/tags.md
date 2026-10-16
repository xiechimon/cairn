# 标签(固定词表 + agent 回填,spec 15 #394 / ADR 0002)

标签 = 任务的 category 分类:**固定 6 词表**(bug / feature / improvement / refactor / docs / chore,固定配色,shared `FIXED_TAGS` 单源),随项目创建播种、server 启动补齐存量项目;**无人工创建/挑选 UI**——执行 agent 开工前经 worker 窄工具 `set_task_meta({title, tag?})` 回填(todoId 由 server 从 stepId 钉死,词表外 tag name = 400),每任务至多 1 个,判不出不贴。任务详情 fresh meta 区按 tagIds 渲染只读 TagChip(无标签时整行不渲染);**看板卡渲染标签**(#445 起,每卡至多 1 = 渲染上限,无标签零占位;原 spec 08 附录 A「看板卡不渲染」校准已退役,ADR 0002 F4 修订)。Paper 卡(PR #1371)起卡面标签 = 元信息行里的标签图标 + 名字,图标着 tag.color,不再是实心 TagChip;TagChip 只留在详情 meta 与类型筛选弹层。

## Sub-features

- `tag-fixed-vocab` 词表固定 6 词(`FIXED_TAGS`,packages/shared/src/task-meta.ts),name/描述/配色单源。
- `tag-seed-on-project-create` 项目创建即播种 6 行(REST POST /api/projects 与 chief create_project 双面)。
- `tag-seed-backfill` server 启动对存量项目按 name 幂等补齐(缺谁补谁,二次启动零动作)。
- `tag-agent-assign` 执行 agent 经 `set_task_meta` 回填(伴随标题回填;server vitest `apps/server/test/task-meta.test.ts` 钉 relay 链 + 校验面)。
- `tag-render-detail-meta` 任务详情 fresh meta 区按 todo.tagIds 渲染 TagChip(每标签一 chip,只读);看板卡自 #445 起也渲染:载体 `[data-card-tag]`(值 = tag id),标签图标 svg 的 color = tag.color,文本 = 标签名;首个可解析标签,无标签零占位(e2e 钉 = board-filter.spec)。
- `tag-no-manual-ui` 新建对话框无标签行/面板;详情页无添加 affordance;`POST /api/projects/{id}/tags` HTTP API 保留(播种复用 + 将来筛选面落点)。

## How to get to it (user POV)

- 用户不操作标签。派发任务后,执行 agent 自动归类;详情页 meta 区看已回填的 chip(只读)。

## Driving it with verify-pacman

Preconditions:

1. `launch.mjs` 起隔离栈,`doctor.mjs` 全 PASS。播种/只读渲染是 UI + server 面,无需 daemon。
2. live 面:看板新建任务对话框(无项目时自动建「默认项目」,同 board-new-task)。

- **固定词表 + 无标题面。** 看板「新建任务」→ 对话框(无标题输入/无标签行)→ 正文多行 → 保存 → 卡标题 = 首行。**跑法:** `node <skill>/scripts/drive-tags.mjs`(自足,无需 daemon/seed)——checks:类型筛选弹层选中行的 TagChip 落点契约（`[data-slot="badge"]`、20px 几何；XMON-14 起落在 registry Badge 上）→ 负空间钉(无 `.new-task-input`/`.new-task-tags`/`.new-task-tag-add`)→ 占位标题落卡 → API todo.title/tagIds 空 → 播种词表 6 行(API + SQLite)→ 详情页无标签行 + h2 = 占位标题 → 无标签卡零占位(卡面无 chip)。
- **agent 回填面。** 需 daemon + 真模型,不脚本化——server vitest 覆盖 relay 链(`task-meta.test.ts` 的 set_task_meta 三测);live 复验 = 起完整栈派发任务,看板卡标题在执行开始后被覆盖、详情页出 chip。
- **验证状态(2026-09-29)**:随 #394 改写,待本票 verify 跑出首份证据。

## Gotchas

- #445 起看板卡渲染标签(Paper 卡起 = `[data-card-tag]` 图标 + 名字,图标着词表色,每卡至多 1)——旧「看板卡不渲染」校准律(spec 08 附录 A)已退役;无标签任务卡面仍必须零占位(drive-tags 的 board-card-no-chip 钉的就是这条)。
- 词表验证镜像在 `drive-tags.mjs` 里**有意硬编码**(EXPECTED_TAGS)——与 shared 脱钩,词表漂移必须让脚本 FAIL;改词表时同步改它。
- 「保存不派发」的任务长期挂占位标题 + 无标签——预期行为(ADR 0002 Premortem),不是缺陷。
- 旧票注记(#309 手动标签面)已随 ADR 0002 D5 移除;历史证据在 `docs/verify/309/`(归档不删)。
