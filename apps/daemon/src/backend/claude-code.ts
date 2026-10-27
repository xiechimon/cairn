import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join } from 'node:path';
import {
  createSdkMcpServer,
  type EffortLevel,
  type McpServerConfig,
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
  type SdkMcpToolDefinition,
  type SdkPluginConfig,
  type SettingSource,
  tool,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentSessionHandle,
  AgentTodoItem,
  AgentTokenUsage,
  BriefChannel,
  DeliveredImage,
  LocalToolDef,
  McpEndpoint,
  ModelUsage,
  RemoteToolDef,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
} from '@cairn/shared';
import { AGENT_TODO_MAX_ITEMS, CLAUDE_TODO_STATUS_STATES } from '@cairn/shared';
import { z } from 'zod';
import { claudeCodeAuthFailureMessage } from '../claude-code-auth.js';
import { ensureTeamSkillsPlugin } from '../team-skills.js';
import { SessionNotResumableError } from './errors.js';
import { claudeTelemetryEnv } from './otel.js';
import {
  appendSkillsCatalog,
  collectDeniedSkillDirs,
  collectTeamSkillEntries,
  composeSkillsSection,
  type DeniedSkillEntry,
} from './skills.js';

export const CLAUDE_CODE_CAPABILITIES: AgentBackendCapabilities = {
  name: 'claude-code',
  thinkingLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  oauthProviders: [],
  compaction: true,
  sessionResume: true,
};

const USAGE_MODEL_PREFIX = 'claude-code';

const EFFORT_LEVELS: readonly string[] = ['low', 'medium', 'high', 'xhigh', 'max'];

const SDK_WRITE_TOOLS = ['Edit', 'Write'];
const SDK_ASK_TOOL = 'AskUserQuestion';

function isRetryableError(message: string): boolean {
  return /rate.?limit|overloaded|timeout|temporarily|5\d\d/i.test(message);
}

export function todoFromTodoWrite(name: unknown, input: unknown): AgentTodoItem[] | null {
  if (name !== 'TodoWrite') return null;
  const todos = (input as { todos?: unknown } | null | undefined)?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const items: AgentTodoItem[] = [];
  for (const raw of todos) {
    const content = (raw as { content?: unknown })?.content;
    const status = (raw as { status?: unknown })?.status;
    if (typeof content !== 'string' || content === '') continue;
    const state = typeof status === 'string' ? CLAUDE_TODO_STATUS_STATES[status] : undefined;
    if (state === undefined) continue;
    if (items.length >= AGENT_TODO_MAX_ITEMS) break;
    items.push({ text: content, state });
  }
  return items.length > 0 ? items : null;
}

export interface ClaudeMapState {
  calls: Map<string, ToolCallRecord>;
  interrupted: boolean;
  usage: AgentTokenUsage;
  sessionId: string | null;
  modelId?: string;
  authFailed?: boolean;
  machineName?: string;
}

export function createClaudeMapState(opts?: {
  modelId?: string;
  machineName?: string;
}): ClaudeMapState {
  return {
    calls: new Map(),
    interrupted: false,
    usage: [],
    sessionId: null,
    ...(opts?.modelId !== undefined ? { modelId: opts.modelId } : {}),
    ...(opts?.machineName !== undefined ? { machineName: opts.machineName } : {}),
  };
}

function toUsageRows(
  msg: {
    modelUsage?: Record<
      string,
      {
        inputTokens: number;
        outputTokens: number;
        cacheReadInputTokens: number;
        cacheCreationInputTokens: number;
        costUSD?: number;
        costBasis?: string;
      }
    >;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_creation?: {
        ephemeral_5m_input_tokens?: number;
        ephemeral_1h_input_tokens?: number;
      };
    };
  },
  modelId: string | undefined,
): ModelUsage[] {
  const entries = Object.entries(msg.modelUsage ?? {});
  if (entries.length > 0) {
    return entries.map(([key, mu]) => {
      const flat = msg.usage?.cache_creation_input_tokens ?? 0;
      const nested = msg.usage?.cache_creation;
      const nestedWrite =
        (nested?.ephemeral_5m_input_tokens ?? 0) + (nested?.ephemeral_1h_input_tokens ?? 0);
      const cacheWrite =
        mu.cacheCreationInputTokens > 0
          ? mu.cacheCreationInputTokens
          : entries.length === 1 && flat > 0
            ? flat
            : entries.length === 1
              ? nestedWrite
              : 0;
      const cost =
        mu.costBasis === 'unknown' || typeof mu.costUSD !== 'number' || mu.costUSD === 0
          ? undefined
          : { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: mu.costUSD };
      return {
        model: `${USAGE_MODEL_PREFIX}/${key}`,
        input: mu.inputTokens,
        output: mu.outputTokens,
        cacheRead: mu.cacheReadInputTokens,
        cacheWrite,
        ...(cost !== undefined ? { cost } : {}),
      };
    });
  }
  if (msg.usage && modelId !== undefined) {
    const flat = msg.usage.cache_creation_input_tokens ?? 0;
    const nested = msg.usage.cache_creation;
    return [
      {
        model: `${USAGE_MODEL_PREFIX}/${modelId}`,
        input: msg.usage.input_tokens ?? 0,
        output: msg.usage.output_tokens ?? 0,
        cacheRead: msg.usage.cache_read_input_tokens ?? 0,
        cacheWrite:
          flat > 0
            ? flat
            : (nested?.ephemeral_5m_input_tokens ?? 0) + (nested?.ephemeral_1h_input_tokens ?? 0),
      },
    ];
  }
  return [];
}

export function mapClaudeMessage(msg: SDKMessage, state: ClaudeMapState): StepEvent[] {
  switch (msg.type) {
    case 'stream_event': {
      const event = (
        msg as {
          event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
        }
      ).event;
      if (event?.type !== 'content_block_delta') return [];
      if (event.delta?.type === 'text_delta' && event.delta.text !== undefined) {
        return [{ type: 'text_delta', text: event.delta.text }];
      }
      if (event.delta?.type === 'thinking_delta' && event.delta.thinking !== undefined) {
        return [{ type: 'thinking_delta', text: event.delta.thinking }];
      }
      return [];
    }
    case 'assistant': {
      const content = (msg as { message?: { role?: string; content?: unknown[] } }).message
        ?.content;
      if ((msg as { error?: unknown }).error === 'authentication_failed') {
        state.authFailed = true;
      }
      if (!Array.isArray(content)) return [];
      const out: StepEvent[] = [];
      for (const block of content) {
        const b = block as {
          type?: string;
          thinking?: string;
          id?: string;
          name?: string;
          input?: unknown;
        };
        if (b.type === 'thinking' && b.thinking !== undefined) {
          out.push({ type: 'thinking', text: b.thinking });
        } else if (b.type === 'tool_use' && typeof b.id === 'string') {
          const todo = todoFromTodoWrite(b.name, b.input);
          const call: ToolCallRecord = {
            id: b.id,
            name: b.name ?? '',
            arguments: b.input,
            ...(todo !== null ? { todo } : {}),
          };
          state.calls.set(call.id, call);
          out.push({ type: 'toolcall_end', call });
        }
      }
      out.push({
        type: 'message_end',
        message: {
          role: 'assistant',
          content,
        },
      });
      return out;
    }
    case 'user': {
      const content = (msg as { message?: { role?: string; content?: unknown[] } }).message
        ?.content;
      if (!Array.isArray(content)) return [];
      const out: StepEvent[] = [];
      for (const block of content) {
        const b = block as {
          type?: string;
          tool_use_id?: string;
          content?: unknown;
          is_error?: boolean;
        };
        if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
        const pending = state.calls.get(b.tool_use_id);
        if (!pending) continue;
        const final: ToolCallRecord = {
          ...pending,
          result: b.content,
          isError: b.is_error ?? false,
        };
        state.calls.set(final.id, final);
        out.push({ type: 'toolcall_end', call: final });
      }
      return out;
    }
    case 'system': {
      const subtype = (msg as { subtype?: string }).subtype;
      if (subtype === 'init') {
        const sessionId = (msg as { session_id?: string }).session_id;
        if (typeof sessionId === 'string') state.sessionId = sessionId;
        return [];
      }
      if (subtype === 'compact_boundary') return [{ type: 'compaction' }];
      if (subtype === 'api_retry') {
        const attempt = (msg as { attempt?: number }).attempt;
        return [{ type: 'auto_retry_start', attempt: attempt ?? 1 }];
      }
      return [];
    }
    case 'result': {
      const subtype = (msg as { subtype?: string }).subtype;
      const sessionId = (msg as { session_id?: string }).session_id;
      if (typeof sessionId === 'string' && state.sessionId === null) {
        state.sessionId = sessionId;
      }
      const rows = toUsageRows(msg as Parameters<typeof toUsageRows>[0], state.modelId);
      state.usage = rows;
      const isError = (msg as { is_error?: boolean }).is_error === true;
      if (subtype === 'success' && !isError) {
        return [{ type: 'done', usage: rows }];
      }
      const errors = (msg as { errors?: string[] }).errors ?? [];
      const resultText = (msg as { result?: unknown }).result;
      const cliMessage =
        errors.length > 0
          ? errors.join('; ')
          : typeof resultText === 'string' && resultText !== ''
            ? resultText
            : (subtype ?? 'unknown error');
      const message = state.authFailed
        ? claudeCodeAuthFailureMessage(state.machineName ?? hostname())
        : cliMessage;
      if (state.interrupted) {
        return [
          {
            type: 'message_stop',
            message: { role: 'assistant', content: [{ type: 'text', text: message }] },
          },
        ];
      }
      return [{ type: 'error', error: { message, retryable: isRetryableError(message) } }];
    }
    default:
      return [];
  }
}

class AsyncQueue<T> {
  private readonly items: T[] = [];
  private waiter: ((r: IteratorResult<T>) => void) | null = null;
  private ended = false;

  push(item: T): void {
    if (this.ended) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: item, done: false });
      return;
    }
    this.items.push(item);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as unknown as T, done: true });
    }
  }

  private next(): Promise<IteratorResult<T>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.ended) {
      return Promise.resolve({ value: undefined as unknown as T, done: true });
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waiter = resolve;
    });
  }

  iterable(): AsyncIterable<T> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<T> {
        return { next: () => self.next() };
      },
    };
  }
}

const TERMINAL_EVENT_TYPES: readonly string[] = ['done', 'error', 'message_stop'];

class ClaudeSessionHandle implements AgentSessionHandle {
  readonly sessionId: string;
  readonly sessionFile: string;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue = new AsyncQueue<StepEvent>();
  private readonly input: AsyncQueue<SDKUserMessage>;
  private readonly state: ClaudeMapState;
  private readonly q: Query;
  private readonly abort: AbortController;
  private closed = false;
  private stopping = false;

  constructor(
    q: Query,
    opts: {
      sessionId: string;
      cwd: string;
      state: ClaudeMapState;
      abort: AbortController;
      input: AsyncQueue<SDKUserMessage>;
    },
  ) {
    this.q = q;
    this.sessionId = opts.sessionId;
    this.sessionFile = sdkTranscriptPath(opts.cwd, opts.sessionId);
    this.state = opts.state;
    this.abort = opts.abort;
    this.input = opts.input;
    this.events = this.queue.iterable();
    void this.pump();
  }

  private async pump(): Promise<void> {
    try {
      for await (const msg of this.q) {
        for (const ev of mapClaudeMessage(msg, this.state)) {
          this.queue.push(ev);
          if (TERMINAL_EVENT_TYPES.includes(ev.type)) {
            this.finish();
            return;
          }
        }
      }
      this.queue.end();
    } catch (err) {
      if (this.stopping) {
        this.queue.end();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.queue.push({ type: 'error', error: { message, retryable: false } });
      this.queue.end();
    }
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.input.end();
    this.queue.end();
    if (!this.abort.signal.aborted) this.abort.abort();
  }

  async steer(text: string, images?: readonly DeliveredImage[]): Promise<void> {
    this.input.push(buildUserMessage(text, images));
    this.queue.push({ type: 'steer', text });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.state.interrupted = true;
    this.input.end();
    this.q.interrupt().catch(() => {});
    this.finish();
  }

  usage(): AgentTokenUsage {
    return this.state.usage;
  }
}

export function buildUserMessage(text: string, images?: readonly DeliveredImage[]): SDKUserMessage {
  if (images === undefined || images.length === 0) {
    return {
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
    };
  }
  return {
    type: 'user',
    message: { role: 'user', content: [textBlock(text), ...images.map(toImageBlock)] },
    parent_tool_use_id: null,
  };
}

function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text };
}

type InlineImageMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export function toImageBlock(img: DeliveredImage): {
  type: 'image';
  source: { type: 'base64'; media_type: InlineImageMediaType; data: string };
} {
  return {
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType as InlineImageMediaType, data: img.data },
  };
}

const CLAUDE_PROJECT_SLUG_MAX = 200;

const CLAUDE_PROJECT_DIR_NAME = /^[A-Za-z0-9_-]{1,64}$/;

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

function claudePathHash(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    hash = ((hash << 5) - hash + path.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function claudeProjectSlug(resolvedPath: string): string {
  const flat = resolvedPath.replace(/[^a-zA-Z0-9]/g, '-');
  if (flat.length <= CLAUDE_PROJECT_SLUG_MAX) return flat;
  return `${flat.slice(0, CLAUDE_PROJECT_SLUG_MAX)}-${claudePathHash(resolvedPath)}`;
}

function claudeProjectDirOverride(): string | undefined {
  if (!process.env.CLAUDE_CONFIG_DIR) return undefined;
  const name = process.env.CLAUDE_CODE_PROJECT_DIR_NAME;
  if (!name || !CLAUDE_PROJECT_DIR_NAME.test(name) || WINDOWS_DEVICE_NAME.test(name)) {
    return undefined;
  }
  return name;
}

function claudeProjectsRoot(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR;
  const root = configDir ? configDir : join(homedir(), '.claude');
  return join(root.normalize('NFC'), 'projects');
}

// Claude Code slug: realpath'd cwd, non-alphanumerics to "-", 200-char cap plus path hash, darwin NFC root.
export function sdkTranscriptPath(cwd: string, sessionId: string): string {
  let resolved = cwd;
  try {
    resolved = realpathSync(cwd);
  } catch {}
  if (process.platform === 'darwin') resolved = resolved.normalize('NFC');
  const slug = claudeProjectDirOverride() ?? claudeProjectSlug(resolved);
  return join(claudeProjectsRoot(), slug, `${sessionId}.jsonl`);
}

const HOST_MCP_SERVER_NAME = 'cairn';

function jsonSchemaToZod(schema: unknown, where: string): z.ZodType {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    throw new Error(`claude-code backend: tool schema ${where} must be an object (fail-closed)`);
  }
  const def = schema as {
    type?: unknown;
    description?: unknown;
    items?: unknown;
    properties?: unknown;
    required?: unknown;
  };
  const description = typeof def.description === 'string' ? def.description : undefined;
  const describe = (t: z.ZodType) => (description !== undefined ? t.describe(description) : t);
  const forbidKeys = (allowed: readonly string[]) => {
    const extra = Object.keys(schema as Record<string, unknown>).filter(
      (k) => !allowed.includes(k),
    );
    if (extra.length > 0) {
      throw new Error(
        `claude-code backend: tool schema ${where} keys [${extra.join(',')}] not in vocabulary (fail-closed)`,
      );
    }
  };
  switch (def.type) {
    case 'string':
      forbidKeys(['type', 'description']);
      return describe(z.string());
    case 'number':
      forbidKeys(['type', 'description']);
      return describe(z.number());
    case 'boolean':
      forbidKeys(['type', 'description']);
      return describe(z.boolean());
    case 'array':
      forbidKeys(['type', 'description', 'items']);
      return describe(z.array(jsonSchemaToZod(def.items, `${where}.items`)));
    case 'object': {
      forbidKeys(['type', 'description', 'properties', 'required']);
      if (
        def.properties === undefined ||
        typeof def.properties !== 'object' ||
        def.properties === null ||
        Array.isArray(def.properties)
      ) {
        throw new Error(
          `claude-code backend: tool schema ${where} object properties must be an object (fail-closed)`,
        );
      }
      if (
        def.required !== undefined &&
        (!Array.isArray(def.required) || def.required.some((k) => typeof k !== 'string'))
      ) {
        throw new Error(
          `claude-code backend: tool schema ${where} required must be string[] (fail-closed)`,
        );
      }
      const required = new Set((def.required as string[] | undefined) ?? []);
      const shape: Record<string, z.ZodType> = {};
      for (const [key, sub] of Object.entries(def.properties)) {
        const field = jsonSchemaToZod(sub, `${where}.properties.${key}`);
        shape[key] = required.has(key) ? field : field.optional();
      }
      return describe(z.object(shape));
    }
    default:
      throw new Error(
        `claude-code backend: tool schema ${where} type '${String(def.type)}' not in vocabulary (fail-closed)`,
      );
  }
}

export function parametersToShape(
  parameters: unknown,
  toolName: string,
): Record<string, z.ZodType> {
  if (parameters === undefined || parameters === null) return {};
  if (
    typeof parameters !== 'object' ||
    Array.isArray(parameters) ||
    (parameters as { type?: unknown }).type !== 'object'
  ) {
    throw new Error(
      `claude-code backend: tool '${toolName}' parameters must be an object schema (fail-closed)`,
    );
  }
  return (jsonSchemaToZod(parameters, `'${toolName}'.parameters`) as z.ZodObject).shape;
}

export interface HostToolSources {
  remoteTools: readonly RemoteToolDef[];
  relay?: (name: string, params: Record<string, unknown>) => Promise<string>;
  localTools: readonly LocalToolDef[];
}

export function buildHostTools(sources: HostToolSources): SdkMcpToolDefinition[] {
  if (sources.remoteTools.length > 0 && !sources.relay) {
    throw new Error('claude-code backend: remoteTools require executeRemoteTool (fail-closed)');
  }
  const tools: SdkMcpToolDefinition[] = [];
  for (const def of sources.remoteTools) {
    const shape = parametersToShape(def.parameters, def.name);
    tools.push(
      tool(def.name, def.description, shape, async (params: Record<string, unknown>) => {
        try {
          const text = await sources.relay?.(def.name, params ?? {});
          return { content: [{ type: 'text' as const, text: text ?? '' }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `${def.name} rejected: ${msg}` }],
            isError: true,
          };
        }
      }),
    );
  }
  for (const def of sources.localTools) {
    const shape = parametersToShape(def.parameters, def.name);
    tools.push(
      tool(def.name, def.description, shape, async (params: Record<string, unknown>) => {
        try {
          const text = await def.execute(params ?? {});
          return { content: [{ type: 'text' as const, text }] };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `${def.name} failed: ${msg}` }],
            isError: true,
          };
        }
      }),
    );
  }
  return tools;
}

export function mapMcpEndpoint(endpoint: McpEndpoint): McpServerConfig {
  if (endpoint.transport === 'http') {
    if (typeof endpoint.url !== 'string' || endpoint.url === '') {
      throw new Error(
        `claude-code backend: mcp server '${endpoint.slug}' http transport requires url (fail-closed)`,
      );
    }
    return {
      type: 'http',
      url: endpoint.url,
      ...(endpoint.headers !== undefined ? { headers: endpoint.headers } : {}),
      alwaysLoad: true,
    };
  }
  if (typeof endpoint.command !== 'string' || endpoint.command === '') {
    throw new Error(
      `claude-code backend: mcp server '${endpoint.slug}' stdio transport requires command (fail-closed)`,
    );
  }
  return {
    type: 'stdio',
    command: endpoint.command,
    ...(endpoint.args !== undefined ? { args: [...endpoint.args] } : {}),
    ...(endpoint.env !== undefined ? { env: endpoint.env } : {}),
    alwaysLoad: true,
  };
}

export const CLAUDE_SETTING_SOURCES: readonly SettingSource[] = ['user', 'project', 'local'];

export function escapeGitignorePath(path: string): string {
  return path.replaceAll(/([\\*?[\]])/g, '\\$1');
}

export function buildSkillDenyRules(denied: readonly DeniedSkillEntry[]): string[] {
  return denied.flatMap((d) => [
    `Read(/${escapeGitignorePath(d.baseDir)}/**)`,
    `Skill(${d.name})`,
    `Skill(skill:${d.name})`,
  ]);
}

export const MIN_CLAUDE_PLUGIN_VERSION = '2.1.74';

export function claudeVersionAtLeast(version: string | null | undefined, min: string): boolean {
  const parse = (v: string): number[] | null => {
    const parts = v
      .split('.')
      .slice(0, 3)
      .map((p) => {
        const m = /^(\d+)/.exec(p);
        return m === null ? Number.NaN : Number.parseInt(m[1] ?? '', 10);
      });
    return parts.length === 3 && parts.every((n) => !Number.isNaN(n)) ? parts : null;
  };
  if (version == null) return false;
  const a = parse(version);
  const b = parse(min);
  if (a === null || b === null) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

export interface TeamSkillsPluginParts {
  skills: { skillsDir: string; cwd: string } | undefined;
  cacheRoot: string | undefined;
  executableVersion: string | null | undefined;
  session: { skillsAllowlist?: string[]; injectedSkills?: string[]; teamSkillsDir?: string };
  log?: (msg: string) => void;
}

export function resolveTeamSkillsPluginDir(parts: TeamSkillsPluginParts): string | null {
  const viewDir = parts.session.teamSkillsDir;
  if (viewDir === undefined) return null;
  const log = parts.log;
  if (parts.cacheRoot === undefined) {
    log?.('native-plugin: skipped (team-skills cache root not wired; catalog channel only)');
    return null;
  }
  if (!claudeVersionAtLeast(parts.executableVersion, MIN_CLAUDE_PLUGIN_VERSION)) {
    log?.(
      `native-plugin: skipped (claude ${parts.executableVersion ?? 'unparsed'} < ${MIN_CLAUDE_PLUGIN_VERSION}; catalog channel only)`,
    );
    return null;
  }
  const entries = collectTeamSkillEntries(parts.skills, {
    ...(parts.session.skillsAllowlist !== undefined
      ? { skillsAllowlist: parts.session.skillsAllowlist }
      : {}),
    teamSkillsDir: viewDir,
  });
  if (entries.length === 0) {
    log?.('native-plugin: 0 allowed team skill(s); not delivered (catalog channel only)');
    return null;
  }
  const dir = ensureTeamSkillsPlugin({
    cacheRoot: parts.cacheRoot,
    viewDir,
    dirNames: entries.map((e) => e.dirName),
    ...(log !== undefined ? { log } : {}),
  });
  if (dir !== null) log?.(`native-plugin: ${entries.length} skill(s) → ${dir}`);
  return dir;
}

export interface ClaudeSdkOptionParts {
  cwd: string;
  modelId: string;
  resumeId: string | null;
  sessionId: string;
  disallowedTools: string[];
  mcpServers: Record<string, McpServerConfig>;
  strictMcpConfig?: boolean;
  effort?: EffortLevel;
  append?: string;
  skillDenyRules?: string[];
  executablePath?: string;
  env?: Record<string, string>;
  plugins?: SdkPluginConfig[];
  abortController: AbortController;
}

export function buildClaudeSdkOptions(parts: ClaudeSdkOptionParts): Options {
  const managedMcp = parts.strictMcpConfig === true;
  const mcpSection: Pick<Options, 'mcpServers' | 'strictMcpConfig'> = managedMcp
    ? { mcpServers: parts.mcpServers, strictMcpConfig: true }
    : Object.keys(parts.mcpServers).length > 0
      ? { mcpServers: parts.mcpServers }
      : {};
  return {
    cwd: parts.cwd,
    model: parts.modelId,
    permissionMode: 'bypassPermissions',
    disallowedTools: parts.disallowedTools,
    includePartialMessages: true,
    settingSources: [...CLAUDE_SETTING_SOURCES],
    ...mcpSection,
    ...(parts.effort !== undefined ? { effort: parts.effort } : {}),
    ...(parts.append !== undefined
      ? {
          systemPrompt: {
            type: 'preset' as const,
            preset: 'claude_code' as const,
            append: parts.append,
          },
        }
      : {}),
    ...(parts.resumeId !== null ? { resume: parts.resumeId } : { sessionId: parts.sessionId }),
    ...(parts.skillDenyRules !== undefined && parts.skillDenyRules.length > 0
      ? { settings: { permissions: { deny: [...parts.skillDenyRules] } } }
      : {}),
    ...(parts.executablePath !== undefined
      ? { pathToClaudeCodeExecutable: parts.executablePath }
      : {}),
    ...(parts.env !== undefined ? { env: { ...process.env, ...parts.env } } : {}),
    ...(parts.plugins !== undefined && parts.plugins.length > 0 ? { plugins: parts.plugins } : {}),
    abortController: parts.abortController,
  };
}

export function claudeSessionEnv(opts: SessionOpts): Record<string, string> | undefined {
  const telemetryEnv = opts.telemetry !== undefined ? claudeTelemetryEnv(opts.telemetry) : null;
  if (opts.env === undefined && telemetryEnv === null) return undefined;
  return { ...opts.env, ...telemetryEnv };
}

export interface ClaudeCodeBackendOpts {
  skills?: { skillsDir: string; cwd: string };
  onSkillsLog?: (msg: string) => void;
  machineName?: string;
  executablePath?: string;
  teamSkillsCacheDir?: string;
  executableVersion?: string | null;
}

export class ClaudeCodeBackend implements AgentBackend {
  readonly capabilities = CLAUDE_CODE_CAPABILITIES;

  readonly brief: BriefChannel = {
    backendId: 'claude-code',
    composeBody: (opts, base) =>
      appendSkillsCatalog(
        base,
        composeSkillsSection(this.opts.skills, opts, this.opts.onSkillsLog),
      ) ?? '',
  };

  constructor(private readonly opts: ClaudeCodeBackendOpts) {}

  async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, null);
  }

  async continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle> {
    if (!existsSync(sdkTranscriptPath(opts.cwd, id))) {
      throw new SessionNotResumableError(id);
    }
    return this.open(opts, id);
  }

  private async open(opts: SessionOpts, resumeId: string | null): Promise<AgentSessionHandle> {
    const managedMcp = opts.mcpServers !== undefined;
    const hostTools = buildHostTools({
      remoteTools: opts.remoteTools ?? [],
      ...(opts.executeRemoteTool ? { relay: opts.executeRemoteTool } : {}),
      localTools: opts.localTools ?? [],
    });
    const mcpServers: Record<string, McpServerConfig> = {};
    if (hostTools.length > 0) {
      mcpServers[HOST_MCP_SERVER_NAME] = createSdkMcpServer({
        name: HOST_MCP_SERVER_NAME,
        alwaysLoad: true,
        tools: hostTools,
      });
    }
    for (const endpoint of opts.mcpServers ?? []) {
      if (endpoint.slug === HOST_MCP_SERVER_NAME) {
        throw new Error(
          `claude-code backend: mcp server slug '${endpoint.slug}' collides with the host tool server (fail-closed)`,
        );
      }
      mcpServers[endpoint.slug] = mapMcpEndpoint(endpoint);
    }
    const effort = toEffort(opts.thinkingLevel);
    const append = opts.systemPrompt;
    const disallowedTools = [SDK_ASK_TOOL, ...(opts.readOnly === true ? SDK_WRITE_TOOLS : [])];
    const abort = new AbortController();
    const sessionId = resumeId ?? randomUUID();
    const deniedSkills = collectDeniedSkillDirs(this.opts.skills, opts);
    const skillDenyRules = buildSkillDenyRules(deniedSkills);
    if (deniedSkills.length > 0) {
      this.opts.onSkillsLog?.(`deny: ${deniedSkills.length} skill dir(s) hard-blocked`);
    }
    const nativePluginDir = resolveTeamSkillsPluginDir({
      skills: this.opts.skills,
      cacheRoot: this.opts.teamSkillsCacheDir,
      executableVersion: this.opts.executableVersion,
      session: opts,
      ...(this.opts.onSkillsLog !== undefined ? { log: this.opts.onSkillsLog } : {}),
    });
    const sessionEnv = claudeSessionEnv(opts);
    const sdkOptions: Options = buildClaudeSdkOptions({
      cwd: opts.cwd,
      modelId: opts.modelId,
      resumeId,
      sessionId,
      disallowedTools,
      mcpServers,
      ...(managedMcp ? { strictMcpConfig: true } : {}),
      ...(effort !== undefined ? { effort } : {}),
      ...(append !== undefined ? { append } : {}),
      skillDenyRules,
      ...(this.opts.executablePath !== undefined
        ? { executablePath: this.opts.executablePath }
        : {}),
      ...(sessionEnv !== undefined ? { env: sessionEnv } : {}),
      ...(nativePluginDir !== null
        ? { plugins: [{ type: 'local' as const, path: nativePluginDir }] }
        : {}),
      abortController: abort,
    });
    const state = createClaudeMapState({
      modelId: opts.modelId,
      machineName: this.opts.machineName ?? hostname(),
    });
    const input = new AsyncQueue<SDKUserMessage>();
    if (opts.prompt !== undefined) input.push(buildUserMessage(opts.prompt, opts.promptImages));
    const q = query({ prompt: input.iterable(), options: sdkOptions });
    return new ClaudeSessionHandle(q, { sessionId, cwd: opts.cwd, state, abort, input });
  }
}

function toEffort(level: string | undefined): EffortLevel | undefined {
  if (level === undefined || level === 'off' || level === 'minimal') return undefined;
  if (EFFORT_LEVELS.includes(level)) return level as EffortLevel;
  throw new Error(`claude-code backend: unsupported thinkingLevel '${level}' (fail-closed)`);
}

export function createClaudeCodeBackend(opts: ClaudeCodeBackendOpts): AgentBackend {
  return new ClaudeCodeBackend(opts);
}
