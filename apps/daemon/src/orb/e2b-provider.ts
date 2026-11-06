import type { Duplex } from 'node:stream';
import { defaultOrbDistSource, orbDistRelease } from './dist.js';
import { E2bStdioStream } from './e2b-stream.js';
import { assertOrbMachineName, orbMachineName } from './names.js';
import { ORB_RELAY_TOKEN_ENV, orbReleaseKeySchema } from './protocol.js';
import {
  type OrbCommandRunner,
  type OrbHandle,
  type OrbProvider,
  type OrbRelayStreamRequest,
  orbNote,
  runOrbCommand,
} from './provider.js';

export const E2B_DEFAULT_SESSION_MS = 3_600_000;
export const E2B_MIN_SESSION_MS = 60_000;
export const E2B_MAX_SESSION_MS = 86_400_000;
export const E2B_CLAUDE_BIN = '/usr/bin/claude';
export const E2B_STALE_RELEASE_EXIT = 75;

const SESSION_LIMIT_SLACK_MS = 10_000;
const STDERR_TAIL_CHARS = 500;

export interface E2bCommandExit {
  exitCode: number;
  timedOut: boolean;
  error?: string;
}

export interface E2bCommand {
  sendStdin(data: Uint8Array): Promise<void>;
  closeStdin(): Promise<void>;
  kill(): Promise<void>;
  readonly exited: Promise<E2bCommandExit>;
}

export interface E2bSandbox {
  readonly id: string;
  exec(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  start(
    command: string,
    options: {
      envs: Record<string, string>;
      onStdout: (chunk: string) => void;
      onStderr: (chunk: string) => void;
    },
  ): Promise<E2bCommand>;
  kill(): Promise<void>;
}

export interface E2bClient {
  create(options: {
    template: string;
    timeoutMs: number;
    metadata: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<E2bSandbox>;
}

export interface E2bOrbProviderOptions {
  client: E2bClient;
  template: string;
  sessionTimeoutMs?: number;
  runner?: OrbCommandRunner;
  distSource?: string;
  now?: () => number;
}

interface LiveSandbox {
  sandbox: E2bSandbox;
  deadline: number;
}

function releaseEntry(release: string): string {
  return `"$HOME/cairn-orb/releases/${orbReleaseKeySchema.parse(release)}/dist/cli.mjs"`;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class E2bOrbProvider implements OrbProvider {
  readonly kind = 'orb';
  private readonly handles = new Map<string, OrbHandle>();
  private readonly pending = new Map<string, Promise<OrbHandle>>();
  private readonly live = new Map<string, LiveSandbox>();
  private readonly client: E2bClient;
  private readonly template: string;
  private readonly sessionTimeoutMs: number;
  private readonly runner: OrbCommandRunner;
  private readonly distSource: string;
  private readonly now: () => number;

  constructor(options: E2bOrbProviderOptions) {
    this.client = options.client;
    this.template = options.template;
    this.sessionTimeoutMs = options.sessionTimeoutMs ?? E2B_DEFAULT_SESSION_MS;
    if (
      !Number.isInteger(this.sessionTimeoutMs) ||
      this.sessionTimeoutMs < E2B_MIN_SESSION_MS ||
      this.sessionTimeoutMs > E2B_MAX_SESSION_MS
    )
      throw new Error(
        `E2B session timeout must be an integer between ${E2B_MIN_SESSION_MS} and ${E2B_MAX_SESSION_MS} ms`,
      );
    this.runner = options.runner ?? runOrbCommand;
    this.distSource = options.distSource ?? defaultOrbDistSource();
    this.now = options.now ?? Date.now;
  }

  ensure(input: { conversationId: string; projectId: string }): Promise<OrbHandle> {
    const pending = this.pending.get(input.conversationId);
    if (pending) return pending;
    const operation = this.register(input).finally(() => this.pending.delete(input.conversationId));
    this.pending.set(input.conversationId, operation);
    return operation;
  }

  private async register(input: { conversationId: string; projectId: string }): Promise<OrbHandle> {
    let handle = this.handles.get(input.conversationId);
    if (!handle) {
      handle = {
        ...input,
        id: orbMachineName(input.conversationId),
        running: false,
        lastUsedAt: this.now(),
        notes: [],
      };
      this.handles.set(input.conversationId, handle);
    }
    return handle;
  }

  async prepare(handle: OrbHandle): Promise<string> {
    this.validate(handle);
    handle.expectedReleaseKey = (await orbDistRelease(this.distSource, this.runner)).key;
    return `e2b:${handle.id}`;
  }

  async start(handle: OrbHandle, options: { signal?: AbortSignal } = {}): Promise<void> {
    this.validate(handle);
    options.signal?.throwIfAborted();
    if (handle.running && this.live.has(handle.id)) return;
    const release = orbReleaseKeySchema.parse(handle.expectedReleaseKey);
    handle.running = false;
    handle.releaseKey = undefined;
    handle.notes.push(orbNote('orb: setup'));
    let sandbox: E2bSandbox;
    try {
      sandbox = await this.client.create({
        template: this.template,
        timeoutMs: this.sessionTimeoutMs,
        metadata: { cairnOrb: handle.id },
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      options.signal?.throwIfAborted();
      throw new Error(`E2B sandbox creation failed: ${describe(error)}`, { cause: error });
    }
    const live = { sandbox, deadline: this.now() + this.sessionTimeoutMs };
    this.live.set(handle.id, live);
    handle.running = true;
    try {
      options.signal?.throwIfAborted();
      await this.requireInstalled(
        sandbox,
        `test -f ${releaseEntry(release)}`,
        `E2B template "${this.template}" has no cairn release ${release}; rebuild the template from this daemon version`,
      );
      await this.requireInstalled(
        sandbox,
        `test -x ${E2B_CLAUDE_BIN}`,
        `E2B template "${this.template}" has no ${E2B_CLAUDE_BIN}`,
      );
      options.signal?.throwIfAborted();
    } catch (error) {
      await this.stop(handle).catch(() => {});
      throw error;
    }
  }

  private async requireInstalled(
    sandbox: E2bSandbox,
    command: string,
    message: string,
  ): Promise<void> {
    const result = await sandbox.exec(command);
    if (result.exitCode !== 0) throw new Error(message);
  }

  async openRelayStream(handle: OrbHandle, request: OrbRelayStreamRequest): Promise<Duplex> {
    this.validate(handle);
    const live = this.live.get(handle.id);
    if (!live) throw new Error('E2B sandbox is not running');
    request.signal.throwIfAborted();
    const release = orbReleaseKeySchema.parse(handle.expectedReleaseKey);
    const stream = new E2bStdioStream();
    let stderr = '';
    const command = await live.sandbox.start(`node ${releaseEntry(release)} orb-step --stdio`, {
      envs: { CAIRN_ORB: '1', [ORB_RELAY_TOKEN_ENV]: request.token },
      onStdout: (chunk) => stream.receive(chunk),
      onStderr: (chunk) => {
        stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS);
      },
    });
    stream.bind(command);
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true });
    void command.exited.then(async (exit) => {
      const failure = this.exitFailure(handle, live, exit, stderr);
      if (failure) request.onFailure(failure);
      stream.finish(failure);
      if (this.live.get(handle.id) !== live) return;
      await this.stop(handle).catch((error: unknown) => {
        handle.notes.push(orbNote(`orb: sandbox kill failed: ${describe(error)}`));
      });
    });
    return stream;
  }

  private exitFailure(
    handle: OrbHandle,
    live: LiveSandbox,
    exit: E2bCommandExit,
    stderr: string,
  ): Error | undefined {
    if (
      exit.timedOut ||
      (exit.exitCode !== 0 && this.now() >= live.deadline - SESSION_LIMIT_SLACK_MS)
    )
      return new Error(
        `E2B sandbox session limit of ${Math.round(this.sessionTimeoutMs / 60_000)} minutes reached; the step was stopped (Hobby plans allow 60 minutes, set CAIRN_E2B_TIMEOUT_MS up to your plan limit)`,
      );
    if (exit.exitCode === E2B_STALE_RELEASE_EXIT)
      return new Error(
        `Orb worker refused: stale-release (E2B template "${this.template}" runs a different cairn release than ${handle.expectedReleaseKey})`,
      );
    if (exit.exitCode !== 0) {
      const detail = (exit.error ?? stderr).trim();
      return new Error(
        `E2B worker exited with code ${exit.exitCode}${detail ? `: ${detail}` : ''}`,
      );
    }
    return undefined;
  }

  authenticateRelease(handle: OrbHandle, release: string): void {
    this.validate(handle);
    orbReleaseKeySchema.parse(release);
    if (release !== handle.expectedReleaseKey)
      throw new Error('Orb authenticated release does not match published release');
    handle.releaseKey = release;
  }

  async stop(handle: OrbHandle): Promise<void> {
    this.validate(handle);
    const live = this.live.get(handle.id);
    if (live) {
      await live.sandbox.kill();
      this.live.delete(handle.id);
    }
    if (!handle.running) return;
    handle.running = false;
    handle.notes.push(orbNote('orb: stopped'));
  }

  async destroy(handle: OrbHandle): Promise<void> {
    await this.stop(handle);
    this.handles.delete(handle.conversationId);
  }

  async list(): Promise<OrbHandle[]> {
    return [...this.handles.values()];
  }

  touch(handle: OrbHandle, now: number): void {
    handle.lastUsedAt = now;
  }

  private validate(handle: OrbHandle): void {
    assertOrbMachineName(handle.id);
  }
}
