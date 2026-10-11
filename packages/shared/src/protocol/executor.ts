// executor（机器面）协议词表——02 §5 全量（r3 §1 一手证据 1:1）。
// CLI 形态 / 本地状态布局 / worktree 契约 / pi 流事件与工具面 / 步骤生命周期。
// 机器面 REST 13 端点见 protocol/machine-api.ts。

import { z } from 'zod';
import { BRAND, DEVICE_ID_PATTERN, MACHINE_TOKEN_PATTERN } from '../brand.js';
import { recordId } from '../records/common.js';

/** CLI 命令面（02 §5.1 照抄 r3 §1.1：logs 带 [-f]；provider 仅提示
 * 「Providers are managed on the website」——凭据管理在 web，CLI 不代做）。 */
export const CLI_COMMANDS = [
  'start',
  'stop',
  'restart',
  'logs',
  'logout',
  'status',
  'version',
  'provider',
] as const;

export const PROVIDER_COMMAND_NOTICE = 'Providers are managed on the website';

/** start 选项（02 §5.1 照抄）：--foreground（attached 供 pm2/systemd/容器）、
 * --api-key <k> --team <id>（非交互注册，覆盖既有注册以换团队）、--name
 * （默认 hostname）、--server、--workspaces-dir（持久；父目录必须已存在护栏）。 */
export const CLI_START_OPTIONS = [
  '--foreground|-f',
  '--api-key <k>',
  '--team <id>',
  '--name',
  '--server',
  '--workspaces-dir',
] as const;

/** workspaces-dir 护栏 canon（r3 §1.1 help 原话行形；原句前缀 = 品牌槽，
 * 替换相位随 BRAND.cliCommandName，#109）。 */
export const WORKSPACES_DIR_GUARD_CANON = `if that drive is unmounted ${BRAND.cliCommandName} refuses to start instead of cloning onto the boot disk`;

/** 发行形态（01 §4.3/S9，divergence 登记 04 §1）：纯 JS npm 包（esbuild
 * 单文件 + node shebang），不复刻 6 平台二进制；默认 detached + supervisor
 * 跨崩溃保活；机器 shell 权限改动秒级热加载（02 §5.1 "no restart needed"）。 */
export const DAEMON_LOG_PREFIXES = [
  'supervisor',
  'machine',
  'step',
  'workspace',
  'recover',
  'wake',
  // MCP per-turn 连接面（r3 §1.5 daemon.log 实测行 `[mcp] r3mcp: connect
  // failed — its tools are unavailable this turn: fetch failed…`；M4b 补录，
  // 02 §5.3 前缀词表回写）。
  'mcp',
  // skills 执行面注入诊断行（#371，spec 14：`[skills] <type>: <msg>` 族，
  // type ∈ loaded/collision/invalid-frontmatter/missing-skill-md/cap/invalid，
  // 词表正源 = daemon backend/pi.ts classifySkillDiagnostic + buildSkillsCatalog）。
  'skills',
  // 命令闸裁决行（#866 T5：`[gate] <ask|reject>: rule=<id> command=<…>`——只记
  // 非放行裁决，allow 静默；词表正源 = daemon backend/command-gate.ts）。
  'gate',
  // pi project trust 裁决行（#925 D1：`[trust] denied: <.pi/…> present in
  // worktree …`——只记受保护资源在位的 denied 行，空 worktree 静默；词表
  // 正源 = daemon backend/pi.ts detectTrustProtectedResources）。
  'trust',
] as const;

/** 本地状态布局（02 §5.3，r3 §1.3 实测；目录名品牌位走 brand.ts 槽）。 */
export const LOCAL_STATE_FILES = [
  'machine.json',
  'device.json',
  'daemon.json',
  'daemon.log',
] as const;
export const LOCAL_STATE_DIRS = [
  'outbox', // 出站事件缓冲（离线补发 [推断]，r3 §1.3）
  'chat-sessions', // 会话持久化（pi session）
  'agent-runtime',
  'workspaces',
] as const;

/** ~/.<home>/machine.json（r3 §1.3 实测：机器 bearer）。 */
export const machineJsonSchema = z.object({
  machineId: z.string(),
  token: z.string().regex(MACHINE_TOKEN_PATTERN), // 64hex
  teamId: recordId,
  serverUrl: z.string(),
});
export type MachineJson = z.infer<typeof machineJsonSchema>;

/** ~/.<home>/device.json（r3 §1.3：跨机器实例的设备指纹 32hex）。 */
export const deviceJsonSchema = z.object({
  deviceId: z.string().regex(DEVICE_ID_PATTERN),
});
export type DeviceJson = z.infer<typeof deviceJsonSchema>;

/** ~/.<home>/daemon.json（r3 §1.3：{pid,startedAt,runner:"cli"}；
 * startedAt 值形未特写，epoch ms [推断]）。 */
export const daemonJsonSchema = z.object({
  pid: z.number().int(),
  startedAt: z.number().int(),
  runner: z.literal('cli'),
});
export type DaemonJson = z.infer<typeof daemonJsonSchema>;

/** worktree 契约（02 §5.5 全表照抄，r3 §1.4 实测）。 */
export const WORKTREE_CONTRACT = {
  /** 基座 `<workspacesRoot>/<projectId>/repo`（baseRepoDir）。 */
  baseRepoSubpath: '<projectId>/repo',
  /** 任务目录 `<workspacesRoot>/<conversationId>`（目录名 = UUIDv7）。 */
  taskDirLayout: '<workspacesRoot>/<conversationId>',
  /** 分支 = 品牌前缀 + conversationId（brand.ts conversationBranch()）；
   * worktree add -b，base = origin/<convBranch> 否则 origin/<defaultBranch>。 */
  branchPrefix: BRAND.branchPrefix,
  /** 复用/恢复：存在→reused；checkpoint→reset --hard + clean -fd（restored）；
   * 陈旧→remove --force + prune + branch -D。 */
  checkpointResetArgs: ['reset --hard', 'clean -fd'],
  staleCleanupArgs: ['worktree remove --force', 'worktree prune', 'branch -D'],
  /** 并发保护：projectLock(projectId) 串行化同项目工作区操作。 */
  concurrencyGuard: 'projectLock(projectId)',
  /** 防分叉护栏：origin/<branch> 有本机没有的提交且 worktree 不在该分支 → 抛错。 */
  remoteBranchDiverged: 'remote branch diverged',
  /** 每步结束自动 push 本 conversation 工作分支；合并用 git merge --no-edit <ref>。 */
  mergeArgs: 'merge --no-edit',
  /** 强制同步面板文案 canon（r3 §3.9）。 */
  forceSyncCopy: '丢弃代码修改并删除非忽略的未跟踪文件；保留忽略内容。仅本次生效。',
  /** 重试预算（r3 bundle 注释原话数值）：push 覆盖 git-host 5xx 窗口；
   * 冷 worktree ls-remote+fetch「~2 min typical, ~8 min worst on /done's path」；
   * merge 轮走 gitNetwork。 */
  retryBudgetCanon: "~2 min typical, ~8 min worst on /done's path",
} as const;

/** 孤儿 worktree 回收 TTL = 7×24h（02 §5.5/r3 §1.4 cleanupOrphanWorktrees）。 */
export const ORPHAN_WORKTREE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 环境生命周期钩子（#1149，形态照 Amp docs/research/amp-native-sandbox-orb.md
 * §3.2）：仓内 `.agents/setup`（装机，幂等契约）/ `.agents/resume`（唤醒后
 * 修复钩子）。同路径同名 = 一份配置 Amp 与 pacman 两用。默认超时 20 分钟
 * （票面钉死），超时杀整组进程；可用 PACMAN_HOOK_TIMEOUT_MS 覆写。 */
export const WORKSPACE_HOOK_TIMEOUT_MS = 20 * 60 * 1000;
/** 钩子运行注记（PreparedWorkspace.hooks 槽，workspace → runner 投影面）：
 * runner 把它落成 transcript system 行（用户在步日志里看得见 setup/resume
 * 做了什么）。status 全集照原语 note：setup 失败不落此槽（prepare 抛错，
 * 步失败，错误进 done.failed.errorMessage）；resume 失败/超时照落（步继续，
 * 用户在 transcript 里看得见失败原文）。 */
export interface WorkspaceHookNoteData {
  name: 'setup' | 'resume';
  status: 'ok' | 'failed' | 'timeout';
  exitCode: number | null;
  output: string;
  totalChars: number;
  ms: number;
}

/** pi 流事件词表 17 件（02 §5.6，r3 §1.5 bundle 静态提取；01 §5 AgentBackend
 * 缝事件面 = 本词表 1:1，不得增删改名）。 */
export const PI_STREAM_EVENTS = [
  'text_delta',
  'thinking',
  'thinking_delta',
  'toolcall_end',
  'message_update',
  'message_end',
  'message_stop',
  'compaction',
  'compaction_start',
  'compaction_end',
  'auto_retry_start',
  'auto_retry_end',
  'steer',
  'done',
  'error',
  'wake',
  'shutdown',
] as const;
export type PiStreamEvent = (typeof PI_STREAM_EVENTS)[number];

/** 配置 kind（02 §5.6：provider 凭证三协议 + MCP stdio）。 */
export const CONFIG_KINDS = ['api_key', 'oauth', 'http', 'stdio'] as const;

/** 流超时护栏（r3 bundle 原文数值，02 §5.6/01 §4.3 照抄）。数值 = r3 一手
 * 证据；重置语义 = pacman 侧 #699 修订（三臂事件到达即重置 + 步级绝对上界
 * PACMAN_STREAM_DURATION_CAP_MS，语义正本 02 §5.6，执行面 runner.ts）。 */
export const STREAM_TIMEOUTS_MS = {
  streamFirstEvent: 300_000,
  streamIdle: 480_000,
  streamBodyTimeout: 540_000,
} as const;

/** 机器侧自定义工具三件（02 §5.6，描述 canon 照 r3）；其余工具面 =
 * pi-coding-agent 内建（bash/edit/read…，transcript 实测 edit/bash 行）。 */
export const MACHINE_CUSTOM_TOOLS = ['web_fetch', 'remote_shell', 'push_branch'] as const;

/** web_fetch URL 文本上限（r3 §1.5：≤8000 字符）。 */
export const WEB_FETCH_CHAR_LIMIT = 8_000;

/** remoteTools 同机制承载的 relay 工具（r5 §3.1：push_credential = git 凭证
 * per-step 下发坐实、open_repo）。 */
export const RELAY_TOOLS = ['push_credential', 'open_repo'] as const;

/** 代理探测（02 §5.6：启动读系统/环境代理并打印；代理死持续重试不退出——
 * r3 §1.5 实测 10+ 分钟）。env 词表 = undici EnvHttpProxyAgent honor 三件
 * （01 §4.3）。 */
export const PROXY_ENV_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'] as const;

/** 启动代理打印行形（r3 §1.5 实测 `[tds] Proxy: http://127.0.0.1:7890`；
 * 前缀走品牌槽）。 */
export const PROXY_PROBE_LOG_CANON = `[${BRAND.cliCommandName}] Proxy: <url>`;

/** 步骤生命周期日志行序模板（02 §5.7，r3 §1.5 实测行序；#503 起在跑步数
 * 不再带分母——并发上限概念已摘除，行内只出本机在跑步数）。 */
export const STEP_LIFECYCLE_LOG_LINES = [
  'claim step=<id>',
  'step <id> for conv <uuid> (n running)',
  'using model <provider>/<modelId>',
  'new session <convId> | continue session <convId>',
  'workspace 准备（准备工作区...）',
  'pushed <convBranch>',
  'finished (m running)',
] as const;
