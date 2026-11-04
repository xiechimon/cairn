import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineAttachmentResponse,
  SessionOpts,
  TranscriptUpload,
} from '@cairn/shared';
import { formatAttachmentToken } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function captureLogger(): { logger: DaemonLogger; lines: string[] } {
  const lines: string[] = [];
  const push = (prefix: string | undefined, msg: string) =>
    lines.push(prefix ? `[${prefix}] ${msg}` : msg);
  const logger: DaemonLogger = {
    raw: (msg) => push(undefined, msg),
    prefixed: (prefix, msg) => push(prefix, msg),
    supervisor: (msg) => push('supervisor', msg),
    machine: (msg) => push('machine', msg),
    step: (msg) => push('step', msg),
    workspace: (msg) => push('workspace', msg),
    recover: (msg) => push('recover', msg),
    wake: (msg) => push('wake', msg),
    skills: (msg) => push('skills', msg),
    gate: (msg) => push('gate', msg),
    trust: (msg) => push('trust', msg),
    mcp: (msg) => push('mcp', msg),
  };
  return { logger, lines };
}

class FakeClient implements MachineApi {
  attachmentCalls: string[] = [];
  attachments: Record<string, MachineAttachmentResponse | Error> = {};

  async enroll(): Promise<never> {
    throw new Error('unused');
  }
  async me(): Promise<never> {
    throw new Error('unused');
  }
  async presence() {}
  async recover() {
    return { steps: [] };
  }
  async claim() {
    return null;
  }
  async heartbeat() {}
  async tool() {}
  async transcriptDelta() {}
  async relayTool() {
    return '{}';
  }
  async token() {
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
  async attachment(stepId: string, attachmentId: string) {
    this.attachmentCalls.push(`${stepId}:${attachmentId}`);
    const hit = this.attachments[attachmentId];
    if (hit === undefined) throw new Error(`machine api 404: attachment ${attachmentId}`);
    if (hit instanceof Error) throw hit;
    return hit;
  }
  async uploadUrls(_stepId: string, files: { name: string }[]) {
    return {
      uploads: files.map((f, i) => ({
        name: f.name,
        url: `http://server/up/${i}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  transcripts: TranscriptUpload[] = [];
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload) {
    this.transcripts.push(body);
  }
  async done() {}
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult() {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream() {}
}

function recordedBackend(): { backend: AgentBackend; seen: SessionOpts[] } {
  const seen: SessionOpts[] = [];
  return {
    seen,
    backend: {
      capabilities: PI_CAPABILITIES,
      async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
        seen.push(opts);
        return {
          sessionId: 'sess-img',
          events: (async function* () {
            yield { type: 'done', usage: [] } as never;
          })(),
          async steer() {},
          async stop() {},
          usage: () => [],
        };
      },
      async continueSession(): Promise<never> {
        throw new Error('unused');
      },
    },
  };
}

function claimed(spec: string, opts: { kind?: 'build' | 'chief' } = {}): ClaimedStep {
  const kind = opts.kind ?? 'build';
  return {
    step: { id: 's1', buildId: 'conv-1', kind, machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    ...(kind === 'build'
      ? { todo: { id: 't1', seqNum: 1, title: '图片任务', spec } }
      : { instruction: spec }),
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

async function setup(claim: ClaimedStep, client: FakeClient) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-img-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const journal = new StepJournal(paths.outboxDir);
  const { backend, seen } = recordedBackend();
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claim);
  return { seen, lines, paths };
}

describe('runner image attachment wiring (#730)', () => {
  test('failure mode 1: full-line png token in the spec → backend receives expanded text + images; transcript keeps the original token', async () => {
    const client = new FakeClient();
    client.attachments.id1 = {
      fileName: 'shot.png',
      mimeType: 'image/png',
      sizeBytes: PNG.byteLength,
      contentBase64: PNG.toString('base64'),
    };
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const spec = `任务标题\n\n${token}\n\n执行后写 README`;
    const { seen } = await setup(claimed(spec), client);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain('[image attached: shot.png]');
    expect(seen[0]!.prompt).not.toContain('attachment:t1/id1.png');
    expect(seen[0]!.promptImages).toEqual([
      { data: PNG.toString('base64'), mimeType: 'image/png' },
    ]);
    expect(client.attachmentCalls).toEqual(['s1:id1']);
    const userRow = client.transcripts[0]!.messages.find((m) => m.id === 'user-s1');
    expect(userRow?.content).toBe(`图片任务\n\n${spec}`);
  });

  test('failure mode 3: download 409 → step still succeeds, prompt carries an unavailable annotation, zero images', async () => {
    const client = new FakeClient();
    client.attachments.id1 = new Error('machine api 409: attachment id1 not ready (pending)');
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const { seen } = await setup(claimed(`任务\n\n${token}`), client);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toContain(token);
    expect(seen[0]!.prompt).toContain('不可用');
    expect(seen[0]!.promptImages ?? []).toHaveLength(0);
  });

  test('failure mode 4: chief step instruction passed through verbatim (zero parsing, zero downloads)', async () => {
    const client = new FakeClient();
    const token = formatAttachmentToken('shot.png', 't1/id1.png');
    const { seen } = await setup(claimed(`看图 ${token}`, { kind: 'chief' }), client);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.prompt).toBe(`看图 ${token}`);
    expect(client.attachmentCalls).toHaveLength(0);
    expect(seen[0]!.promptImages).toBeUndefined();
  });

  test('failure mode 5: step without tokens → prompt identical byte for byte (zero regression)', async () => {
    const client = new FakeClient();
    const spec = '纯文本任务，没有附件。';
    const { seen } = await setup(claimed(spec), client);
    expect(seen[0]!.prompt).toBe(`图片任务\n\n${spec}`);
    expect(seen[0]!.promptImages).toBeUndefined();
    expect(client.attachmentCalls).toHaveLength(0);
  });
});
