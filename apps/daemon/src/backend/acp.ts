import {
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
  spawn,
} from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  type ContentBlock,
  client,
  type LoadSessionResponse,
  methods,
  type NewSessionResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type ResumeSessionResponse,
  type SessionUpdate,
} from '@agentclientprotocol/sdk';
import type {
  AgentBackend,
  AgentBackendCapabilities,
  AgentSessionHandle,
  AgentTokenUsage,
  BriefChannel,
  DeliveredImage,
  ProviderConfig,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
} from '@cairn/shared';
import { z } from 'zod';
import { DAEMON_VERSION } from '../version.js';
import { openAcpTools } from './acp-tools.js';
import { isLearnedNoVision, rememberNoVision } from './image-support.js';

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
  remoteTools?: readonly unknown[];
  localTools?: readonly unknown[];
}

export function validateGeminiSession(opts: GeminiSessionValidation): {
  prompt: string | undefined;
  resumeId: string | undefined;
} {
  if ((opts.remoteTools?.length ?? 0) > 0 || (opts.localTools?.length ?? 0) > 0) {
    throw new Error('gemini ACP backend: remoteTools and localTools are unsupported (fail-closed)');
  }
  if ((opts.promptImages?.length ?? 0) > 0 && !opts.imageCapability) {
    throw new Error('gemini ACP backend: image capability is not advertised');
  }
  return { prompt: opts.prompt, resumeId: opts.resumeId };
}

export function acpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
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
  private readonly usageRows: AgentTokenUsage = [];
  private promptStarted = false;
  private cancelled = false;
  private text = '';
  private readonly calls = new Map<string, ToolCallRecord>();
  private readonly toolOutputs = new Map<string, unknown>();
  private cancelTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    sessionId: string,
    private readonly connection: ReturnType<ReturnType<typeof client>['connect']>,
    private readonly prompt: string | undefined,
    private readonly images: readonly ContentBlock[],
    private readonly imageCapability: boolean,
    private readonly cleanup: () => void,
    private readonly adapter?: AcpBackendOptions,
  ) {
    this.sessionId = sessionId;
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
      const result = await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: this.prompt }, ...this.images],
      });
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
        this.push({ type: 'done', usage: [] });
      } else
        this.push({
          type: 'error',
          error: {
            message: `${this.adapter?.harness ?? 'Gemini'} ACP stopped: ${result.stopReason}`,
            retryable: false,
          },
        });
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

  onAcpUpdate(update: SessionUpdate): void {
    if (this.stopped || (this.adapter && !this.promptStarted)) return;
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
      this.text += update.content.text;
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
    } else {
      const event = mapAcpUpdate(update);
      if (event) this.push(event);
    }
  }

  get acceptingPermissions(): boolean {
    return this.promptStarted && !this.stopped && !this.cancelled;
  }

  async steer(text: string, images: readonly DeliveredImage[] = []): Promise<void> {
    if (this.adapter) throw new Error('ACP steer is unsupported during a step');
    if (images.length > 0 && !this.imageCapability) {
      throw new Error('gemini ACP backend: image capability is not advertised');
    }
    await this.connection.agent.request(methods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt: [
        { type: 'text', text },
        ...images.map((image) => ({ type: 'image' as const, ...image })),
      ],
    });
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

export interface GeminiBackendOptions {
  executablePath?: string;
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
    this.capabilities = options.adapter
      ? { ...GEMINI_CAPABILITIES, name: `${options.adapter.harness}-acp` }
      : GEMINI_CAPABILITIES;
    if (!options.adapter) {
      this.brief = { backendId: 'gemini', composeBody: (_opts, base) => base ?? '' };
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
      (opts.readOnly ||
        opts.remoteToolsOnly ||
        opts.skillsAllowlist !== undefined ||
        (opts.injectedSkills?.length ?? 0) > 0 ||
        (opts.tools?.length ?? 0) > 0 ||
        (opts.mcpServers?.length ?? 0) > 0 ||
        (opts.thinkingLevel !== undefined && opts.thinkingLevel !== 'off'))
    )
      throw new Error('ACP session policy or host tools are unsupported (fail-closed)');
    const validated = validateGeminiSession({
      cwd: opts.cwd,
      modelId: opts.modelId,
      ...(resumeId !== undefined ? { resumeId } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),

      ...(!adapter && opts.remoteTools !== undefined ? { remoteTools: opts.remoteTools } : {}),
      ...(!adapter && opts.localTools !== undefined ? { localTools: opts.localTools } : {}),
    });
    const hostTools = adapter ? await openAcpTools(opts) : null;
    const spawnProcess = this.options.spawnProcess ?? spawn;
    let child: ReturnType<NonNullable<GeminiBackendOptions['spawnProcess']>>;
    try {
      child = spawnProcess(
        adapter?.command ?? this.options.executablePath ?? 'gemini',
        adapter ? (adapter.args ?? []) : ['--acp'],
        {
          cwd: opts.cwd,
          stdio: ['pipe', 'pipe', 'pipe'],
          ...(adapter && process.platform !== 'win32' ? { detached: true } : {}),
          env: { ...process.env, ...opts.env },
        },
      );
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
    app.onRequest(methods.client.session.requestPermission, ({ params }) => {
      const allow =
        adapter?.permissions === 'allow-once' &&
        session?.acceptingPermissions &&
        params.sessionId === session.sessionId;
      const option = params.options.find(
        (value) => value.kind === (allow ? 'allow_once' : 'reject_once'),
      );
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
      if (hostTools && !caps?.mcpCapabilities?.http)
        throw new Error('ACP adapter does not support HTTP host tools');
      if (adapter && resumeId && !caps?.sessionCapabilities?.resume && !caps?.loadSession) {
        throw new Error('ACP resume is unsupported by this adapter');
      }
      const request = { cwd: opts.cwd, mcpServers: hostTools ? [hostTools.declaration] : [] };
      const response = resumeId
        ? caps?.sessionCapabilities?.resume
          ? await connection.agent.request<ResumeSessionResponse>(methods.agent.session.resume, {
              ...request,
              sessionId: resumeId,
            })
          : caps?.loadSession
            ? await connection.agent.request<LoadSessionResponse>(methods.agent.session.load, {
                ...request,
                sessionId: resumeId,
              })
            : await connection.agent.request<NewSessionResponse>(methods.agent.session.new, request)
        : await connection.agent.request<NewSessionResponse>(methods.agent.session.new, request);
      const sessionId =
        'sessionId' in response && typeof response.sessionId === 'string'
          ? response.sessionId
          : resumeId;
      if (!sessionId) throw new Error(`${adapter?.harness ?? 'Gemini'} ACP returned no sessionId`);
      const modelOption = response.configOptions?.find((option) => option.category === 'model');
      if (modelOption) {
        await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: modelOption.id,
          value: opts.modelId,
        });
      } else if (adapter) {
        throw new Error('ACP adapter did not advertise model configuration');
      } else {
        process.stderr.write(
          `Gemini ACP: no model configuration advertised; using the CLI default instead of ${opts.modelId}\n`,
        );
      }
      session = new AcpSession(
        sessionId,
        connection,
        adapter && opts.systemPrompt && validated.prompt !== undefined
          ? `${opts.systemPrompt}\n\n${validated.prompt}`
          : validated.prompt,
        (opts.promptImages ?? []).map((image) => ({ type: 'image', ...image })),
        caps?.promptCapabilities?.image === true,
        cleanup,
        adapter,
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

export interface AcpBackendOptions {
  harness: 'claude-code' | 'codex';
  command: string;
  args?: string[];
  permissions?: 'deny' | 'allow-once';
  initializeTimeoutMs?: number;
  cancelTimeoutMs?: number;
  spawnProcess?: GeminiBackendOptions['spawnProcess'];
}

export function createAcpBackend(options: AcpBackendOptions): AgentBackend {
  return new AcpBackend({
    adapter: options,
    ...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
  });
}

export function configuredAcpBackends(raw: string | undefined): Map<string, AgentBackend> {
  if (!raw) return new Map();
  const configuration = z
    .record(
      z.string().min(1),
      z
        .object({
          harness: z.enum(['claude-code', 'codex']),
          command: z.string().min(1),
          args: z.array(z.string()).optional(),
          permissions: z.enum(['deny', 'allow-once']).optional(),
        })
        .strict(),
    )
    .parse(JSON.parse(raw));
  return new Map(
    Object.entries(configuration).map(([id, options]) => [id, createAcpBackend(options)]),
  );
}
