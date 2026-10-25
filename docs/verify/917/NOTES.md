# #917 技能可见面收归 —— 验证证据索引

Ticket: #917 (server+daemon: fold the skill visibility surface back to pacman). The canonical copy of the post-ruling scope =
`docs/spec/14-skills-execution-surface-injection.md` §skill-visibility-surface folding (points 1/2 deferred by #958/spec 24;
landed = point 3 explicit settingSources declaration, point 4 hard-block whitelist, point 5 observation lines,
plus the shutoff of pi's native `<available_skills>` section folded back by #958).

机制类声称一律取运行时真值（仓规「机制生效验收:实物判据」）。本目录两组实物：

## 1. 真 SDK/CLI 探针（claude-code 侧机制）

- `probe-sdk-917.mjs` —— 探针脚本。真 `@anthropic-ai/claude-agent-sdk@0.3.278`
  （bundled CLI 2.1.278）+ 真模型（glm-5.3，经本机 claude 登录态）。复现：
  仓库根 `node docs/verify/917/probe-sdk-917.mjs`（每次 query 最多 3 次尝试，
  全部留档进结果 JSON）。
- `probe-results.json` —— 终版运行（六臂 A1/A2、B1、B3/B4/B5、C1）。判定摘要：

  | 臂 | 声称 | 实物结果 |
  |---|---|---|
  | A1 before | bypassPermissions 下、无 deny 规则时，worktree 外文件 Read 成功 | ✅ 读到 `SECRET-MARKER-917`（= 漏洞面存在） |
  | A2 after | `Read(//<dir>/**)` deny 规则在 bypassPermissions 下挡 Read | ✅ 回复 `DENIED`，marker 未出现 |
  | A 附属 | 两侧 `init.permissionMode` 均为 `bypassPermissions` | ✅（bypass 真的在生效，不是回落到 default 的假阳性） |
  | B1 | 原生技能清单实数（产品不拥有、也不知情的基线） | 122 条 |
  | B3 before | 无规则时未授权技能可被 Skill 工具加载 | ✅ 技能内容 marker 被回出（= 原生面调用洞存在） |
  | B4 | 仅 Read deny **不**连带挡 Skill 工具的内容加载 | ✅ marker 仍被回出（Read deny 覆盖不到 Skill 加载 → Skill 名 deny 必须独立成规） |
  | B5 after | `Skill(<name>)` deny 在 bypassPermissions 下拒绝调用 | ✅ 回复 `DENIED`，且 `result.permission_denials` 落 `{tool_name:"Skill", tool_input:{skill:"probe-skill"}}` |
  | C1 | 显式 `settingSources: ['user','project','local']` 下 CLAUDE.md 简报通道存活 | ✅ codeword 被回出（spec 24 承重位重验） |

- `probe-results-run1-skills-option-inert.json` —— 首轮运行，含一条**否定性
  发现**：SDK `skills: [<name>]` 选项（d.ts 宣称「unlisted skills are hidden
  from the model's listing and rejected by the Skill tool」）实测只被 SDK 翻译成
  `Skill(<name>)` **allow** 规则——allow 规则在 bypassPermissions 下无效果，且
  原生清单条数分毫未动（传 `skills:['agent-reach']` 后 `init.skills` 仍 122 条）。
  据此弃用该选项，硬挡改走 deny 规则三条/技能（Read 路径 + Skill 精确名 +
  Skill(skill:) 任一名形）。这份 JSON 是「宣称与实现不符」的留档依据。

## 2. 集成测试 before/after（pi 侧 + 观测行）

harness = `integration/test/skills-inject-e2e.test.ts`（真 daemon + 真 server +
stub LLM；worker 步白名单 = `['demo-skill']`，同目录另有未授权 `extra-skill`，
pi agentDir/skills 种入原生技能 `native-dup`）。

- `before-deny-integration-red.txt` —— 实现前红跑：未授权 `extra-skill/SKILL.md`
  的 read **成功**（tool result `isError:false`，正文 `EXTRA-BODY-MARKER-917`
  落库）= 口径 4 要堵的洞的实物。
- `before-noskills-integration-red.txt` —— 仅把 `noSkills` 翻回 false 的红跑：
  pi 原生 `<available_skills>` 段（`PI-NATIVE-DUP-MARKER-917`）出现在 LLM 输入
  面（AssertionError 原文在文件里）= #958 接线实录「两份清单并存」在本 harness
  的复现，证明 after 侧断言不是空转。dump 还实锤了原生发现的实际口径：pi 经
  `~/.pi` 默认目录抓到本机整个 `~/.agents/skills` 池——该次 worker 会话的原生
  段含 **106 条**技能（含白名单外全部条目），全部不受 `agent.skills` 约束。
  文件内含被引用的第三方技能描述原文（逐字运行时捕获，不作净化以保证证据保真）。
- `after-integration-green.txt` —— 实现后绿跑：同一次运行内双向证据齐——授权
  SKILL.md 正文 marker 落库、未授权 read 被拒（拒绝文案落库、正文 marker 不
  落库）；daemon.log canon 行 `catalog: entries=1 chars=618` /
  `deny: 1 skill dir(s) hard-blocked` / `denied-read: …(skill extra-skill not in
  allowlist)`；原生段 marker 不在 LLM 输入面。

## 版本兼容

本票 wire/schema 零变更（`SessionOpts.skillsAllowlist` / `teamSkillsDir` /
machine skills 端点均为既有面）：新 daemon × 旧 server、旧 daemon × 新 server
构造性兼容。判据 = shared 快照面未动 + 全量单测（193 文件 / 2113 条）与
integration 全套（21 文件 / 60 条）绿。
