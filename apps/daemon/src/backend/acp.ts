import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import {
  client,
  methods,
  ndJsonStream,
  PROTOCOL_VERSION,
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
} from '@cairn/shared';
import { DAEMON_VERSION } from '../version.js';

export const GEMINI_CAPABILITIES: AgentBackendCapabilities = {
  name: 'gemini',
  thinkingLevels: [],
  oauthProviders: [],
  compaction: false,
  sessionResume: true,
};

export interface GeminiSessionValidation {
  cwd: string;
  modelId: string;
  resumeId?: string;
  prompt?: string;
  promptImages?: readonly unknown[];
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
  if ((opts.promptImages?.length ?? 0) > 0) {
    throw new Error('gemini ACP backend: image capability is not advertised');
  }
  return { prompt: opts.resumeId === undefined ? opts.prompt : undefined, resumeId: opts.resumeId };
}

export function acpErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/spawn gemini .*ENOENT|gemini.*not found/i.test(message)) {
    return '未找到 gemini 可执行文件，请先安装 Gemini CLI';
  }
  if (/authenticate|required|not logged in|login/i.test(message)) {
    return `Gemini 登录失败，请按 Gemini CLI 的登录提示完成登录：${message}`;
  }
  return message;
}

export function mapAcpUpdate(update: SessionUpdate | { kind: 'cancelled' }): StepEvent | null {
  if ('kind' in update) return { type: 'message_stop' } as StepEvent;
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

  constructor(
    sessionId: string,
    private readonly connection: ReturnType<ReturnType<typeof client>['connect']>,
    private readonly prompt: string | undefined,
    private readonly onUpdate: (update: SessionUpdate) => void,
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
    if (this.prompt === undefined) return;
    try {
      await this.connection.agent.request(methods.agent.session.prompt, {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: this.prompt }],
      });
      this.push({ type: 'done', usage: [] });
    } catch (error) {
      const message = acpErrorMessage(error);
      if (/cancel|abort/i.test(message)) {
        const stopped = mapAcpUpdate({ kind: 'cancelled' });
        if (stopped !== null) this.push(stopped);
      } else this.push({ type: 'error', error: { message, retryable: false } });
    } finally {
      this.stopped = true;
      for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
    }
  }

  onAcpUpdate(update: SessionUpdate): void {
    const event = mapAcpUpdate(update);
    if (event) this.push(event);
    this.onUpdate(update);
  }

  async steer(text: string): Promise<void> {
    await this.connection.agent.request(methods.agent.session.prompt, {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    await this.connection.agent.notify(methods.agent.session.cancel, { sessionId: this.sessionId });
    this.connection.close();
  }

  usage(): AgentTokenUsage {
    return this.usageRows;
  }
}

export interface GeminiBackendOptions {
  executablePath?: string;
  spawnProcess?: typeof spawn;
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
      ...(opts.promptImages !== undefined ? { promptImages: opts.promptImages } : {}),
      ...(opts.remoteTools !== undefined ? { remoteTools: opts.remoteTools } : {}),
      ...(opts.localTools !== undefined ? { localTools: opts.localTools } : {}),
    });
    const spawnProcess = this.options.spawnProcess ?? spawn;
    const child = spawnProcess(this.options.executablePath ?? 'gemini', ['--experimental-acp'], {
      cwd: opts.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: process.env,
    }) as ChildProcessWithoutNullStreams;
    const app = client({ name: 'cairn' });
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
    try {
      await connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, session: {} },
        clientInfo: { name: 'cairn', version: DAEMON_VERSION },
      });
      const response = resumeId
        ? await connection.agent.request(methods.agent.session.load, {
            sessionId: resumeId,
            cwd: opts.cwd,
          })
        : await connection.agent.request(methods.agent.session.new, { cwd: opts.cwd });
      const sessionId = (response as { sessionId?: string } | undefined)?.sessionId ?? resumeId;
      if (!sessionId) throw new Error('Gemini ACP returned no sessionId');
      session = new GeminiSession(sessionId, connection, validated.prompt, () => undefined);
      return session;
    } catch (error) {
      child.kill();
      const message = error instanceof Error ? error.message : String(error);
      const mapped = acpErrorMessage(error);
      throw new Error(
        mapped !== message
          ? mapped
          : `ACP initialize failed (protocolVersion client=${PROTOCOL_VERSION}, agent=${message})`,
      );
    }
  }
}

export function createGeminiBackend(options?: GeminiBackendOptions): AgentBackend {
  return new GeminiBackend(options);
}
