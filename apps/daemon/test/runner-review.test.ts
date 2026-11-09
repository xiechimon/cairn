import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
import { buildReviewStepPrompt, type DocumentDiffFile } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { builtinToolNames, PI_CAPABILITIES, sessionToolNames } from '../src/backend/pi.js';
import { commitEnv, runGitOk } from '../src/git.js';
import { StepJournal } from '../src/journal.js';
import type { DaemonLogger } from '../src/log.js';
import type { MachineApi } from '../src/machine-client.js';
import { type RunStepOptions, runStep } from '../src/runner.js';
import { statePaths } from '../src/state.js';
import { WorkspaceManager } from '../src/workspace.js';
import { testTempDir } from './test-temp-dir.js';

const HOSTED_REPO = { kind: 'hosted' as const, cloneUrl: 'http://localhost:9/git/t/r.git' };
const PLAN_TEXT = '# plan v1\n\n## Changes\n- 加 parseInput\n';
const CHANGES: DocumentDiffFile[] = [
  {
    path: 'src/parse.ts',
    additions: 1,
    deletions: 0,
    hunks: [{ header: '@@ -0,0 +1,1 @@', lines: ['+export function parseInput() {}'] }],
  },
];

function captureLogger(): DaemonLogger {
  const noop = () => {};
  return {
    raw: noop,
    prefixed: noop,
    supervisor: noop,
    machine: noop,
    step: noop,
    workspace: noop,
    recover: noop,
    wake: noop,
    skills: noop,
    gate: noop,
    trust: noop,
    mcp: noop,
  };
}

function claimedReview(
  gate: 'confirm' | 'review',
  repo: NonNullable<ClaimedStep['project']>['repo'],
): ClaimedStep {
  return {
    step: { id: 's-review', buildId: 'conv-1', kind: 'review', machineId: 'm1', createdAt: 1 },
    conversationId: 'conv-1',
    session: { action: 'new', sessionId: null },
    instruction: buildReviewStepPrompt({
      agentId: 'a1',
      gate,
      planText: PLAN_TEXT,
      ...(gate === 'review' ? { changes: CHANGES } : {}),
    }),
    todo: { id: 't1', seqNum: 1, title: '审核探针', spec: '实现一段示例代码' },
    project: { id: 'p1', name: 'demo', repo },
    agent: {
      id: 'a1',
      displayName: 'stub-reviewer',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
  };
}

class FakeClient implements MachineApi {
  calls: string[] = [];
  doneBodies: { stepId: string; body: MachineDoneBody }[] = [];
  uploadedTranscript = '';
  attachments: Record<string, unknown>[] = [];

  constructor(private readonly uploadFailure?: 'reject' | 'unbound') {}

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
  async relayTool(_stepId: string, name: string, params: Record<string, unknown>) {
    if (name === 'attach_file') {
      this.attachments.push(params);
      if (this.uploadFailure === 'reject') throw new Error('upload rejected');
      if (this.uploadFailure === 'unbound') return '{}';
      return JSON.stringify({
        id: 'step-attachment',
        sha256: createHash('sha256')
          .update(Buffer.from(String(params.contentBase64), 'base64'))
          .digest('hex'),
      });
    }
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
      git: null as GitCredentials | null,
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
  async putUpload(_url: string, _headers: Record<string, string>, body: TranscriptUpload | string) {
    this.uploadedTranscript += typeof body === 'string' ? body : JSON.stringify(body);
  }
  async done(stepId: string, body: MachineDoneBody) {
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
  async shellPrecheck(): Promise<never> {
    throw new Error('unused');
  }
  async shellResult(): Promise<void> {}
  async stream(_signal: AbortSignal, _onEvent: (ev: MachineStreamEvent) => void) {}
}

interface WorkspaceOptions {
  rewindError?: string;
  rewindFailures?: number;
  uploadFailure?: 'reject' | 'unbound';
  head?: string | null;
  reused?: boolean;
  run?: RunStepOptions;
  workspace?: WorktreeOps;
}

function fakeWorkspace(cwd: string, calls: string[], opts: WorkspaceOptions = {}): WorktreeOps {
  let restoreAttempts = 0;
  return {
    async prepare(input) {
      calls.push(`prepare:${input.cloneUrl}`);
      mkdirSync(cwd, { recursive: true });
      return {
        cwd,
        baseRepoDir: join(input.workspacesRoot, input.projectId, 'repo'),
        branch: `cairn/conv-${input.conversationId}`,
        defaultBranch: 'main',
        reused: opts.reused ?? true,
      };
    },
    async commitAll() {
      calls.push('commitAll');
      return { committed: true, head: 'abc123', setupDrift: [] };
    },
    async push(_cwd, branch) {
      calls.push(`push:${branch}`);
    },
    async mergeDefaultBranch() {
      calls.push('mergeDefaultBranch');
      return { output: 'Already up to date' };
    },
    async headCommit() {
      calls.push('headCommit');
      return opts.head === undefined ? 'abc123' : opts.head;
    },
    async countAhead() {
      return 1;
    },
    async restoreCheckpoint(_cwd, commit) {
      calls.push(`restoreCheckpoint:${commit}`);
      if (
        opts.rewindError !== undefined &&
        ++restoreAttempts <= (opts.rewindFailures ?? Number.POSITIVE_INFINITY)
      )
        throw new Error(opts.rewindError);
    },
    async cleanupOrphans() {
      return [];
    },
  };
}

function capturingBackend(captured: SessionOpts[]): AgentBackend {
  const session = (): AgentSessionHandle => ({
    sessionId: 'pi-sess-review',
    events: (async function* () {
      yield { type: 'text_delta', text: 'ok' } as never;
      yield { type: 'done', usage: [] } as never;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  });
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts) {
      captured.push(opts);
      return session();
    },
    async continueSession() {
      throw new Error('审核步不接续主 conv 会话');
    },
  };
}

function scriptedBackend(captured: SessionOpts[], script: unknown[]): AgentBackend {
  const session = (): AgentSessionHandle => ({
    sessionId: 'pi-sess-review',
    events: (async function* () {
      for (const ev of script) yield ev as never;
      yield { type: 'done', usage: [] } as never;
    })(),
    async steer() {},
    async stop() {},
    usage: () => [],
  });
  return {
    capabilities: PI_CAPABILITIES,
    async createSession(opts: SessionOpts) {
      captured.push(opts);
      return session();
    },
    async continueSession() {
      throw new Error('审核步不接续主 conv 会话');
    },
  };
}

async function setup(claimed: ClaimedStep, opts: WorkspaceOptions = {}) {
  return setupWithBackend(claimed, opts, (captured) => capturingBackend(captured));
}

async function setupWithBackend(
  claimed: ClaimedStep,
  opts: WorkspaceOptions,
  backendFor: (captured: SessionOpts[]) => AgentBackend,
) {
  const home = testTempDir('cairn-runner-review-');
  const checkoutCwd = join(home, 'review-checkout');
  const paths = statePaths(home, join(home, 'workspaces'));
  const calls: string[] = [];
  const client = new FakeClient(opts.uploadFailure);
  client.calls = calls;
  const captured: SessionOpts[] = [];
  const deps = {
    client,
    journal: new StepJournal(paths.outboxDir),
    backendFor: () => backendFor(captured),
    logger: captureLogger(),
    paths,
    workspace: opts.workspace ?? fakeWorkspace(checkoutCwd, calls, opts),
    workspacesDir: join(home, 'workspaces'),
    mcpConfigPath: join(home, 'claude.json'),
    heartbeatIntervalMs: 60_000,
  };
  await runStep(deps, claimed, opts.run);
  return { client, calls, captured, checkoutCwd };
}

describe('review step execution surface (#511)', () => {
  test('failure modes 1+2: review checkpoint opens the read-only checkout, reviewer writes are discarded, no commit / no push', async () => {
    const { client, calls, captured, checkoutCwd } = await setup(
      claimedReview('review', HOSTED_REPO),
    );
    expect(calls).toContain(`prepare:${HOSTED_REPO.cloneUrl}`);
    expect(captured[0]!.cwd).toBe(checkoutCwd);
    expect(calls).toContain('restoreCheckpoint:abc123');
    expect(calls.indexOf('restoreCheckpoint:abc123')).toBeLessThan(
      calls.indexOf('done:s-review:success'),
    );
    expect(calls).not.toContain('commitAll');
    expect(calls.some((c) => c.startsWith('push:'))).toBe(false);
    expect(calls).not.toContain('mergeDefaultBranch');
    const body = client.doneBodies[0]!.body;
    expect(body.status).toBe('success');
    expect(body.hasChanges).toBe(false);
    expect(body.commit).toBeUndefined();
  });

  test('failure mode 3: confirmation checkpoint does not open a checkout (cwd falls back to the bare task directory), material delivered as usual', async () => {
    const { calls, captured, checkoutCwd } = await setup(claimedReview('confirm', HOSTED_REPO));
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(calls.some((c) => c.startsWith('push:'))).toBe(false);
    expect(calls).not.toContain('headCommit');
    expect(captured[0]!.cwd).not.toBe(checkoutCwd);
    expect(captured[0]!.prompt).toContain(PLAN_TEXT);
    expect(captured[0]!.prompt).not.toContain('src/parse.ts');
  });

  test('failure mode 4: review material is really delivered (prompt = instruction, does not eat the CONTINUE_PROMPTS empty string)', async () => {
    const { captured } = await setup(claimedReview('review', HOSTED_REPO));
    const prompt = captured[0]!.prompt ?? '';
    expect(prompt).not.toBe('');
    expect(prompt).toContain(PLAN_TEXT);
    expect(prompt).toContain('src/parse.ts');
    expect(prompt).toContain('+export function parseInput() {}');
  });

  test('failure mode 5: review session is read-only — readOnly set, edit/write absent from the tool surface, bash kept', async () => {
    const { captured } = await setup(claimedReview('review', HOSTED_REPO));
    expect(captured[0]!.readOnly).toBe(true);
    expect(builtinToolNames(true)).toEqual(['read', 'bash']);
    expect(builtinToolNames(false)).toEqual(['read', 'bash', 'edit', 'write']);
    expect(
      sessionToolNames({ readOnly: true, remoteTools: ['save_memory'], mcpTools: ['mcp__x__y'] }),
    ).toEqual(['read', 'bash', 'save_memory', 'mcp__x__y']);
    expect(
      sessionToolNames({ readOnly: false, remoteTools: ['save_memory'], mcpTools: [] }),
    ).toEqual(['read', 'bash', 'edit', 'write', 'save_memory']);
  });

  test('read-only checkout rollback failure is not silent: a system line lands in the transcript (write residue must be visible)', async () => {
    const { client, calls } = await setup(claimedReview('review', HOSTED_REPO), {
      rewindError: 'fatal: unable to create file',
    });
    expect(calls).toContain('restoreCheckpoint:abc123');
    expect(client.doneBodies[0]!.body.status).toBe('success');
    expect(client.uploadedTranscript).toContain('审核检出未能回退到本轮起点');
    expect(client.uploadedTranscript).toContain('fatal: unable to create file');
  });

  test('review checkpoint + unbound repo: no checkout opened (bare-directory degraded shape), material still contains the changes', async () => {
    const { calls, captured } = await setup(claimedReview('review', null));
    expect(calls.some((c) => c.startsWith('prepare'))).toBe(false);
    expect(captured[0]!.prompt).toContain('src/parse.ts');
  });

  test('#700 failure mode 1: #519 full-chain shape — JSON followed by tool calls → done body carries findings', async () => {
    const verdictJson = JSON.stringify({
      conclusion: '方案在边界情况上存在硬风险，需修复两处',
      findings: [
        { id: '1', severity: 'blocking', summary: '未处理空输入', file: 'src/parse.ts', line: 42 },
      ],
    });
    const { client } = await setupWithBackend(
      claimedReview('review', HOSTED_REPO),
      {},
      (captured) =>
        scriptedBackend(captured, [
          { type: 'message_end', message: { role: 'assistant', content: verdictJson } },
          {
            type: 'toolcall_end',
            call: {
              id: 'call-set-meta',
              name: 'set_task_meta',
              arguments: { title: '审核探针' },
              result: '{}',
              isError: false,
              endedAt: 123,
            },
          },
          { type: 'message_end', message: { role: 'assistant', content: '' } },
        ]),
    );
    const body = client.doneBodies[0]!.body;
    expect(body.status).toBe('success');
    expect(body.findings).toEqual({
      conclusion: '方案在边界情况上存在硬风险，需修复两处',
      findings: [
        { id: '1', severity: 'blocking', summary: '未处理空输入', file: 'src/parse.ts', line: 42 },
      ],
    });
    expect(body.findingsError).toBeUndefined();
  });

  test('#700 failure mode 2: no JSON anywhere → done body carries findingsError, not findings', async () => {
    const { client } = await setupWithBackend(
      claimedReview('review', HOSTED_REPO),
      {},
      (captured) =>
        scriptedBackend(captured, [
          {
            type: 'message_end',
            message: { role: 'assistant', content: '看完了，方案整体可行。' },
          },
        ]),
    );
    const body = client.doneBodies[0]!.body;
    expect(body.status).toBe('success');
    expect(body.findings).toBeUndefined();
    expect(body.findingsError).toContain('未找到');
  });
});

describe('chief digest execution surface (#1939)', () => {
  const claimedDigest: ClaimedStep = {
    step: {
      id: 's-digest',
      buildId: 'chief-digest-c1',
      kind: 'chief',
      machineId: 'm1',
      createdAt: 1,
    },
    conversationId: 'chief-digest-c1',
    session: { action: 'new', sessionId: null },
    instruction: '整理这段对话',
    agent: {
      id: 'a1',
      displayName: 'stub-chief',
      description: null,
      provider: null,
      modelId: 'stub-model',
      thinkingLevel: null,
    },
    chief: { threadId: 'chief-digest-c1', systemPrompt: '只读整理', trigger: 'user' },
    remoteTools: [{ name: 'todos', description: 'list tasks' }],
    mcpServers: [],
    remoteToolsOnly: true,
  };

  test('a digest session gets only its remote tools and a managed-empty MCP set', async () => {
    const { captured } = await setup(claimedDigest);
    expect(captured[0]!.remoteToolsOnly).toBe(true);
    expect(captured[0]!.mcpServers).toEqual([]);
    expect(captured[0]!.remoteTools?.map((t) => t.name)).toEqual(['todos']);
    expect(captured[0]!.localTools).toBeUndefined();
  });

  test('host lockdown: chief and review sessions are locked down, verify and build sessions are not', async () => {
    const chief = await setup(claimedDigest);
    expect(chief.captured[0]!.lockedDown).toBe(true);
    const review = await setup(claimedReview('review', HOSTED_REPO));
    expect(review.captured[0]!.lockedDown).toBe(true);
    const base = claimedReview('review', HOSTED_REPO);
    const verify = await setup({ ...base, step: { ...base.step, kind: 'verify' } });
    expect(verify.captured[0]!.lockedDown).toBeUndefined();
    const build = await setup({ ...base, step: { ...base.step, kind: 'build' } });
    expect(build.captured[0]!.lockedDown).toBeUndefined();
  });

  test('pi: a remote-only session drops read, bash, edit, write, local and MCP tools', () => {
    expect(
      sessionToolNames({
        readOnly: false,
        remoteToolsOnly: true,
        remoteTools: ['todos'],
        mcpTools: ['mcp__x__y'],
        localTools: ['create_tag'],
      }),
    ).toEqual(['todos']);
  });
});

describe('out-of-tree verify execution', () => {
  const base = claimedReview('review', HOSTED_REPO);
  const verify: ClaimedStep = {
    ...base,
    step: { ...base.step, kind: 'verify' },
    instruction: JSON.stringify({
      kind: 'verify',
      expectedHeadSha: 'abc123',
      evidence: 'attachments',
    }),
  };

  test('attachments verify restores the start checkpoint, never commits or pushes, and reports the start head', async () => {
    const { calls, client } = await setup(verify, { reused: false });
    expect(calls).toContain('restoreCheckpoint:abc123');
    expect(calls).not.toContain('commitAll');
    expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
    expect(client.doneBodies[0]?.body).toMatchObject({ commit: 'abc123', hasChanges: false });
  });

  test.each(['', '.cairn-verify/', '.*', 'tracked'])(
    'real worktree uploads evidence before discarding agent commits and scratch files (ignore=%s)',
    async (ignore) => {
      const root = testTempDir('cairn-verify-worktree-');
      const origin = join(root, 'origin.git');
      const seed = join(root, 'seed');
      const env = commitEnv({ name: 'test-agent', email: 'test@example.com' });
      await runGitOk(['init', '--bare', '--initial-branch=main', origin]);
      await runGitOk(['clone', origin, seed]);
      writeFileSync(join(seed, 'delivery.txt'), 'delivered\n');
      writeFileSync(join(seed, '.gitignore'), `${ignore}\n`);
      if (ignore === 'tracked') {
        mkdirSync(join(seed, '.cairn-verify'));
        writeFileSync(join(seed, '.cairn-verify/keep.txt'), 'original scratch\n');
        await runGitOk(['add', '.cairn-verify/keep.txt'], { cwd: seed });
      }
      await runGitOk(['add', '-f', 'delivery.txt', '.gitignore'], { cwd: seed });
      await runGitOk(['commit', '-m', 'seed'], { cwd: seed, env });
      await runGitOk(['push', 'origin', 'main'], { cwd: seed });
      const startHead = (await runGitOk(['rev-parse', 'HEAD'], { cwd: seed })).trim();
      const workspace = new WorkspaceManager({ logger: captureLogger() });
      let checkout = '';
      let agentHead: string | null = null;
      const claim: ClaimedStep = {
        ...verify,
        project: { id: 'p1', name: 'demo', repo: { kind: 'hosted', cloneUrl: origin } },
        instruction: JSON.stringify({
          kind: 'verify',
          expectedHeadSha: startHead,
          evidence: 'attachments',
        }),
        remoteTools: [{ name: 'attach_file', description: 'Attach verification evidence' }],
      };
      const { client } = await setupWithBackend(claim, { workspace }, (captured) => ({
        ...capturingBackend(captured),
        async createSession(opts) {
          checkout = opts.cwd;
          expect(opts.prompt).not.toContain('工作分支注记');
          mkdirSync(join(checkout, '.cairn-verify'), { recursive: true });
          writeFileSync(join(checkout, '.cairn-verify/proof.txt'), 'checked delivery\n');
          await opts.executeRemoteTool?.('attach_file', { path: '.cairn-verify/proof.txt' });
          writeFileSync(join(checkout, 'delivery.txt'), 'agent modification\n');
          await runGitOk(['add', 'delivery.txt'], { cwd: checkout });
          await runGitOk(['commit', '-m', 'unwanted verifier commit'], { cwd: checkout, env });
          agentHead = await runGitOk(['rev-parse', 'HEAD'], { cwd: checkout });
          await expect(
            runGitOk(['push', 'origin', 'HEAD:refs/heads/escaped-verification'], {
              cwd: checkout,
              env: opts.env,
            }),
          ).rejects.toThrow('cairn-readonly-workspace-denied');
          return {
            sessionId: 'verify-real-git',
            events: (async function* () {
              yield {
                type: 'message_end',
                message: {
                  role: 'assistant',
                  content: JSON.stringify({
                    passed: true,
                    conclusion: 'Checked delivery',
                    evidence: [{ path: '.cairn-verify/proof.txt' }],
                  }),
                },
              } as const;
              yield { type: 'done', usage: [] } as const;
            })(),
            async steer() {},
            async stop() {},
            usage: () => [],
          };
        },
      }));
      const runtime = {
        startHead,
        agentHead,
        finalHead: await runGitOk(['rev-parse', 'HEAD'], { cwd: checkout }),
        delivery: readFileSync(join(checkout, 'delivery.txt'), 'utf8'),
        scratchPresent: existsSync(join(checkout, '.cairn-verify')),
        worktreeStatus: await runGitOk(['status', '--porcelain'], { cwd: checkout }),
        originHeads: await runGitOk(['show-ref', '--heads'], { cwd: origin }),
        uploads: client.attachments.map((attachment) => ({
          fileName: attachment.fileName,
          content: Buffer.from(String(attachment.contentBase64), 'base64').toString('utf8'),
        })),
        done: client.doneBodies[0]?.body,
      };
      const evidenceDirectory = process.env.VERIFY_EVIDENCE_DIR;
      if (evidenceDirectory !== undefined) {
        mkdirSync(evidenceDirectory, { recursive: true });
        writeFileSync(
          join(evidenceDirectory, 'daemon-runtime.json'),
          JSON.stringify(runtime, null, 2),
        );
      }
      expect(client.attachments).toEqual([
        {
          fileName: 'proof.txt',
          contentBase64: Buffer.from('checked delivery\n').toString('base64'),
        },
      ]);
      expect(runtime.delivery).toBe('delivered\n');
      expect(runtime.scratchPresent).toBe(ignore === 'tracked');
      expect(existsSync(join(checkout, '.cairn-verify/proof.txt'))).toBe(false);
      if (ignore === 'tracked')
        expect(readFileSync(join(checkout, '.cairn-verify/keep.txt'), 'utf8')).toBe(
          'original scratch\n',
        );
      expect(runtime.finalHead).toBe(startHead);
      expect(runtime.worktreeStatus).toBe('');
      expect(runtime.originHeads).toBe(`${startHead} refs/heads/main`);
      expect(client.doneBodies[0]?.body, client.doneBodies[0]?.body.errorMessage).toMatchObject({
        status: 'success',
        commit: startHead,
        hasChanges: false,
        verifyVerdict: { passed: true },
      });
    },
  );

  test('attachments verify fails closed when restoring its checkpoint fails', async () => {
    const { calls, client } = await setup(verify, { rewindError: 'restore failed' });
    expect(calls).not.toContain('commitAll');
    expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('attachments verify cannot start an agent without a restorable head', async () => {
    const { calls, client, captured } = await setup(verify, { head: null, reused: false });
    expect(captured).toHaveLength(0);
    expect(calls).not.toContain('commitAll');
    expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test('attachments verify rewinds after an agent error and reports the original head', async () => {
    const { calls, client } = await setupWithBackend(verify, { reused: false }, (captured) =>
      scriptedBackend(captured, [
        { type: 'error', error: { message: 'verification failed', retryable: false } },
      ]),
    );
    expect(calls).toContain('restoreCheckpoint:abc123');
    expect(calls).not.toContain('commitAll');
    expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
    expect(client.doneBodies[0]?.body).toMatchObject({
      status: 'failed',
      commit: 'abc123',
      hasChanges: false,
    });
  });

  test('attachments verify rewinds even when opening the session throws', async () => {
    const { calls, client } = await setupWithBackend(verify, { reused: false }, (captured) => ({
      ...capturingBackend(captured),
      async createSession() {
        throw new Error('session could not start');
      },
    }));
    expect(calls).toContain('restoreCheckpoint:abc123');
    expect(calls).not.toContain('commitAll');
    expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test.each([false, true])(
    'attachments verify rewinds on stop with discard=%s',
    async (discard) => {
      const { calls, client } = await setup(verify, {
        reused: false,
        run: { stopRequest: { discard } },
      });
      expect(calls).toContain('restoreCheckpoint:abc123');
      expect(calls).not.toContain('commitAll');
      expect(calls.some((call) => call.startsWith('push:'))).toBe(false);
      expect(client.doneBodies[0]?.body).toMatchObject({
        status: 'stopped',
        commit: 'abc123',
        hasChanges: false,
      });
    },
  );

  test('final cleanup retries a transient checkpoint restore failure', async () => {
    const { calls, client } = await setup(verify, {
      rewindError: 'transient restore failure',
      rewindFailures: 1,
      reused: false,
    });
    expect(calls.filter((call) => call === 'restoreCheckpoint:abc123')).toHaveLength(2);
    expect(client.doneBodies[0]?.body.status).toBe('failed');
  });

  test.each([
    'missing',
    'rejected',
    'mismatched',
    'empty',
    'unbound',
    'malformed',
    'valid',
  ] as const)(
    'attachment verdict binds every evidence path to a successful upload (%s)',
    async (scenario) => {
      const claim = {
        ...verify,
        remoteTools: [{ name: 'attach_file', description: 'Attach evidence' }],
      };
      const { client } = await setupWithBackend(
        claim,
        {
          uploadFailure:
            scenario === 'rejected' ? 'reject' : scenario === 'unbound' ? 'unbound' : undefined,
        },
        (captured) => ({
          ...capturingBackend(captured),
          async createSession(opts) {
            mkdirSync(join(opts.cwd, '.cairn-verify'), { recursive: true });
            writeFileSync(join(opts.cwd, '.cairn-verify/proof.txt'), 'proof');
            if (scenario !== 'missing') {
              try {
                await opts.executeRemoteTool?.('attach_file', { path: '.cairn-verify/proof.txt' });
              } catch {}
            }
            return {
              sessionId: 'verify-upload',
              events: (async function* () {
                if (scenario === 'malformed') {
                  yield {
                    type: 'message_end',
                    message: {
                      role: 'assistant',
                      content: JSON.stringify({
                        passed: true,
                        conclusion: 'Earlier draft',
                        evidence: [{ path: '.cairn-verify/proof.txt' }],
                      }),
                    },
                  } as const;
                }
                const verdict = JSON.stringify({
                  passed: true,
                  conclusion: 'Checked',
                  evidence:
                    scenario === 'empty'
                      ? []
                      : scenario === 'malformed'
                        ? [{ path: '.cairn-verify/proof.txt' }, { path: null }]
                        : [
                            {
                              path:
                                scenario === 'mismatched'
                                  ? '.cairn-verify/other.txt'
                                  : '.cairn-verify/proof.txt',
                            },
                          ],
                });
                yield { type: 'text_delta', text: verdict } as const;
                yield {
                  type: 'message_end',
                  message: { role: 'assistant', content: verdict },
                } as const;
                yield { type: 'done', usage: [] } as const;
              })(),
              async steer() {},
              async stop() {},
              usage: () => [],
            };
          },
        }),
      );
      if (scenario === 'valid') expect(client.doneBodies[0]?.body.verifyVerdict?.passed).toBe(true);
      else expect(client.doneBodies[0]?.body.verifyVerdict?.passed).not.toBe(true);
    },
  );

  test('repository verify retains the existing commit and push path', async () => {
    const { calls } = await setup({
      ...verify,
      instruction: JSON.stringify({ kind: 'verify', expectedHeadSha: 'abc123' }),
    });
    expect(calls).toContain('commitAll');
    expect(calls.some((call) => call.startsWith('push:'))).toBe(true);
  });
});
