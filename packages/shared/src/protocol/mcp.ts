// MCP 双面词表——02 §7（A10 锁定：server 面 24 工具白名单保形 + client 面
// 薄桥 per-Agent 授权 per-turn 降级）。
// client 面（外部 MCP → Agent）：管理页/授权/运行时行为 canon；
// server 面（外部 MCP 客户端 ← 复刻）：/api/mcp 端点 + key 级工具白名单
// （r3 §6 实测矩阵 1:1 收录）。

import { z } from 'zod';
import { BRAND } from '../brand.js';

/** server 面端点（02 §5.8：形状保留（无品牌），路径保留）。 */
export const MCP_ENDPOINT_PATH = BRAND.remoteMcpPath;

/** 认证：Authorization: Bearer <apiKey>（02 §7.2；key 双用途见
 * records/api-key.ts）。 */
export const MCP_AUTH_HEADER_FORMAT = 'Authorization: Bearer <apiKey>';

/** 配置示例文案（02 §7.2：r3 §5.2 原文行形 `{"mcpServers":{"todos":{"url":
 * "https://todos.dev/api/mcp",…Bearer tds_your_key}}}`；替换相位已执行
 * （#109）= 本地主机名 + `cairn` server 名 + `cairn_<key>`，素材替换计划
 * §3.1。url 域 = 本地主机名代位（self-host 缺省 127.0.0.1:8787，01 §4.2），
 * /api/mcp 路径形状保留（02 §5.8 非品牌槽）。 */
export const MCP_CONFIG_EXAMPLE_CANON = {
  json: `{"mcpServers":{"${BRAND.cliCommandName}":{"url":"http://127.0.0.1:8787${BRAND.remoteMcpPath}","headers":{"Authorization":"Bearer ${BRAND.apiKeyPrefix}your_key"}}}}`,
  vsCodeNote:
    'VS Code uses a servers key instead of mcpServers, with the same url and headers fields. Browser connectors that only support OAuth cannot use a key.',
} as const;

/** key 级工具白名单 = 24 件（02 §7.2，r3 §6 实测矩阵 1:1）：读 11 组 + 写 13 项。
 * 语义 canon 两句见 records/api-key.ts API_KEY_GRANT_SEMANTICS_COPY。 */
export const MCP_TOOLS_READ = [
  'Todos',
  'Projects',
  'Conversation',
  'Agents',
  'Schedules',
  'Attachment',
  'Skills',
  'Machines',
  'Issues',
  'Pull Requests',
  'Workflow Runs',
] as const;

export const MCP_TOOLS_WRITE = [
  'Create Todo',
  'Update Todo',
  'Message Todo',
  'Run Builds',
  'Run Review',
  'Confirm Builds',
  'Merge Builds',
  'Cancel Builds',
  'Complete Todos',
  'Close Todos',
  'Reopen Todos',
  'Schedule Todo',
  'Unschedule Todo',
] as const;

/** 能力六组（docs 原文，02 §7.2）：Read the repo 的 issues/PR+merge state/CI
 * workflow runs 仅 GitHub-backed 项目（依赖 02 §3/A4 GitHub 形态）。 */
export const MCP_CAPABILITY_GROUPS = [
  'Read the workspace',
  'Read the repo',
  'Read progress',
  'Organize work',
  'Run work',
  'Manage lifecycle',
] as const;

/** client 面 transport 两形态（02 §7.1 添加表单：远程 HTTP / 本地 stdio；
 * record 词表见 records/mcp-server.ts）。 */
export const MCP_TRANSPORT_LABELS = {
  http: '远程（HTTP）',
  stdio: '本地命令（stdio）',
} as const;

/** client 面空态与降级 canon（02 §7.1/r3 §1.5 原文）：每回合连接已授权
 * server；连接失败降级不阻断。 */
export const MCP_LIST_EMPTY_COPY =
  'MCP 服务器为 Agent 提供额外工具，例如工单系统、浏览器、内部 API。授权在每个 Agent 的页面上单独进行。';
export const MCP_CONNECT_FAILED_CANON = 'connect failed — its tools are unavailable this turn';

/** 降级行族扩展（spec 13/#368 claim slug 化）：daemon 本机解析面比连接面多
 * 一种失败因——config 里没有这个 slug（勾选与配置漂移 / 多机各读各 config）。
 * 行形与 MCP_CONNECT_FAILED_CANON 同族：`[mcp] <slug>: <canon>`。 */
export const MCP_NOT_IN_CONFIG_CANON = 'not in local config — its tools are unavailable this turn';

// —— 本地 config 消费面（spec 13：~/.claude.json mcpServers 段，非 cairn
// 所有、只读单源）———————————————————————————————————————————————
// server 投影面（UI 展示，值剥离）与 daemon 执行面（端点解析，值本机消费）
// 共用同一份条目 schema。判别 = command 在 → stdio；否则 url → http。
// 文件级失败 = 空集、条目级失败 = 跳过该条，均不炸全局（premortem 护栏一：
// claude.json 被写脏/格式漂移）。

/** stdio 条目：命令 + 参数 + env。env 值 = 本机凭证面——只存在于执行机
 * config → 子进程环境，永不经 server / wire。 */
export const claudeMcpStdioEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

/** http 条目：URL + 请求头。headers 值同律 = 只在本机解析、本机请求。 */
export const claudeMcpHttpEntrySchema = z.object({
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

export const claudeMcpEntrySchema = z.union([claudeMcpStdioEntrySchema, claudeMcpHttpEntrySchema]);
export type ClaudeMcpEntry = z.infer<typeof claudeMcpEntrySchema>;

/** 解析产出条目：原键 + 归一 slug + 校验过的 entry。 */
export interface ClaudeMcpParsedEntry {
  /** config 原键（server 投影的 label 槽）。 */
  key: string;
  /** 键小写化 = slug（agent 勾选值 / daemon 匹配键 / record.slug 同值）。 */
  slug: string;
  entry: ClaudeMcpEntry;
}

/** 文件 JSON → 归一条目表（spec 13 归一律单源）：文件级形状坏 = 空表；
 * 条目级校验失败 = 跳过不殃及其它；键小写化 = slug、小写撞名 first-wins。
 * server 投影面（services/mcp-servers）与 daemon 执行面（backend/mcp-config）
 * 共用本函数——slug 匹配契约不因任一侧规则漂移静默断裂。fs 读取各侧自留
 * （shared 无 node: 依赖）。 */
export function parseClaudeMcpEntries(json: unknown): ClaudeMcpParsedEntry[] {
  const file = claudeMcpConfigSchema.safeParse(json);
  if (!file.success || file.data.mcpServers === undefined) return [];
  const out: ClaudeMcpParsedEntry[] = [];
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(file.data.mcpServers)) {
    const entry = claudeMcpEntrySchema.safeParse(value);
    if (!entry.success) continue;
    const slug = key.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({ key, slug, entry: entry.data });
  }
  return out;
}

/** 文件级宽松形状：`~/.claude.json` 还承载 Claude Code 自身状态（projects
 * 等大段），只取 mcpServers 段；键可缺（缺 = 空集）。 */
export const claudeMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});

/** 默认 config 文件名（home 相对）：server / daemon 两侧缺省路径单源
 * （`join(homedir(), CLAUDE_CONFIG_FILE_NAME)`；env 覆盖 = ENV_VARS.mcpConfig）。 */
export const CLAUDE_CONFIG_FILE_NAME = '.claude.json';

/** 版本墙形状（02 §7.1）：todos.dev 按机器 CLI 版本门控（r2 §6.2 文案
 * 「机器上的 tds CLI 需升级至 v0.1.45 及以上才能使用 MCP 工具…」）——复刻保留
 * 「executor 最低版本检查」形状，数值随复刻版本线自定（素材归 #44）。 */
export const MCP_MIN_CLI_VERSION_GATE_OBSERVED = '0.1.45';

/** 复刻版本线的最低 executor 版本（[设计]，02 §7.1「数值自定」）：claim 载荷
 * 只在机器 `latestCliVersion` ≥ 本值时携带 mcpServers（版本墙形状的真实门）。
 * spec 13 断约提升 0.1.0 → 0.2.0：claim mcpServers 形状从 McpEndpoint[] 改
 * slug string[]，旧 daemon（≤0.1.x）不过门 = 收不到该字段（视为无 MCP 运行，
 * 不混发形状）。daemon 版本单源 apps/daemon/src/version.ts（= manifest
 * version，与本墙同 PR 提升至 0.2.0）。 */
export const MCP_MIN_CLI_VERSION = '0.2.0';

/** server 面 24 工具注册表（grant 白名单键 ↔ MCP wire 工具名，单源）。
 * grant = r3 §6 矩阵行标签（MCP_TOOLS_READ/WRITE 原词）；name = wire 工具名
 * [推断]——官方 wire 名未采，取 chief 词表同族投影（r5 §3.1「与 docs MCP
 * server 面六能力组同构」；snake_case 与 CHIEF_REMOTE_TOOLS 命名同律）。
 * apiKey.toolGrants.{read,write} 存 grant 标签；/api/mcp 面按本表映射执行。 */
export const MCP_TOOL_REGISTRY = [
  // —— 读 11 组（02 §7.2）——
  { grant: 'Todos', name: 'todos', kind: 'read' },
  { grant: 'Projects', name: 'projects', kind: 'read' },
  { grant: 'Conversation', name: 'conversation', kind: 'read' },
  { grant: 'Agents', name: 'agents', kind: 'read' },
  { grant: 'Schedules', name: 'schedules', kind: 'read' },
  { grant: 'Attachment', name: 'attachment', kind: 'read' },
  { grant: 'Skills', name: 'skills', kind: 'read' },
  { grant: 'Machines', name: 'machines', kind: 'read' },
  { grant: 'Issues', name: 'issues', kind: 'read' },
  { grant: 'Pull Requests', name: 'pull_requests', kind: 'read' },
  { grant: 'Workflow Runs', name: 'workflow_runs', kind: 'read' },
  // —— 写 13 项（02 §7.2）——
  { grant: 'Create Todo', name: 'create_todo', kind: 'write' },
  { grant: 'Update Todo', name: 'update_todo', kind: 'write' },
  { grant: 'Message Todo', name: 'message_todo', kind: 'write' },
  { grant: 'Run Builds', name: 'run_builds', kind: 'write' },
  { grant: 'Run Review', name: 'run_review', kind: 'write' },
  { grant: 'Confirm Builds', name: 'confirm_builds', kind: 'write' },
  { grant: 'Merge Builds', name: 'merge_builds', kind: 'write' },
  { grant: 'Cancel Builds', name: 'cancel_builds', kind: 'write' },
  { grant: 'Complete Todos', name: 'complete_todos', kind: 'write' },
  { grant: 'Close Todos', name: 'close_todos', kind: 'write' },
  { grant: 'Reopen Todos', name: 'reopen_todos', kind: 'write' },
  { grant: 'Schedule Todo', name: 'schedule_todo', kind: 'write' },
  { grant: 'Unschedule Todo', name: 'unschedule_todo', kind: 'write' },
] as const satisfies readonly { grant: string; name: string; kind: 'read' | 'write' }[];

export type McpToolKind = (typeof MCP_TOOL_REGISTRY)[number]['kind'];

/** name → 注册行反查（/api/mcp tools/call 授权判定：wire 名 → grant 标签 →
 * key.toolGrants 命中校验，「The key's tool selection limits every call」）。 */
export const MCP_REGISTRY_BY_NAME: ReadonlyMap<string, (typeof MCP_TOOL_REGISTRY)[number]> =
  new Map(MCP_TOOL_REGISTRY.map((t) => [t.name, t]));
