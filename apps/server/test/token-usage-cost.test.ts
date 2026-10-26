import { todoRecordSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  provider as providerTable,
  step as stepTable,
  tokenUsage,
} from '../src/db/schema.js';
import { backfillTokenUsageCost } from '../src/services/token-usage-cost.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const RATES = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const FREE_RATES = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const TOKENS = { input: 1000, output: 2000, cacheRead: 4000, cacheWrite: 8000 };
const PRICED_MODEL = 'stub-gw/org/stub-model';
const FREE_MODEL = 'stub-gw/free-model';
const UNKNOWN_MODEL = 'stub-gw/org/unknown-model';
const REPORTED_MODEL = 'github-copilot/gpt-5.4';
const REPORTED_COST = { input: 0.01, output: 0.02, cacheRead: 0, cacheWrite: 0, total: 0.03 };
const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function world() {
  const s = bootServer({ claimHoldMs: 60_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-cost',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [
        { id: 'org/stub-model', name: 'Stub', cost: RATES },
        { id: 'free-model', name: 'Free', cost: FREE_RATES },
      ],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: 'agent-cost',
      teamId: s.team.id,
      displayName: 'cost-builder',
      provider: 'stub-gw',
      modelId: 'org/stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'cost-mbp', cliVersion: '0.1.0' },
  });
  expect(enrollRes.status).toBe(200);
  bindAllAgents(s);
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  return { s, token, projectId };
}

async function createTodo(s: TestServer, projectId: string, title: string): Promise<string> {
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title, spec: '' },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId: 'agent-cost' } },
      withPlan: false,
    },
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
}

async function claimStep(app: Hono, token: string) {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as {
    step: { step: { id: string; buildId: string; machineId: string | null } } | null;
  };
  if (!body.step?.step.machineId) throw new Error('claim returned no step');
  return {
    stepId: body.step.step.id,
    buildId: body.step.step.buildId,
    machineId: body.step.step.machineId,
  };
}

async function reportDone(app: Hono, token: string, stepId: string, usage: unknown[]) {
  const res = await call(app, 'POST', `/api/machine/done/${stepId}`, {
    cred: token,
    body: { status: 'success', usage, hasChanges: true },
  });
  expect(res.status).toBe(200);
}

async function readTodo(s: TestServer, id: string) {
  const res = await req(s.app, 'GET', `/api/todos/${id}`);
  expect(res.status).toBe(200);
  return todoRecordSchema.parse(await res.json());
}

function usageRow(s: TestServer, model: string) {
  return s.db.select().from(tokenUsage).where(eq(tokenUsage.model, model)).get();
}

function expectRates(
  row: {
    costInput: number | null;
    costOutput: number | null;
    costCacheRead: number | null;
    costCacheWrite: number | null;
    costTotal: number | null;
  },
  factor: number,
) {
  expect(row.costInput).toBeCloseTo(0.003 * factor, 9);
  expect(row.costOutput).toBeCloseTo(0.03 * factor, 9);
  expect(row.costCacheRead).toBeCloseTo(0.0012 * factor, 9);
  expect(row.costCacheWrite).toBeCloseTo(0.03 * factor, 9);
  expect(row.costTotal).toBeCloseTo(0.0642 * factor, 9);
}

function expectUnknown(row: {
  costInput: number | null;
  costOutput: number | null;
  costCacheRead: number | null;
  costCacheWrite: number | null;
  costTotal: number | null;
}) {
  expect(row.costInput).toBeNull();
  expect(row.costOutput).toBeNull();
  expect(row.costCacheRead).toBeNull();
  expect(row.costCacheWrite).toBeNull();
  expect(row.costTotal).toBeNull();
}

describe('token usage cost at write time', () => {
  test('a priced model is tokens times the declared rates, and a model with no price is null', async () => {
    const w = await world();
    try {
      const todoId = await createTodo(w.s, w.projectId, 'Priced and unknown');
      await startBuild(w.s, w.projectId, todoId);
      const claimed = await claimStep(w.s.app, w.token);
      await reportDone(w.s.app, w.token, claimed.stepId, [
        { model: PRICED_MODEL, ...TOKENS, cost: ZERO_COST },
        { model: UNKNOWN_MODEL, ...TOKENS },
      ]);
      const priced = usageRow(w.s, PRICED_MODEL);
      const unknown = usageRow(w.s, UNKNOWN_MODEL);
      expect(priced?.cacheWrite).toBe(8000);
      expect(unknown?.cacheWrite).toBe(8000);
      expectRates(priced!, 1);
      expectUnknown(unknown!);
    } finally {
      w.s.dispose();
    }
  });

  test('explicit zero rates stay zero, a reported price is kept, and an all-zero report is unknown', async () => {
    const w = await world();
    try {
      const todoId = await createTodo(w.s, w.projectId, 'Free reported and zero report');
      await startBuild(w.s, w.projectId, todoId);
      const claimed = await claimStep(w.s.app, w.token);
      await reportDone(w.s.app, w.token, claimed.stepId, [
        { model: FREE_MODEL, ...TOKENS },
        { model: REPORTED_MODEL, ...TOKENS, cost: REPORTED_COST },
        { model: 'relay-186/mystery', ...TOKENS, cost: ZERO_COST },
      ]);
      const free = usageRow(w.s, FREE_MODEL);
      expect(free).toMatchObject({
        cacheWrite: 8000,
        costInput: 0,
        costOutput: 0,
        costCacheRead: 0,
        costCacheWrite: 0,
        costTotal: 0,
      });
      expect(usageRow(w.s, REPORTED_MODEL)).toMatchObject({
        costInput: 0.01,
        costOutput: 0.02,
        costCacheRead: 0,
        costCacheWrite: 0,
        costTotal: 0.03,
      });
      expectUnknown(usageRow(w.s, 'relay-186/mystery')!);
    } finally {
      w.s.dispose();
    }
  });

  test('a later step recomputes a priced row from the summed tokens and leaves an unknown price untouched', async () => {
    const w = await world();
    try {
      const pricedTodo = await createTodo(w.s, w.projectId, 'Accumulated cost');
      const unknownTodo = await createTodo(w.s, w.projectId, 'Unknown only');
      const idleTodo = await createTodo(w.s, w.projectId, 'Never ran');
      await startBuild(w.s, w.projectId, pricedTodo);
      const first = await claimStep(w.s.app, w.token);
      await reportDone(w.s.app, w.token, first.stepId, [
        { model: PRICED_MODEL, ...TOKENS },
        { model: UNKNOWN_MODEL, ...TOKENS },
        { model: REPORTED_MODEL, ...TOKENS, cost: REPORTED_COST },
        { model: FREE_MODEL, ...TOKENS },
      ]);
      w.s.db
        .insert(stepTable)
        .values({
          id: 'step-cost-2',
          buildId: first.buildId,
          kind: 'build',
          machineId: first.machineId,
          status: 'claimed',
          claimedAt: Date.now(),
          createdAt: Date.now(),
        })
        .run();
      await reportDone(w.s.app, w.token, 'step-cost-2', [
        {
          model: PRICED_MODEL,
          ...TOKENS,
          cost: { input: 10, output: 20, cacheRead: 30, cacheWrite: 39, total: 99 },
        },
        { model: UNKNOWN_MODEL, ...TOKENS },
        { model: REPORTED_MODEL, ...TOKENS },
      ]);
      const priced = usageRow(w.s, PRICED_MODEL);
      expect(priced).toMatchObject({
        input: 2000,
        output: 4000,
        cacheRead: 8000,
        cacheWrite: 16000,
      });
      expectRates(priced!, 2);
      const unknown = usageRow(w.s, UNKNOWN_MODEL);
      expect(unknown).toMatchObject({ input: 2000, cacheWrite: 16000 });
      expectUnknown(unknown!);
      expect(usageRow(w.s, REPORTED_MODEL)).toMatchObject({
        input: 2000,
        output: 4000,
        cacheRead: 8000,
        cacheWrite: 16000,
        costInput: 0.01,
        costOutput: 0.02,
        costCacheRead: 0,
        costCacheWrite: 0,
        costTotal: 0.03,
      });
      const task = await readTodo(w.s, pricedTodo);
      expect(task.usageCost?.total).toBeCloseTo(0.1284 + 0.03, 9);
      expect(task.usageCost).not.toHaveProperty('priced');

      await startBuild(w.s, w.projectId, unknownTodo);
      const onlyUnknown = await claimStep(w.s.app, w.token);
      await reportDone(w.s.app, w.token, onlyUnknown.stepId, [
        { model: 'relay-186/mystery', ...TOKENS, cost: ZERO_COST },
      ]);
      expect(await readTodo(w.s, unknownTodo)).toMatchObject({
        usageCost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, priced: false },
      });
      const idle = await readTodo(w.s, idleTodo);
      expect(idle.usageCost).toBeUndefined();
    } finally {
      w.s.dispose();
    }
  });

  test('backfill prices legacy zero rows when the rate is known and clears the rest once', async () => {
    const w = await world();
    try {
      const todoId = await createTodo(w.s, w.projectId, 'Legacy rows');
      w.s.db
        .insert(buildTable)
        .values({
          id: 'build-legacy',
          todoId,
          withPlan: false,
          triggerSource: 'user',
          createdAt: Date.now(),
        })
        .run();
      w.s.db
        .insert(tokenUsage)
        .values([
          {
            buildId: 'build-legacy',
            model: PRICED_MODEL,
            ...TOKENS,
            costInput: 0,
            costOutput: 0,
            costCacheRead: 0,
            costCacheWrite: 0,
            costTotal: 0,
          },
          {
            buildId: 'build-legacy',
            model: 'stub-gw/missing',
            ...TOKENS,
            costInput: 0,
            costOutput: 0,
            costCacheRead: 0,
            costCacheWrite: 0,
            costTotal: 0,
          },
          {
            buildId: 'build-legacy',
            model: REPORTED_MODEL,
            ...TOKENS,
            costInput: 0.01,
            costOutput: 0.02,
            costCacheRead: 0,
            costCacheWrite: 0,
            costTotal: 0.03,
          },
          {
            buildId: 'build-legacy',
            model: FREE_MODEL,
            ...TOKENS,
            costInput: 0,
            costOutput: 0,
            costCacheRead: 0,
            costCacheWrite: 0,
            costTotal: 0,
          },
        ])
        .run();
      backfillTokenUsageCost(w.s.db);
      expectRates(usageRow(w.s, PRICED_MODEL)!, 1);
      expectUnknown(usageRow(w.s, 'stub-gw/missing')!);
      expect(usageRow(w.s, REPORTED_MODEL)?.costTotal).toBe(0.03);
      expect(usageRow(w.s, FREE_MODEL)?.costTotal).toBe(0);
      backfillTokenUsageCost(w.s.db);
      expectRates(usageRow(w.s, PRICED_MODEL)!, 1);
      expectUnknown(usageRow(w.s, 'stub-gw/missing')!);
      expect(usageRow(w.s, REPORTED_MODEL)?.costTotal).toBe(0.03);
      expect(usageRow(w.s, FREE_MODEL)?.costTotal).toBe(0);
    } finally {
      w.s.dispose();
    }
  });
});
