# 新建任务(看板)

用户在看板上把一件事变成持久任务:点「新建任务」开 dialog、**只写正文**(单字段,无标题输入——spec 15 #394)、保存,卡片落进「待开始」列,标题 = 正文首个非空行截断(占位标题,执行 agent 接单后经 `set_task_meta` 回填正式标题,ADR 0002);全新库无项目时系统自动建「默认项目」再落任务(todo → project 两跳,用户无感)。

## Sub-features

- `board-render` 工作台 shell(#351 更名 + 4 列收敛)渲染恰 4 列(待开始/执行中/待处理/已完成),列头 id↔名对拍,退役列名(规划中/待确认/待验收)不占列,收起族(钮/窄条/折叠态)无渲染位,4 列等宽且桌面无横向滚动。
- `newtask-open` 侧栏「新任务」行(`.sidebar-new-task`,#445 起顶栏「+ 任务」钮撤除)开 dialog(`.new-task-dialog`,**单字段正文 textarea `.new-task-spec`**,placeholder = 五行模板族;无标题输入/无标签行)。
- `newtask-gate` 「保存」(`.new-task-save`)与「保存并开始」(`.new-task-start`)的闸 = 正文非空(空正文双钮 disabled)。
- `newtask-save` 「保存」落卡;「保存并开始」建卡后还会起 build(会派给 Agent,无 Agent 时行为未铺,勿默认验)。
- `newtask-placeholder-title` 占位标题 = 正文首个非空行 ≤50 字符 + 超长省略号(server 派生,shared `derivePlaceholderTitle` 单源;fixture 面同规则)。
- `newtask-autoproject` 无项目时自动建「默认项目」(hosted),任务挂其下。
- `newtask-persist` 卡片三重真值:板上可见 + `GET /api/todos` 行 + SQLite `todo` 表行。

## How to get to it (user POV)

- 侧栏「新任务」行或 C 热键(XMON-41 起键位由 N 改 C;#445 起顶栏「+ 任务」钮撤除,行点击与热键同一 opener;详情页/总管另立后票)。
- 驱动(`vp.mjs list board-new-task` 列出全部 case 与 usage):
  - `node .claude/skills/verify-cairn/scripts/vp.mjs drive board-new-task new-task`:侧栏「新任务」行开 dialog、保存:卡片上板 + API + SQLite。
  - 判 stale、不带 `--force` 拒跑的 case(拒跑时打印原因):`vp.mjs drive board-new-task board`(等的看板标题元素已随 #1375 删除);`vp.mjs drive board-new-task overlay-css-migration`(读的选择子已不在 apps/web/src)。

## Driving it with verify-cairn

Preconditions:

- `launch.mjs` 起栈(全新库),`doctor.mjs` 全 PASS。

- **渲染。** 开 `/app`,工作台出现。Run `node <skill>/scripts/drive.mjs board`。4 个 `.board-column`(待开始/执行中/待处理/已完成)+ `.sidebar-new-task` 可见,证据 `01-board.png`。
- **新建。** 点「新建任务」→ 填正文(首行即任务一句话)→ 点「保存」。Run `node <skill>/scripts/drive.mjs new-task`。它完整走该链:dialog 开 → 正文上屏 → 卡片落 `[data-column-list="todo"]` 带 `#seqNum` 且标题 = 首行 → `GET /api/todos` 找到该 title 且 `phase=todo` → SQLite `SELECT id,title,phase,seqNum FROM todo WHERE title=?` 命中。证据 `01-board-before.png` / `02-new-task-card.png` + `result.json`(含 apiTodo/dbTodo 字段)。
- **持久化(重载)。** new-task probe 后手动补:reload `/app`,同一 `.todo-card[data-todo-id]` 仍在「待开始」列(卡片 = 查询真值渲染,重载即二次确认)。
- **项目 chip。** dialog 里 `.new-task-project` 显示当前项目(全新库首建后 =「默认项目」);多项目时点开 `.new-task-project-menu` 选行(`aria-selected`)——选择是纯表单态,随提交走(fixture 面 e2e newtask-project-select.spec.ts 已锁该行为,live 复验非必须)。
- **单字段形态 + 占位标题(fixture 面)。** `apps/web/e2e/newtask-single-field.spec.ts` 钉:无标题输入/无标签 UI、保存闸 = 正文非空、首行落卡、>50 字符截断省略号、autofocus 在正文。

## Gotchas

- 「保存并开始」会 POST builds(起运行)——不属本 feature 的最小证明,别顺手点。
- 全新库下第一张卡会先触发自动建项目(两跳 mutation),卡片出现比单跳慢一拍;probe 的 15s 等待已覆盖,手动验时别提前断言。
- 断言用 `[data-column-list="todo"]` 定列 + 卡片 `data-todo-id`,别按列序/坐标猜。
- API/DB 断言要与板上同一 title 对齐——**title = 正文首行派生**(占位标题),探针正文首行带时间戳防撞残留数据(全新库理论无残留,防的是复用旧栈)。
- agent 回填(`set_task_meta`)会让标题在任务开始后变为 LLM 总结值——验「开始后标题变化」归 live 带 daemon 的链,本 feature 只钉占位态。
