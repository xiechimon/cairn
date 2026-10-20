# 模型服务 runtime tabs（providers 页，spec 11 A1-A4/A7，#353/#354）

用户打开模型服务页（`/app/resources/providers`）看到 `pi` 和 `Claude Code` 两个 runtime tab：每个 tab 头部卡写着 runtime 名、一行说明和它跑在哪台机器（「已安装在 \<hostname\>」/未安装指引），tab 内是该 runtime 的模型行（显示名 → 模型 id）。pi 的模型来自用户配置的 custom provider；Claude Code 的模型来自各执行机 daemon 读本机 `~/.claude/settings.json` 经 presence/enroll 上报、server 按机器聚合（#707）。「Pacman（内置）」facade 行已除，页面不再承诺不存在的远程托管服务。规格源：`docs/spec/11-模型服务与机器本地化.md`（A1-A4/A7 + model-sources 数据契约）。

## Sub-features

- `prov-tablist` tablist = 恰两个 tab：`pi` / `Claude Code`（无「内置」字样；Codex 后续票再扩）。契约句柄：`[role="tablist"]` + `[role="tab"][data-runtime="pi"|"claude-code"]` + `aria-selected`，默认选中 pi。
- `prov-tab-url` tab 状态同步 `?runtime=pi|claude-code` search param——刷新/分享可回定位，深链直落对应 tab。
- `prov-runtime-head` 每 tab header 卡（`[data-testid="runtime-head"][data-runtime]`）：runtime 名 + 一行说明 + 安装态。claude-code 安装态 = 执行机上报（A4，#707 修订）：上报过的机器各一张 header 卡——有 settings 文件 → 「已安装在 \<上报 hostname\>」；无文件 → 「未安装」指引态，不空报不崩；从未上报的机器（旧 daemon）无卡、不下发假清单。
- `prov-pi-models` pi tab 模型行 = custom providers `models[]` 投影（A3）。契约句柄：`[data-model-id][data-runtime]`，行文本含显示名与模型 id。
- `prov-pi-empty` 无 custom provider 时 pi tab 空态（`[data-testid="runtime-empty"]`）+ 引导钮开添加服务商 picker（A3；picker 面见 provider-picker.md）。
- `prov-facade-gone` 「Pacman（内置）」facade 行已除（负向；现状残留 = 前端渲染的固定装饰行，非库内数据）。
- `prov-no-affordance` 模型行纯展示无 handler → 不渲染 chevron/三点装饰（负向句柄 = 行内 `[data-model-id] svg` / `[data-model-id] button` 计数 0——装饰类已随 #944 退役，A7 语义改钉「纯展示行无可点感」）。
- `prov-model-sources-api` `GET /api/teams/:id/model-sources` → pi 首段 + 每台上报过的机器一段 claude-code（序固定：pi 首 + 按机器名），与 UI 双真值一致（数据契约单源在 shared）；封套元素形状 `{runtime, installed, hostname, models[{id, name, slot?}]}` 逐段钉死（机器无关面）。

## Drive (vp.mjs)

- `vp.mjs drive providers-tabs claude-bin-detection`
- `vp.mjs drive providers-tabs runtime-tabs`

前置（stack / daemon / stub-llm …）、状态与脚本参数：`vp.mjs list providers-tabs`。`vp.mjs` = `node .claude/skills/verify-pacman/scripts/vp.mjs`。

## How to get to it (user POV)

- 看板侧栏 资源 → 模型服务（`/app/resources/providers`），落地默认 pi tab。
- tab 点击切换；URL 带 `?runtime=claude-code` 深链直落 Claude Code tab。

## Driving it with verify-pacman

Preconditions:

1. `launch.mjs` 起隔离栈，`doctor.mjs` 全 PASS。claude-code 段由 probe 经公开 machine wire 自铺底一台上报过的机器（建 API key → enroll 携 claudeCode 上报），无需真 daemon。
2. **全新库**：pi 空态断言要求库内无 custom provider（同 api-key probe 律）——先于 `drive-provider-picker.mjs` 跑（picker 的 e2e 会建 provider）；重验 = 重 launch。
3. claude-code 段数据源 = **probe 铺底的上报值**（hostname=`verify-exec-1`、模型 `verify-cc-model-*`，确定性；与运行机真实 `~/.claude/settings.json` 无关——#707 起 server 不读本机文件）。probe 断言 UI=API=上报值三方一致。

- **runtime tabs 全链。** **跑法：** `node <skill>/scripts/drive-providers-tabs.mjs`（自足，无需 daemon/seed）——21 checks（#707 起 +enroll-executor-api、executor-following 两条）：页面就绪 → tablist/两 tab/文案/默认 pi → facade 负向 → pi 空态 → 空态钮开 picker → API 铺底 custom provider（公开 REST，非被测路径，同 search probe 铺底律）→ pi 模型行命中铺底模型 → chevron/三点负向 → 切 Claude Code（aria-selected + ?runtime= 同步）→ model-sources API 两段 → 封套形状 → header 卡安装态分支 → claude-code 模型行 UI=API 行数一致 → 深链回定位。
- **真值。** `GET /api/teams/:id/model-sources` 封套（runtime/installed/hostname/models）与 UI header 卡、模型行交叉对照；铺底 provider 走 `POST /api/teams/:id/providers`（响应 201 全记录）。
- **验证状态（2026-09-28，#354）**：先行地图（spec 11 A12）——实现票（model-sources 端点 + providers 页重写）落地前本 probe 为**红**，每条 FAIL detail 指向 spec 条款；红态输出即实现票的验收清单，实现票验收 = 本 probe 转绿 + 证据归档。

## Gotchas

- **红态语义**：本 probe 先行于实现（A12「实现票消费之」）——红 ≠ harness 坏，别为了转绿改断言；实现与 map 冲突时先改 map（`/maintain-verification-skill`）再动 probe。
- **契约句柄是 T0 定义的**：`data-runtime` 词表 = `'pi'|'claude-code'`（与 machine `enabledRuntimes` PATCH 词表同源，shared 常量单源）；`[data-testid="runtime-head"]` / `[data-model-id]` / `[data-testid="runtime-empty"]` 载体以本文件为准，实现要改载体先改 map（**#944 载体迁移**：类名钩 → 语义/data-* 载体，原 `.res-runtime-head` / `.res-model-row` / `.res-runtime-empty` 类名退役，断言语义不变）；负向句柄 = 行内 svg/button 计数 0（原 `.res-row-chev` / `.res-row-more` 装饰类退役，A7 语义 = 纯展示行无可点感）。
- 全新库次序：先 tabs 后 picker；跑反了 pi 空态断言假红（库内已有 picker e2e 建的 provider）。
- claude-code header 两分支皆合法（installed true/false）——断言以 model-sources API 为分支依据，别写死「已安装」。
- `?runtime=` 不翻 live 判定（live 面只看 `?scenario=`），live URL 可安全携带。
- Codex tab 不断言（A1：后续票再扩）；tab 数恰 2 是负向钉。
- chief-model-select 数据源切换（A10）不在本 probe——属 T5，选项清单面另铺。
