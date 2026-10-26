import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  MachineDoneBody,
  MachineSkillsManifestResponse,
  MachineStreamEvent,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import { type MachineApi, MachineApiError } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
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

const DEMO_CONTENTS: Record<string, string> = {
  'deploy-demo/SKILL.md':
    '---\nname: deploy-demo\ndescription: 演示部署技能。\n---\n\n部署正文。\n',
};

function sha256(s: string): string {
  return createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
}

const DEMO_MANIFEST: MachineSkillsManifestResponse = {
  selection: 'whitelist',
  skills: [
    {
      id: 'deploy-demo',
      name: 'deploy-demo',
      description: '演示部署技能。',
      dirName: 'deploy-demo',
      files: [
        {
          path: 'SKILL.md',
          sizeBytes: Buffer.byteLength(DEMO_CONTENTS['deploy-demo/SKILL.md']!, 'utf8'),
          sha256: sha256(DEMO_CONTENTS['deploy-demo/SKILL.md']!),
        },
      ],
    },
  ],
};

function claimedBuildStep(): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: '技能探针', spec: '跑一步' },
    project: { id: 'p1', name: 'demo', repo: null },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      defaultSkill: null,
      skillsAllowlist: ['deploy-demo'],
    },
  };
}

type SkillsOutcome =
  | { kind: 'manifest'; manifest: MachineSkillsManifestResponse }
  | { kind: 'manifestError'; error: Error }
  | { kind: 'fileError'; error: Error };

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  manifestCalls: string[] = [];
  fileCalls: string[] = [];

  constructor(private readonly outcome: SkillsOutcome) {}

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
  async skillsManifest(stepId: string) {
    this.manifestCalls.push(stepId);
    if (this.outcome.kind === 'manifestError') throw this.outcome.error;
    if (this.outcome.kind === 'fileError') return DEMO_MANIFEST;
    return this.outcome.manifest;
  }
  async skillFile(stepId: string, dirName: string, path: string): Promise<Buffer> {
    this.fileCalls.push(`${stepId}:${dirName}/${path}`);
    if (this.outcome.kind === 'fileError') throw this.outcome.error;
    const content = DEMO_CONTENTS[`${dirName}/${path}`];
    if (content === undefined) throw new MachineApiError(404, `no such file ${path}`);
    return Buffer.from(content, 'utf8');
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
  async putUpload(
    _url: string,
    _headers: Record<string, string>,
    _body: TranscriptUpload | string,
  ) {}
  async done(stepId: string, body: MachineDoneBody) {
    this.doneBodies.push({ stepId, body });
  }
  async steer() {
    return null;
  }
  async attachment(): Promise<never> {
    throw new Error('unused');
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

function recordingBackend(): { backend: AgentBackend; sessions: SessionOpts[] } {
  const sessions: SessionOpts[] = [];
  const backend: AgentBackend = {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts): Promise<AgentSessionHandle> {
      sessions.push(opts);
      return {
        sessionId: 'pi-sess-team',
        events: (async function* () {
          yield { type: 'text_delta', text: 'ok' } as never;
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
  };
  return { backend, sessions };
}

async function setup(outcome: SkillsOutcome) {
  const home = makeTestTempDir('cairn-runner-team-');
  const paths = statePaths(home, join(home, 'workspaces'));
  const { logger, lines } = captureLogger();
  const client = new FakeClient(outcome);
  const journal = new StepJournal(paths.outboxDir);
  const { backend, sessions } = recordingBackend();
  await runStep(
    {
      client,
      journal,
      backendFor: () => backend,
      logger,
      paths,
      workspacesDir: join(home, 'workspaces'),
      mcpConfigPath: join(home, 'claude.json'),
      heartbeatIntervalMs: 60_000,
    },
    claimedBuildStep(),
  );
  return { client, lines, sessions, paths };
}

describe('runner team-skills wiring (#920 manifest + on-demand fetch)', () => {
  test('R1 fetch succeeds → teamSkillsDir passed to the session + content on disk and readable + materialized line + done success', async () => {
    const { client, lines, sessions, paths } = await setup({
      kind: 'manifest',
      manifest: DEMO_MANIFEST,
    });
    expect(client.manifestCalls).toEqual(['s1']);
    expect(client.fileCalls).toEqual(['s1:deploy-demo/SKILL.md']);
    const opts = sessions[0]!;
    expect(opts.teamSkillsDir).toBeDefined();
    expect(opts.teamSkillsDir!.startsWith(join(paths.teamSkillsCacheDir, 'views'))).toBe(true);
    expect(readFileSync(join(opts.teamSkillsDir!, 'deploy-demo', 'SKILL.md'), 'utf8')).toContain(
      '部署正文。',
    );
    expect(
      lines.some((l) => l.startsWith('[skills] team: 1 skill(s), 1 file(s) materialized')),
    ).toBe(true);
    expect(client.doneBodies[0]!.body.status).toBe('success');
  });

  test('R2 manifest fetch throws → done failed naming the root cause + zero sessions created + team-skills-failed line', async () => {
    const { lines, sessions, client } = await setup({
      kind: 'manifestError',
      error: new MachineApiError(500, 'boom'),
    });
    expect(sessions.length).toBe(0);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('team skills distribution failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('500');
    expect(lines.some((l) => l.startsWith('[skills] team-skills-failed:'))).toBe(true);
  });

  test.each(['whitelist', 'all'] as const)(
    'R3 空清单 selection=%s → 无 teamSkillsDir、缓存根零创建、team-manifest-empty 显式行、会话照常',
    async (selection) => {
      const { lines, sessions, paths, client } = await setup({
        kind: 'manifest',
        manifest: { selection, skills: [] },
      });
      expect(sessions[0]!.teamSkillsDir).toBeUndefined();
      expect(existsSync(paths.teamSkillsCacheDir)).toBe(false);
      expect(client.fileCalls).toEqual([]);
      const empty = lines.find((l) => l.startsWith('[skills] team-manifest-empty:'));
      expect(empty).toBeDefined();
      expect(empty).toContain(`selection=${selection}`);
      expect(client.doneBodies[0]!.body.status).toBe('success');
    },
  );

  test('R4 invalid manifest (dirName escape) → done failed with an explicit error + zero sessions created', async () => {
    const evil: MachineSkillsManifestResponse = {
      selection: 'whitelist',
      skills: [{ ...DEMO_MANIFEST.skills[0]!, dirName: '../evil' }],
    };
    const { lines, sessions, client } = await setup({ kind: 'manifest', manifest: evil });
    expect(sessions.length).toBe(0);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('unsafe skill manifest');
    expect(lines.some((l) => l.startsWith('[skills] team-skills-failed:'))).toBe(true);
  });

  test('R5 on-demand file fetch fails → done failed naming the file and root cause + zero sessions created', async () => {
    const { sessions, client } = await setup({
      kind: 'fileError',
      error: new MachineApiError(503, 'file upstream gone'),
    });
    expect(sessions.length).toBe(0);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('team skills distribution failed');
    expect(client.doneBodies[0]!.body.errorMessage).toContain('503');
  });

  test('R6 old server 404 (no endpoint) → same-shaped failed as R2 (fail-open retired)', async () => {
    const { lines, sessions, client } = await setup({
      kind: 'manifestError',
      error: new MachineApiError(404, 'not found'),
    });
    expect(sessions.length).toBe(0);
    expect(lines.some((l) => l.startsWith('[skills] team-skills-failed:'))).toBe(true);
    expect(client.doneBodies[0]!.body.status).toBe('failed');
  });

  test('R1 supplement: a successfully materialized cache directory has no .tmp residue (both views/ and blobs/)', async () => {
    const { sessions, paths } = await setup({ kind: 'manifest', manifest: DEMO_MANIFEST });
    expect(
      readdirSync(join(paths.teamSkillsCacheDir, 'views')).filter((e) => e.includes('.tmp-')),
    ).toEqual([]);
    expect(
      readdirSync(join(paths.teamSkillsCacheDir, 'blobs')).filter((e) => e.includes('.tmp-')),
    ).toEqual([]);
    expect(sessions[0]!.teamSkillsDir).toBeDefined();
  });
});
