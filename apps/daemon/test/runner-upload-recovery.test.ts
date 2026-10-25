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
import { PLAN_FILE_NAME } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { resumePendingUpload, runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

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

function claimedPlanStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'plan', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 3, title: '产物探针', spec: '写方案与改动' },
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

class FlakyClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploads: { url: string; body: TranscriptUpload | string }[] = [];
  uploadNames: string[][] = [];
  failPutStatuses: number[] = [];
  failDone = 0;

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
    this.calls.push('token');
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
  async putUpload(url: string, headers: Record<string, string>, body: TranscriptUpload | string) {
    const status = this.failPutStatuses.shift();
    if (status !== undefined) throw new MachineApiError(status, 'flaky upload failure');
    this.uploads.push({ url, body });
    void headers;
  }
  async done(stepId: string, body: MachineDoneBody) {
    if (this.failDone > 0) {
      this.failDone -= 1;
      throw new MachineApiError(503, 'server restarting');
    }
    this.doneBodies.push({ stepId, body });
    this.calls.push(`done:${stepId}:${body.status}`);
  }
  async steer() {
    return null;
  }
  async stop() {
    return null;
  }
  async syncResult(_syncId: string, _body: { status: string; errorMessage?: string }) {}
  async attachment(): Promise<never> {
    throw new Error('unused');
  }
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

function planWritingBackend(events: StepEvent[]): {
  backend: AgentBackend;
  prompts: (string | undefined)[];
} {
  const prompts: (string | undefined)[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts) {
      prompts.push(opts.prompt ?? undefined);
      writeFileSync(join(opts.cwd, PLAN_FILE_NAME), '# 方案\nContext: 恢复探针');
      return handle('pi-sess-1', events);
    },
    async continueSession(id, opts) {
      prompts.push(opts.prompt ?? undefined);
      void id;
      return handle(id, events);
    },
  };
  return { backend, prompts };
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

const DONE_EVENT: StepEvent = { type: 'done', usage: [] };

async function setup(claimed: ClaimedStep, backend: AgentBackend, client: MachineApi) {
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-upload-recovery-'));
  const workspacesDir = join(home, 'workspaces');
  const paths = statePaths(home, workspacesDir);
  const { logger, lines } = captureLogger();
  const journal = new StepJournal(paths.outboxDir);
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger,
    paths,
    workspacesDir,
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed);
  return { deps, client, journal, lines, workspacesDir };
}

describe('#1028 expired presigned-URL resend (recovery does not depend on server process memory)', () => {
  test('PUT 404 (old URL expired after a server restart) → re-fetch the URL and resend: done lands, journal cleared', async () => {
    const { backend } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failPutStatuses = [404];
    const { journal } = await setup(claimedPlanStep(), backend, client);
    expect(client.uploadNames).toHaveLength(2);
    expect(client.uploadNames[1]).toEqual(['transcript.json', PLAN_FILE_NAME]);
    expect(
      client.uploads.filter((u) => typeof u.body === 'string' && u.body.includes('恢复探针')),
    ).toHaveLength(1);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body.status).toBe('success');
    expect(journal.pending()).toHaveLength(0);
  });

  test('PUT 409 (semantic rejection) → no retry: URL fetched only once, journal residue awaits recover reporting', async () => {
    const { backend } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failPutStatuses = [409];
    const { journal } = await setup(claimedPlanStep(), backend, client);
    expect(client.uploadNames).toHaveLength(1);
    expect(client.doneBodies).toHaveLength(0);
    expect(journal.pending()).toHaveLength(1);
  });
});

describe('#1026 done failure → final-draft snapshot residue + recover fast-path report', () => {
  test('done failure → journal residue contains doneBody+planContent; fast-path reporting runs no further agent rounds', async () => {
    const { backend, prompts } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failDone = 1;
    const { deps, journal } = await setup(claimedPlanStep(), backend, client);

    const pending = journal.pending();
    expect(pending).toHaveLength(1);
    const entry = pending[0]!;
    expect(entry.state).toBe('awaiting-upload');
    expect(entry.planContent).toBe('# 方案\nContext: 恢复探针');
    expect(entry.doneBody).toMatchObject({ status: 'success', sessionId: 'pi-sess-1' });

    expect(
      client.uploads.filter((u) => typeof u.body === 'string' && u.body.includes('恢复探针')),
    ).toHaveLength(1);

    client.failDone = 0;
    await resumePendingUpload(deps, entry);
    expect(prompts).toHaveLength(1);
    expect(
      client.uploads.filter((u) => typeof u.body === 'string' && u.body.includes('恢复探针')),
    ).toHaveLength(2);
    expect(client.doneBodies).toHaveLength(1);
    expect(client.doneBodies[0]?.body).toEqual(entry.doneBody);
    expect(journal.pending()).toHaveLength(0);
  });

  test('fast-path done fails again → journal residue kept (retried on next restart, still no agent rounds rerun)', async () => {
    const { backend } = planWritingBackend([DONE_EVENT]);
    const client = new FlakyClient();
    client.failDone = 2;
    const { deps, journal } = await setup(claimedPlanStep(), backend, client);
    const entry = journal.pending()[0]!;
    expect(entry).toBeTruthy();
    client.failDone = 1;
    await resumePendingUpload(deps, entry);
    expect(client.doneBodies).toHaveLength(0);
    expect(journal.pending()).toHaveLength(1);
    expect(journal.pending()[0]?.doneBody).toEqual(entry.doneBody);
  });
});
