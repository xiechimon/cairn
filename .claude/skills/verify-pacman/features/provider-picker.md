# 添加服务商 picker dialog（providers 页「新建」，spec 11 A5/A6，#353/#354）

用户在模型服务页点「新建」， dialog 是上游形态的 picker：顶部搜索框（客户端过滤）+ 38 项 preset 行（显示名照 spec 11 名单；OAuth 徽标只骑族表已接线族——现仅 github-copilot；openai-codex 族未接线，#385：行禁用 + 右端「暂未开通」注记）+ 底部「自定义端点」入口（disclosure 展开现有自定义网关表单）。点 api_key 族 preset 行进该 preset 的密钥表单；已接线 OAuth 族走既有 authorize 重定向（#231/#243 着陆面原样保留）。38 项 preset 数据层全留（shared `PROVIDER_PRESET_IDS`），但只在 dialog 内出现——页面列表不再投喂。规格源：`docs/spec/11-模型服务与机器本地化.md`（A5/A6 + 38 项名单 + #385 修订注）。

## Sub-features

- `pick-open` providers 页「新建」（role=button 文案「新建」exact；CSS 载体 `[data-testid="resource-new"]`）开 picker dialog（dialog 族律不变：X / Esc / backdrop，#68）。
- `pick-page-no-presets` 页面列表不投喂 preset 目录（A5 负向：preset 仅在 dialog 内出现；抽样三个辨识名 DeepSeek / OpenRouter / Cloudflare AI Gateway，页面正文非空守卫）。
- `pick-search` 搜索框（契约句柄 `input[aria-label="搜索服务商..."]`，getByLabel 一级）客户端过滤 38 项，大小写不敏感：`qwen` → 3 行（Token Plan 族）/ 无命中 → 0 行 / 清空 → 38 行。
- `pick-preset-rows` preset 行（契约句柄 `[data-preset-id]`）38 项与数据层目录（A5 全留）1:1 同数；显示名 canon = spec 11「上游 38 项 preset 显示名」名单逐字（脚本常量 `PRESET_NAMES` 单源转录）——断言为**名称节点等值**（徽标标记除外；整行子串会放行 MiniMax ⊂ MiniMax CN 类更长变体假命中）。
- `pick-oauth-badge` OAuth 标签 = 族表已接线族行右的「OAuth」标签节点（现仅 github-copilot 一项）；openai-codex 族表未接线（#385）——行**不带**标签、行禁用（`disabled`）、右端「暂未开通」注记（行内文案载体，getByText「暂未开通」）；xai 行**不带**标签（负向钉）。Paper 分组选择器（#1393）：行在小标题分组下，行 = 首字母方块 + 名称 + 右侧标签。
- `pick-xai-label` xai 密钥表单内展示 oauthLabel「Sign in with SuperGrok or X Premium」（spec 11 名单注正向；纯 UI 文案，无外网请求）。
- `pick-preset-keyform` 点 api_key 族 preset 行 → 该 preset 的密钥表单（#380 落地契约 = 现有自定义网关表单原样复用 + 预填）：`#dlg-provider-id` 值 = preset id、`#dlg-provider-label` 值 = 显示名、密钥输入（password）在场。
- `pick-custom-disclosure` 底部「自定义端点」入口（契约句柄 role=button 文案「自定义端点」）→ 展开**现有**自定义网关表单——既有句柄保全：`#dlg-provider-id` / `#dlg-provider-label` / `#dlg-provider-baseurl` / API 协议段（`[role="tab"]` + `aria-selected`）/ `#dlg-provider-apikey` / 「添加模型」钮（role=button，exact——「添加模型服务」含它作子串）/ 「添加模型服务」submit 钮（role=button，dialog 内 scoped）。
- `pick-create-e2e` 创建链回归护栏（既有行为，A6 重构不得击穿）：填表 + 模型行 → 保存 → `POST /api/teams/:id/providers` → dialog 关 → 封套 providers 段字段全对 + SQLite `provider` 表行（models JSON 含所填模型）。

## How to get to it (user POV)

- 模型服务页（`/app/resources/providers`）topbar「+ 新建」。
- pi tab 空态引导钮（providers-tabs.md `prov-pi-empty`）同样开到本 dialog。

## Driving it with verify-pacman

Preconditions:

1. `launch.mjs` 起隔离栈，`doctor.mjs` 全 PASS。无需 daemon。
2. **后于 `drive-providers-tabs.mjs` 跑**——本 probe 的 e2e 会建 custom provider，破坏 tabs 的 pi 空态断言（全新库前置）。重验 = 重 launch。

- **picker 全链。** **跑法：** `node <skill>/scripts/drive-provider-picker.mjs`（自足）——17 checks：页面就绪 → 页面无 preset 投喂负向 → 「新建」开 dialog → 搜索框在位 → preset 行 38 项 → 显示名 canon 等值命中（缺项列名）→ OAuth 徽标仅 github-copilot + codex 未接线注记/禁用 + xai 负向 → 搜索过滤三腿（qwen→3 / 无命中→0 / 清空→38）→ 点 DeepSeek 行进密钥表单 → X 关窗 → 重看点 xai 行验 oauthLabel → 关窗重开 → 「自定义端点」入口 → disclosure 展开现有表单三句柄 → 填表（含模型行）保存关窗 → GET 封套 providers 段字段全对 → SQLite provider 行 + models JSON。
- **真值。** `GET /api/teams/:id/providers` 封套（providers 段：providerId/label/baseUrl/models）+ SQLite `provider` 表行（`SELECT ... FROM provider WHERE providerId=?`，models JSON parse 后含所填模型 id）。
- **红态也产出回归证据**：创建链段（e2e 三 checks）在 disclosure 未落地时同样可达（现状表单外露直陈）——重构前跑 = 创建链绿的基线证据，重构后跑 = 重构没击穿创建链。
- **验证状态（2026-09-29，#385）**：picker 已落地（#355/PR #380）。本 probe 随 #385 改钉——openai-codex 族表未接线：行无 OAuth 标签、禁用、「暂未开通」注记（canon `PRESET_NAMES['openai-codex']` 同步改）；其余 checks 不变。

## Gotchas

- **OAuth 点击链不在本 probe**：authorize → 外网重定向 → 302 着陆（?oauth=connected|error&reason=…）需真外网 + 真订阅，属 #231/#243 e2e 面；probe 内不发外部请求，只钉徽标/未接线注记文本与 xai oauthLabel 的密钥表单展示（皆纯 UI 文案）。
- 38 项显示名含大小写/空格细节（`MiniMax CN`、`Z.AI`、`OpenCode Zen` vs `OpenCode Go`、`Kimi For Coding`）——`PRESET_NAMES` 是 spec 11 名单逐字转录，文案变更先改 spec 再改脚本（脚本自带 38 项数守卫）。
- 搜索过滤是客户端行为（A6）：断言可见行数用 `:visible` 口径，实现无论 DOM 移除还是隐藏皆过。
- 密钥表单断言用可观测真值（预填的 input 值 + password 输入在位），不钉未定的类名——`data-preset-id` 是唯一契约句柄。（先行期曾按「preset 名文本 + 自定义表单隐藏」的假想形态断言，#380 落地为表单复用 + 预填后该形态不成立，#385 校正。）
- dialog 重构后族律不变（#68：X/Esc/backdrop 关；状态在重开边沿重置）——`keyform-closes` 是这条律的哨兵 check。
- **#944 载体迁移**：类名钩 → 语义/data-* 载体（断言语义不变）——原 `.res-new` → role=button「新建」exact / `[data-testid="resource-new"]`、`.dlg-picker-search` → `input[aria-label="搜索服务商..."]`、`.dlg-picker-row` → `[data-preset-id]`、`.dlg-picker-custom` / `.dlg-provider-create` / `.dlg-provider-model-add` → role=button+文案（「自定义端点」/「添加模型服务」/「添加模型」exact）、`.dlg-provider-note` → 行内「暂未开通」文案；`#dlg-provider-*` id 载体不变；#952 起壳级 dlg 系类名（dlg / dlg-title / dlg-close）不再输出，spec/22 §5.5——壳句柄 = `[role="dialog"]`（可及名 = title）、关窗钮 = `button[aria-label="关闭"]`、结构盒 = `dialog-head/-body/-foot` testid。
- preset 数据层（shared 38 项常量 + OAuth 授权链）A5 全留——probe 红的是**页面形态**，不是数据缺失；`GET providers` 封套 presets 段现在就有 38 项。
