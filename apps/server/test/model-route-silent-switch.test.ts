import type { ClaimedStep } from '@cairn/shared';
import {
  CHIEF_MODEL_FALLBACK_KIND,
  chiefModelFallbackContentSchema,
  claimedStepSchema,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chiefMessage,
  claudeSubscription,
  machine as machineTable,
  message as messageTable,
  stepRoute,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { nowMs } from '../src/lib/ids.js';
import { createProvider } from '../src/services/providers.js';
import {
  bootServer,
  insertAntigravitySubscription,
  insertClaudeSubscription,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});

interface World {
  s: TestServer;
  machineToken: string;
  machineId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 50 });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      readyMachine({ teamId: s.team.id, name: 'route-box', cliVersion: '0.3.0' }),
    ),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  const projectId = await postProject(s.app, 'route-proj');
  return { s, machineToken, machineId, projectId };
}

function equipClaudeMachine(
  w: World,
  options: { subscription?: boolean; weeklyUtilization?: number } = {},
): void {
  if (options.subscription !== false) {
    const existing = w.s.db
      .select()
      .from(claudeSubscription)
      .where(eq(claudeSubscription.teamId, w.s.team.id))
      .get();
    if (existing === undefined) insertClaudeSubscription(w.s);
  }
  w.s.db
    .update(machineTable)
    .set({
      online: true,
      claudeCodeReport: {
        installed: true,
        hostname: 'route-box',
        models: [
          { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', slot: 'builtin' },
          { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', slot: 'builtin' },
          { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', slot: 'builtin' },
        ],
        auth: { state: 'not-logged-in', provider: 'firstParty' },
      },
      claudeRateLimits:
        options.weeklyUtilization === undefined
          ? []
          : [
              {
                subscription: 'seven_day',
                status: 'allowed',
                utilization: options.weeklyUtilization,
                resetsAt: nowMs() + 86_400_000,
                reportedAt: nowMs(),
              },
            ],
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [{ id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' }],
        },
        antigravityOAuthProfile: true,
      },
    })
    .where(eq(machineTable.id, w.machineId))
    .run();
}

function addProvider(w: World, providerId: string, modelId: string, apiKey = 'sk-test-key'): void {
  createProvider(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      body: {
        providerId,
        label: providerId,
        baseUrl:
          providerId === 'openai-codex'
            ? 'https://chatgpt.com/backend-api'
            : 'https://example.invalid/v1',
        api: providerId === 'openai-codex' ? 'openai-responses' : 'openai-completions',
        apiKey,
        models: [{ id: modelId, name: modelId }],
      },
      createdBy: w.s.user.id,
    },
  );
}

async function buildTodo(
  w: World,
  spec: string,
): Promise<{ todoRow: typeof todoTable.$inferSelect; buildId: string }> {
  const todoRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title: 'frontend polish',
    spec,
  });
  expect(todoRes.status).toBe(201);
  const todoId = ((await todoRes.json()) as { id: string }).id;
  const started = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [todoId],
    withPlan: false,
  });
  expect(started.status).toBe(201);
  const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  return { todoRow, buildId: todoRow.latestBuildId! };
}

async function claim(w: World): Promise<ClaimedStep | null> {
  const res = await w.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${w.machineToken}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

describe('silent model switch and explicit model preservation', () => {
  test('T1: explicitly pinned task model stays on Opus on a small task while unpinned small task tiers to Haiku', async () => {
    const w = await setupWorld();
    equipClaudeMachine(w);
    seedRoute(w.s, 'session', { provider: 'claude-code', modelId: 'claude-opus-5-5' });
    const { todoRow } = await buildTodo(w, '把按钮间距从 8px 调成 12px');
    w.s.db
      .update(todoTable)
      .set({
        request: {
          segments: [
            {
              source: { kind: 'chat', threadId: 't1', messageId: 'm1', span: 'whole' },
              author: 'owner',
              sourceRef: null,
              text: '把按钮间距从 8px 调成 12px',
            },
          ],
          siblings: [],
          difficulty: 'easy',
          titleSource: 'owner',
          titleSourceRef: null,
          model: { provider: 'claude-code', modelId: 'claude-opus-5-5', thinkingLevel: null },
        },
      })
      .where(eq(todoTable.id, todoRow.id))
      .run();

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed!.agent?.provider).toBe('claude-code');
    expect(claimed!.agent?.modelId).toBe('claude-opus-5-5');

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, claimed!.step.id))
      .get()!;
    expect(stepRow.ranModel).toEqual({ provider: 'claude-code', modelId: 'claude-opus-5-5' });
    expect(stepRow.fallback).toBeNull();
    expect(stepRow.claudeSubscriptionId).not.toBeNull();

    const routeRow = w.s.db
      .select()
      .from(stepRoute)
      .where(eq(stepRoute.stepId, claimed!.step.id))
      .get()!;
    expect(routeRow.provider).toBe('claude-code');
    expect(routeRow.modelId).toBe('claude-opus-5-5');
    expect(routeRow.reason).toBe('configured model');

    await buildTodo(w, '把按钮间距从 8px 调成 12px');
    const tiered = await claim(w);
    expect(tiered?.agent?.provider).toBe('claude-code');
    expect(tiered?.agent?.modelId).toBe('claude-haiku-5-5');
  });

  test('T2: non-routed antigravity session rule records configured model instead of misleading availability-changed reason', async () => {
    const w = await setupWorld();
    equipClaudeMachine(w);
    insertAntigravitySubscription(w.s, { token: 'ag-test-token' });
    seedRoute(w.s, 'session', { provider: 'antigravity', modelId: 'gemini-4-hydrogen' });
    await buildTodo(w, '修复样式');

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed!.agent?.provider).toBe('antigravity');
    expect(claimed!.agent?.modelId).toBe('gemini-3.8-flash');

    const routeRow = w.s.db
      .select()
      .from(stepRoute)
      .where(eq(stepRoute.stepId, claimed!.step.id))
      .get()!;
    expect(routeRow.provider).toBe('antigravity');
    expect(routeRow.modelId).toBe('gemini-3.8-flash');
    expect(routeRow.reason).toBe('easy: antigravity/gemini-3.8-flash (tier easy)');
    expect(routeRow.reason).not.toContain('availability changed during the claim');
  });

  test('T3: stock-seed fallback to provider records step.fallback and posts a visible fallback line', async () => {
    const w = await setupWorld();
    equipClaudeMachine(w, { subscription: false });
    addProvider(w, 'vani', 'm1');
    seedRoute(w.s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
    const { buildId } = await buildTodo(w, '修复样式');

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed!.agent?.provider).toBe('vani');
    expect(claimed!.agent?.modelId).toBe('m1');

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, claimed!.step.id))
      .get()!;
    expect(stepRow.ranModel).toEqual({ provider: 'vani', modelId: 'm1' });
    expect(stepRow.fallback?.model).toEqual({ provider: 'vani', modelId: 'm1' });

    const sysMsgs = w.s.db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.conversationId, buildId), eq(messageTable.role, 'system')))
      .all()
      .map((m) => String(m.content));
    expect(
      sysMsgs.some(
        (c) =>
          c.includes('已换备用模型') &&
          c.includes('claude-code/claude-sonnet-5-5') &&
          c.includes('vani/m1'),
      ),
    ).toBe(true);
  });

  test('T4: capability-routed stock-seed switch from over-quota Claude to Codex records step.fallback and posts a visible fallback line', async () => {
    const w = await setupWorld();
    equipClaudeMachine(w, { weeklyUtilization: 0.85 });
    addProvider(w, 'openai-codex', 'gpt-6.1-sol');
    seedRoute(w.s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
    const { buildId } = await buildTodo(w, 'x'.repeat(800));

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed!.agent?.provider).toBe('openai-codex');
    expect(claimed!.agent?.modelId).toBe('gpt-6.1-sol');

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, claimed!.step.id))
      .get()!;
    expect(stepRow.fallback?.model).toEqual({ provider: 'openai-codex', modelId: 'gpt-6.1-sol' });

    const sysMsgs = w.s.db
      .select()
      .from(messageTable)
      .where(and(eq(messageTable.conversationId, buildId), eq(messageTable.role, 'system')))
      .all()
      .map((m) => String(m.content));
    expect(
      sysMsgs.some(
        (c) =>
          c.includes('已换备用模型') &&
          c.includes('claude-code/claude-sonnet-5-5') &&
          c.includes('openai-codex/gpt-6.1-sol') &&
          c.includes('额度'),
      ),
    ).toBe(true);
  });

  test('T5: declared step.fallback records the effective fallback provider and model in step_route', async () => {
    const w = await setupWorld();
    equipClaudeMachine(w);
    addProvider(w, 'vani', 'm1');
    seedRoute(w.s, 'session', { provider: 'claude-code', modelId: 'claude-opus-5-5' });
    const { buildId } = await buildTodo(w, '修复样式');

    const pendingStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, buildId))
      .get()!;
    w.s.db
      .update(stepTable)
      .set({
        fallback: {
          model: { provider: 'vani', modelId: 'm1' },
          tried: ['claude-code/claude-opus-5-5', 'vani/m1'],
          zeroUsageRetried: false,
        },
      })
      .where(eq(stepTable.id, pendingStep.id))
      .run();

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed!.agent?.provider).toBe('vani');
    expect(claimed!.agent?.modelId).toBe('m1');

    const routeRow = w.s.db
      .select()
      .from(stepRoute)
      .where(eq(stepRoute.stepId, claimed!.step.id))
      .get()!;
    expect(routeRow.provider).toBe('vani');
    expect(routeRow.modelId).toBe('m1');
    expect(routeRow.reason).not.toContain('availability changed during the claim');
  });

  test('T6: project coordinator override falling back from missing provider records step.fallback and posts a visible fallback notice', async () => {
    const w = await setupWorld();
    equipClaudeMachine(w);
    seedRoute(w.s, 'coordinator', {
      provider: 'claude-code',
      modelId: 'claude-opus-5-5',
      machineId: w.machineId,
    });
    const patched = await req(w.s.app, 'PATCH', `/api/projects/${w.projectId}`, {
      modelOverrides: {
        coordinator: {
          provider: 'removed-provider',
          modelId: 'missing-model',
          thinkingLevel: null,
        },
      },
    });
    expect(patched.status).toBe(200);

    const opened = await req(
      w.s.app,
      'POST',
      `/api/teams/${w.s.team.id}/chief/channels/${w.projectId}`,
    );
    expect([200, 201]).toContain(opened.status);
    const thread = (await opened.json()) as { id: string };
    const sent = await req(w.s.app, 'POST', `/api/conversations/${thread.id}/messages`, {
      content: 'hello',
    });
    expect(sent.status).toBe(201);

    const claimed = await claim(w);
    expect(claimed).not.toBeNull();
    expect(claimed!.step.kind).toBe('chief');
    expect(claimed!.agent?.provider).toBe('claude-code');
    expect(claimed!.agent?.modelId).toBe('claude-opus-5-5');

    const stepRow = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.id, claimed!.step.id))
      .get()!;
    expect(stepRow.fallback?.model).toEqual({
      provider: 'claude-code',
      modelId: 'claude-opus-5-5',
    });

    const notices = w.s.db
      .select()
      .from(chiefMessage)
      .where(and(eq(chiefMessage.threadId, thread.id), eq(chiefMessage.role, 'system')))
      .all()
      .flatMap((row) => {
        try {
          const parsed = chiefModelFallbackContentSchema.safeParse(
            typeof row.content === 'string' ? JSON.parse(row.content) : row.content,
          );
          return parsed.success ? [parsed.data] : [];
        } catch {
          return [];
        }
      });
    expect(notices).toContainEqual({
      kind: CHIEF_MODEL_FALLBACK_KIND,
      from: 'removed-provider/missing-model',
      to: 'claude-code/claude-opus-5-5',
      stepId: claimed!.step.id,
      announced: true,
    });
  });
});
