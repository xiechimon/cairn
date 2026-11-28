import type { ClaudeCodeReport } from '@cairn/shared';
import { desc, eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { coordinatorProviders } from '../src/coordinator/credentials.js';
import {
  chiefMessage as chiefMessageTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { serverTakesTurn } from '../src/services/machine-claim.js';
import { getModelLiveness } from '../src/services/model-liveness.js';
import { providerHealth } from '../src/services/provider-health.js';
import { createProvider } from '../src/services/providers.js';
import {
  bootServer,
  claimedGeneration,
  insertClaudeSubscription,
  issueApiKey,
  seedRoute,
  type TestServer,
} from './helpers.js';
import { readStepFixture } from './step-groups-fixture.js';

const CLAUDE_REPORT = {
  installed: true,
  hostname: 'mbp',
  models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet' }],
  auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
} as ClaudeCodeReport;

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
  providerHealth.reset();
});

function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
) {
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

function addProvider(s: TestServer, providerId: string, models: { id: string }[]) {
  createProvider(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      body: {
        providerId,
        label: providerId,
        baseUrl: `http://127.0.0.1:9/${providerId}`,
        api: 'openai-completions',
        apiKey: `${providerId}-key`,
        models: models.map((m) => ({ id: m.id, name: m.id })),
      },
      createdBy: s.user.id,
    },
  );
}

async function enroll(s: TestServer, report: ClaudeCodeReport | null = null) {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: {
      ...readyMachine({ teamId: s.team.id, name: 'ran-mbp', cliVersion: '9.9.9' }),
      ...(report !== null ? { claudeCode: report } : {}),
    },
  });
  expect(res.status).toBe(200);
  const { token } = (await res.json()) as { token: string };
  const machineId = s.db.select().from(machineTable).get()!.id;
  return { token, machineId };
}

async function newTurn(s: TestServer): Promise<string> {
  const res = await call(s.app, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
    body: { content: 'hello' },
  });
  expect(res.status).toBe(201);
  const row = s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.kind, 'chief'))
    .orderBy(desc(stepTable.createdAt))
    .get();
  expect(row).toBeDefined();
  return row!.id;
}

async function claim(s: TestServer, token: string) {
  const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as {
    step: { step: { id: string }; agent: { provider: string; modelId: string } } | null;
  };
  return body.step;
}

async function done(s: TestServer, token: string, stepId: string, body: Record<string, unknown>) {
  const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
    cred: token,
    body: { generation: claimedGeneration(s.db, stepId), ...body },
  });
  expect(res.status).toBe(200);
}

function stepRow(s: TestServer, stepId: string) {
  return readStepFixture(s.db, stepId)!;
}

function errorFacts(s: TestServer, stepId: string): Record<string, unknown> {
  const row = s.db
    .select()
    .from(chiefMessageTable)
    .where(eq(chiefMessageTable.id, `chief-err-${stepId}`))
    .get();
  expect(row, `chief-err-${stepId} message`).toBeDefined();
  return JSON.parse(String(row!.content)) as Record<string, unknown>;
}

describe('the model a Coordinator step ran is recorded at claim, not re-derived from the live rule', () => {
  test('a Chief step claimed on Claude Code names its model on the error card', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    disposables.push(() => s.dispose());
    insertClaudeSubscription(s);
    const { token, machineId } = await enroll(s, CLAUDE_REPORT);
    seedRoute(s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      machineId,
    });
    const stepId = await newTurn(s);
    const claimed = await claim(s, token);
    expect(claimed?.agent).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
    });
    await done(s, token, stepId, {
      status: 'failed',
      errorMessage:
        "claude-code backend: tool schema 'computer_act'.parameters.properties.actions.items.properties.x type 'integer' not in vocabulary (fail-closed)",
    });
    expect(errorFacts(s, stepId)).toMatchObject({
      provider: 'claude-code',
      model: 'claude-sonnet-5-5',
    });
  });

  test('a step claimed on workbuddy that finishes after the rule changed still names workbuddy', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    disposables.push(() => s.dispose());
    const { token, machineId } = await enroll(s);
    addProvider(s, 'workbuddy', [{ id: 'deepseek-v4.1-flash' }]);
    addProvider(s, 'anthropic', [{ id: 'claude-sonnet-5-5' }]);
    seedRoute(s, 'coordinator', {
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
      machineId,
    });
    const stepId = await newTurn(s);
    const claimed = await claim(s, token);
    expect(claimed?.agent).toMatchObject({ provider: 'workbuddy' });
    seedRoute(s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      machineId,
    });
    await done(s, token, stepId, { status: 'failed', errorMessage: 'Coordinator turn ended' });
    const facts = errorFacts(s, stepId);
    expect(facts.provider).toBe('workbuddy');
    expect(facts.model).toBe('deepseek-v4.1-flash');
    expect(stepRow(s, stepId).ranModel).toMatchObject({
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
    });
  });

  test('the step token still serves the provider the step was claimed on after the rule changed', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    disposables.push(() => s.dispose());
    const { token, machineId } = await enroll(s);
    addProvider(s, 'workbuddy', [{ id: 'deepseek-v4.1-flash' }]);
    addProvider(s, 'anthropic', [{ id: 'claude-sonnet-5-5' }]);
    seedRoute(s, 'coordinator', {
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
      machineId,
    });
    const stepId = await newTurn(s);
    await claim(s, token);
    seedRoute(s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      machineId,
    });
    const res = await call(
      s.app,
      'GET',
      `/api/machine/token/${stepId}?generation=${stepRow(s, stepId).claimedAt}`,
      { cred: token },
    );
    expect(res.status).toBe(200);
    const tok = (await res.json()) as { provider: { providerId: string } | null };
    expect(tok.provider?.providerId).toBe('workbuddy');
  });

  test('a fallback-pinned step is not swallowed by the in-server drain after the rule changed', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    disposables.push(() => s.dispose());
    insertClaudeSubscription(s);
    const { token, machineId } = await enroll(s, CLAUDE_REPORT);
    addProvider(s, 'workbuddy', [{ id: 'deepseek-v4.1-flash' }]);
    seedRoute(s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      fallbackModels: [{ provider: 'claude-code', modelId: 'claude-opus-5-5' }],
      machineId,
    });
    const stepId = await newTurn(s);
    const claimed = await claim(s, token);
    expect(claimed?.agent).toMatchObject({ provider: 'claude-code' });
    await done(s, token, stepId, {
      status: 'failed',
      errorMessage: '404 model not found',
    });
    expect(stepRow(s, stepId).fallback?.model).toEqual({
      provider: 'claude-code',
      modelId: 'claude-opus-5-5',
    });
    seedRoute(s, 'coordinator', {
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
      machineId,
    });
    setCoordinatorInServer(true);
    expect(serverTakesTurn(s.db, s.team.id, stepRow(s, stepId))).toBe(false);
    const again = await claim(s, token);
    expect(again?.agent).toMatchObject({ provider: 'claude-code', modelId: 'claude-opus-5-5' });
  });

  test('in-server providers run the model the step carries, not the live rule', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    disposables.push(() => s.dispose());
    setCoordinatorInServer(true);
    addProvider(s, 'workbuddy', [{ id: 'deepseek-v4.1-flash' }]);
    addProvider(s, 'relay-b', [{ id: 'model-b' }]);
    seedRoute(s, 'coordinator', {
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
    });
    const deps = { db: s.db, box: s.secretBox };
    expect(
      coordinatorProviders(deps, s.team.id, null, {
        provider: 'relay-b',
        modelId: 'model-b',
      })?.router,
    ).toMatchObject({ provider: 'relay-b', modelId: 'model-b' });
  });

  test('finish bookkeeping marks the model that ran dead, not the live rule', async () => {
    const s = bootServer({ claimHoldMs: 100 });
    disposables.push(() => s.dispose());
    const { token, machineId } = await enroll(s);
    addProvider(s, 'workbuddy', [{ id: 'deepseek-v4.1-flash' }]);
    addProvider(s, 'anthropic', [{ id: 'claude-sonnet-5-5' }]);
    seedRoute(s, 'coordinator', {
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
      machineId,
    });
    const stepId = await newTurn(s);
    await claim(s, token);
    seedRoute(s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-sonnet-5-5',
      machineId,
    });
    await done(s, token, stepId, {
      status: 'failed',
      errorMessage: '404 model not found',
    });
    expect(getModelLiveness(s.team.id, 'workbuddy', 'deepseek-v4.1-flash')).toBe('dead');
    expect(getModelLiveness(s.team.id, 'anthropic', 'claude-sonnet-5-5')).not.toBe('dead');
    expect(stepRow(s, stepId).ranModel).toMatchObject({
      provider: 'workbuddy',
      modelId: 'deepseek-v4.1-flash',
    });
  });
});
