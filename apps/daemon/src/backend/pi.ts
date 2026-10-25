import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentSessionHandle,
  AgentTokenUsage,
  BriefChannel,
  DeliveredImage,
  McpEndpoint,
  ModelUsage,
  ProviderCompat,
  ProviderConfig,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
} from '@cairn/shared';
import { ENV_VARS, THINKING_LEVELS } from '@cairn/shared';
import {
  type AgentSession,
  createAgentSession,
  createBashToolDefinition,
  createMcpExtension,
  createReadToolDefinition,
  DefaultResourceLoader,
  defineTool,
  type ExtensionUIContext,
  type InlineExtension,
  type McpServerConfig,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { gateToolCallHandler, type PermissionRule } from './command-gate.js';
import { SessionNotResumableError } from './errors.js';
import { connectFailedLine } from './mcp-config.js';
import { PI_RETRY_SETTINGS } from './pi-retry.js';
import {
  enrichProviderError,
  type ProviderResponseSink,
  wrapProviderFetch,
} from './provider-response.js';
import {
  appendSkillsCatalog,
  collectDeniedSkillDirs,
  composeSkillsSection,
  createSkillReadGate,
  piWorktreeSkillDirs,
} from './skills.js';

export const PI_CAPABILITIES: AgentBackendCapabilities = {
  name: 'pi',
  thinkingLevels: THINKING_LEVELS,
  oauthProviders: ['anthropic', 'openai-codex', 'github-copilot', 'xai'],
  compaction: true,
  sessionResume: true,
};

const PI_BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write'];

export const TRUST_PROTECTED_ENTRIES = [
  'settings.json',
  'mcp.json',
  'extensions',
  'skills',
  'prompts',
  'themes',
  'SYSTEM.md',
  'APPEND_SYSTEM.md',
] as const;

export function detectTrustProtectedResources(cwd: string): string[] {
  const found: string[] = [];
  for (const entry of TRUST_PROTECTED_ENTRIES) {
    if (existsSync(join(cwd, '.pi', entry))) found.push(`.pi/${entry}`);
  }
  return found;
}

type PiSettingsSeed = NonNullable<Parameters<typeof SettingsManager.inMemory>[0]>;
export const PI_DAEMON_SETTINGS: PiSettingsSeed = {
  compaction: { enabled: true },
  enableInstallTelemetry: false,
  cacheWarming: 'off',
};

export function daemonSettingsManager(): SettingsManager {
  return SettingsManager.inMemory(
    { ...buildPiSessionSettings(), ...PI_DAEMON_SETTINGS },
    { projectTrusted: false },
  );
}

export const PI_SETTINGS_BYPASS = [
  {
    setting: 'defaultProjectTrust',
    policy: '信任决定由宿主钉死 projectTrusted:false（deny），文件位不参与',
  },
  {
    setting: 'retry',
    policy:
      'retry 预算由宿主显式钉死（PI_RETRY_SETTINGS，#926），文件位不参与；步级纪律：失败无自动重跑',
  },
  {
    setting: 'modelOverrides',
    policy: '模型面由 server 配置经 models.json 物化下发，本机覆盖不掺入',
  },
  { setting: 'httpProxy', policy: '代理面归 daemon setupProxy（env 级），不经 pi settings' },
  {
    setting: 'cacheWarming',
    policy: '显式 off（PI_DAEMON_SETTINGS）：无人值守不发后台缓存刷新请求',
  },
  { setting: 'enableInstallTelemetry', policy: '显式 false + PI_TELEMETRY=0 env 钉（D2）' },
  {
    setting: 'packages',
    policy: '项目级 packages/extensions 不加载：SDK 面无 builtin 注入、无附加路径',
  },
  { setting: 'themes', policy: '无 TUI 面，主题不进会话' },
  { setting: 'promptTemplates', policy: '提示模板是 TUI slash 面，会话组装不消费' },
] as const;

export function piUnattendedEnvPins(env: NodeJS.ProcessEnv): Record<string, string> {
  const pins: Record<string, string> = {
    PI_OFFLINE: '1',
    PI_TELEMETRY: '0',
    PI_SKIP_VERSION_CHECK: '1',
    PI_CACHE_RETENTION: resolvePiCacheRetention(env),
  };
  for (const key of Object.keys(pins)) {
    if (env[key] !== undefined) delete pins[key];
  }
  return pins;
}

export function resolvePiCacheRetention(env: NodeJS.ProcessEnv): 'short' | 'long' {
  return env[ENV_VARS.piCacheRetention] === 'long' ? 'long' : 'short';
}

function truthyEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

export function piSessionPolicyLine(env: NodeJS.ProcessEnv): string {
  const effective: NodeJS.ProcessEnv = { ...env, ...piUnattendedEnvPins(env) };
  const telemetry = truthyEnvFlag(effective.PI_TELEMETRY) ? 'on' : 'off';
  const versionCheck = effective.PI_SKIP_VERSION_CHECK ? 'off' : 'on';
  const retention = effective.PI_CACHE_RETENTION === 'long' ? 'long' : 'short';
  return `pi policy: trust=deny telemetry=${telemetry} version-check=${versionCheck} cache-retention=${retention} settings=in-memory (bypass list: PI_SETTINGS_BYPASS, spec 26)`;
}

export function buildPiSessionSettings() {
  return { compaction: { enabled: true }, retry: PI_RETRY_SETTINGS };
}

interface PiImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export function toPiImages(images: readonly DeliveredImage[]): PiImageContent[] {
  return images.map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType }));
}

export function ensureImageInput(model: { input: ('text' | 'image')[] }): void {
  if (model.input.includes('image')) return;
  model.input = [...model.input, 'image'];
}

const PI_READONLY_TOOLS = ['read', 'bash'];

export function builtinToolNames(readOnly: boolean): readonly string[] {
  return readOnly ? PI_READONLY_TOOLS : PI_BUILTIN_TOOLS;
}

export function sessionToolNames(opts: {
  readOnly: boolean;
  remoteTools: readonly string[];
  mcpTools: readonly string[];
  localTools?: readonly string[];
}): string[] {
  return [
    ...builtinToolNames(opts.readOnly),
    ...opts.remoteTools,
    ...opts.mcpTools,
    ...(opts.localTools ?? []),
  ];
}

const MCP_TIMEOUT_SECONDS = 10;

const MCP_TOOL_ALLOWLIST = [
  'mcp__*',
  'list_mcp_resources',
  'list_mcp_resource_templates',
  'read_mcp_resource',
] as const;

function mcpServerConfig(endpoint: McpEndpoint): McpServerConfig {
  return endpoint.transport === 'stdio'
    ? {
        type: 'stdio',
        command: endpoint.command ?? '',
        ...(endpoint.args ? { args: [...endpoint.args] } : {}),
        ...(endpoint.env ? { env: { ...endpoint.env } } : {}),
        exposure: 'direct',
        timeout: MCP_TIMEOUT_SECONDS,
      }
    : {
        type: 'http',
        url: endpoint.url ?? '',
        ...(endpoint.headers ? { headers: { ...endpoint.headers } } : {}),
        exposure: 'direct',
        timeout: MCP_TIMEOUT_SECONDS,
      };
}

export interface McpAttentionLine {
  slug: string;
  reason: string;
}

export function parseMcpAttentionMessage(message: string): McpAttentionLine[] {
  if (!message.startsWith('MCP servers need attention:')) return [];
  const out: McpAttentionLine[] = [];
  for (const line of message.split('\n').slice(1)) {
    if (line.startsWith('Run /mcp')) break;
    const m = /^ {2}(\S+): (.+)$/.exec(line);
    if (m) out.push({ slug: m[1] ?? '', reason: m[2] ?? '' });
  }
  return out;
}

export function headlessCaptureUi(
  onNotify: (message: string, type?: 'info' | 'warning' | 'error') => void,
  ask?: (params: Record<string, unknown>) => Promise<string>,
): ExtensionUIContext {
  const base: Record<string, unknown> = {
    notify: onNotify,
    ...(ask !== undefined
      ? {
          select: async (title: string, options: string[]) => {
            const parsed = await askViaChannel(ask, {
              header: headerOf(title),
              question: title,
              options: options.map((label) => ({ label })),
            });
            return parsed?.choices?.[0];
          },
          confirm: async (title: string, message: string) => {
            const parsed = await askViaChannel(ask, {
              header: headerOf(title),
              question: message === '' ? title : `${title}\n${message}`,
              options: [{ label: '是' }, { label: '否' }],
            });
            return parsed?.choices?.[0] === '是';
          },
          input: async (title: string) => {
            const parsed = await askViaChannel(ask, {
              header: headerOf(title),
              question: title,
              options: [],
            });
            return parsed?.text;
          },
        }
      : {}),
  };
  return new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      return () => undefined;
    },
  }) as unknown as ExtensionUIContext;
}

async function askViaChannel(
  ask: (params: Record<string, unknown>) => Promise<string>,
  question: { header: string; question: string; options: { label: string }[] },
): Promise<{ choices?: string[]; text?: string } | undefined> {
  try {
    const text = await ask({ questions: [question] });
    const parsed = JSON.parse(text) as {
      status?: string;
      answers?: { choices?: string[]; text?: string }[] | null;
    };
    if (parsed.status !== 'answered') return undefined;
    return parsed.answers?.[0] ?? undefined;
  } catch {
    return undefined;
  }
}

function headerOf(title: string): string {
  const trimmed = title.trim();
  return trimmed.length > 24 ? `${trimmed.slice(0, 24)}…` : trimmed || '问题';
}

const MODELS_JSON_KEY_PLACEHOLDER = 'per-step';

const learnedCompat = new Map<string, ProviderCompat>();

const lastServerCompat = new Map<string, string>();

export function protocolCompatFlip(errorMessage: string): Partial<ProviderCompat> | null {
  if (/model does not support this protocol/i.test(errorMessage)) {
    return { maxTokensField: 'max_tokens', supportsStore: false };
  }
  if (/unsupported parameter[^\n]*max_completion_tokens/i.test(errorMessage)) {
    return { maxTokensField: 'max_tokens' };
  }
  if (/unsupported parameter[^\n]*\bstore\b/i.test(errorMessage)) {
    return { supportsStore: false };
  }
  return null;
}

export function adaptProviderCompat(
  provider: ProviderConfig,
  errorMessage: string,
): ProviderConfig | null {
  if (!provider.baseUrl) return null;
  const flip = protocolCompatFlip(errorMessage);
  if (flip === null) return null;
  const next: ProviderCompat = {
    ...learnedCompat.get(provider.providerId),
    ...provider.compat,
    ...flip,
  };
  const prior: ProviderCompat = { ...learnedCompat.get(provider.providerId), ...provider.compat };
  if (prior.maxTokensField === next.maxTokensField && prior.supportsStore === next.supportsStore) {
    return null;
  }
  learnedCompat.set(provider.providerId, next);
  return { ...provider, compat: next };
}

const CUSTOM_MODEL_DEFAULTS = {
  reasoning: false,
  input: ['text'] as ('text' | 'image')[],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 16_384,
};

function customModelReasoning(): Record<string, unknown> {
  if (process.env[ENV_VARS.customModelReasoning] !== '1') return {};
  return {
    reasoning: true,
    compat: { supportsDeveloperRole: false },
    thinkingLevelMap: {
      off: 'none',
      minimal: 'low',
      low: 'low',
      medium: 'low',
      high: 'high',
      xhigh: 'high',
      max: 'max',
    },
  };
}

interface PiMessageLike {
  role: string;
  content?: unknown;
  provider?: string;
  model?: string;
  stopReason?: string;
  rawStopReason?: string;
  responseModel?: string;
  errorMessage?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
      total?: number;
    };
  };
}

export interface AgentSessionEventLike {
  type: string;
  message?: PiMessageLike;
  assistantMessageEvent?: {
    type: string;
    delta?: string;
    content?: string;
    toolCall?: { id: string; name: string; arguments: unknown };
  };
  toolCallId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  attempt?: number;
  willRetry?: boolean;
}

export interface MapState {
  usage: Map<string, ModelUsage>;
  calls: Map<string, ToolCallRecord>;
  diagnose?: (message: string) => string;
}

export function newMapState(opts?: { diagnose?: (message: string) => string }): MapState {
  return {
    usage: new Map(),
    calls: new Map(),
    ...(opts?.diagnose !== undefined ? { diagnose: opts.diagnose } : {}),
  };
}

function toMessageRecord(msg: PiMessageLike): {
  role: 'system' | 'user' | 'assistant';
  content: unknown;
  stopReason?: string;
  rawStopReason?: string;
  responseModel?: string;
  usage?: PiMessageLike['usage'];
} {
  const role =
    msg.role === 'assistant' ? 'assistant' : msg.role === 'user' ? 'user' : ('system' as const);
  return {
    role,
    content: msg.content ?? null,
    ...(msg.stopReason !== undefined ? { stopReason: msg.stopReason } : {}),
    ...(msg.rawStopReason !== undefined ? { rawStopReason: msg.rawStopReason } : {}),
    ...(msg.responseModel !== undefined ? { responseModel: msg.responseModel } : {}),
    ...(msg.usage !== undefined ? { usage: msg.usage } : {}),
  };
}

function isRetryableError(message: string): boolean {
  return /rate.?limit|overloaded|timeout|temporarily|5\d\d/i.test(message);
}

export function mapPiSessionEvent(event: AgentSessionEventLike, state: MapState): StepEvent[] {
  switch (event.type) {
    case 'message_update': {
      const msg = event.message;
      if (!msg) return [];
      const record = toMessageRecord(msg);
      const ame = event.assistantMessageEvent;
      if (!ame) return [{ type: 'message_update', message: record }];
      if (ame.type === 'text_delta' && ame.delta !== undefined) {
        return [
          { type: 'text_delta', text: ame.delta },
          { type: 'message_update', message: record },
        ];
      }
      if (ame.type === 'thinking_delta' && ame.delta !== undefined) {
        return [
          { type: 'thinking_delta', text: ame.delta },
          { type: 'message_update', message: record },
        ];
      }
      if (ame.type === 'thinking_end') {
        return [{ type: 'thinking', text: ame.content ?? '' }];
      }
      if (ame.type === 'toolcall_end' && ame.toolCall) {
        const call: ToolCallRecord = {
          id: ame.toolCall.id,
          name: ame.toolCall.name,
          arguments: ame.toolCall.arguments,
        };
        state.calls.set(call.id, call);
        return [{ type: 'toolcall_end', call }];
      }
      return [{ type: 'message_update', message: record }];
    }
    case 'message_end': {
      const msg = event.message;
      if (!msg) return [];
      if (msg.role === 'assistant' && msg.usage && msg.provider && msg.model) {
        const key = `${msg.provider}/${msg.model}`;
        const prev = state.usage.get(key) ?? {
          model: key,
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        };
        const next: ModelUsage = {
          model: key,
          input: prev.input + (msg.usage.input ?? 0),
          output: prev.output + (msg.usage.output ?? 0),
          cacheRead: prev.cacheRead + (msg.usage.cacheRead ?? 0),
          cacheWrite: prev.cacheWrite + (msg.usage.cacheWrite ?? 0),
        };
        const cost = msg.usage.cost;
        if (cost !== undefined) {
          const pc = prev.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
          next.cost = {
            input: pc.input + (cost.input ?? 0),
            output: pc.output + (cost.output ?? 0),
            cacheRead: pc.cacheRead + (cost.cacheRead ?? 0),
            cacheWrite: pc.cacheWrite + (cost.cacheWrite ?? 0),
            total: pc.total + (cost.total ?? 0),
          };
        } else if (prev.cost !== undefined) {
          next.cost = prev.cost;
        }
        state.usage.set(key, next);
      }
      if (msg.stopReason === 'aborted') {
        return [{ type: 'message_stop', message: toMessageRecord(msg) }];
      }
      const out: StepEvent[] = [{ type: 'message_end', message: toMessageRecord(msg) }];
      if (msg.role === 'assistant' && msg.stopReason === 'error') {
        const message = msg.errorMessage ?? 'unknown error';
        const retryable = isRetryableError(message);
        out.push({
          type: 'error',
          error: { message: state.diagnose?.(message) ?? message, retryable },
        });
      }
      return out;
    }
    case 'tool_execution_end': {
      const toolCallId = event.toolCallId ?? '';
      const prior = state.calls.get(toolCallId);
      const call: ToolCallRecord = {
        id: toolCallId,
        name: event.toolName ?? prior?.name ?? '',
        arguments: prior?.arguments ?? event.args,
        result: event.result,
        isError: event.isError ?? false,
        ...(prior?.startedAt !== undefined ? { startedAt: prior.startedAt } : {}),
        endedAt: Date.now(),
      };
      state.calls.set(call.id, call);
      return [{ type: 'toolcall_end', call }];
    }
    case 'compaction_start':
      return [{ type: 'compaction_start' }];
    case 'compaction_end':
      return [{ type: 'compaction_end' }];
    case 'auto_retry_start':
      return [{ type: 'auto_retry_start', attempt: event.attempt ?? 1 }];
    case 'auto_retry_end':
      return [{ type: 'auto_retry_end', attempt: event.attempt ?? 1 }];
    case 'agent_settled': {
      const usage: ModelUsage[] = [...state.usage.values()];
      return [{ type: 'done', usage }];
    }
    case 'agent_end':
      return [];
    default:
      return [];
  }
}

class EventQueue {
  private readonly items: StepEvent[] = [];
  private waiter: ((r: IteratorResult<StepEvent>) => void) | null = null;
  private ended = false;

  push(ev: StepEvent): void {
    if (this.ended) return;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: ev, done: false });
      return;
    }
    this.items.push(ev);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiter) {
      const resolve = this.waiter;
      this.waiter = null;
      resolve({ value: undefined as unknown as StepEvent, done: true });
    }
  }

  next(): Promise<IteratorResult<StepEvent>> {
    const item = this.items.shift();
    if (item !== undefined) return Promise.resolve({ value: item, done: false });
    if (this.ended) {
      return Promise.resolve({ value: undefined as unknown as StepEvent, done: true });
    }
    return new Promise<IteratorResult<StepEvent>>((resolve) => {
      this.waiter = resolve;
    });
  }

  iterable(): AsyncIterable<StepEvent> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<StepEvent> {
        return { next: () => self.next() };
      },
    };
  }
}

class PiSessionHandle implements AgentSessionHandle {
  readonly sessionId: string;
  readonly sessionFile: string | undefined;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue = new EventQueue();
  private readonly state: MapState;
  private closed = false;
  private stopping = false;

  constructor(
    private readonly session: AgentSession,
    private readonly model: { input: ('text' | 'image')[] } | null,
    diagnose?: (message: string) => string,
  ) {
    this.sessionId = session.sessionId;
    this.sessionFile = session.sessionFile;
    this.state = newMapState(diagnose !== undefined ? { diagnose } : undefined);
    this.events = this.queue.iterable();
    session.subscribe((event) => {
      for (const mapped of mapPiSessionEvent(
        event as unknown as AgentSessionEventLike,
        this.state,
      )) {
        if (this.stopping && mapped.type === 'done') continue;
        this.queue.push(mapped);
        if (mapped.type === 'done') this.finish();
      }
    });
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue.end();
    void this.shutdownExtensions().finally(() => {
      this.session.dispose();
    });
  }

  private async shutdownExtensions(): Promise<void> {
    if (!this.session.hasExtensionHandlers('session_shutdown')) return;
    try {
      await this.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
    } catch {}
  }

  async steer(text: string, images?: readonly DeliveredImage[]): Promise<void> {
    if (images !== undefined && images.length > 0 && this.model !== null) {
      ensureImageInput(this.model);
      await this.session.steer(text, toPiImages(images));
    } else {
      await this.session.steer(text);
    }
    this.queue.push({ type: 'steer', text });
  }

  emitBackendError(message: string): void {
    this.queue.push({ type: 'error', error: { message, retryable: false } });
    this.finish();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    await this.session.abort();
    this.finish();
  }

  usage(): AgentTokenUsage {
    return [...this.state.usage.values()];
  }
}

export interface PiBackendOpts {
  agentDir: string;
  sessionDir: string;
  resolveSessionFile?: (sessionId: string) => string | null;
  onSession?: (sessionId: string, sessionFile: string | undefined) => void;
  onMcpLog?: (msg: string) => void;
  skills?: { skillsDir: string; cwd: string };
  onSkillsLog?: (msg: string) => void;
  onGateLog?: (msg: string) => void;
  onTrustLog?: (msg: string) => void;
  gateRules?: readonly PermissionRule[];
  machineName?: string;
}

export class PiBackend implements AgentBackend {
  readonly capabilities = PI_CAPABILITIES;

  readonly brief: BriefChannel = {
    backendId: 'pi',
    composeBody: (opts, base) =>
      appendSkillsCatalog(
        base,
        composeSkillsSection(
          this.opts.skills,
          {
            ...(opts.skillsAllowlist !== undefined
              ? { skillsAllowlist: opts.skillsAllowlist }
              : {}),
            ...(opts.injectedSkills !== undefined ? { injectedSkills: opts.injectedSkills } : {}),
            ...(opts.teamSkillsDir !== undefined ? { teamSkillsDir: opts.teamSkillsDir } : {}),
            ...(opts.onSkillsResolved !== undefined
              ? { onSkillsResolved: opts.onSkillsResolved }
              : {}),
            worktreeSkillsDirs: piWorktreeSkillDirs(opts.cwd),
          },
          this.opts.onSkillsLog,
        ),
      ) ?? '',
  };

  constructor(private readonly opts: PiBackendOpts) {
    mkdirSync(opts.agentDir, { recursive: true });
    mkdirSync(opts.sessionDir, { recursive: true });
    for (const [key, value] of Object.entries(piUnattendedEnvPins(process.env))) {
      process.env[key] = value;
    }
    process.env.PI_CODING_AGENT_DIR = opts.agentDir;
  }

  async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, null);
  }

  async continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle> {
    const file = this.opts.resolveSessionFile?.(id) ?? null;
    if (!file || !existsSync(file)) {
      throw new SessionNotResumableError(id);
    }
    return this.open(opts, file);
  }

  adaptProviderCompat(provider: ProviderConfig, errorMessage: string): ProviderConfig | null {
    return adaptProviderCompat(provider, errorMessage);
  }

  private async open(opts: SessionOpts, resumeFile: string | null): Promise<AgentSessionHandle> {
    const modelsPath = join(this.opts.agentDir, 'models.json');
    materializeProvider(modelsPath, opts.provider);
    const authPath = join(this.opts.agentDir, 'auth.json');
    const runtime = await ModelRuntime.create({ authPath, modelsPath });
    if (opts.provider.apiKey) {
      await runtime.setRuntimeApiKey(opts.provider.providerId, opts.provider.apiKey);
    }
    const model = runtime.getModel(opts.provider.providerId, opts.modelId);
    if (!model) {
      throw new Error(`model ${opts.provider.providerId}/${opts.modelId} not found`);
    }
    const providerResponses: ProviderResponseSink = { current: null };
    const diagnosedFetch = wrapProviderFetch(globalThis.fetch, providerResponses);
    const streamSimple = runtime.streamSimple.bind(runtime);
    runtime.streamSimple = (requestModel, context, options) =>
      streamSimple(requestModel, context, { ...options, fetch: diagnosedFetch });
    const diagnose = (message: string): string =>
      enrichProviderError(message, providerResponses.current, {
        ...(this.opts.machineName !== undefined
          ? { machineName: this.opts.machineName }
          : { machineName: hostname() }),
        ...(opts.provider.baseUrl !== undefined ? { providerBaseUrl: opts.provider.baseUrl } : {}),
      });
    const settingsManager = daemonSettingsManager();
    const protectedPresent = detectTrustProtectedResources(opts.cwd);
    if (protectedPresent.length > 0) {
      this.opts.onTrustLog?.(
        `denied: ${protectedPresent.join(', ')} present in worktree — project trust is denied by policy, protected resources are not loaded (spec 26)`,
      );
    }
    const gateExtension: InlineExtension = {
      name: 'cairn-command-gate',
      factory: (pi) => {
        pi.on(
          'tool_call',
          gateToolCallHandler({
            ...(this.opts.gateRules ? { rules: this.opts.gateRules } : {}),
            ...(this.opts.onGateLog ? { log: this.opts.onGateLog } : {}),
          }),
        );
      },
    };
    const mcpEndpoints = opts.mcpServers ?? [];
    const onMcpLog = this.opts.onMcpLog;
    const mcpRegisterExtension: InlineExtension = {
      name: 'cairn-mcp-bridge',
      factory: (pi) => {
        for (const endpoint of mcpEndpoints) {
          try {
            pi.registerMcpServer(endpoint.slug, mcpServerConfig(endpoint));
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            onMcpLog?.(connectFailedLine(endpoint.slug, reason));
          }
        }
      },
    };
    const remoteTools = opts.remoteTools ?? [];
    const relay = opts.executeRemoteTool;
    const askRelay =
      relay !== undefined && remoteTools.some((t) => t.name === 'ask_user')
        ? (params: Record<string, unknown>) => relay('ask_user', params)
        : undefined;
    const mcpCaptureUi = headlessCaptureUi((message) => {
      for (const { slug, reason } of parseMcpAttentionMessage(message)) {
        onMcpLog?.(connectFailedLine(slug, reason));
      }
    }, askRelay);
    const loader = new DefaultResourceLoader({
      cwd: opts.cwd,
      agentDir: this.opts.agentDir,
      settingsManager,
      noSkills: true,
      ...(opts.systemPrompt !== undefined ? { systemPromptOverride: () => opts.systemPrompt } : {}),
      extensionFactories: [
        gateExtension,
        mcpRegisterExtension,
        createMcpExtension({ loadConfig: () => ({ servers: [], errors: [] }) }),
      ],
    });
    await loader.reload();
    const sessionManager = resumeFile
      ? SessionManager.open(resumeFile, this.opts.sessionDir, opts.cwd)
      : SessionManager.create(opts.cwd, this.opts.sessionDir);
    const customTools =
      remoteTools.length > 0 && relay
        ? remoteTools.map((def) =>
            defineTool({
              name: def.name,
              label: def.label ?? def.name,
              description: def.description,
              parameters: (def.parameters ?? { type: 'object', properties: {} }) as never,
              execute: async (_id: string, params: Record<string, unknown>) => {
                try {
                  const text = await relay(def.name, params ?? {});
                  return { content: [{ type: 'text' as const, text }], details: {} };
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  return {
                    content: [{ type: 'text' as const, text: `${def.name} rejected: ${msg}` }],
                    details: {},
                  };
                }
              },
            }),
          )
        : [];
    const localTools = (opts.localTools ?? []).map((def) =>
      defineTool({
        name: def.name,
        label: def.label ?? def.name,
        description: def.description,
        parameters: (def.parameters ?? { type: 'object', properties: {} }) as never,
        execute: async (_id: string, params: Record<string, unknown>) => {
          try {
            const text = await def.execute(params ?? {});
            return { content: [{ type: 'text' as const, text }], details: {} };
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            return {
              content: [{ type: 'text' as const, text: `${def.name} failed: ${msg}` }],
              details: {},
            };
          }
        },
      }),
    );
    const deniedSkills = collectDeniedSkillDirs(this.opts.skills, {
      ...(opts.skillsAllowlist !== undefined ? { skillsAllowlist: opts.skillsAllowlist } : {}),
      ...(opts.teamSkillsDir !== undefined ? { teamSkillsDir: opts.teamSkillsDir } : {}),
      worktreeSkillsDirs: piWorktreeSkillDirs(opts.cwd),
    });
    const gatedRead =
      deniedSkills.length > 0
        ? defineTool(
            createReadToolDefinition(opts.cwd, {
              operations: createSkillReadGate(deniedSkills, this.opts.onSkillsLog).operations,
            }),
          )
        : null;
    if (deniedSkills.length > 0) {
      this.opts.onSkillsLog?.(`deny: ${deniedSkills.length} skill dir(s) hard-blocked`);
    }
    const envBash =
      opts.env !== undefined
        ? defineTool(
            createBashToolDefinition(opts.cwd, {
              spawnHook: (ctx) => ({ ...ctx, env: { ...ctx.env, ...opts.env } }),
            }),
          )
        : null;
    const { session } = await createAgentSession({
      cwd: opts.cwd,
      agentDir: this.opts.agentDir,
      model,
      ...(opts.thinkingLevel !== undefined
        ? {
            thinkingLevel: opts.thinkingLevel as
              | 'off'
              | 'minimal'
              | 'low'
              | 'medium'
              | 'high'
              | 'xhigh'
              | 'max',
          }
        : {}),
      modelRuntime: runtime,
      resourceLoader: loader,
      sessionManager,
      settingsManager,
      tools: [
        ...sessionToolNames({
          readOnly: opts.readOnly === true,
          remoteTools: remoteTools.map((t) => t.name),
          mcpTools: [],
          localTools: localTools.map((t) => t.name),
        }),
        ...(mcpEndpoints.length > 0 ? [...MCP_TOOL_ALLOWLIST] : []),
      ],
      ...(gatedRead || envBash !== null || customTools.length > 0 || localTools.length > 0
        ? {
            customTools: [
              ...(gatedRead ? [gatedRead] : []),
              ...(envBash !== null ? [envBash] : []),
              ...customTools,
              ...localTools,
            ],
          }
        : {}),
    });
    await session.bindExtensions(
      mcpEndpoints.length > 0 || askRelay !== undefined ? { uiContext: mcpCaptureUi } : {},
    );
    this.opts.onSession?.(session.sessionId, session.sessionFile);
    const handle = new PiSessionHandle(session, model, diagnose);
    if (opts.prompt !== undefined) {
      const promptImages =
        opts.promptImages !== undefined && opts.promptImages.length > 0
          ? opts.promptImages
          : undefined;
      if (promptImages !== undefined) {
        ensureImageInput(model);
      }
      const sent =
        promptImages !== undefined
          ? session.prompt(opts.prompt, { images: toPiImages(promptImages) })
          : session.prompt(opts.prompt);
      void sent.catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        handle.emitBackendError(`session.prompt rejected: ${message}`);
      });
    }
    return handle;
  }
}

function mergedCompat(provider: ProviderConfig): ProviderCompat | undefined {
  const merged: ProviderCompat = {
    ...learnedCompat.get(provider.providerId),
    ...provider.compat,
  };
  const hasAny =
    merged.supportsDeveloperRole !== undefined ||
    merged.maxTokensField !== undefined ||
    merged.supportsStore !== undefined;
  return hasAny ? merged : undefined;
}

export function materializeProvider(modelsPath: string, provider: ProviderConfig): void {
  if (!provider.baseUrl) return;
  const serverCompatKey = JSON.stringify(provider.compat ?? null);
  if (
    lastServerCompat.has(provider.providerId) &&
    lastServerCompat.get(provider.providerId) !== serverCompatKey
  ) {
    learnedCompat.delete(provider.providerId);
  }
  lastServerCompat.set(provider.providerId, serverCompatKey);
  const raw = existsSync(modelsPath)
    ? (JSON.parse(readFileSync(modelsPath, 'utf8')) as {
        providers?: Record<string, Record<string, unknown>>;
      })
    : {};
  const providers = raw.providers ?? {};
  const compat = mergedCompat(provider);
  providers[provider.providerId] = {
    baseUrl: provider.baseUrl,
    api: provider.api ?? 'openai-completions',
    apiKey: MODELS_JSON_KEY_PLACEHOLDER,
    ...(provider.authHeader !== undefined ? { authHeader: provider.authHeader } : {}),
    ...(compat !== undefined ? { compat } : {}),
    models: (provider.models ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      ...CUSTOM_MODEL_DEFAULTS,
      ...(m.cost !== undefined ? { cost: m.cost } : {}),
      ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
      ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
      ...customModelReasoning(),
    })),
  };
  writeFileSync(modelsPath, `${JSON.stringify({ providers }, null, 2)}\n`, 'utf8');
}

export function createPiBackend(opts: PiBackendOpts): AgentBackend {
  return new PiBackend(opts);
}
