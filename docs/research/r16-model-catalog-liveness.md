# 模型选择面：上游全量目录 + 活性状态 — phase-1 调研与 spec 草案（随 PR #1288 入仓）

> 目标 issue：#1288（OPEN）。本文件原为只读调研产物，现已随 #1288 施工 PR 入仓（docs/research/r16-model-catalog-liveness.md）——数据流全链证据 / 方案 A/B/C 对比 / 10 条失败方式 / spec 骨架为开工时的决策正本，实现时已按票面三道闸落地。
> 仓内相关票：#1287（别名解析去重，施工中，改 `packages/shared/src/records/model-source.ts`）。
> Background (measured): a claude-code machine offers at most 5 models, one per slot mapped in `~/.claude/settings.json`. The upstream relay (provider row relay-186, baseUrl `http://<relay-host>:<port>`, apiKeyCipher in SecretBox) serves 9 models from `GET /v1/models`; two of them, `deepseek-v4.1-flash` and `gpt-5.6-luna`, were withdrawn upstream (`/v1/messages` 404), yet the UI still lists them, while `homeMachineRejectReason` rejects live models outside the list with a 400.

---

## 1. 数据流现状（一个模型 id 从哪来、经哪几跳、在哪被去重/过滤）

### 1.1 两族模型来源，互不合并

**族 A — provider 表模型（pi 段 / custom provider）**
- 存储：`provider.models` 列，`json<ProviderModel[]>`，明文（`apps/server/src/db/schema.ts:475`）。
- `ProviderModel` 形状 = `{ id, name, cost? }`（`packages/shared/src/records/provider.ts:31-36`）——**用户手工录入**，不是探活来的（注释明写 `// 探测模型 对 /v1/models 拉列表 (r3 §2)`，但当前无探测实现，列值只有写入面）。
- relay-186 是本族一员：`baseUrl` + `apiKeyCipher`（SecretBox 密封）+ `models[]`（用户录入的子集）。
- 读出：`listProviders` → `toProviderRecord`（`providers.ts:48-62`，`models: row.models` 原样透出）。

**族 B — claude-code 机器上报模型（claude-code 段）**
- 来源：daemon 读本机 `~/.claude/settings.json`（`model` 字段 → default 槽；`env.ANTHROPIC_*_MODEL` → 命名槽），纯槽位语义单源 = shared `parseClaudeCodeModelSource`（`packages/shared/src/records/model-source.ts`）。
- daemon 侧：`readClaudeCodeReport()`（`apps/daemon/src/claude-code-models.ts`）组装 `{installed, hostname, models, bin?, auth?}`。
- 上行：enroll + 每 30s presence 携带 `claudeCode` 字段（`apps/daemon/src/machine-loop.ts:288`、`:303`、`:305`；`machine-client.ts:86/93`）。
- 落库：`markPresence` 把 `body.claudeCode` 覆写进 `machine.claudeCodeReport`（`apps/server/src/services/machines.ts:494-509`，每拍覆写）。
- 这族模型的 id 实际由 relay 提供（claude-code `ANTHROPIC_BASE_URL` 指 relay，`ANTHROPIC_*_MODEL` 选 relay 目录里的某条），但 pacman 数据面看不到 relay 目录全量——只看机器槽位映射出的子集（至多 5 条）。

**两族合流点 = `getModelSources`（`providers.ts:getModelSources`）**
- 产出 `{ sources: [pi 段, ...每台上报机一段 claude-code] }`。
- pi 段：`listProviders` 的所有 custom provider `models[]` 扁平投影（空 id 丢弃，空 name 回退 id）。
- claude-code 段：`listClaudeCodeSources` 按机器名排序逐机一段（`providers.ts:listClaudeCodeSources`）。
- **关键：两族只是并列进同一个 `sources[]` 数组，不做 id 级合并去重**。pi 段的 relay 模型与 claude-code 段的槽位模型即使指向同一 relay 模型 id 也各占一行。

### 1.2 web 选择器消费链

- `GET /api/teams/:id/model-sources`（`routes-resources.ts:396-399`）→ `getModelSources(keysvc, teamId)`。
- web `useModelSources(teamId, live)` 拉封套（`providers-page.tsx:149`）。
- **providers 页**（`providers-page.tsx:140-270`）：tablist = `pi` / `claude-code`；按 `?runtime=` 过滤 `matching`，逐段渲染 header 卡 + 模型行。**只展示，不可选**——行无 click handler，纯只读目录视图。
- **模型选择器**（agent 创建/概览两级级联 + chief 压缩 popover）：
  - 候选投影 = `toModelOptions(sources)`（`apps/web/src/api/mappers.ts:1197-1224`）。
  - **当前实现只取非 pi 段**（`if (source.runtime === 'pi') continue;`，`mappers.ts:1213`）——即选择器**只看 claude-code 段机器槽位模型，不看 pi 段 relay 目录**。这是 #1288 问题 1「选择器看不到、选不了」的直接成因：用户裁决原文（注释）「自有 relay 不要，Claude Code 肯定做得比我们好」让 pi 段退出了选择器，但 claude-code 段又只是槽位子集，于是 9 个里只 5 个可见。
  - 去重键 = `provider/machineId/modelId`（`mappers.ts:1207`，#1259 加 machineId 防多机同名撞键），first-wins。
  - 两级级联（`agent-model-select.tsx`）：一级 = provider 分组（`providerGroups`），二级 = 该 provider 名下模型。一级清空二级（防跨 provider 脏值）。

### 1.3 去重/过滤落点汇总

| 位置 | 作用 | 证据 |
|---|---|---|
| `toModelOptions` 去重键 `provider/machineId/modelId` | 选择器候选去重 | `mappers.ts:1207` |
| `getModelSources` pi 段空 id 丢弃 / 空 name 回退 id | 封套卫生 | `providers.ts:getModelSources` |
| `parseClaudeCodeModelSource` 槽值空串跳过 | 上报卫生 | `model-source.ts` |
| `homeMachineRejectReason` 模型清单校验 | **写入闸**（见 §4） | `dispatch-eligibility.ts:269-285` |
| claim 面 `!agentRow.modelId` | 只查非空，不查清单 | `machines.ts`（chief `:735`，worker 同形） |

### 1.4 写入闸现状（`homeMachineRejectReason`，`dispatch-eligibility.ts:259-285`）

- 触发面：创建 agent（`routes-agents.ts:87`）、PATCH 换 provider/model 或换归属机（`:181`、`:196`）、整机迁移批量校验（`routes-resources.ts:221`）。**三处共用单源**。
- 判据：`runtime === 'claude-code' && modelId != null` 时，要求 `report.installed && report.models.some(m => m.id === modelId)`。`report = machine.claudeCodeReport`（**只查 claude-code 段槽位清单，不查 pi 段 relay 目录**）。
- 这就是 #1288 问题 3：清单外**活**模型（如 relay 在架的 `glm-5.3-flash`）被 400 拒——闸挡的是「没配进槽位」而不是「不能用」。

---

## 2. provider 表模型与 claude-code 上报模型两族现在如何在 UI 合流（或不合流）

**结论：不合流。**

- providers 页：两族各占一个 tab（pi / claude-code），**并列展示不合并**。pi tab = 所有 custom provider 的 models[] 扁平铺（跨 provider 平铺，模型 id 偶发撞名用索引兜底，`providers-page.tsx:232`）；claude-code tab = 按机器分段，每段是该机 settings.json 槽位映射。
- 模型选择器：`toModelOptions` **只消费 claude-code 段**（`mappers.ts:1213` 跳过 pi 段），pi 段 relay 目录不进选择器候选。
- provider.models 列明文结构 = `{ id, name, cost? }`（`provider.ts:31-36`），由用户手工录入（create/update provider 表单），**无探活回填**。

**两族 id 实际同源（都来自 relay）但数据面互不可见**：claude-code 槽位模型 id 是 relay 目录的子集，pi 段 relay provider 的 `models[]` 是用户另录的（可能过期 / 不全）。UI 既看不到 relay `/v1/models` 全量，也无法判断哪条还活着。

---

## 3. 探活方案取舍（核心交付）

> 探活目标 = 拿到 relay `/v1/models` 的活目录（9 条）+ 标注哪些活/哪些死（404 的 2 条）。探活对象是 **relay（provider 表行，server 持 apiKeyCipher）**，不是 claude-code 二进制——claude-code 槽位只是 relay 目录的用户子集选择，活性继承自 relay。

### 方案 A — server 侧直连 relay `/v1/models`（持 apiKeyCipher）

**机制**：server 调 `openProviderKey`（`providers.ts:305`，已有 SecretBox 解密先例）拿 relay apiKey → `fetch(baseUrl + '/v1/models', { headers: { Authorization: 'Bearer <key> } })` → 解析返回的模型清单 + 各模型活性。

**密钥触达面**：与 `openProviderKey` / `openGithubToken`（`github-connection.ts:61`）同律——明文只进内存、不落盘、不进日志。server 已有外部 HTTP 先例（`lib/github.ts` 的 `fetchImpl` + `AbortSignal.timeout` + `readJson`，`skill-import.ts` 的 `fetch + GH_HEADERS`）。

| 维度 | 评价 |
|---|---|
| 探测成本 | 一次 HTTP GET /v1/models（轻量，relay 侧只列目录不打模型）。可按 provider 缓存。 |
| 缓存/TTL | server 内存缓存，TTL 建议 60s（对齐 Multica `cachedDiscovery` 60s，`r13:154`）。presence 30s 节拍太频繁，目录变更分钟级才发生。 |
| 失败语义（误杀风险） | **中**：探活失败（relay 断网/超时）≠ 模型死。必须 fail-open：探不到 = 标「未知」不置灰，绝不能把活模型标死。死判定要靠 `/v1/messages` 404 实测，不是 `/v1/models` 不返回——`/v1/models` 列出的模型也可能 404（实测：deepseek-v4.1-flash 在 /v1/models 里但 /v1/messages 404）。**这是 A 方案的最大坑**：/v1/models 只给「在目录」不给「能调通」。 |
| 密钥暴露面 | server 持明文出站一次/缓存周期。密钥不出 server 进程（不进 wire、不进日志），与既有 github/oauth 出站同律。 |
| 与 #1287 关系 | **无冲突**。#1287 改 `parseClaudeCodeModelSource`（claude-code 段别名解析去重），A 方案改 relay 目录探活，两族正交。交界 = 合流时按 model id 去重（见 §7）。 |

**A 的关键缺陷**：`/v1/models` 列出的模型仍可能 404（上游下架未同步目录）。要真正判活需对每条模型发最小 completion 探测——成本高、易触发额度/计费，**不推荐**。退而求其次：`/v1/models` 给「目录在」，死模型靠运行时 404 回填标注（见 §5）。

### 方案 B — daemon 侧探测随 presence 上报（30s 节拍）

**机制**：daemon 侧对 claude-code 配的 relay 发 `/v1/models`，结果随 presence 上报进 `claudeCodeReport`（或新字段）。

| 维度 | 评价 |
|---|---|
| 探测成本 | 每台 claude-code 机每 30s 一次 GET /v1/models。多机重复探测同一 relay。 |
| 缓存/TTL | daemon 侧 mtime/间隔缓存（对齐 `createMachineCapabilitiesProbe` 的 mtime 缓存律，`machine-capabilities.ts`），但 relay 目录无本地文件 mtime 可比，只能时间窗缓存。 |
| 失败语义 | daemon 探不到 = 上报「未知」，server fail-open。与 A 同样的 /v1/models ≠ 可调通坑。 |
| 密钥暴露面 | **更宽**：daemon 也要拿 relay apiKey。当前 daemon 不持 relay 密钥（relay 是 server 侧 custom provider，daemon 只跑 claude-code 二进制读 settings.json）。把密钥下沉到 daemon = 新增暴露面 + 多机密钥分发问题。 |
| 与 #1287 关系 | 同 A，正交。 |

**B 的关键缺陷**：密钥暴露面扩大（daemon 要持 relay key），且多台 claude-code 机重复探同一 relay。relay 是 server 侧资产，探测权应在 server。

### 方案 C — 惰性探活（选择器打开时探）

**机制**：web 选择器打开 → 触发 server 一次 `/v1/models` 探测 → 返回带活性标注的目录。

| 维度 | 评价 |
|---|---|
| 探测成本 | 按需，无空转。但每次开选择器都探 = 用户感知延迟（HTTP 往返）。 |
| 缓存/TTL | server 侧短缓存（如 30-60s）兜住连开。 |
| 失败语义 | 同 A。 |
| 密钥暴露面 | 同 A（server 持 key）。 |
| 与 #1287 关系 | 正交。 |

**C 的关键缺陷**：选择器打开是高频交互，每次探 = 用户等。且死模型 404 只有运行时才暴露，惰性探活探不到死。

### 推荐：A（server 侧直连 relay `/v1/models`，60s 缓存）+ 运行时 404 回填标注

**理由**：
1. **密钥归属正确**：relay 是 server 侧 custom provider 资产（apiKeyCipher 在 server），探测权在 server，不下沉 daemon（避免 B 的密钥暴露面扩大）。
2. **成本可控**：60s 缓存对齐 Multica 既有 60s TTL（`r13:154` `cachedDiscovery`），presence 30s 节拍不必触发探活。
3. **失败语义安全**：`/v1/models` 探不到 = 标「目录未知」fail-open 不置灰（绝不把活模型标死）。
4. **死模型靠运行时回填**：`/v1/models` 给「目录在」，真正的死（404）靠 step 运行时失败回填标注（见 §5）——这避免了对每条模型发 completion 探测的高成本/计费风险。
5. **与 #1287 正交**：A 探 relay 目录，#1287 解析 claude-code 槽位别名，两族合流时按 model id 去重。

**A 方案的已知边界（必须写进 spec）**：`/v1/models` 列出 ≠ 可调通（上游下架未同步目录）。因此活性三态 = `alive`（目录在 + 运行时未报死）/ `dead`（运行时 404 回填）/ `unknown`（目录在但未跑过 / 探活失败）。**不做主动 completion 探活**（成本/计费/误杀风险）。

---

## 4. 写入闸语义修正：`homeMachineRejectReason` 从「在槽位清单内」改成「在合并目录内且活」

### 4.1 当前判据（`dispatch-eligibility.ts:269-285`）

```
runtime === 'claude-code' && modelId != null
  → report.installed && report.models.some(m => m.id === modelId)
  → 否则 400「未配置模型 X」
```

`report = machine.claudeCodeReport`（只查 claude-code 槽位 5 条）。

### 4.2 修正落点

闸的语义从「modelId 在该机 claude-code 槽位清单内」改成「modelId 在合并目录（relay 活目录 ∪ claude-code 槽位）内，且非 dead」。

- **活目录来源**：A 方案探活的 relay `/v1/models`（活模型集）。
- **claude-code 槽位**：仍由 `machine.claudeCodeReport` 提供（#1287 解析后是真名去重清单）。
- **合并 = 按 model id 并集，活性取严**：在 relay 活目录或在槽位清单都算「可配」；标 dead 的不可配（置灰 + 报错指认）。

### 4.3 影响面（确认无第二处模型清单闸）

- claim 面（`machines.ts` chief `:735`、worker 同形）：只查 `!agentRow.modelId`（非空）+ `runtimeGatePasses` + `capabilityGatePasses`，**不查模型清单**——claim 不受影响，无需改。
- `personas.ts:pickPersonaModel`（`:n`）：取 `claudeCodeReport.models` default 槽首条 / 回落 pi provider 首模——**选值面不是闸**，但 A 方案后可优先从活目录选（避免选到死模型 seed 给 persona）。
- 三处 `homeMachineRejectReason` 调用（`routes-agents.ts:87/181/196`、`routes-resources.ts:221`）共用单源，改一处即全改。
- **无第二处模型清单闸**：grep 确认 `.models.some` / `report.models` 只在 `dispatch-eligibility.ts`（闸）与 `personas.ts`（选值）出现。

### 4.4 修正后文案（T6 律「报机器 + 报修法」先例，`dispatch-timeouts.ts`）

参考 `dispatch-timeouts.ts` 的可见 reason 兜底律（缺项点名 + 修法），死模型拒绝文案应指认：模型名 + 哪台机 + 修法（换活模型 / 联系上游）。例：`机器 mea 的模型 deepseek-v4.1-flash 已被上游下架（/v1/messages 404）。换一个活模型，或联系上游恢复上架。`

---

## 5. UI 形态：死模型置灰/隐藏/标注的取舍；存量 agent 挂死模型的显式报错

### 5.1 死模型在选择器与 providers 页

- **选择器（agent-model-select / chief popover）**：死模型**置灰 + 标注不隐藏**（保留可见性，用户看得到历史值为何不可选）。行 disabled，副题标注「已下架」。隐藏会让用户以为模型从没配过，丢失诊断信息。
- **providers 页**（只读目录）：死模型行同样置灰 + 标注，不隐藏。

### 5.2 存量 agent 挂死模型的显式报错

- 参考 `dispatch-timeouts.ts` 的 T6 律「报机器 + 报修法」：当 agent 的 modelId 在活目录里标 dead 时，agent 卡片 / claim 失败行显式指认「模型 X 已被上游下架，换模型或联系上游」。
- claim 面（machines.ts）当前 dead 不会在 claim 闸拦（claim 不查清单），死模型会在运行时 404——需把运行时 404 分类成「模型已下架」失败语义（`classifyStepFailure` 现有 network/quota 分类旁加 `model_unavailable`），落 `build.errorMessage` 可见失败态 + 指认修法。
- **运行时 404 回填**：step 运行时撞 `/v1/messages` 404 → `classifyStepFailure` 识别为 `model_unavailable` → 回填该模型 id 的 `dead` 标注进活目录缓存（server 侧）→ 后续选择器/闸即时置灰 + 拒绝。这是 A 方案「死模型靠运行时回填」的闭环。

### 5.3 活性三态 UI 渲染

| 态 | 选择器 | providers 页 | 闸 |
|---|---|---|---|
| alive | 可选 | 正常 | 放行 |
| dead | 置灰 + 「已下架」 | 置灰 + 「已下架」 | 400 拒绝 + 修法 |
| unknown | 可选（fail-open） | 正常 + 无标注 | 放行 |

---

## 6. 借鉴面

### 6.1 Multica（`docs/research/r10`、`r13`）

- **模型清单来源**（`r10:148-162`、`r13:149-154`）：`ListModels` 按 provider 分派，每族一套 discovery。Claude 走 stream-json `list_models` 控制协议（无 `--list-models`），回答由**已装二进制 + 已登录账号**算出。
- **缓存**：`cachedDiscovery` 60s TTL（`r13:154`）——本 spec A 方案 60s 缓存对齐此值。
- **picker 惰性**：`ModelSelectionSupported` 对 qwenpaw/mcode/zeroclaw 返回 false，UI 显「Managed by runtime」（`r10:162`）——pacman 无此族，不适用。
- **disabled 行**（`r13:107`）：claude 目录里 disabled 行 → `UnavailableModel` with Reason——本 spec 死模型标注借鉴此形（dead + reason）。
- **关键差异**：Multica 的 discovery 是**对自己 spawn 的二进制**发 list_models（server 持有二进制执行权）；pacman 的 claude-code 是**用户的机器 + 用户的 relay**，server 不 spawn claude 二进制。因此 pacman 不能照搬 Multica 的 stream-json list_models 探测——pacman 探的是 relay `/v1/models`（HTTP），不是 claude 二进制控制协议。

### 6.2 spec 11 (`docs/spec/11-model-service-and-machine-localization.md`) already has rulings — conflict check

- **A3**（pi tab 数据源 = custom providers models[]）：A 方案探活不改 pi 段数据源结构，只增活性标注层。**不冲突**。
- **A4**（claude-code tab 数据源 = 执行机上报、server 按机器聚合）：A 方案探活对象是 relay（pi 段资产），不改 claude-code 段上报链。**不冲突**。
- **A10**（chief-model-select 选项 = 两 runtime 模型并集 + custom providers）：#1288 的核心改动 = 选择器候选要从「只 claude-code 段」扩到「claude-code 段 ∪ relay 活目录」。**这与 A10 的「并集」表述一致，但与当前 `toModelOptions` 跳过 pi 段的实现冲突**——需修正 `toModelOptions` 不再跳过 relay provider 段（或新增活目录段）。**显式冲突点**：A10 注释「自有 relay 不要」是当时裁决，#1288 要翻案（让 relay 活目录进选择器），spec 11 A10 需 superseded-in-part。
- **#774 收单回落**（chief 主模型槽存量值不在候选里 → 置 null）：扩候选后，原被跳过的 relay 模型现在在候选里，回落逻辑触发面变化——需核对，但语义不变（仍在候选里就不置 null）。
- **数据契约**（`GET /api/teams/:id/model-sources`）：A 方案可能扩 `modelSource` schema 增活性位（`alive/dead/unknown`），或新增独立活目录段。**与 #1287 共改 `model-source.ts`——交界见 §7**。

---

## 7. 与 #1287 的交界清单

#1287（施工中）改 `packages/shared/src/records/model-source.ts` 的 `parseClaudeCodeModelSource`：别名解析成真名 + 按 id 去重。本 spec 改同文件（schema 增活性位）+ `toModelOptions`（候选扩 relay 活目录）+ `homeMachineRejectReason`（闸语义）。

| 交界点 | #1287 | #1288（本 spec） | 协调 |
|---|---|---|---|
| `model-source.ts` schema | 改 `parseClaudeCodeModelSource` 逻辑（别名→真名、去重） | 增活性位（`liveness?: 'alive'\|'dead'\|'unknown'`）on `modelSourceModelSchema` | **同文件不同字段**，无文本冲突；合并期注意 #1287 先合则本 spec 基于其去重后的清单加活性位 |
| 去重键 | claude-code 段内按 id 去重 | 合流时 relay 活目录与 claude-code 段按 id 去重（跨族） | #1287 是族内去重，#1288 是族间合流去重——**两层去重不冲突**，#1288 合流时以 #1287 去重后的 claude-code 清单为输入 |
| `toModelOptions`（`mappers.ts:1213`） | 不改（仍只 claude-code 段） | 改：不再跳过 relay provider 段（或消费活目录段） | #1288 独占此改动，#1287 不碰 |
| `homeMachineRejectReason` | #1287 验收要求「核对 homeMachineRejectReason 行为不回退」 | #1288 改闸语义（合并目录 + 活） | **顺序依赖**：#1287 先合（claude-code 清单已是真名去重），#1288 的合并目录基于干净清单判活，避免别名/重复干扰活性判定 |
| `personas.ts pickPersonaModel` | #1287 要求核对 | #1288 可让 persona 优先选活模型 | 两票都碰此函数，合并期协调 |

**建议顺序**：#1287 先合（族内去重 + 别名解析），#1288 基于 #1287 的干净清单做族间合流 + 探活。若并行，#1288 的 spec 须声明「claude-code 段输入假设已过 #1287 去重」。

---

## 8. spec 草案骨架

### 8.1 影响面

**shared**
- `packages/shared/src/records/model-source.ts`（与 #1287 共文件，见 §7）：
  - `modelSourceModelSchema` 增 `liveness?: 'alive' | 'dead' | 'unknown'`（缺省 = unknown，fail-open）
  - 可能新增 relay 活目录段 schema（或复用 modelSource 形 + runtime='pi'）
- 新增 `packages/shared/src/records/` 探活结果 wire 形（若独立段）

**server**
- 新增 `apps/server/src/services/model-liveness.ts`（探活服务）：
  - `probeRelayCatalog(deps, providerId)` → `openProviderKey` 拿 key → `fetch(baseUrl + '/v1/models')` → 解析 → 60s 内存缓存（对齐 `cachedDiscovery` 60s）
  - 失败 fail-open（返回 unknown，不标死）
  - 运行时 404 回填：`markModelDead(deps, providerId, modelId)` 写进缓存
- `getModelSources`（`providers.ts`）：relay provider 段附带活性标注（或新增活目录段）
- `dispatch-eligibility.ts:homeMachineRejectReason`：判据从「槽位清单内」改成「合并目录内且非 dead」
- `classifyStepFailure`（运行时失败分类）：增 `model_unavailable`（识别 `/v1/messages` 404）→ 回填 dead + 落 `build.errorMessage` 指认修法
- `personas.ts:pickPersonaModel`：优先从活目录选（避免 seed 死模型）

**web**
- `mappers.ts:toModelOptions`：候选扩到 claude-code 段 ∪ relay 活目录（不再 `continue` 跳过 pi/relay 段），跨族按 model id 去重
- `agent-model-select.tsx` / `model-select-core.tsx`：死模型行置灰 + 「已下架」标注（disabled + 副题）
- `providers-page.tsx`：死模型行置灰 + 标注
- agent 卡片：modelId 标 dead 时显式报错指认（T6 律）

**daemon**：无改动（探活在 server 侧，relay 是 server 资产）。

### 8.2 验收口径

- 探活：relay `/v1/models` 返回 9 条，UI 选择器显示 9 条（含原槽位外 4 条）；其中 2 条死模型（运行时 404 回填后）置灰 + 标注。
- 闸：活模型（不在槽位清单但在 relay 目录）创建 agent 不再 400；死模型创建 400 + 指认修法。
- 探活失败（relay 断网）：全部标 unknown，不置灰不拒绝（fail-open）。
- 运行时 404：step 失败分类为 `model_unavailable`，回填 dead，后续选择器/闸即时生效。
- 与 #1287：claude-code 段输入为 #1287 去重后清单，合流去重不重复。

### 8.3 失败方式清单（先列再写实现）

1. **探活超时/断网**：relay 不可达 → 全标 unknown（fail-open），不误杀活模型。
2. **`/v1/models` 列出但 `/v1/messages` 404**：目录在但实际已下架 → 靠运行时 404 回填 dead，不靠探活判死（A 方案已知边界）。
3. **密钥损坏/keyfile 不匹配**：`openProviderKey` 抛 SecretBoxError → 探活失败 fail-open（标 unknown），不崩选择器。
4. **多 relay provider**：每个 custom provider 各探各的，缓存按 providerId 分键。
5. **运行时 404 误判**：非模型死的 404（如临时上游故障）被误标 dead → dead 标注带 TTL（如 10min 后重探复活），或仅运行时回填不主动复探（保守）。
6. **claude-code 段与 relay 段同 id 两行**：跨族去重 first-wins，活性取严（任一族标 dead 则 dead）。
7. **存量 agent 挂死模型**：扩候选后存量值命中候选 → 不触发 #774 回落；dead 则卡片报错指认。
8. **#1287 未合时合流**：claude-code 段有别名/重复 → 合流去重前先过 #1287 逻辑，否则重复行进选择器。
9. **探活缓存过期窗口内上游下架**：60s 内 dead 未回填，用户选了刚死的 → 运行时 404 兜底回填 + 失败指认。
10. **provider 表 relay 行无 apiKeyCipher**：`openProviderKey` 返回 null → 探活跳过（标 unknown），不 400。

---

## 9. 推荐方案一句话结论

**server 侧直连 relay `/v1/models` 探活（60s 缓存，fail-open，密钥触达面同 `openProviderKey`/`openGithubToken` 既有先例），死模型靠运行时 404 回填标注；选择器候选扩到 claude-code 段 ∪ relay 活目录跨族去重；`homeMachineRejectReason` 闸语义从「槽位清单内」改成「合并目录内且非 dead」。**

## 10. 与 #1287 交界一句话

#1287 改 `parseClaudeCodeModelSource`（claude-code 族内别名解析 + 去重），本 spec 改同文件 schema 增活性位 + `toModelOptions` 扩候选 + 闸语义；两票同文件不同字段无文本冲突，但 #1288 的族间合流去重以 #1287 族内去重后的清单为输入——建议 #1287 先合。
