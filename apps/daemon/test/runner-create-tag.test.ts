import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentBackend,
  AgentSessionHandle,
  ClaimedStep,
  GitCredentials,
  MachineDoneBody,
  MachineStreamEvent,
  SessionOpts,
  ToolCallRecord,
  TranscriptUpload,
  WorktreeOps,
} from '@cairn/shared';
import { LOCAL_TOOL_CREATE_TAG } from '@cairn/shared';
import { describe, expect, test, vi } from 'vitest';
import { PI_CAPABILITIES } from '../src/backend/pi.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';

const probeMock = vi.fn();
vi.mock('../src/github-probe.js', async (importOriginal) => {
  const real = (await importOriginal<typeof import('../src/github-probe.js')>()) as {
    githubRepoRefOf: unknown;
  };
  return { ...real, probeGithubPr: (...args: unknown[]) => probeMock(...args) };
});

function captureLogger(): DaemonLogger {
  const push = () => {};
  return {
    raw: push,
    prefixed: push,
    supervisor: push,
    machine: push,
    step: push,
    workspace: push,
    recover: push,
    wake: push,
    skills: push,
    gate: push,
    trust: push,
    mcp: push,
  };
}

function claimedStep(opts: {
  repo: NonNullable<ClaimedStep['project']>['repo'];
  localTools?: string[];
}): ClaimedStep {
  return {
    step: { id: 's1', buildId: 'conv-1', kind: 'build', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    todo: { id: 't1', seqNum: 1, title: 'tag 探针', spec: '打一个 tag' },
    project: { id: 'p1', name: 'demo', repo: opts.repo },
    agent: {
      id: 'a1',
      displayName: 'stub-builder',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: ['创建标签'],
    },
    ...(opts.localTools !== undefined ? { localTools: opts.localTools } : {}),
  };
}

class FakeClient implements MachineApi {
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  git: GitCredentials | null = null;
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
      git: this.git,
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
        sessionId: 'pi-sess-tag',
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

function fakeWorkspace(): WorktreeOps {
  return {
    async prepare(input) {
      return {
        cwd: join(input.workspacesRoot, input.conversationId),
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: false,
      };
    },
    async commitAll() {
      return { committed: false, head: null };
    },
    async push() {},
    async mergeDefaultBranch() {
      return { output: 'Already up to date' };
    },
    async headCommit() {
      return null;
    },
    async countAhead() {
      return 0;
    },
    async restoreCheckpoint() {},
    async cleanupOrphans() {
      return [];
    },
  };
}

async function setup(claimed: ClaimedStep) {
  probeMock.mockReset();
  probeMock.mockResolvedValue(null);
  const home = mkdtempSync(join(tmpdir(), 'cairn-runner-tag-'));
  const paths = statePaths(home, join(home, 'workspaces'));
  const client = new FakeClient();
  const journal = new StepJournal(paths.outboxDir);
  const { backend, sessions } = recordingBackend();
  const deps = {
    client,
    journal,
    backendFor: () => backend,
    logger: captureLogger(),
    paths,
    workspace: fakeWorkspace(),
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed);
  return { sessions };
}

const GITHUB_REPO = { kind: 'github', cloneUrl: 'https://github.com/o/r.git' } as const;

function localToolNames(opts: SessionOpts | undefined): string[] {
  return (opts?.localTools ?? []).map((t) => t.name);
}

describe('runner create_tag registration surface (XMON-111 T1, acceptance 3)', () => {
  test('failure mode 1: localTools contains create_tag → session tool surface contains it', async () => {
    const { sessions } = await setup(
      claimedStep({ repo: GITHUB_REPO, localTools: [LOCAL_TOOL_CREATE_TAG] }),
    );
    expect(localToolNames(sessions[0])).toContain('create_tag');
  });

  test('failure mode 2: localTools = [] (switch off) → tool absent', async () => {
    const { sessions } = await setup(claimedStep({ repo: GITHUB_REPO, localTools: [] }));
    expect(localToolNames(sessions[0])).not.toContain('create_tag');
  });

  test('failure mode 3: localTools absent (old server) → tool absent (fail-closed)', async () => {
    const { sessions } = await setup(claimedStep({ repo: GITHUB_REPO }));
    expect(localToolNames(sessions[0])).not.toContain('create_tag');
  });

  test('failure mode 4: repo null with the tool word present → still registered; execute returns an explicit reason text', async () => {
    const { sessions } = await setup(
      claimedStep({ repo: null, localTools: [LOCAL_TOOL_CREATE_TAG] }),
    );
    const names = localToolNames(sessions[0]);
    expect(names).toContain('create_tag');
    const tool = (sessions[0]?.localTools ?? []).find((t) => t.name === 'create_tag');
    const out = await tool?.execute({ tag: 'v1.0.0' });
    expect(out).toContain('no repository');
  });
});
