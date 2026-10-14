# #1307 三态受管 MCP —— 验证证据索引

票：#1307（daemon claude-code 会话继承用户全局 MCP——320 工具/960KB schema
吃光 glm 窗口，autocompact thrash 必现）。修法对齐 Multica 三态受管
（`multica` `server/pkg/agent/mcp_config.go` / `claude.go`）：claim/SessionOpts
的 `mcpServers` 缺省 = 继承 runtime 配置（旧 server 形 / 版本墙机器，逃生门）；
数组（含 `[]` = 受管严格空）= 受管集合 → claude-code 后端发 `mcpServers` 键
（恒发，含 in-process `pacman` 缝）+ `strictMcpConfig: true`（SDK → CLI
`--strict-mcp-config`：用户全局 / 项目 .mcp.json / 插件 MCP 全忽略，
`sdk.d.ts:2200` 本机 0.3.278 实测在位）。

机制类声称一律取运行时真值（仓规「机制生效验收:实物判据」）。本目录三组实物：

## 0. pre-fix 野外基线（票面取证同款会话存档）

- `baseline-dogfood-b70499b7.json` —— dogfood 任务 `abycCXdnb0yXJQN0TXKdF`
  失败会话（`~/.claude/projects/-private-tmp-pacman-chain-daemon-home-workspaces-*/b70499b7-*.jsonl`，
  agent DB `mcpServers='[]'`，4/4 autocompact thrash）最后一份
  `attachment[type=prompt_snapshot].tools` 直方图：**319 工具 / 960,035B**，
  `mcp__rea` 170 / `mcp__plugin_figma_figma` 42 / `mcp__agent-native-design` 41 /
  `mcp__playwright` 25 / `mcp__pacman` 7 —— 与票面「320 条 ≈ 960KB」逐字吻合。
  这就是「继承用户全局 MCP」的野外实物。

## 1. 探针（真 SDK + 真 daemon 组装函数）

- `probe-sdk-1307.mts` —— 探针脚本。真 `@anthropic-ai/claude-agent-sdk@0.3.278`
  + **真 `buildClaudeSdkOptions` 本尊**（tsx 直载 `apps/daemon/src/backend/claude-code.ts`，
  非手抄形状）。复现（B 组两个前提见下）：

  ```sh
  cd apps/daemon && env -i HOME="$HOME" TMPDIR=/tmp PATH="<fnm bin>:/opt/homebrew/bin:/usr/bin:/bin" \
    ANTHROPIC_AUTH_TOKEN="$ANTHROPIC_AUTH_TOKEN" ANTHROPIC_BASE_URL="$ANTHROPIC_BASE_URL" \
    pnpm exec tsx ../../docs/verify/1307/probe-sdk-1307.mts
  ```

  - B 组必须**干净环境**起（无 `CLAUDECODE` / `CLAUDE_CODE_*` 嵌套标记）：
    在嵌套 Claude Code 会话环境里子 CLI 不加载用户全局 MCP——control 臂会
    **假阴性**（首两轮实测 builtin-only，泄漏复现不出来）。
  - B 组必须用**机器 claude 可执行文件**（本机 2.1.294，`PROBE_EXECUTABLE`
    可覆写）：SDK bundled CLI 2.1.278 在 SDK spawn 形下同样不加载用户全局
    mcpServers；dogfood 泄漏会话与 daemon 生产形（#1050 executablePath 探测）
    都是机器 claude 所写/所起，control 臂必须对齐该形态。
  - 模型缺省 glm-5.3（`PROBE_MODEL` 可覆写）；`SKIP_B=1` 只跑 A 组。
- A 组（argv 捕获，无网络）：stub 可执行文件当 `pathToClaudeCodeExecutable`，
  捕获 SDK 实际拼给 CLI 的参数：

  | 臂 | 输入（buildClaudeSdkOptions parts） | 实物结果 |
  |---|---|---|
  | A1 managed | `mcpServers: {}` + `strictMcpConfig: true` | ✅ argv 含 `--strict-mcp-config`（`argv-managed.json`） |
  | A2 inherit | `mcpServers: {}`（strict 缺省） | ✅ argv 无任何 mcp 旗标（`argv-inherit.json`，逃生门零回归） |

- B 组（真会话对照，prompt_snapshot 判据与 §0 同法）：

  | 臂 | 形状 | tools 直方图 | 判定 |
  |---|---|---|---|
  | B1 control-inherit | pre-fix 形状（受管空但键不发） | **56 工具 / 148,947B = builtin 31 + `mcp__playwright` 25** | ✅ 用户全局 MCP 泄漏进会话（复现 #1307 机制） |
  | B2 managed-strict | 修后形状（strict + in-process pacman 缝 1 条 dummy 工具） | **28 工具 / 122,030B = builtin 27 + `mcp__pacman` 1** | ✅ 零全局 MCP；host 缝存活 |

  同一干净环境、同一机器 claude、同一模型，唯一变量 = 受管态（strict 旗）——
  B1 泄漏的 `mcp__playwright` 在 B2 完全消失，`mcp__pacman` 缝工具
  （`probe_echo`）在 B2 在位。B1 只泄出 playwright 一家（dogfood 野外是
  rea/figma/design/playwright 全家 319 条）：`env -i` 精简 PATH 下其余全局
  stdio server 起不来——不影响判定，泄漏面「有/无」是二值的，strict 锁
  把有的那家也锁掉了。

  原始产物 = `session-contrast.json`（含 sessionId / transcript 路径 /
  promptSnapshotBytes / 每臂直方图 / 模型回复）。B 组会话存档在
  `~/.claude/projects/-var-folders-*/<sessionId>.jsonl`（本机可复核）。

## 2. 单测钉面（红→绿，先于实现固化）

- `apps/daemon/test/claude-mcp-strict.test.ts` —— 组装面四态（受管空键恒发 +
  strict / 受管非空透传 + strict / 缺省空不发键 / 缺省非空发键无 strict）。
- `apps/daemon/test/runner-mcp-managed.test.ts` —— runner 三态透传（claim `[]`
  → SessionOpts 键在位 `[]`；claim 缺省 → 键缺省；未知 slug 降级不翻转受管性；
  受管空观测行）。
- `apps/server/test/mcp-servers.test.ts` —— claim 载荷三态（受管空携带 `[]`；
  版本门未达才缺省）。旧断言「未授权（勾选空）= 不携带」即本票主修位的
  钉死面，随语义反转。

红灯留档：修复前 5 failed（daemon 新增面）+ 1 failed（server claim 面），
失败断言均为主修位判据（`'mcpServers' in opts` / `strictMcpConfig` / `toEqual([])`）。
