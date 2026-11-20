import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn,
} from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import {
  type ContentBlock,
  client,
  type LoadSessionResponse,
  type McpServer,
  methods,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ResumeSessionResponse,
  type SessionConfigOption,
  type SessionUpdate,
  type SetSessionConfigOptionResponse,
} from '@agentclientprotocol/sdk';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentSessionHandle,
  AgentTokenUsage,
  BriefBackendId,
  BriefChannel,
  DeliveredImage,
  ModelSourceModel,
  ModelUsage,
  ProviderConfig,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
} from '@cairn/shared';
import {
  AGENT_TODO_MAX_ITEMS,
  acpThoughtLevel,
  acpThoughtLevels,
  acpThoughtValue,
  CLAUDE_TODO_STATUS_STATES,
} from '@cairn/shared';
import { DAEMON_VERSION } from '../version.js';
import {
  type AcpToolCall,
  acpTurnPolicy,
  claudeAcpSessionMeta,
  decideAcpPermission,
  restrictiveAcpMode,
} from './acp-permission-gate.js';
import { type AcpStdioBridge, bridgeHttpMcpToStdio, openAcpTools } from './acp-tools.js';
import type { PermissionRule } from './command-gate.js';
import type { SessionConfiner } from './confine-session.js';
import { SessionNotResumableError } from './errors.js';
import { isLearnedNoVision, rememberNoVision } from './image-support.js';
import { runtimeChildEnv } from './otel.js';
import { withoutPinnedEnv } from './pinned-env.js';
import { appendSkillsCatalog, composeSkillsSection } from './skills.js';

const adapterProcessGroups = new Set<number>();

function terminateAdapterProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  if (signal === 'SIGKILL') adapterProcessGroups.delete(pid);
}

process.once('exit', () => {
  for (const pid of adapterProcessGroups) {
    try {
      terminateAdapterProcessGroup(pid, 'SIGKILL');
    } catch {}
  }
});

export const GEMINI_CAPABILITIES: AgentBackendCapabilities = {
  name: 'gemini',
  thinkingLevels: [],
  oauthProviders: [],
  compaction: false,
  sessionResume: false,
};

export interface GeminiSessionValidation {
  cwd: string;
  modelId: string;
  resumeId?: string;
  prompt?: string;
  promptImages?: readonly unknown[];
  imageCapability?: boolean;
}

export function validateGeminiSession(opts: GeminiSessionValidation): {
  prompt: string | undefined;
  resumeId: string | undefined;
} {
  if ((opts.promptImages?.length ?? 0) > 0 && !opts.imageCapability) {
    throw new Error('gemini ACP backend: image capability is not advertised');
  }
  return { prompt: opts.prompt, resumeId: opts.resumeId };
}

function advertisedDevinModels(
  option: SessionConfigOption,
  thoughtByModel: Record<string, readonly SessionConfigOption[]>,
): ModelSourceModel[] {
  if (option.type !== 'select') return [];
  const seen = new Set<string>();
  const models: ModelSourceModel[] = [];
  for (const entry of option.options) {
    const candidates = 'value' in entry ? [entry] : entry.options;
    for (const candidate of candidates) {
      if (candidate.value === '' || seen.has(candidate.value)) continue;
      seen.add(candidate.value);
      const options = thoughtByModel[candidate.value];
      models.push({
        id: candidate.value,
        name: candidate.name === '' ? candidate.value : candidate.name,
        ...(options === undefined ? {} : thoughtChoice(options)),
      });
    }
  }
  return models;
}

function isThoughtOption(option: SessionConfigOption): boolean {
  return (
    option.category === 'thought_level' || option.id === 'thought_level' || option.id === 'effort'
  );
}

function thoughtChoice(
  options: readonly SessionConfigOption[],
): Pick<ModelSourceModel, 'thinkingLevels' | 'thinkingDefault'> {
  const option = options.find(isThoughtOption);
  if (option === undefined) return { thinkingLevels: [] };
  const thinkingDefault = acpThoughtLevel(currentValueOf(option));
  const thinkingLevels = acpThoughtLevels(selectOptionValues(option));
  return thinkingDefault === undefined ? { thinkingLevels } : { thinkingLevels, thinkingDefault };
}

function currentValueOf(option: SessionConfigOption): string {
  return option.type === 'select' ? option.currentValue : '';
}

function selectOptionValues(option: SessionConfigOption): Set<string> {
  if (option.type !== 'select') return new Set();
  return new Set(
    option.options.flatMap((entry) =>
      'options' in entry ? entry.options.map((item) => item.value) : [entry.value],
    ),
  );
}

export function acpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/spawn agy .*ENOENT|\bagy\b.*not found/i.test(message)) {
    return 'Antigravity executable not found: install Google Antigravity (agy) on the Runner or enable managed install.';
  }
  if (
    /(antigravity|\bagy\b)/i.test(message) &&
    /authenticate|not logged in|login|unauthorized|api key|auth method/i.test(message)
  ) {
    return `Antigravity login failed: sign in to Antigravity on the Runner or enable a subscription with a token. ${message}`;
  }
  if (/spawn gemini .*ENOENT|gemini.*not found/i.test(message)) {
    return 'Gemini executable not found: install Gemini CLI with npm install -g @google/gemini-cli';
  }
  if (
    /authenticate|required|not logged in|login|api key is missing|auth method|GEMINI_API_KEY/i.test(
      message,
    )
  ) {
    return `Gemini login failed: run gemini and complete its login flow. ${message}`;
  }
  return message;
}

export function mapAcpUpdate(update: SessionUpdate | { kind: 'cancelled' }): StepEvent | null {
  if ('kind' in update)
    return { type: 'message_stop', message: { role: 'assistant', content: '' } };
  if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
    return { type: 'text_delta', text: update.content.text };
  }
  if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
    return {
      type: 'toolcall_end',
      call: {
        id: update.toolCallId,
        name: update.name ?? update.title ?? 'unknown',
        arguments: 'rawInput' in update ? (update.rawInput ?? {}) : {},
        ...(update.status === 'failed' ? { isError: true } : {}),
      },
    };
  }
  return null;
}

class AcpSession implements AgentSessionHandle {
  readonly sessionId: string;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue: StepEvent[] = [];
  private readonly waiters: Array<(result: IteratorResult<StepEvent>) => void> = [];
  private stopped = false;
  private readonly usageRows: ModelUsage[] = [];
  private promptStarted = false;
  private cancelled = false;
  private text = '';
  private readonly calls = new Map<string, ToolCallRecord>();
  private readonly toolOutputs = new Map<string, unknown>();
  private readonly rawCalls = new Map<string, AcpToolCall>();
  private cancelTimer: ReturnType<typeof setTimeout> | undefined;
  private midTurnPrompt: Promise<{ stopReason?: string }> | null = null;
  private readonly normalizer?: (update: SessionUpdate) => AcpUpdateNormalization;

  constructor(
    sessionId: string,
    private readonly connection: ReturnType<ReturnType<typeof client>['connect']>,
    private readonly prompt: string | undefined,
    private readonly images: readonly ContentBlock[],
    private readonly imageCapability: boolean,
    private readonly cleanup: () => void,
    private readonly adapter?: AcpBackendOptions,
    private readonly modelId = 'unknown',
  ) {
    this.sessionId = sessionId;
    this.normalizer = adapter?.createUpdateNormalizer?.();
    this.events = { [Symbol.asyncIterator]: () => this };
  }

  [Symbol.asyncIterator](): AsyncIterator<StepEvent> {
    return this;
  }

  async next(): Promise<IteratorResult<StepEvent>> {
    if (!this.promptStarted && !this.stopped) {
      this.promptStarted = true;
      void this.runPrompt();
    }
    const event = this.queue.shift();
    if (event !== undefined) return { done: false, value: event };
    if (this.stopped) return { done: true, value: undefined };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private push(event: StepEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value: event });
    else this.queue.push(event);
  }

  private async runPrompt(): Promise<void> {
    if (this.prompt === undefined) {
      this.finish();
      return;
    }
    try {
      let wait: Promise<{ stopReason?: string }> = this.connection.agent.request(
        methods.agent.session.prompt,
        {
          sessionId: this.sessionId,
          prompt: [{ type: 'text', text: this.prompt }, ...this.images],
        },
      );
      for (;;) {
        const result = await wait;
        if (result.stopReason === 'interrupted' && this.midTurnPrompt !== null) {
          if (this.text) {
            this.push({
              type: 'message_end',
              message: { role: 'assistant', content: this.text },
            });
            this.text = '';
          }
          wait = this.midTurnPrompt;
          this.midTurnPrompt = null;
          continue;
        }
        if (this.text)
          this.push({ type: 'message_end', message: { role: 'assistant', content: this.text } });
        if (this.adapter && result.stopReason === 'cancelled' && !this.cancelled) {
          throw new Error('ACP agent cancelled the prompt without a stop request');
        }
        if (this.cancelled || result.stopReason === 'cancelled') {
          this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
        } else if (result.stopReason === 'end_turn') {
          if (this.adapter && [...this.calls.values()].some((call) => call.result === undefined)) {
            throw new Error('ACP prompt completed with unfinished tool calls');
          }
          this.push({ type: 'done', usage: this.usageRows });
        } else
          this.push({
            type: 'error',
            error: {
              message: `${this.adapter?.harness ?? 'Gemini'} ACP stopped: ${result.stopReason}`,
              retryable: false,
            },
          });
        break;
      }
    } catch (error) {
      const message = this.adapter
        ? error instanceof Error
          ? error.message
          : String(error)
        : acpErrorMessage(error);
      if (this.cancelled) {
        this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
      } else this.push({ type: 'error', error: { message, retryable: false } });
    } finally {
      this.finish();
    }
  }

  private finish(): void {
    if (this.stopped) return;
    clearTimeout(this.cancelTimer);
    this.stopped = true;
    this.cleanup();
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  describeToolCall(requested: AcpToolCall): AcpToolCall {
    const merged: Record<string, unknown> = { ...this.rawCalls.get(requested.toolCallId) };
    for (const [key, value] of Object.entries(requested)) {
      if (value !== undefined && value !== null) merged[key] = value;
    }
    return merged as AcpToolCall;
  }

  recordRejection(toolCall: AcpToolCall, reason: string): void {
    if (this.stopped) return;
    const previous = this.calls.get(toolCall.toolCallId);
    const call: ToolCallRecord = {
      id: toolCall.toolCallId,
      name: toolCall.name ?? toolCall.title ?? previous?.name ?? 'unknown',
      arguments: toolCall.rawInput ?? previous?.arguments ?? {},
      result: reason,
      isError: true,
      ...(previous?.parent !== undefined ? { parent: previous.parent } : {}),
    };
    this.calls.set(call.id, call);
    this.push({ type: 'toolcall_end', call });
  }

  onAcpUpdate(raw: SessionUpdate): void {
    if (raw.sessionUpdate === 'tool_call' || raw.sessionUpdate === 'tool_call_update') {
      const kept: Record<string, unknown> = { ...this.rawCalls.get(raw.toolCallId) };
      for (const [key, value] of Object.entries(raw)) {
        if (key !== 'sessionUpdate' && value !== undefined && value !== null) kept[key] = value;
      }
      this.rawCalls.set(raw.toolCallId, kept as AcpToolCall);
    }
    if (this.stopped || (this.adapter && !this.promptStarted)) return;
    let update = raw;
    let parent: string | undefined;
    if (this.normalizer !== undefined) {
      const normalized = this.normalizer(update);
      if (normalized.update === null) return;
      update = normalized.update;
      parent = normalized.parent;
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
      this.text += update.content.text;
    if (update.sessionUpdate === 'usage_update' && this.adapter?.usageEvents === true) {
      const meta = update._meta as Record<string, unknown> | undefined;
      const num = (key: string) => {
        const value = meta?.[`cognition.ai/${key}`];
        return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
      };
      this.usageRows.splice(0, this.usageRows.length, {
        model: this.modelId,
        input: num('inputTokens') || update.used,
        output: num('outputTokens'),
        cacheRead: num('cachedReadTokens'),
        cacheWrite: num('cachedWriteTokens'),
        contextWindow: update.size,
      });
      this.push({ type: 'usage', usage: [...this.usageRows] });
      return;
    }
    if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text') {
      this.push({ type: 'thinking_delta', text: update.content.text });
    } else if (
      update.sessionUpdate === 'tool_call' ||
      update.sessionUpdate === 'tool_call_update'
    ) {
      const previous = this.calls.get(update.toolCallId);
      const call: ToolCallRecord = {
        id: update.toolCallId,
        name: update.name ?? update.title ?? previous?.name ?? 'unknown',
        arguments: update.rawInput ?? previous?.arguments ?? {},
        ...(previous?.result !== undefined ? { result: previous.result } : {}),
        ...(update.content != null ? { result: update.content } : {}),
        ...(update.status === 'failed' || update.status === 'completed'
          ? { isError: update.status === 'failed' }
          : {}),
        ...(parent !== undefined || previous?.parent !== undefined
          ? { parent: parent ?? previous?.parent }
          : {}),
      };
      if (this.adapter) {
        if (update.rawOutput != null) this.toolOutputs.set(call.id, update.rawOutput);
        else if (update.content != null) this.toolOutputs.set(call.id, update.content);
        const terminal =
          update.status === 'completed' ||
          update.status === 'failed' ||
          previous?.isError !== undefined;
        if (terminal) {
          call.result = this.toolOutputs.get(call.id) ?? previous?.result ?? '';
          call.isError =
            update.status === 'failed' ||
            (update.status !== 'completed' && previous?.isError === true);
        } else delete call.result;
        this.calls.set(call.id, call);
        if (
          JSON.stringify(call) !== JSON.stringify(previous) &&
          (!previous ||
            terminal ||
            update.rawInput != null ||
            update.name != null ||
            update.title != null)
        ) {
          this.push({ type: 'toolcall_end', call });
        }
      } else {
        this.calls.set(call.id, call);
        this.push({ type: 'toolcall_end', call });
      }
    } else if (update.sessionUpdate === 'plan') {
      const todo = update.entries.flatMap((entry) => {
        const state = CLAUDE_TODO_STATUS_STATES[entry.status];
        return entry.content.trim() !== '' && state !== undefined
          ? [{ text: entry.content.trim(), state }]
          : [];
      });
      this.push({
        type: 'toolcall_end',
        call: {
          id: `plan-${randomUUID()}`,
          name: 'plan',
          arguments: { entries: update.entries },
          result: '',
          isError: false,
          todo: todo.slice(0, AGENT_TODO_MAX_ITEMS),
        },
      });
    } else {
      const event = mapAcpUpdate(update);
      if (event) this.push(event);
    }
  }

  get acceptingPermissions(): boolean {
    return this.promptStarted && !this.stopped && !this.cancelled;
  }

  async steer(text: string, images: readonly DeliveredImage[] = []): Promise<void> {
    if (this.adapter && this.adapter.steering !== 'mid-turn')
      throw new Error('ACP steer is unsupported during a step');
    if (images.length > 0 && !this.imageCapability) {
      throw new Error(
        `${this.adapter?.harness ?? 'gemini'} ACP backend: image capability is not advertised`,
      );
    }
    const prompt = {
      sessionId: this.sessionId,
      prompt: [
        { type: 'text', text },
        ...images.map((image) => ({ type: 'image' as const, ...image })),
      ],
    };
    if (this.adapter?.steering === 'mid-turn') {
      const request = this.connection.agent.request<{ stopReason?: string }>(
        methods.agent.session.prompt,
        prompt,
      );
      request.catch(() => {});
      this.midTurnPrompt = request;
      return;
    }
    await this.connection.agent.request(methods.agent.session.prompt, prompt);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.cancelled = true;
    if (this.adapter) {
      if (!this.promptStarted) {
        this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
        this.finish();
        return;
      }
      this.cancelTimer ??= setTimeout(
        () => this.connection.close(new Error('ACP cancellation timed out')),
        this.adapter.cancelTimeoutMs ?? 2_000,
      );
      this.cancelTimer.unref();
    }
    await this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
  }

  usage(): AgentTokenUsage {
    return this.usageRows;
  }
}

export interface AcpGateOptions {
  rules?: readonly PermissionRule[];
  log?: (message: string) => void;
}

export interface GeminiBackendOptions {
  gate?: AcpGateOptions;
  executablePath?: string;
  confine?: SessionConfiner;
  permissions?: 'deny' | 'allow-once';
  skills?: { skillsDir: string; cwd: string };
  onSkillsLog?: (msg: string) => void;
  spawnProcess?: (
    command: string,
    args: string[],
    options: SpawnOptionsWithoutStdio,
  ) => Pick<ChildProcessWithoutNullStreams, 'stdin' | 'stdout' | 'stderr'> &
    Pick<ChildProcess, 'once' | 'kill' | 'pid'>;
}

class AcpBackend implements AgentBackend {
  private readonly imageSupport = new Map<string, boolean>();
  readonly capabilities: AgentBackendCapabilities;
  readonly brief?: BriefChannel;

  constructor(
    private readonly options: GeminiBackendOptions & { adapter?: AcpBackendOptions } = {},
  ) {
    const adapter = options.adapter;
    this.capabilities = adapter
      ? {
          ...GEMINI_CAPABILITIES,
          name: `${adapter.harness}-acp`,
          steering: adapter.steering === 'mid-turn',
          sessionResume: adapter.sessionResume === true,
        }
      : GEMINI_CAPABILITIES;
    const skills = options.skills ?? adapter?.skills;
    const onSkillsLog = options.onSkillsLog ?? adapter?.onSkillsLog;
    const briefId: BriefBackendId | null = !adapter
      ? 'gemini'
      : adapter.harness === 'devin' ||
          adapter.harness === 'claude-code' ||
          adapter.harness === 'antigravity'
        ? adapter.harness
        : null;
    if (briefId !== null) {
      this.brief = {
        backendId: briefId,
        composeBody: (sessionOpts, base) =>
          appendSkillsCatalog(
            base,
            composeSkillsSection(
              skills,
              {
                ...(sessionOpts.skillsAllowlist !== undefined
                  ? { skillsAllowlist: sessionOpts.skillsAllowlist }
                  : {}),
                ...(sessionOpts.injectedSkills !== undefined
                  ? { injectedSkills: sessionOpts.injectedSkills }
                  : {}),
                ...(sessionOpts.teamSkillsDir !== undefined
                  ? { teamSkillsDir: sessionOpts.teamSkillsDir }
                  : {}),
                ...(sessionOpts.onSkillsResolved !== undefined
                  ? { onSkillsResolved: sessionOpts.onSkillsResolved }
                  : {}),
              },
              onSkillsLog,
            ),
          ) ?? '',
      };
    }
  }

  async modelSupportsImages(provider: ProviderConfig, modelId: string): Promise<boolean | null> {
    if (isLearnedNoVision(provider.providerId, modelId)) return false;
    return this.imageSupport.get(`${provider.providerId}/${modelId}`) ?? null;
  }

  rememberNoVision(provider: ProviderConfig, modelId: string): void {
    rememberNoVision(provider.providerId, modelId);
  }

  async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, undefined);
  }

  async continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, id);
  }

  private async open(opts: SessionOpts, resumeId: string | undefined): Promise<AgentSessionHandle> {
    const adapter = this.options.adapter;
    if (
      adapter &&
      opts.mcpServers !== undefined &&
      adapter.allowHostMcp !== true &&
      opts.remoteToolsOnly !== true
    )
      throw new Error(
        'ACP mcpServers policy is unsupported: adapter host MCP configuration is not isolated',
      );
    const policy = acpTurnPolicy(opts);
    const hostToolNames = [...(opts.remoteTools ?? []), ...(opts.localTools ?? [])].map(
      (tool) => tool.name,
    );
    const validated = validateGeminiSession({
      cwd: opts.cwd,
      modelId: opts.modelId,
      ...(resumeId !== undefined ? { resumeId } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    });
    const hostTools = await openAcpTools(opts);
    const mcpBridges: AcpStdioBridge[] = [];
    const spawnProcess = this.options.spawnProcess ?? spawn;
    let child: ReturnType<NonNullable<GeminiBackendOptions['spawnProcess']>>;
    try {
      const launch = {
        command: adapter?.command ?? this.options.executablePath ?? 'gemini',
        args: adapter ? (adapter.args ?? []) : ['--acp'],
      };
      const confined =
        this.options.confine?.(opts, adapter ? adapter.harness : 'gemini', launch) ?? launch;
      const childEnv: NodeJS.ProcessEnv = { ...withoutPinnedEnv(process.env), ...opts.env };
      if (adapter?.harness === 'devin') {
        for (const key of Object.keys(childEnv)) {
          if (key.startsWith('CHISEL_') || key.startsWith('DEVIN_')) delete childEnv[key];
        }
      }
      child = spawnProcess(confined.command, confined.args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        ...(adapter && process.platform !== 'win32' ? { detached: true } : {}),
        env: runtimeChildEnv(childEnv),
      });
    } catch (error) {
      hostTools?.close();
      throw error;
    }
    const groupPid = adapter && process.platform !== 'win32' ? child.pid : undefined;
    if (groupPid !== undefined) adapterProcessGroups.add(groupPid);
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    const app = client({ name: 'cairn' });
    const gateOptions = this.options.gate;
    app.onRequest(methods.client.session.requestPermission, ({ params }) => {
      const accepting =
        session?.acceptingPermissions === true && params.sessionId === session.sessionId;
      const toolCall = session ? session.describeToolCall(params.toolCall) : params.toolCall;
      const decision = accepting
        ? decideAcpPermission({
            policy,
            toolCall,
            hostToolNames,
            normal: {
              mode: adapter
                ? (adapter.permissions ?? 'deny')
                : (this.options.permissions ?? 'gate'),
              ...(gateOptions?.rules ? { rules: gateOptions.rules } : {}),
            },
          })
        : {
            allow: false,
            reason: 'Cairn permission gate rejected: the session is not accepting permissions',
          };
      const allow = decision.allow;
      if (!allow) {
        session?.recordRejection(toolCall, decision.reason);
        gateOptions?.log?.(`reject: policy=${policy} ${decision.reason}`);
      }
      const option = params.options
        .filter((value) => value.optionId !== 'plan_bypass')
        .find((value) => value.kind === (allow ? 'allow_once' : 'reject_once'));
      return {
        outcome: option
          ? { outcome: 'selected', optionId: option.optionId }
          : { outcome: 'cancelled' },
      };
    });
    let session: AcpSession | null = null;
    app.onNotification(methods.client.session.update, ({ params }) => {
      if (session && (!adapter || params.sessionId === session.sessionId))
        session.onAcpUpdate(params.update);
    });
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    child.once('error', (error) => connection.close(error));
    child.once('exit', (code) =>
      connection.close(
        new Error(`${adapter?.harness ?? 'Gemini'} ACP exited (${code}): ${stderr}`),
      ),
    );
    let exited = false;
    let cleanedUp = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    child.once('close', () => {
      exited = true;
      if (groupPid === undefined) clearTimeout(killTimer);
    });
    const terminate = (signal: NodeJS.Signals) => {
      if (groupPid !== undefined) {
        try {
          terminateAdapterProcessGroup(groupPid, signal);
        } catch {
          child.kill(signal);
        }
      } else if (!exited) child.kill(signal);
    };
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      hostTools?.close();
      for (const bridge of mcpBridges) bridge.close();
      mcpBridges.length = 0;
      connection.close();
      terminate('SIGTERM');
      if (adapter && (groupPid !== undefined || !exited)) {
        killTimer = setTimeout(() => terminate('SIGKILL'), 1_000);
      }
    };
    const initializeTimer = adapter
      ? setTimeout(
          () => connection.close(new Error('ACP initialization timed out')),
          adapter.initializeTimeoutMs ?? 30_000,
        )
      : undefined;
    initializeTimer?.unref();
    let agentVersion: number | string = 'unavailable';
    try {
      const initialized = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
        clientInfo: { name: 'cairn', version: DAEMON_VERSION },
      });
      agentVersion = initialized.protocolVersion;
      if (agentVersion !== PROTOCOL_VERSION) throw new Error('Protocol version mismatch');
      const caps = initialized.agentCapabilities;
      this.imageSupport.set(
        `${opts.provider.providerId}/${opts.modelId}`,
        caps?.promptCapabilities?.image === true,
      );
      if (adapter) {
        if ((opts.promptImages?.length ?? 0) > 0 && !caps?.promptCapabilities?.image) {
          throw new Error(`${adapter.harness} ACP backend: image capability is not advertised`);
        }
      } else
        validateGeminiSession({
          ...opts,
          imageCapability: caps?.promptCapabilities?.image === true,
        });
      if (adapter && resumeId && !caps?.sessionCapabilities?.resume && !caps?.loadSession) {
        throw new Error('ACP resume is unsupported by this adapter');
      }
      const isRestricted = policy !== 'normal' || opts.lockedDown === true;
      const externalMcpAllowed = (!adapter || adapter.allowHostMcp === true) && !isRestricted;
      const externalMcpServers: McpServer[] = [];
      if (externalMcpAllowed) {
        for (const endpoint of opts.mcpServers ?? []) {
          if (endpoint.transport === 'http' && endpoint.url !== undefined) {
            if (caps?.mcpCapabilities?.http === true) {
              externalMcpServers.push({
                type: 'http',
                name: endpoint.slug,
                url: endpoint.url,
                headers: Object.entries(endpoint.headers ?? {}).map(([name, value]) => ({
                  name,
                  value,
                })),
              });
            } else {
              const bridge = await bridgeHttpMcpToStdio(endpoint);
              mcpBridges.push(bridge);
              externalMcpServers.push(bridge.declaration);
            }
          } else if (endpoint.transport === 'stdio' && endpoint.command !== undefined) {
            externalMcpServers.push({
              name: endpoint.slug,
              command: endpoint.command,
              args: endpoint.args ?? [],
              env: Object.entries(endpoint.env ?? {}).map(([name, value]) => ({
                name,
                value,
              })),
            });
          }
        }
      }
      const sessionMeta =
        adapter?.harness === 'claude-code' ? claudeAcpSessionMeta(policy) : undefined;
      const request = {
        cwd: opts.cwd,
        ...(sessionMeta !== undefined ? { _meta: sessionMeta } : {}),
        mcpServers: [...externalMcpServers, ...(hostTools ? [hostTools.declaration] : [])],
      };
      const response = resumeId
        ? await (async () => {
            try {
              if (caps?.sessionCapabilities?.resume)
                return await connection.agent.request<ResumeSessionResponse>(
                  methods.agent.session.resume,
                  { ...request, sessionId: resumeId },
                );
              if (caps?.loadSession)
                return await connection.agent.request<LoadSessionResponse>(
                  methods.agent.session.load,
                  { ...request, sessionId: resumeId },
                );
            } catch (error) {
              throw new SessionNotResumableError(
                resumeId,
                error instanceof Error ? error.message : String(error),
              );
            }
            throw new SessionNotResumableError(resumeId);
          })()
        : await connection.agent.request<NewSessionResponse>(methods.agent.session.new, request);
      const sessionId =
        'sessionId' in response && typeof response.sessionId === 'string'
          ? response.sessionId
          : resumeId;
      if (!sessionId) throw new Error(`${adapter?.harness ?? 'Gemini'} ACP returned no sessionId`);
      const modelOption = response.configOptions?.find((option) => option.category === 'model');
      let configOptions = response.configOptions ?? [];
      if (modelOption) {
        const selected = await connection.agent.request<SetSessionConfigOptionResponse>(
          methods.agent.session.setConfigOption,
          { sessionId, configId: modelOption.id, value: opts.modelId },
        );
        configOptions = selected.configOptions ?? [];
        if (adapter?.harness === 'devin') {
          const models = advertisedDevinModels(modelOption, {
            [currentValueOf(modelOption)]: response.configOptions ?? [],
            [opts.modelId]: configOptions,
          });
          if (models.length > 0) adapter.onDevinModels?.(models);
        }
      } else if (adapter) {
        throw new Error('ACP adapter did not advertise model configuration');
      } else {
        process.stderr.write(
          `Gemini ACP: no model configuration advertised; using the CLI default instead of ${opts.modelId}\n`,
        );
      }
      const thinkingOption = configOptions.find(isThoughtOption);
      const thinkingValue =
        opts.thinkingLevel === undefined || thinkingOption === undefined
          ? undefined
          : acpThoughtValue(opts.thinkingLevel, selectOptionValues(thinkingOption));
      if (thinkingOption !== undefined && thinkingValue !== undefined) {
        await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: thinkingOption.id,
          value: thinkingValue,
        });
      }
      const modes = 'modes' in response ? response.modes : null;
      if (policy !== 'normal') {
        if (modes) {
          const target = restrictiveAcpMode(modes);
          if (target !== null) {
            await connection.agent.request(methods.agent.session.setMode, {
              sessionId,
              modeId: target,
            });
          }
        } else if (adapter?.harness === 'devin') {
          throw new Error(
            `${adapter.harness} ACP did not report its modes: refusing a locked turn (fail-closed)`,
          );
        }
      }
      if (adapter?.harness === 'devin' && policy === 'normal' && !isRestricted) {
        if (!modes?.availableModes.some((mode) => mode.id === 'bypass'))
          throw new Error('Devin ACP did not offer bypass mode for unattended steps');
        await connection.agent.request(methods.agent.session.setMode, {
          sessionId,
          modeId: 'bypass',
        });
      }
      if (adapter?.harness === 'antigravity') {
        const modes = 'modes' in response ? response.modes : null;
        if (modes !== null && modes !== undefined) {
          const preferred = !isRestricted
            ? (modes.availableModes.find((mode) => mode.id === 'auto') ??
              modes.availableModes.find((mode) => mode.id === 'accept-edits'))
            : (modes.availableModes.find((mode) => mode.id === 'plan') ??
              modes.availableModes.find((mode) => mode.id === 'default'));
          if (preferred !== undefined && modes.currentModeId !== preferred.id) {
            await connection.agent.request(methods.agent.session.setMode, {
              sessionId,
              modeId: preferred.id,
            });
          }
        }
      }
      session = new AcpSession(
        sessionId,
        connection,
        opts.systemPrompt && validated.prompt !== undefined
          ? `${opts.systemPrompt}\n\n${validated.prompt}`
          : validated.prompt,
        (opts.promptImages ?? []).map((image) => ({ type: 'image', ...image })),
        caps?.promptCapabilities?.image === true,
        cleanup,
        adapter,
        opts.modelId,
      );
      return session;
    } catch (error) {
      cleanup();
      const message = error instanceof Error ? error.message : String(error);
      const mapped = adapter ? message : acpErrorMessage(error);
      throw new Error(
        mapped !== message
          ? mapped
          : `ACP initialize failed (protocolVersion client=${PROTOCOL_VERSION}, agent=${agentVersion}): ${message}`,
      );
    } finally {
      clearTimeout(initializeTimer);
    }
  }
}

export class GeminiBackend extends AcpBackend {}

export function createGeminiBackend(options?: GeminiBackendOptions): AgentBackend {
  return new GeminiBackend(options);
}

export interface AcpUpdateNormalization {
  update: SessionUpdate | null;
  parent?: string;
}

export interface AcpBackendOptions {
  confine?: SessionConfiner;
  harness: 'claude-code' | 'devin' | 'antigravity';
  command: string;
  args?: string[];
  permissions?: 'deny' | 'allow-once';
  gate?: AcpGateOptions;
  steering?: 'mid-turn';
  sessionResume?: boolean;
  allowHostMcp?: boolean;
  usageEvents?: boolean;
  skills?: { skillsDir: string; cwd: string };
  onSkillsLog?: (msg: string) => void;
  onDevinModels?: (models: ModelSourceModel[]) => void;
  createUpdateNormalizer?: () => (update: SessionUpdate) => AcpUpdateNormalization;
  initializeTimeoutMs?: number;
  cancelTimeoutMs?: number;
  spawnProcess?: GeminiBackendOptions['spawnProcess'];
}

export function createAcpBackend(options: AcpBackendOptions): AgentBackend {
  return new AcpBackend({
    adapter: options,
    ...(options.gate ? { gate: options.gate } : {}),
    ...(options.confine ? { confine: options.confine } : {}),
    ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
  });
}
