import { z } from 'zod';
import { BRAND } from '../brand.js';

export const MCP_ENDPOINT_PATH = BRAND.remoteMcpPath;

export const MCP_AUTH_HEADER_FORMAT = 'Authorization: Bearer <apiKey>';

export const MCP_CONFIG_EXAMPLE_CANON = {
  json: `{"mcpServers":{"${BRAND.cliCommandName}":{"url":"http://127.0.0.1:8787${BRAND.remoteMcpPath}","headers":{"Authorization":"Bearer ${BRAND.apiKeyPrefix}your_key"}}}}`,
  vsCodeNote:
    'VS Code uses a servers key instead of mcpServers, with the same url and headers fields. Browser connectors that only support OAuth cannot use a key.',
} as const;

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

export const MCP_CAPABILITY_GROUPS = [
  'Read the workspace',
  'Read the repo',
  'Read progress',
  'Organize work',
  'Run work',
  'Manage lifecycle',
] as const;

export const MCP_TRANSPORT_LABELS = {
  http: '远程（HTTP）',
  stdio: '本地命令（stdio）',
} as const;

export const MCP_LIST_EMPTY_COPY =
  'MCP 服务器为 Agent 提供额外工具，例如工单系统、浏览器、内部 API。授权在每个 Agent 的页面上单独进行。';
export const MCP_CONNECT_FAILED_CANON = 'connect failed — its tools are unavailable this turn';

export const MCP_NOT_IN_CONFIG_CANON = 'not in local config — its tools are unavailable this turn';

export const claudeMcpStdioEntrySchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const claudeMcpHttpEntrySchema = z.object({
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

export const claudeMcpEntrySchema = z.union([claudeMcpStdioEntrySchema, claudeMcpHttpEntrySchema]);
export type ClaudeMcpEntry = z.infer<typeof claudeMcpEntrySchema>;

export interface ClaudeMcpParsedEntry {
  key: string;
  slug: string;
  entry: ClaudeMcpEntry;
}

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

export const claudeMcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});

export const CLAUDE_CONFIG_FILE_NAME = '.claude.json';

export const MCP_MIN_CLI_VERSION_GATE_OBSERVED = '0.1.45';

export const MCP_MIN_CLI_VERSION = '0.2.0';

export const MCP_TOOL_REGISTRY = [
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

export const MCP_REGISTRY_BY_NAME: ReadonlyMap<string, (typeof MCP_TOOL_REGISTRY)[number]> =
  new Map(MCP_TOOL_REGISTRY.map((t) => [t.name, t]));
