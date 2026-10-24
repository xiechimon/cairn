import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineStreamEvent,
  StepEvent,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { SESSION_FILE_NAME, SESSION_JSONL_MAX_BYTES } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

class FakeClient implements MachineApi {
  uploads: { name: string; body: TranscriptUpload | string }[] = [];
  uploadNames: string[][] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  failSessionPut = false;

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
  async tool(_stepId: string, _call: ToolCallRecord) {}
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
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async uploadUrls(_stepId: string, files: { name: string }[]) {
    this.uploadNames.push(files.map((f) => f.name));
    return {
      uploads: files.map((f, i) => ({
        name: f.name,
        url: `http://server/up/${i}`,
        method: 'PUT' as const,
        headers: {},
      })),
    };
  }
  async putUpload(url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    const index = Number(url.slice('http://server/up/'.length));
    const names = this.uploadNames[this.uploadNames.length - 1] ?? [];
    const name = names[index] ?? url;
    if (this.failSessionPut && name === SESSION_FILE_NAME) {
      throw new MachineApiError(500, 'session store down');
    }
    this.uploads.push({ name, body });
  }
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

const DONE_EVENT: StepEvent = { type: 'done', usage: [] };

function backendWithSession(sessionFile?: string): AgentBackend {
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(): Promise<AgentSessionHandle> {
      return {
        sessionId: 'pi-sess-1',
        ...(sessionFile !== undefined ? { sessionFile } : {}),
        events: (async function* gen() {
          yield DONE_EVENT;
        })(),
        async steer() {},
        async stop() {},
        usage: () => [],
      };
    },
    async continueSession() {
      throw new Error('unused');
    },
  };
}

async function setup(backend: AgentBackend, client: FakeClient = new FakeClient()) {
  const home = mkdtempSync(join(tmpdir(), 'pacman-runner-session-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = (() => {
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
  })();
  const journal = new StepJournal(paths.outboxDir);
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir,
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    {
      step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
      conversationId: 'conv-1',
      session: { action: 'new', sessionId: null },
      todo: { id: 't1', seqNum: 1, title: '会话附件', spec: '跑一步' },
      project: { id: 'p1', name: 'demo', repo: null },
      agent: {
        id: 'a1',
        displayName: 'stub-builder',
        description: null,
        provider: null,
        modelId: 'stub-model',
        thinkingLevel: null,
      },
    } satisfies ClaimedStep,
  );
  return { client, lines };
}

describe('步收尾会话 JSONL 上传（#1512）', () => {
  test('失败方式 1：可读会话文件 → 随 transcript 上传原文', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-pi-session-'));
    const sessionFile = join(dir, 'sess.jsonl');
    const body = '{"type":"assistant","stopReason":"length"}\n';
    writeFileSync(sessionFile, body);
    const { client } = await setup(backendWithSession(sessionFile));
    expect(client.uploadNames[0]).toContain('transcript.json');
    expect(client.uploadNames[0]).toContain(SESSION_FILE_NAME);
    const sessionPut = client.uploads.find((u) => u.name === SESSION_FILE_NAME);
    expect(sessionPut?.body).toBe(body);
    expect(client.doneBodies[0]?.body.status).toBe('success');
  });

  test('失败方式 2：文件不存在 → 步成功，日志可见，不请求 session.jsonl', async () => {
    const missing = join(tmpdir(), `pacman-session-gone-${Date.now()}.jsonl`);
    const { client, lines } = await setup(backendWithSession(missing));
    expect(client.uploadNames[0]).toEqual(['transcript.json']);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('session') && l.includes('missing'))).toBe(true);
  });

  test('失败方式 3：超过上限 → 步成功，日志可见，不请求 session.jsonl', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-pi-session-big-'));
    const sessionFile = join(dir, 'sess.jsonl');
    writeFileSync(sessionFile, 'x'.repeat(SESSION_JSONL_MAX_BYTES + 1));
    const { client, lines } = await setup(backendWithSession(sessionFile));
    expect(client.uploadNames[0]).toEqual(['transcript.json']);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('session') && l.includes('over'))).toBe(true);
  });

  test('失败方式 4：session PUT 失败 → transcript 仍上传、done 仍报', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pacman-pi-session-put-'));
    const sessionFile = join(dir, 'sess.jsonl');
    writeFileSync(sessionFile, '{"ok":1}\n');
    const client = new FakeClient();
    client.failSessionPut = true;
    const { lines } = await setup(backendWithSession(sessionFile), client);
    expect(client.uploads.some((u) => u.name === 'transcript.json')).toBe(true);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(lines.some((l) => l.includes('session') && l.includes('upload failed'))).toBe(true);
  });
});
