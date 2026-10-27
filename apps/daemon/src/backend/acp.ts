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
  ProviderConfig,
  SessionOpts,
  StepEvent,
  ToolCallRecord,
} from '@cairn/shared';
import { DAEMON_VERSION } from '../version.js';

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

class GeminiSession implements AgentSessionHandle {
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

  constructor(
    sessionId: string,
    private readonly connection: ReturnType<ReturnType<typeof client>['connect']>,
    private readonly prompt: string | undefined,
    private readonly images: readonly ContentBlock[],
    private readonly cleanup: () => void,
  ) {
    this.sessionId = sessionId;
    this.events = { [Symbol.asyncIterator]: () => this };
  }

  [Symbol.asyncIterator](): AsyncIterator<StepEvent> {
    return this;
  }

  async next(): Promise<IteratorResult<StepEvent>> {
    if (!this.promptStarted) {
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
      if (this.cancelled || result.stopReason === 'cancelled') {
        this.push({ type: 'message_stop', message: { role: 'assistant', content: this.text } });
      } else if (result.stopReason === 'end_turn') this.push({ type: 'done', usage: [] });
      else
        this.push({
          type: 'error',
          error: { message: `Gemini ACP stopped: ${result.stopReason}`, retryable: false },
        });
    } catch (error) {
      const message = acpErrorMessage(error);
      if (this.cancelled) {
        const stopped = mapAcpUpdate({ kind: 'cancelled' });
        if (stopped !== null) this.push(stopped);
      } else this.push({ type: 'error', error: { message, retryable: false } });
    } finally {
      this.finish();
    }
  }

  private finish(): void {
    this.stopped = true;
    this.cleanup();
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  onAcpUpdate(update: SessionUpdate): void {
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
      this.calls.set(call.id, call);
      this.push({ type: 'toolcall_end', call });
    } else {
      const event = mapAcpUpdate(update);
      if (event) this.push(event);
    }
  }

  async steer(text: string): Promise<void> {
    await this.connection.agent.request(methods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.cancelled = true;
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
    Pick<ChildProcess, 'once' | 'kill'>;
}

export class GeminiBackend implements AgentBackend {
  readonly capabilities = GEMINI_CAPABILITIES;
  readonly brief: BriefChannel = {
    backendId: 'gemini',
    composeBody: (_opts, base) => base ?? '',
  };

  constructor(private readonly options: GeminiBackendOptions = {}) {}

  async modelSupportsImages(_provider: ProviderConfig, _modelId: string): Promise<boolean | null> {
    return false;
  }

  async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, undefined);
  }

  async continueSession(id: string, opts: SessionOpts): Promise<AgentSessionHandle> {
    return this.open(opts, id);
  }

  private async open(opts: SessionOpts, resumeId: string | undefined): Promise<AgentSessionHandle> {
    const validated = validateGeminiSession({
      cwd: opts.cwd,
      modelId: opts.modelId,
      ...(resumeId !== undefined ? { resumeId } : {}),
      ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),

      ...(opts.remoteTools !== undefined ? { remoteTools: opts.remoteTools } : {}),
      ...(opts.localTools !== undefined ? { localTools: opts.localTools } : {}),
    });
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess(this.options.executablePath ?? 'gemini', ['--acp'], {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...opts.env },
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-8192);
    });
    const app = client({ name: 'cairn' });
    app.onRequest(methods.client.session.requestPermission, ({ params }) => {
      const option = params.options.find((value) => value.kind === 'reject_once');
      return {
        outcome: option
          ? { outcome: 'selected', optionId: option.optionId }
          : { outcome: 'cancelled' },
      };
    });
    let session: GeminiSession | null = null;
    app.onNotification(methods.client.session.update, ({ params }) =>
      session?.onAcpUpdate(params.update),
    );
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    );
    const connection = app.connect(stream);
    child.once('error', (error) => connection.close(error));
    child.once('exit', (code) =>
      connection.close(new Error(`Gemini ACP exited (${code}): ${stderr}`)),
    );
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
      validateGeminiSession({ ...opts, imageCapability: caps?.promptCapabilities?.image === true });
      const request = { cwd: opts.cwd, mcpServers: [] };
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
      if (!sessionId) throw new Error('Gemini ACP returned no sessionId');
      const modelOption = response.configOptions?.find((option) => option.category === 'model');
      if (modelOption) {
        await connection.agent.request(methods.agent.session.setConfigOption, {
          sessionId,
          configId: modelOption.id,
          value: opts.modelId,
        });
      } else {
        process.stderr.write(
          `Gemini ACP: no model configuration advertised; using the CLI default instead of ${opts.modelId}\n`,
        );
      }
      session = new GeminiSession(
        sessionId,
        connection,
        validated.prompt,
        (opts.promptImages ?? []).map((image) => ({ type: 'image', ...image })),
        () => {
          connection.close();
          child.kill();
        },
      );
      return session;
    } catch (error) {
      connection.close();
      child.kill();
      const message = error instanceof Error ? error.message : String(error);
      const mapped = acpErrorMessage(error);
      throw new Error(
        mapped !== message
          ? mapped
          : `ACP initialize failed (protocolVersion client=${PROTOCOL_VERSION}, agent=${agentVersion}): ${message}`,
      );
    }
  }
}

export function createGeminiBackend(options?: GeminiBackendOptions): AgentBackend {
  return new GeminiBackend(options);
}
