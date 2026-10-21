# 机器页本机行 + per-runtime 品牌 mark + 机器层 shell 开关（machines 页，spec 11 A8/A9/A7，#353/#354；#503 开关 → 品牌 mark；XMON-113 行内接回 shell 开关）

用户打开机器页（`/app/resources/machines`）看到本机钉在列表首（hostname 显示、不可删），行内带 pi / Claude Code 两个官方品牌 mark：启用 = 品牌原色，未启用 = 35% 透明——`enabledRuntimes` 的 read-only 展示面，per-runtime 位不提供启停控件（#503 摘除，理由是那些开关全仓只写不读）。行尾另有**一个活控件** = 机器层 shell 开关（XMON-113 R3；XMON-108 R1 提供 `machine.shellEnabled` 字段与 PATCH 单字段透传）：拨动即写 `PATCH /api/machines/{id}` 的 `{shellEnabled}`，乐观更新、失败回滚并落一行 `保存失败，请重试。`。「Pacman 托管机器」facade 行已除——托管形态在本架构不存在；用户真正拥有的是本机 + 自行接入的 LAN/VPS 机器（添加机器 = 在目标机器上跑同一 CLI，dialog 流程不变）。规格源：`docs/spec/11-模型服务与机器本地化.md`（A7-A9）+ XMON-85 计划 §1 / XMON-113。

## Sub-features

- `mach-local-row` 本机行钉列表首：server 启动 seed（`os.hostname()` 匹配已有行则补 `kind='local'`，无则建行，idempotent）。契约句柄：`div[data-machine-id][data-kind="local"]`（div 元素名限定防串——行内 shell 开关也带 `data-machine-id`），行文本含 hostname。
- `mach-local-nodelete` 本机行不可删（行内无删除控件/三点菜单，负向）。
- `mach-facade-gone` 「Pacman 托管机器」facade 行已除（负向；现状残留 = 前端渲染的固定装饰行，非库内数据）。
- `mach-marks` 本机行内 per-runtime 品牌 mark：`[data-runtime="pi"|"claude-code"]` 容器内 `svg`（官方 mark）；文字名不上屏（#887 图标独形）——可读名 = 容器 `aria-label` / `title`，容器文本为空（负向）；启用态由 `data-enabled="true"|"false"` 承载 = `enabledRuntimes.includes(runtime)`（#503 read-only 展示，非控件）。
- `mach-marks-consistent` mark 亮度分态与 `GET /api/teams/:id/machines` 的 `enabledRuntimes` 一致，且与 SQLite `machine.enabledRuntimes`（JSON 列）同集。
- `mach-shell-switch-single` 行内交互控件 = shell 开关（`[role="switch"]`，`aria-label` = 远程 shell；每行一个，含接入机行）+ #1108 起的并发选择器（行内唯一 `button`，见 machine-concurrency.md）；per-runtime 位零 `switch`、除并发钮外零 `button`（#503 的死控件仍负向）。判据不是「行内不许有控件」而是「不许有死控件」。
- `mach-shell-consistent` 开关 `aria-checked` 与 `GET /api/teams/:id/machines` 记录的 `shellEnabled` 一致（幂等：期望值从 API 态推导）。
- `mach-shell-write-api` 真点击 → `PATCH /api/machines/{id}` 只带 `{shellEnabled}`（单字段，连带发 `enabledRuntimes` 会全量替换该列）→ API 回读为新值。
- `mach-shell-write-db` SQLite `SELECT shellEnabled FROM machine WHERE id=?` 与 API 同值（写入真落库，不只是内存投影）。
- `mach-shell-persist-reload` 拨动后 reload，开关回显新值（读侧投影通）。
- `mach-shell-restore` 收尾拨回初值（栈状态复原，重跑不假红）。
- `mach-subline-shell-hint-only` 副行只承载 shell 开关说明（文案载体 = getByText 整句 `已授权「远程 shell」的 Agent 可在该机器上执行命令。`；#503 的 id 尾巴与 `· max` 只读死显示仍负向——#1108 的并发活控件与「执行中 n/N」读标注在行内右段，见 machine-concurrency.md）。
- `mach-shell-error` PATCH 失败 → 开关回滚 + `[role="alert"]` 出现 `保存失败，请重试。`（XMON-80 同律的可见反馈面；e2e 打桩覆盖，probe 不打桩故不在此列）。
- `mach-kind-column` machine 表三列（A9 + XMON-108 migration）：`kind`（默认 `'remote'`，本机行 `'local'`）+ `enabledRuntimes`（JSON，默认 `[]` = 全关）+ `shellEnabled`（bool，默认 0）——列名 camelCase（与既有列同形），是下文 SQLite 断言的可观测真值。
- `mach-persist` reload 后 mark 亮度分态与 API 仍一致。
- `mach-add-intact` 「添加机器」钮（role=button 文案「添加机器」）→ CLI 命令 dialog 流程不变（dialog 结构不动）。
- `mach-no-affordance` 行无 chevron 装饰（负向句柄 = 行级可点语义计数 0：`[data-kind][role="button"]` / `[data-kind] a`——装饰类已随 #944 退役，A7 语义改钉「行不可点」）。

## How to get to it (user POV)

- 看板侧栏 资源 → 机器（`/app/resources/machines`）。
- 本机行 = 列表首行；中段 mark 只读展示本机启用哪些 runtime，行右缘是「远程 shell」标签 + 开关与「执行中 n/N」读标注 +「并发 N」选择器（两个活控件，点击即写库）。
- 添加 LAN/VPS 机器：「添加机器」钮 → dialog 给可复制 CLI 命令（在目标机器上跑）。
- 驱动(`vp.mjs list machines-local-row` 列出全部 case 与 usage):
  - `node .claude/skills/verify-pacman/scripts/vp.mjs drive machines-local-row local-row`:本机行、品牌 mark、shell 开关写回。

## Driving it with verify-pacman

Preconditions:

1. `launch.mjs` 起隔离栈，`doctor.mjs` 全 PASS。**无需 daemon**——本机行走 server 启动 seed 路径；daemon loopback enroll 落 `kind='local'` 是另一条路径，不在本 probe 覆盖（需真 daemon，属 stop-button 家族配方）。
2. 依赖实现面：machine 三列 migration（A9/T1 + XMON-108）+ server 启动 seed 与 PATCH 单字段透传（T2 + R1）+ 页面重写（T4 + XMON-113 行内开关）。
3. 写路径 probe 会真的改库（拨反 → 落库 → 拨回），故必须跑在隔离栈（`VERIFY_PORT` / `VERIFY_WEB_PORT` 与 `VERIFY_REPO_ROOT` 见 README），别指向在用的栈。

- **本机行 + marks + shell 开关全链。** **跑法：** `node <skill>/scripts/drive-machines-local.mjs`（自足）——20 checks：页面就绪 → facade 负向 → API 本机记录（kind='local'，name=os.hostname() 精确匹配）→ UI 本机行钉首 + hostname 文本 → 不可删负向 → 两 mark 在位（mark + 名称）→ **mark UI=API 一致基线**（亮度分态 vs enabledRuntimes，幂等）→ **行内恰一个控件 = shell 开关**（无 button / per-runtime 无 switch）→ **开关 UI=API 一致基线**（幂等，不假设初值）→ 副行 = shell 说明 → **写链**：拨反 → API 回读新值 → SQLite 同值 → reload 回显 → 拨回初值 → SQLite kind 列 → SQLite enabledRuntimes 与 API 同集 → 整页 reload 持久 → 添加机器 dialog 流程不变 → chevron 负向。
- **真值。** `GET /api/teams/:id/machines` 记录（kind/enabledRuntimes/shellEnabled 字段）+ SQLite `machine` 行（`SELECT kind, enabledRuntimes, shellEnabled FROM machine WHERE id=?`）与 UI（mark `data-enabled` / 开关 `aria-checked`）三向对照。
- **开关的行为面拆两处**：失败回滚与乐观更新需要打桩（probe 打的是真栈），归 `apps/web/e2e/machines-shell-switch.spec.ts`；probe 只钉真栈的读写闭环。
- **幂等**：同栈重跑不假红——期望值从 API 态推导，不写死「初始全关」。

## Gotchas

- **红态语义**：同 providers-tabs.md——probe 先行于实现，红 ≠ harness 坏；实现与 map 冲突先改 map 再动 probe。
- A9 列名 camelCase（`kind` / `enabledRuntimes`）；`enabledRuntimes` 是 JSON text 列，读回要 `JSON.parse`。
- runtime 词表 `'pi'|'claude-code'` 单源在 shared（与 model-sources runtime、providers tab data-runtime 同词表）；品牌 mark 原件来源记在 `apps/web/src/components/brand-marks.tsx` 头部。
- 本机行 name 断言 = `os.hostname()` **精确匹配**（A8 seed 以 hostname 键）；机器改名后旧行按 hostname 匹配补 kind，不重复建行（idempotent 语义归 T2 实现钉）。
- 「不可删」的 probe 口径 = 行内无 `aria-label` 含「删除」的按钮且无 menu 触发（`[aria-haspopup="menu"]` 计数 0）——若实现给出删除以外的行内菜单，先改 map 再改断言。
- **#944 载体迁移**：类名钩 → 语义/data-* 载体（断言语义不变）——原 `.res-grow` → `div[data-machine-id]`、`.mach-runtime` / `.mach-mark` / `.mach-runtime-label` → `[data-runtime]` 容器 + 内 `svg` + `aria-label` 可读名（文字名 #887 起不上屏，负向 = 容器文本空）、`.mach-runtime--on` 状态类 → `data-enabled` 属性、`.mach-shell-switch` → `[role="switch"]`、`.res-row-desc` → 文案一级、`.res-add` → role=button「添加机器」、`.res-row-chev` / `.res-row-more` 负向 → 行级可点语义/menu 触发计数 0；原 res-main / res-main-col 句柄随 PR 6 三壳合一改名 `.page-main` / `.page-main-col`。
- **两个 API 前缀别写混**：读是 team 作用域 `GET /api/teams/{tid}/machines`，写是不带 team 的 `PATCH /api/machines/{id}`（apps/web e2e 打桩同坑，踩过一次）。打桩路由注册序 = 匹配逆序，catch-all 先注册。
- **开关写入是单字段 body**：`{shellEnabled}`。带上 `enabledRuntimes` 会把该列全量替换（R1 起两字段各自可选、缺省 = 不动），probe/e2e 都断言 body 恰一个键。
- 添加机器 dialog 只轻断言（开窗 + 含 `pacman` 命令文本）——CLI 命令细节面归 fixture e2e，本 probe 钉「流程不变」不钉内容。
