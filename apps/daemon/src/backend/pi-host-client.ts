import { spawn } from 'node:child_process';
import { mkdtempSync, realpathSync, rmdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type {
  AgentSessionHandle,
  AgentTokenUsage,
  DeliveredImage,
  SessionOpts,
  StepEvent,
} from '@cairn/shared';
import { ENV_VARS } from '@cairn/shared';
import { childEnv } from '../child-env.js';
import { stepCredentialRedactor } from '../credential-output.js';
import { ProcessTree, STEP_TREE_ENV } from '../process-tree.js';
import { stepCredentialStateDirs } from '../step-app-credential.js';
import type { Launch, SessionConfiner } from './confine-session.js';
import { EventQueue } from './event-queue.js';
import type { PiBackendOpts } from './pi.js';
import {
  childFrameSchema,
  FrameWriter,
  type ParentFrame,
  PI_HOST_PROTOCOL_VERSION,
  type PiHostLogChannel,
  PiHostProtocolError,
  parseFrame,
  readFrames,
} from './pi-host-protocol.js';

export function piHostEnv(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return childEnv({
    [ENV_VARS.piCacheRetention]: parent[ENV_VARS.piCacheRetention],
    [ENV_VARS.customModelReasoning]: parent[ENV_VARS.customModelReasoning],
    SSH_AUTH_SOCK: '',
    SSH_AGENT_PID: '',
  });
}

const START_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 10_000;
const KILL_TREE_GRACE_MS = 3_000;
const STDERR_TAIL_BYTES = 4096;

export interface PiHostOpen {
  backend: PiBackendOpts;
  confine: SessionConfiner;
  launch: Launch;
  opts: SessionOpts;
  resumeFile: string | null;
}

interface PendingSteer {
  resolve: () => void;
  reject: (error: Error) => void;
}

function removeIfEmpty(directory: string): void {
  try {
    rmdirSync(directory);
  } catch {}
}

class PiHostSession implements AgentSessionHandle {
  sessionId = '';
  sessionFile: string | undefined;
  readonly events: AsyncIterable<StepEvent>;
  private readonly queue = new EventQueue();
  private readonly steers = new Map<string, PendingSteer>();
  private readonly toolIds = new Set<string>();
  private readonly remoteNames: ReadonlySet<string>;
  private readonly localNames: ReadonlySet<string>;
  private readonly redact: <T>(value: T) => T;
  private latestUsage: AgentTokenUsage = [];
  private stderrTail = '';
  private nextSteer = 0;
  private closed = false;
  private stopping = false;
  private readyResolve!: () => void;
  private readyReject!: (error: Error) => void;
  readonly ready: Promise<void>;
  private closedResolve!: () => void;
  private readonly closedPromise: Promise<void>;
  private readonly writer: FrameWriter;
  private readonly child: ReturnType<typeof spawn>;
  private readonly tree: ProcessTree | null;
  private killingTree: Promise<void> | undefined;

  constructor(
    private readonly args: PiHostOpen,
    launch: Launch,
    private readonly privateDirectory: string,
    private readonly allowedFiles: readonly string[],
  ) {
    const { opts, backend } = args;
    this.events = this.queue.iterable();
    this.redact = stepCredentialRedactor(opts.secrets, opts.provider.apiKey);
    this.remoteNames = new Set((opts.remoteTools ?? []).map((tool) => tool.name));
    this.localNames = new Set((opts.localTools ?? []).map((tool) => tool.name));
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.closedPromise = new Promise<void>((resolve) => {
      this.closedResolve = resolve;
    });
    const treeMarker = opts.env?.[STEP_TREE_ENV];
    this.child = spawn(launch.command, launch.args, {
      cwd: opts.cwd,
      env: {
        ...piHostEnv(),
        ...(treeMarker !== undefined ? { [STEP_TREE_ENV]: treeMarker } : {}),
      },
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.tree =
      this.child.pid !== undefined && treeMarker !== undefined
        ? new ProcessTree(
            this.child.pid,
            { env: STEP_TREE_ENV, value: treeMarker },
            KILL_TREE_GRACE_MS,
          )
        : null;
    this.child.on('error', (error) => this.fail(`Pi host failed to start: ${error.message}`));
    this.child.on('exit', (code, signal) => {
      void this.killTree();
      if (!this.closed) {
        this.fail(
          `Pi host exited unexpectedly (${signal ?? `code ${code ?? 'unknown'}`})${this.stderrSuffix()}`,
        );
      }
      this.closedResolve();
    });
    const { stdin, stdout, stderr } = this.child;
    if (stdin === null || stdout === null || stderr === null) {
      void this.ready.catch(() => {});
      void this.killTree();
      throw new Error('Pi host has no stdio pipes');
    }
    this.writer = new FrameWriter(
      stdin,
      (chunk) => stdin.write(chunk),
      (error) => this.fail(error.message),
    );
    stderr.on('data', (data: Buffer) => {
      this.stderrTail = `${this.stderrTail}${data.toString('utf8')}`.slice(-STDERR_TAIL_BYTES);
    });
    stdin.on('error', () => {});
    readFrames(
      stdout,
      (line) => this.receive(line),
      (error) => {
        if (error !== null) this.fail(error.message);
        else if (!this.closed) this.fail(`Pi host closed its pipe${this.stderrSuffix()}`);
      },
    );
    const timer = setTimeout(
      () => this.fail('Pi host did not become ready in time'),
      START_TIMEOUT_MS,
    );
    timer.unref();
    void this.ready.then(
      () => clearTimeout(timer),
      () => clearTimeout(timer),
    );
    this.send({
      t: 'initialize',
      v: PI_HOST_PROTOCOL_VERSION,
      agentDir: backend.agentDir,
      sessionDir: this.privateDirectory,
      ...(backend.skills !== undefined ? { skills: backend.skills } : {}),
      ...(backend.machineName !== undefined ? { machineName: backend.machineName } : {}),
      resumeFile: args.resumeFile,
      session: serializableSession(opts),
    });
  }

  private stderrSuffix(): string {
    const tail = this.redact(this.stderrTail).trim();
    return tail === '' ? '' : `: ${tail}`;
  }

  private send(frame: ParentFrame): void {
    this.writer.send(frame);
  }

  private receive(line: string): void {
    if (this.closed) return;
    const frame = parseFrame(line, childFrameSchema);
    switch (frame.t) {
      case 'ready': {
        if (this.sessionId !== '') throw new PiHostProtocolError('pi host sent ready twice');
        this.checkSessionFile(frame.sessionFile);
        this.sessionId = frame.sessionId;
        this.sessionFile = frame.sessionFile;
        this.args.backend.onSession?.(frame.sessionId, frame.sessionFile);
        this.readyResolve();
        return;
      }
      case 'event':
        if (this.sessionId === '') throw new PiHostProtocolError('pi host sent an event early');
        this.queue.push((JSON.parse(line) as { event: StepEvent }).event);
        return;
      case 'usage':
        this.latestUsage = frame.usage;
        return;
      case 'log':
        this.log(frame.channel, this.redact(frame.message));
        return;
      case 'tool_request':
        this.runTool(frame.id, frame.kind, frame.name, frame.params);
        return;
      case 'steer_reply': {
        const pending = this.steers.get(frame.id);
        if (pending === undefined) throw new PiHostProtocolError('pi host replied to no steer');
        this.steers.delete(frame.id);
        if (frame.ok) pending.resolve();
        else pending.reject(new Error(this.redact(frame.error ?? 'steer failed')));
        return;
      }
      case 'ended':
        this.close();
        return;
      case 'fatal':
        this.fail(this.redact(frame.message));
        return;
    }
  }

  private checkSessionFile(file: string | undefined): void {
    if (file === undefined) return;
    const resolved = join(realpathSync(dirname(file)), basename(file));
    if (this.allowedFiles.includes(resolved)) return;
    if (dirname(resolved) === this.privateDirectory) return;
    throw new PiHostProtocolError('pi host reported a session file outside its private directory');
  }

  private log(channel: PiHostLogChannel, message: string): void {
    const { backend } = this.args;
    const handlers: Record<PiHostLogChannel, ((msg: string) => void) | undefined> = {
      mcp: backend.onMcpLog,
      skills: backend.onSkillsLog,
      gate: backend.onGateLog,
      trust: backend.onTrustLog,
      otel: backend.onOtelLog,
      compaction: backend.onCompactionLog,
    };
    handlers[channel]?.(message);
  }

  private runTool(
    id: string,
    kind: 'remote' | 'local',
    name: string,
    params: Record<string, unknown>,
  ): void {
    if (this.toolIds.has(id)) throw new PiHostProtocolError('pi host reused a tool request id');
    const { opts } = this.args;
    const declared = kind === 'remote' ? this.remoteNames : this.localNames;
    if (!declared.has(name)) throw new PiHostProtocolError('pi host requested an undeclared tool');
    const run =
      kind === 'remote'
        ? opts.executeRemoteTool?.(name, params)
        : opts.localTools?.find((tool) => tool.name === name)?.execute(params);
    if (run === undefined) throw new PiHostProtocolError('pi host requested an unavailable tool');
    this.toolIds.add(id);
    void run.then(
      (text) => this.reply({ t: 'tool_reply', id, ok: true, text }),
      (error: unknown) =>
        this.reply({
          t: 'tool_reply',
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  }

  private reply(frame: ParentFrame): void {
    if (this.closed) return;
    this.send(frame);
  }

  private fail(message: string): void {
    if (this.closed) return;
    const text = this.redact(message);
    if (this.sessionId === '') this.readyReject(new Error(text));
    else this.queue.push({ type: 'error', error: { message: text, retryable: false } });
    this.close(new Error(text));
  }

  private close(reason?: Error): void {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.steers.values())
      pending.reject(reason ?? new Error('Pi session closed before steer was consumed'));
    this.steers.clear();
    this.queue.end();
    void this.killTree();
    removeIfEmpty(this.privateDirectory);
    this.closedResolve();
  }

  private killTree(): Promise<void> {
    this.killingTree ??= this.tree === null ? Promise.resolve() : this.tree.kill().catch(() => {});
    return this.killingTree;
  }

  async steer(text: string, images?: readonly DeliveredImage[]): Promise<void> {
    if (this.closed || this.stopping) throw new Error('Pi session is closed or stopping');
    const id = `s${this.nextSteer++}`;
    return new Promise<void>((resolve, reject) => {
      this.steers.set(id, { resolve, reject });
      this.send({
        t: 'steer',
        id,
        text,
        ...(images !== undefined && images.length > 0
          ? { images: images.map(({ data, mimeType }) => ({ data, mimeType })) }
          : {}),
      });
    });
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.stopping = true;
    for (const pending of this.steers.values())
      pending.reject(new Error('Pi session stopped before steer was consumed'));
    this.steers.clear();
    this.send({ t: 'stop' });
    const timer = setTimeout(() => this.fail('Pi host did not stop in time'), STOP_TIMEOUT_MS);
    timer.unref();
    try {
      await this.closedPromise;
      await this.killTree();
    } finally {
      clearTimeout(timer);
    }
  }

  usage(): AgentTokenUsage {
    return this.latestUsage;
  }
}

function serializableSession(opts: SessionOpts) {
  return {
    cwd: opts.cwd,
    provider: opts.provider,
    modelId: opts.modelId,
    ...(opts.compactAt !== undefined ? { compactAt: opts.compactAt } : {}),
    ...(opts.thinkingLevel !== undefined ? { thinkingLevel: opts.thinkingLevel } : {}),
    ...(opts.systemPrompt !== undefined ? { systemPrompt: opts.systemPrompt } : {}),
    ...(opts.remoteTools !== undefined ? { remoteTools: opts.remoteTools } : {}),
    ...(opts.localTools !== undefined
      ? {
          localTools: opts.localTools.map(({ name, label, description, parameters }) => ({
            name,
            ...(label !== undefined ? { label } : {}),
            description,
            ...(parameters !== undefined ? { parameters } : {}),
          })),
        }
      : {}),
    ...(opts.mcpServers !== undefined ? { mcpServers: opts.mcpServers } : {}),
    ...(opts.skillsAllowlist !== undefined ? { skillsAllowlist: opts.skillsAllowlist } : {}),
    ...(opts.injectedSkills !== undefined ? { injectedSkills: opts.injectedSkills } : {}),
    ...(opts.teamSkillsDir !== undefined ? { teamSkillsDir: opts.teamSkillsDir } : {}),
    ...(opts.readOnly !== undefined ? { readOnly: opts.readOnly } : {}),
    ...(opts.remoteToolsOnly !== undefined ? { remoteToolsOnly: opts.remoteToolsOnly } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    ...(opts.secrets !== undefined
      ? { secrets: opts.secrets().filter((value): value is string => Boolean(value)) }
      : {}),
    ...(opts.telemetry !== undefined ? { telemetry: opts.telemetry } : {}),
    ...(opts.prompt !== undefined ? { prompt: opts.prompt } : {}),
    ...(opts.promptImages !== undefined
      ? {
          promptImages: opts.promptImages.map(({ data, mimeType }) => ({ data, mimeType })),
        }
      : {}),
  };
}

export async function openPiHostSession(args: PiHostOpen): Promise<AgentSessionHandle> {
  const privateDirectory = realpathSync(mkdtempSync(join(args.backend.sessionDir, 'host-')));
  let confined: Launch;
  let allowedFiles: string[] = [];
  try {
    allowedFiles =
      args.resumeFile !== null
        ? [join(realpathSync(dirname(args.resumeFile)), basename(args.resumeFile))]
        : [];
    confined = args.confine({ cwd: args.opts.cwd, env: args.opts.env ?? {} }, 'pi', args.launch, {
      state: [args.backend.agentDir, privateDirectory, ...allowedFiles],
      readable: stepCredentialStateDirs(args.opts.env),
    });
  } catch (error) {
    removeIfEmpty(privateDirectory);
    throw new Error(
      `Pi session confinement failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let session: PiHostSession;
  try {
    session = new PiHostSession(args, confined, privateDirectory, allowedFiles);
    await session.ready;
  } catch (error) {
    removeIfEmpty(privateDirectory);
    throw error;
  }
  return session;
}
