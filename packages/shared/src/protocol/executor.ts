import { z } from 'zod';
import { BRAND, DEVICE_ID_PATTERN, MACHINE_TOKEN_PATTERN } from '../brand.js';
import { recordId } from '../records/common.js';

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

export const CLI_START_OPTIONS = [
  '--foreground|-f',
  '--api-key <k>',
  '--team <id>',
  '--name',
  '--server',
  '--workspaces-dir',
] as const;

export const WORKSPACES_DIR_GUARD_CANON = `if that drive is unmounted ${BRAND.cliCommandName} refuses to start instead of cloning onto the boot disk`;

export const DAEMON_LOG_PREFIXES = [
  'supervisor',
  'machine',
  'step',
  'workspace',
  'recover',
  'wake',
  'mcp',
  'skills',
  'gate',
  'trust',
  'otel',
] as const;

export const LOCAL_STATE_FILES = [
  'machine.json',
  'device.json',
  'daemon.json',
  'daemon.log',
] as const;
export const LOCAL_STATE_DIRS = ['outbox', 'chat-sessions', 'agent-runtime', 'workspaces'] as const;

export const machineJsonSchema = z.object({
  machineId: z.string(),
  token: z.string().regex(MACHINE_TOKEN_PATTERN),
  teamId: recordId,
  serverUrl: z.string(),
});
export type MachineJson = z.infer<typeof machineJsonSchema>;

export const deviceJsonSchema = z.object({
  deviceId: z.string().regex(DEVICE_ID_PATTERN),
});
export type DeviceJson = z.infer<typeof deviceJsonSchema>;

export const daemonJsonSchema = z.object({
  pid: z.number().int(),
  startedAt: z.number().int(),
  runner: z.literal('cli'),
});
export type DaemonJson = z.infer<typeof daemonJsonSchema>;

export const WORKTREE_CONTRACT = {
  baseRepoSubpath: '<projectId>/repo',
  taskDirLayout: '<workspacesRoot>/<conversationId>',
  branchPrefix: BRAND.branchPrefix,
  checkpointResetArgs: ['reset --hard', 'clean -fd'],
  staleCleanupArgs: ['worktree remove --force', 'worktree prune', 'branch -D'],
  concurrencyGuard: 'projectLock(projectId)',
  remoteBranchDiverged: 'remote branch diverged',
  mergeArgs: 'merge --no-edit',
  forceSyncCopy: '丢弃代码修改并删除非忽略的未跟踪文件；保留忽略内容。仅本次生效。',
  retryBudgetCanon: "~2 min typical, ~8 min worst on /done's path",
} as const;

export const ORPHAN_WORKTREE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const WORKSPACE_HOOK_TIMEOUT_MS = 20 * 60 * 1000;
export interface WorkspaceHookNoteData {
  name: 'setup' | 'resume';
  status: 'ok' | 'failed' | 'timeout';
  exitCode: number | null;
  output: string;
  totalChars: number;
  ms: number;
}

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

export const CONFIG_KINDS = ['api_key', 'oauth', 'http', 'stdio'] as const;

export const STREAM_TIMEOUTS_MS = {
  streamFirstEvent: 300_000,
  streamIdle: 480_000,
  streamBodyTimeout: 540_000,
} as const;

export const MACHINE_CUSTOM_TOOLS = ['web_fetch', 'push_branch'] as const;

export const WEB_FETCH_CHAR_LIMIT = 8_000;

export const RELAY_TOOLS = ['push_credential', 'open_repo'] as const;

export const PROXY_ENV_VARS = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'] as const;

export const PROXY_PROBE_LOG_CANON = `[${BRAND.cliCommandName}] Proxy: <url>`;

export const STEP_LIFECYCLE_LOG_LINES = [
  'claim step=<id>',
  'step <id> for conv <uuid> (n running)',
  'using model <provider>/<modelId>',
  'new session <convId> | continue session <convId>',
  'workspace 准备（准备工作区...）',
  'pushed <convBranch>',
  'finished (m running)',
] as const;
