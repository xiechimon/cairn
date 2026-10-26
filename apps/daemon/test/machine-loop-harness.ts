import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineAttachmentResponse,
  MachineCapabilities,
  MachineDoneBody,
  MachineStreamEvent,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import type { ClaudeCodeAuthProbe } from '../src/claude-code-auth.js';
import { loadDaemonConfig } from '../src/config.js';
import { type DaemonLogger, formatLine } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runMachine } from '../src/machine-loop.js';
import { ensureStateDirs, type StatePaths, saveMachineJson, statePaths } from '../src/state.js';

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), 'cairn-loop-'));
}

function captureLogger(): { logger: DaemonLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (prefix: string | undefined, msg: string) =>
    lines.push(formatLine(prefix ? { prefix, msg } : { msg }));
  const logger: DaemonLogger = {
    raw: (msg) => push(undefined, msg),
    prefixed: (prefix, msg) => push(prefix, msg),
    supervisor: (msg) => push('supervisor', msg),
    machine: (msg) => push('machine', msg),
    step: (msg) => push('step', msg),
    workspace: (msg) => push('workspace', msg),
    recover: (msg) => push('recover', msg),
    wake: (msg) => push('wake', msg),
    mcp: (msg) => push('mcp', msg),
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
  };
  return { logger, lines };
}

export const CLAIMED: ClaimedStep = {
  step: { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
  conversationId: 'conv-1',
  session: { action: 'new', sessionId: null },
  todo: { id: 't1', seqNum: 3, title: '探针任务', spec: '写一行探针' },
  project: { id: 'p1', name: 'demo', repo: null },
  agent: {
    id: 'a1',
    displayName: 'stub-builder',
    description: '职责说明',
    provider: 'stub-gw',
    modelId: 'stub-model',
    thinkingLevel: null,
  },
};

export class FakeMachineApi implements MachineApi {
  claimQueue: (ClaimedStep | Error)[] = [];
  parked: ((v: ClaimedStep | null) => void) | null = null;
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: { url: string; body: TranscriptUpload }[] = [];
  toolCalls: { stepId: string; call: ToolCallRecord }[] = [];
  recoverSteps: {
    id: string;
    buildId: string;
    kind: 'plan' | 'build' | 'merge';
    machineId: string | null;
    createdAt: number;
  }[] = [];
  failClaims = 0;
  steerResponse: string | null = null;
  attachments: Record<string, MachineAttachmentResponse | Error> = {};
  attachmentCalls: string[] = [];
  stopResponse: boolean | null = null;
  onStreamEvent: ((ev: MachineStreamEvent) => void) | null = null;
  claimCalls = 0;
  claimBodies: unknown[] = [];

  enrollBodies: unknown[] = [];
  presenceBodies: unknown[] = [];
  mePatch: Record<string, unknown> = {};

  async enroll(body: { teamId: string; apiKey: string; name?: string; claudeCode?: unknown }) {
    this.calls.push(`enroll:${body.teamId}`);
    this.enrollBodies.push(body);
    return {
      machineId: 'm1',
      token: 'a'.repeat(64),
      teamId: body.teamId,
      serverUrl: 'http://server',
    };
  }
  async me() {
    return {
      id: 'm1',
      name: 'n',
      teamId: 't1',
      online: true,
      latestCliVersion: null,
      kind: 'remote' as const,
      enabledRuntimes: [],
      ...this.mePatch,
    };
  }
  async presence(body?: { cliVersion?: string; claudeCode?: unknown }) {
    this.calls.push('presence');
    this.presenceBodies.push(body);
  }
  async recover() {
    this.calls.push('recover');
    return { steps: this.recoverSteps };
  }
  async claim(signal?: AbortSignal, body?: unknown): Promise<ClaimedStep | null> {
    this.claimCalls += 1;
    if (body !== undefined) this.claimBodies.push(body);
    if (this.failClaims > 0) {
      this.failClaims -= 1;
      throw new Error('network down');
    }
    const next = this.claimQueue.shift();
    if (next instanceof Error) throw next;
    if (next) return next;
    return new Promise<ClaimedStep | null>((resolve, reject) => {
      this.parked = (v) => {
        this.parked = null;
        resolve(v);
      };
      signal?.addEventListener('abort', () => {
        this.parked = null;
        reject(new Error('aborted'));
      });
    });
  }
  async heartbeat(stepId: string) {
    this.calls.push(`heartbeat:${stepId}`);
  }
  async tool(stepId: string, call: ToolCallRecord) {
    this.toolCalls.push({ stepId, call });
  }
  async transcriptDelta(stepId: string, text: string) {
    this.calls.push(`transcriptDelta:${stepId}:${text.length}`);
  }
  async relayTool(stepId: string, name: string, params: Record<string, unknown>) {
    this.calls.push(`relayTool:${stepId}:${name}`);
    void params;
    return '{}';
  }
  async token(stepId: string) {
    this.calls.push(`token:${stepId}`);
    return {
      provider: {
        kind: 'http' as const,
        providerId: 'stub-gw',
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions' as const,
        authHeader: true,
        models: [{ id: 'stub-model', name: 'stub-model' }],
      },
      secrets: {},
      git: null,
    };
  }
  async skillsManifest() {
    return { selection: 'whitelist' as const, skills: [] };
  }
  async skillFile(): Promise<Buffer> {
    throw new Error('unexpected skillFile call');
  }
  async uploadUrls(stepId: string) {
    this.calls.push(`upload-urls:${stepId}`);
    return {
      uploads: [
        { name: 'transcript.json', url: 'http://server/up/1', method: 'PUT' as const, headers: {} },
      ],
    };
  }
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload) {
    this.uploads.push({ url, body });
  }
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
    this.calls.push(`done:${stepId}:${body.status}`);
  }
  async stream(signal: AbortSignal, onEvent: unknown, onConnected?: () => void) {
    this.onStreamEvent = onEvent as (ev: MachineStreamEvent) => void;
    onConnected?.();
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve());
    });
  }
  async steer(stepId: string) {
    this.calls.push(`steer:${stepId}`);
    return this.steerResponse;
  }
  async steerAck(stepId: string) {
    this.calls.push(`steer-ack:${stepId}`);
  }
  async attachment(stepId: string, attachmentId: string): Promise<MachineAttachmentResponse> {
    this.attachmentCalls.push(`${stepId}:${attachmentId}`);
    const hit = this.attachments[attachmentId];
    if (hit === undefined) throw new Error(`machine api 404: attachment ${attachmentId}`);
    if (hit instanceof Error) throw hit;
    return hit;
  }
  async stop(stepId: string) {
    this.calls.push(`stop:${stepId}`);
    return this.stopResponse;
  }
  async syncResult(syncId: string, body: { status: string; errorMessage?: string }) {
    this.calls.push(`syncResult:${syncId}:${body.status}`);
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
}

export function fakeBackend(events: StepEvent[], sessionId = 'pi-sess-1') {
  const created: { opts: unknown; continued: string | null }[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      created.push({ opts, continued: null });
      return handle(sessionId, events);
    },
    async continueSession(id, opts) {
      created.push({ opts, continued: id });
      return handle(id, events);
    },
  };
  return { backend, created };
}

function handle(sessionId: string, events: StepEvent[]): AgentSessionHandle {
  return {
    sessionId,
    events: (async function* gen() {
      for (const ev of events) yield ev;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  };
}

export async function boot(opts: {
  api?: FakeMachineApi;
  backend?: AgentBackend;
  claudeCodeBackend?: AgentBackend;
  claudeCodeAuthProbe?: () => Promise<ClaudeCodeAuthProbe>;
  readClaudeOauthExpiresAt?: () => number | null;
  presenceIntervalMs?: number;
  capabilitiesProbe?: () => MachineCapabilities;
  withMachineJson?: boolean;
  preEnrolled?: { serverUrl: string };
  seedJournal?: (paths: StatePaths) => void;
  capEnv?: NodeJS.ProcessEnv;
  otel?: import('../src/backend/otel.js').DaemonOtel | null;
}) {
  const home = tmpHome();
  const { logger, lines } = captureLogger();
  const config = loadDaemonConfig(
    {
      serverUrl: 'http://server',
      apiKey: 'cairn_k',
      teamId: 'team-1',
      home,
      name: 'test-mbp',
    },
    {},
  );
  const paths = statePaths(home, config.workspacesDir);
  opts.seedJournal?.(paths);
  if (opts.preEnrolled) {
    ensureStateDirs(paths);
    saveMachineJson(paths, {
      machineId: 'm-old',
      token: 'b'.repeat(64),
      teamId: 'team-1',
      serverUrl: opts.preEnrolled.serverUrl,
    });
  }
  const api = opts.api ?? new FakeMachineApi();
  const handle = await runMachine({
    config,
    paths,
    logger,
    client: api,
    backend: opts.backend ?? fakeBackend([]).backend,
    claudeCodeBackend: opts.claudeCodeBackend,
    claudeCodeAuthProbe:
      opts.claudeCodeAuthProbe ??
      (async () => ({ state: 'logged-in', method: 'oauth_token', provider: 'firstParty' })),
    readClaudeOauthExpiresAt: opts.readClaudeOauthExpiresAt ?? (() => null),
    ...(opts.capabilitiesProbe !== undefined ? { capabilitiesProbe: opts.capabilitiesProbe } : {}),
    idleSleepPrevention: false,
    presenceIntervalMs: opts.presenceIntervalMs ?? 60_000,
    claimBackoffBaseMs: 10,
    proxyEnv: {},
    ...(opts.capEnv !== undefined ? { capEnv: opts.capEnv } : {}),
    ...(opts.otel !== undefined ? { otel: opts.otel } : {}),
  });
  return { handle, api, lines, paths, home };
}

export function defer<T = void>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve: (v: T) => void = () => {};
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

export async function waitFor(fn: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timeout');
}
