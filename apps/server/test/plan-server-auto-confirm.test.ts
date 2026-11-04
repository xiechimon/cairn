import {
  CONFIRM_ANNOUNCEMENT,
  claimedStepSchema,
  DEFAULT_AUTONOMY_SETTINGS,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  agent as agentTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { addChiefWatch } from '../src/services/chief.js';
import { answerQuestion, createOrGetQuestion } from '../src/services/chief-questions.js';
import { confirmBuild } from '../src/services/chief-tools.js';
import { ensurePersonasSeeded } from '../src/services/personas.js';
import { createScheduler } from '../src/services/scheduler.js';
import { createSplitTodo } from '../src/services/todo-split.js';
import { getTodo } from '../src/services/todos.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

afterEach(() => vi.useRealTimers());

const AGENT_ID = 'agent-psac-1';
const GOOD_PLAN =
  '# Plan\nKind: fix\nContext: x\n\n## Verification\n- `pnpm exec vitest run README.test.ts` passes\n';

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

async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-psac',
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
      displayName: 'psac-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'psac-mbp', cliVersion: '0.1.0' },
  });
  bindAllAgents(s);
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app, 'demo', { mergePolicy: 'autonomous' });
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'Auto-confirm probe', spec: 'Probe README' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  return {
    s,
    projectId,
    todoId,
    async startBuild(withPlan = true): Promise<string> {
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
    },

    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: unknown };
      if (!body.step) throw new Error('claim returned no step');
      return claimedStepSchema.parse(body.step);
    },

    async done(stepId: string, body: Record<string, unknown>): Promise<void> {
      const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
      expect(res.status).toBe(200);
    },

    async uploadPlan(stepId: string, content: string): Promise<void> {
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
    },

    todoRow() {
      return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
    },

    messagesOf(buildId: string) {
      return s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();
    },

    setMergePolicy(mergePolicy: 'human' | 'autonomous') {
      s.db
        .update(projectTable)
        .set({ autonomy: { ...DEFAULT_AUTONOMY_SETTINGS, mergePolicy } })
        .where(eq(projectTable.id, projectId))
        .run();
    },
  };
}

describe('#1791 server auto-confirm after plan step', () => {
  test('autonomous clean plan waits ten minutes before scheduler confirmation', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, GOOD_PLAN);
      await w.done(planStep.step.id, { status: 'success', sessionId: 'psac-1' });
      expect(w.todoRow().phase).toBe('confirm');
      vi.useFakeTimers({ toFake: ['Date'] });
      const scheduler = createScheduler(w.s.svc, { tickMs: 15_000 });
      const confirmedAt = w.todoRow().phaseAt;
      vi.setSystemTime(confirmedAt + 600_000 - 1);
      scheduler.tick();
      expect(w.todoRow().phase).toBe('confirm');
      vi.setSystemTime(confirmedAt + 600_000);
      scheduler.tick();
      expect(w.todoRow().phase).toBe('building');
      scheduler.tick();
      await confirmBuild(
        {
          db: w.s.db,
          hub: w.s.hub,
          machineHub: w.s.machineHub,
          box: w.s.secretBox,
          user: w.s.user,
          reposDir: w.s.reposDir,
          attachmentsDir: w.s.attachmentsDir,
          skillsDir: w.s.skillsDir,
        },
        buildId,
        'Chief',
      );
      scheduler.stop();
      const announcements = w.messagesOf(buildId).filter((m) => m.content === CONFIRM_ANNOUNCEMENT);
      expect(announcements).toHaveLength(1);
      expect(announcements[0]?.actor).toBe('server');
      const buildSteps = w.s.db
        .select()
        .from(stepTable)
        .where(eq(stepTable.buildId, buildId))
        .all()
        .filter((st) => st.kind === 'build');
      expect(buildSteps).toHaveLength(1);
    } finally {
      w.s.dispose();
    }
  });

  test.each([
    '# Open questions',
    '### DECISIONS NEEDED',
    '###### Decision points',
    '###\tOpen questions',
    'Open questions\n---',
    'Decisions needed\n===',
    '## Open questions\n- Choose the storage backend.\n---\n## Notes\nlater',
    '## Decisions needed\nUse SQLite or Postgres?\n---',
    '## Open questions:',
    '## **Open questions**',
    '## Open questions\n### Storage',
  ])('%s with content waits for a person', async (heading) => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild();
      const planStep = await w.claim();
      await w.uploadPlan(
        planStep.step.id,
        `${GOOD_PLAN}\n${heading}\nChoose the storage backend.\n`,
      );
      await w.done(planStep.step.id, { status: 'success' });
      createScheduler(w.s.svc, { tickMs: 15_000 }).tick(Date.now() + 600_000);
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.messagesOf(buildId).some((m) => m.content === CONFIRM_ANNOUNCEMENT)).toBe(false);
    } finally {
      w.s.dispose();
    }
  });

  test('an empty Open questions heading confirms after the grace window', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild();
      const planStep = await w.claim();
      await w.uploadPlan(
        planStep.step.id,
        `${GOOD_PLAN}\n## Open questions\n\n## Notes\nnothing pending\n`,
      );
      await w.done(planStep.step.id, { status: 'success' });
      const confirmedAt = w.todoRow().phaseAt;
      const scheduler = createScheduler(w.s.svc, { tickMs: 15_000 });
      scheduler.tick(confirmedAt + 600_000 - 1);
      expect(w.todoRow().phase).toBe('confirm');
      scheduler.tick(confirmedAt + 600_000);
      scheduler.stop();
      expect(w.todoRow().phase).toBe('building');
    } finally {
      w.s.dispose();
    }
  });

  test('an Open questions heading inside a code fence still holds the plan (conservative: fences are not parsed)', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild();
      const planStep = await w.claim();
      await w.uploadPlan(
        planStep.step.id,
        `${GOOD_PLAN}\n\`\`\`md\n## Open questions\nChoose the storage backend.\n\`\`\`\n`,
      );
      await w.done(planStep.step.id, { status: 'success' });
      expect(w.todoRow().phase).toBe('confirm');
      const confirmedAt = w.todoRow().phaseAt;
      const scheduler = createScheduler(w.s.svc, { tickMs: 15_000 });
      scheduler.tick(confirmedAt + 600_000);
      scheduler.stop();
      expect(w.todoRow().phase).toBe('confirm');
    } finally {
      w.s.dispose();
    }
  });

  test('a pending chief question on the watched todo holds confirmation', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild();
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, GOOD_PLAN);
      await w.done(planStep.step.id, { status: 'success' });
      const chiefResponse = await call(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
        body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
      });
      expect(chiefResponse.status).toBe(200);
      const response = await call(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
        body: { content: 'Review this plan' },
      });
      expect(response.status).toBe(201);
      const { thread } = (await response.json()) as { thread: { id: string } };
      addChiefWatch(w.s.svc, {
        teamId: w.s.team.id,
        todo: getTodo(w.s.svc, w.todoId)!,
        projectName: 'demo',
        threadId: thread.id,
      });
      createOrGetQuestion(w.s.svc, {
        threadId: thread.id,
        requestId: 'ask-plan-confirm',
        questions: [{ header: 'Storage', question: 'Which backend?', options: [] }],
      });
      createScheduler(w.s.svc, { tickMs: 15_000 }).tick(Date.now() + 600_000);
      expect(w.todoRow().phase).toBe('confirm');
      answerQuestion(w.s.svc, {
        threadId: thread.id,
        requestId: 'ask-plan-confirm',
        answers: [{ header: 'Storage', text: 'SQLite' }],
      });
      createScheduler(w.s.svc, { tickMs: 15_000 }).tick(Date.now() + 600_000);
      expect(w.todoRow().phase).toBe('building');
    } finally {
      w.s.dispose();
    }
  });

  test('a pending chief question on an unwatched thread does not hold the plan', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild();
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, GOOD_PLAN);
      await w.done(planStep.step.id, { status: 'success' });
      expect(w.todoRow().phase).toBe('confirm');
      const chiefResponse = await call(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/chief`, {
        body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
      });
      expect(chiefResponse.status).toBe(200);
      const response = await call(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
        body: { content: 'Unrelated thread' },
      });
      expect(response.status).toBe(201);
      const { thread } = (await response.json()) as { thread: { id: string } };
      createOrGetQuestion(w.s.svc, {
        threadId: thread.id,
        requestId: 'ask-other-thread',
        questions: [{ header: 'Lunch', question: 'Sandwiches?', options: [] }],
      });
      const confirmedAt = w.todoRow().phaseAt;
      const scheduler = createScheduler(w.s.svc, { tickMs: 15_000 });
      scheduler.tick(confirmedAt + 600_000);
      scheduler.stop();
      expect(w.todoRow().phase).toBe('building');
    } finally {
      w.s.dispose();
    }
  });

  test('human mergePolicy, split parent, and user plan revision stay at confirm', async () => {
    const w = await setupWorld();
    try {
      w.setMergePolicy('human');
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, GOOD_PLAN);
      await w.done(planStep.step.id, { status: 'success', sessionId: 'psac-2a' });
      createScheduler(w.s.svc, { tickMs: 15_000 }).tick(Date.now() + 600_000);
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.messagesOf(buildId).some((m) => m.content === CONFIRM_ANNOUNCEMENT)).toBe(false);

      const revisionRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'revision',
          side: 'plan',
          feedback: 'Use a smaller scope',
          clientMessageId: 'psac-rev-1',
        },
      });
      expect(revisionRes.status).toBe(202);
      expect(w.todoRow().phase).toBe('planning');
      w.setMergePolicy('autonomous');
      const replan = await w.claim();
      await w.uploadPlan(replan.step.id, GOOD_PLAN.replace('Context: x', 'Context: y'));
      await w.done(replan.step.id, { status: 'success', sessionId: 'psac-2b' });
      createScheduler(w.s.svc, { tickMs: 15_000 }).tick(Date.now() + 600_000);
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.messagesOf(buildId).filter((m) => m.content === CONFIRM_ANNOUNCEMENT)).toHaveLength(
        0,
      );

      const splitWorld = await setupWorld();
      try {
        ensurePersonasSeeded(splitWorld.s.db, splitWorld.s.team.id);
        const implementerId = AGENT_ID;
        const splitDeps = {
          db: splitWorld.s.db,
          hub: splitWorld.s.hub,
          machineHub: splitWorld.s.machineHub,
          user: splitWorld.s.user,
        };
        const split = createSplitTodo(splitDeps, {
          parentId: splitWorld.todoId,
          subtodos: [
            { title: 'Child A', spec: 'child a', agentId: implementerId },
            { title: 'Child B', spec: 'child b', agentId: implementerId },
          ],
          chiefAgentId: null,
          chiefId: 'chief-psac',
          threadId: 'chief-thread-1',
          actorName: 'Chief',
        });
        splitWorld.s.db
          .update(planTable)
          .set({ content: GOOD_PLAN })
          .where(eq(planTable.buildId, split.parentBuildId))
          .run();
        createScheduler(splitWorld.s.svc, { tickMs: 15_000 }).tick(
          splitWorld.todoRow().phaseAt + 600_000,
        );
        expect(splitWorld.todoRow().phase).toBe('confirm');
        expect(
          splitWorld
            .messagesOf(split.parentBuildId)
            .some((m) => m.content === CONFIRM_ANNOUNCEMENT),
        ).toBe(false);
      } finally {
        splitWorld.s.dispose();
      }
    } finally {
      w.s.dispose();
    }
  });
});
