import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  isPlanContractRewritePrompt,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; text?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.text,
    }),
  );
}

const AGENT_ID = 'agent-ag-1';

async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-ag',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'ag-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'ag-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '闸探针任务', spec: '写一行探针到 README.md' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(withPlan = true): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan,
      },
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
  }
  async function claim(): Promise<ClaimedStep> {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) throw new Error('claim returned no step');
    return claimedStepSchema.parse(body.step);
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    expect(res.status).toBe(200);
  }
  async function uploadPlan(stepId: string, content: string): Promise<void> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: token,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    const up = urls.uploads[0]!;
    const put = await call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: token,
      text: content,
      contentType: 'text/markdown',
    });
    expect(put.status).toBe(200);
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const buildRow = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  const stepRow = (stepId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
  const stepsOf = (buildId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
  const messagesOf = (buildId: string) =>
    s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();
  return {
    s,
    token,
    projectId,
    todoId,
    startBuild,
    claim,
    done,
    uploadPlan,
    todoRow,
    buildRow,
    stepRow,
    stepsOf,
    messagesOf,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

const GOOD_PLAN =
  '# 方案\nContext: x\n\n## Verification\n- `pnpm exec vitest run README.test.ts` 通过\n';
const VAGUE_PLAN = '# 方案\nContext: x\n\n## Verification\n- 确认没问题\n';

async function runTwoEmptyPlanRounds(w: World): Promise<{ buildId: string; secondStepId: string }> {
  const buildId = await w.startBuild(true);
  const first = await w.claim();
  expect(first.step.kind).toBe('plan');
  await w.done(first.step.id, { status: 'success', sessionId: 'pi-1' });
  const second = await w.claim();
  expect(second.step.kind).toBe('plan');
  await w.done(second.step.id, { status: 'success', sessionId: 'pi-1' });
  return { buildId, secondStepId: second.step.id };
}

describe('gate 1 (B-C10): plan step with no plan document -> confirm unreachable', () => {
  test('completion round still has no plan.md -> failure wrap-up: step failed + todo failed + errorMessage "no plan produced"', async () => {
    const w = await setupWorld();
    try {
      const { buildId, secondStepId } = await runTwoEmptyPlanRounds(w);
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toBe('规划未产出方案');
      expect(w.stepRow(secondStepId).status).toBe('failed');
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
    } finally {
      w.s.dispose();
    }
  });

  test('first round without plan.md still goes through the #113 completion round (one retry, not an immediate failure)', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const first = await w.claim();
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('planning');
      expect(w.todoRow().hasPlan).toBe(false);
      const pending = w
        .stepsOf(buildId)
        .filter((st) => st.kind === 'plan' && st.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.prompt).toContain(PLAN_FILE_NAME);
    } finally {
      w.s.dispose();
    }
  });

  test('counterexample: completion round writes plan.md -> passes the gate into confirm (hasPlan set)', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(true);
      const first = await w.claim();
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-1' });
      const second = await w.claim();
      await w.uploadPlan(second.step.id, GOOD_PLAN);
      await w.done(second.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('failed-restart round (first plan step of a new build, prompt carries the restart instruction) -> gets the same one completion retry', async () => {
    const w = await setupWorld();
    try {
      const { buildId } = await runTwoEmptyPlanRounds(w);
      expect(w.todoRow().phase).toBe('failed');
      const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'restart',
          feedback: '请务必先写方案文档',
          clientMessageId: '3f9a0c2e-0000-4000-8000-000000000003',
        },
      });
      expect(res.status).toBe(202);
      expect(w.todoRow().phase).toBe('queued');
      const first = await w.claim();
      expect(first.step.kind).toBe('plan');
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-restart' });
      expect(w.todoRow().phase).toBe('planning');
      expect(
        w.stepsOf(first.step.buildId).filter((st) => st.kind === 'plan' && st.status === 'pending'),
      ).toHaveLength(1);
      const rewrite = await w.claim();
      await w.done(rewrite.step.id, { status: 'success', sessionId: 'pi-restart' });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(rewrite.step.buildId).errorMessage).toBe('规划未产出方案');
    } finally {
      w.s.dispose();
    }
  });
});

describe('gate 2 (B-C11/B-C14): build step with zero changes / fake completion -> review unreachable', () => {
  test('done success + hasChanges=false -> failure wrap-up "build produced zero changes"', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(w.todoRow().phase).toBe('building');
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-b1',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toBe('构建零改动');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
    } finally {
      w.s.dispose();
    }
  });

  test('counterexample: hasChanges=true -> proceeds to review as usual (an artifact passes the gate)', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        sessionId: 'pi-b2',
      });
      expect(w.todoRow().phase).toBe('review');
      expect(w.todoRow().hasChanges).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('version-wall counterexample: legacy daemon does not carry hasChanges -> fail-open, review as usual', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-b3' });
      expect(w.todoRow().phase).toBe('review');
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 3 (B-C14 fake-completion shape): done success with zero artifact and zero errorMessage -> wrapped up as failure', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-b4',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toBe('构建零改动');
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 4 (no collateral damage): review step with hasChanges=false records a verdict as usual, not failed', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        sessionId: 'pi-b5',
      });
      expect(w.todoRow().phase).toBe('review');
      const res = await call(w.s.app, 'POST', `/api/builds/${buildStep.step.buildId}/steps`, {
        body: { action: 'review', agentId: AGENT_ID },
      });
      expect(res.status).toBe(202);
      const reviewStep = await w.claim();
      expect(reviewStep.step.kind).toBe('review');
      await w.done(reviewStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-r1',
      });
      expect(w.todoRow().phase).toBe('review');
      expect(w.stepRow(reviewStep.step.id).status).toBe('done');
      expect(w.buildRow(buildStep.step.buildId).errorMessage).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 5 (source of truth): repo-less project with hasChanges=true proceeds to review -- the gate does not read the always-empty projection', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        sessionId: 'pi-b6',
      });
      expect(w.todoRow().phase).toBe('review');
    } finally {
      w.s.dispose();
    }
  });
});

describe('gate 2 drift naming (#1195): branch drift is no longer "build produced zero changes"', () => {
  const DRIFT = {
    expected: 'cairn/conv-0198f6c0-0000-7000-8000-000000000000',
    actual: 'dogfood/tracer-1153-verification-note',
  };

  test('failure mode 6: hasChanges=false + workBranchDrift -> failure reason names the branch drift', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        workBranchDrift: DRIFT,
        sessionId: 'pi-d1',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
      const msg = w.buildRow(buildId).errorMessage ?? '';
      expect(msg).not.toBe('构建零改动');
      expect(msg).toContain(DRIFT.actual);
      expect(msg).toContain(DRIFT.expected);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 7: hasChanges=true + workBranchDrift -> hard failure naming both branches, PR not kept', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        workBranchDrift: DRIFT,
        prUrl: 'https://github.com/example/repo/pull/1277',
        prNumber: 1277,
        sessionId: 'pi-d2',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
      const msg = w.buildRow(buildId).errorMessage ?? '';
      expect(msg).toContain(DRIFT.actual);
      expect(msg).toContain(DRIFT.expected);
      expect(msg).not.toBe('构建零改动');
      expect(msg).not.toContain('未见任何提交');
      expect(w.buildRow(buildId).prUrl).toBeNull();
      expect(w.buildRow(buildId).prNumber).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 9: legacy daemon payload (no drift field) -> "build produced zero changes" unchanged', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-d3',
      });
      expect(w.buildRow(buildId).errorMessage).toBe('构建零改动');
    } finally {
      w.s.dispose();
    }
  });
});

describe('plan structure gate (#1492): invalid Verification -> confirm unreachable', () => {
  test('failure modes 10 and 12: first round has a fluff plan -> stays planning, enqueues a structure completion round naming the problem', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const first = await w.claim();
      await w.uploadPlan(first.step.id, VAGUE_PLAN);
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-c1' });
      expect(w.todoRow().phase).toBe('planning');
      expect(w.todoRow().hasPlan).toBe(false);
      const pending = w
        .stepsOf(buildId)
        .filter((st) => st.kind === 'plan' && st.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(isPlanContractRewritePrompt(pending[0]!.prompt)).toBe(true);
      expect(pending[0]!.prompt).toContain('第 1 项');
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 11: structure completion round still invalid -> failure wrap-up naming the reason, plan step capped at two rounds', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const first = await w.claim();
      await w.uploadPlan(first.step.id, VAGUE_PLAN);
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-c2' });
      const second = await w.claim();
      await w.uploadPlan(second.step.id, `${VAGUE_PLAN}- 再看一眼\n`);
      await w.done(second.step.id, { status: 'success', sessionId: 'pi-c2' });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(second.step.id).status).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toContain('方案结构不合格');
      expect(w.buildRow(buildId).errorMessage).toContain('Verification');
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 13: structure completion round not re-uploaded -> judged on the old version, still invalid so it fails', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const first = await w.claim();
      await w.uploadPlan(first.step.id, VAGUE_PLAN);
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-c3' });
      const second = await w.claim();
      await w.done(second.step.id, { status: 'success', sessionId: 'pi-c3' });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toContain('方案结构不合格');
    } finally {
      w.s.dispose();
    }
  });

  test('structure completion round fills in Verification -> proceeds to confirm', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(true);
      const first = await w.claim();
      await w.uploadPlan(first.step.id, VAGUE_PLAN);
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-c4' });
      const second = await w.claim();
      await w.uploadPlan(second.step.id, GOOD_PLAN);
      await w.done(second.step.id, { status: 'success', sessionId: 'pi-c4' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 14: a valid first-round plan proceeds straight to confirm, no extra completion round', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const first = await w.claim();
      await w.uploadPlan(first.step.id, GOOD_PLAN);
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-c5' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(1);
    } finally {
      w.s.dispose();
    }
  });
});

describe('build step fallback report (#1492)', () => {
  test('failure mode 15: machine reports the build step failed -> writes a fallback report with the failure reason', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'failed',
        errorMessage: 'agent 进程退出码 137',
        sessionId: 'pi-f1',
      });
      expect(w.todoRow().phase).toBe('failed');
      const reports = w
        .messagesOf(buildId)
        .filter((m) => m.role === 'system' && String(m.content).startsWith('构建步兜底报告'));
      expect(reports).toHaveLength(1);
      expect(String(reports[0]!.content)).toContain('agent 进程退出码 137');
    } finally {
      w.s.dispose();
    }
  });

  test('artifact-gate failure (build produced zero changes) also writes a fallback report', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, { status: 'success', hasChanges: false, sessionId: 'pi-f2' });
      const report = w
        .messagesOf(buildId)
        .find((m) => m.role === 'system' && String(m.content).startsWith('构建步兜底报告'));
      expect(String(report?.content)).toContain('构建零改动');
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 16: empty failure reason -> errorMessage filled with an explanatory text', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, { status: 'failed', errorMessage: '', sessionId: 'pi-f3' });
      expect(w.buildRow(buildId).errorMessage).toBe('build 步异常结束，未上报原因');
    } finally {
      w.s.dispose();
    }
  });

  test('failure mode 17: plan step failure does not write the build fallback report', async () => {
    const w = await setupWorld();
    try {
      const { buildId } = await runTwoEmptyPlanRounds(w);
      expect(w.todoRow().phase).toBe('failed');
      const reports = w
        .messagesOf(buildId)
        .filter((m) => m.role === 'system' && String(m.content).startsWith('构建步兜底报告'));
      expect(reports).toHaveLength(0);
    } finally {
      w.s.dispose();
    }
  });
});
