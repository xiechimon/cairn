import {
  AGENT_TOOL_PUSH,
  CHIEF_REMOTE_TOOLS,
  type ClaimedStep,
  claimedStepSchema,
  DEFAULT_ANTIGRAVITY_MODELS,
  DEFAULT_CLAUDE_CODE_MODELS,
  DEFAULT_DEVIN_MODELS,
  type ProviderModel,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  chief as chiefTable,
  chiefThread,
  githubConnection,
  machine as machineTable,
  message as messageTable,
  project as projectTable,
  provider as providerTable,
  stepRoute,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { COORDINATOR_SYSTEM_PROMPT } from '../src/services/chief.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { providerHealth } from '../src/services/provider-health.js';
import { createProvider, writeProviderOrder } from '../src/services/providers.js';
import { retryQuotaWaitNow, sweepQuotaWaitSteps } from '../src/services/quota-wait.js';
import { profileForStep } from '../src/services/routing-rules.js';
import { writeQuota } from '../src/services/step-groups/quota.js';
import { writeTopModels } from '../src/services/top-models.js';
import {
  bootServer,
  claimedGeneration,
  insertAntigravitySubscription,
  insertClaudeSubscription,
  insertDevinSubscription,
  issueApiKey,
  postProject,
  req,
  seedPolicy,
  seedRoute,
  type TestServer,
} from './helpers.js';
import { rejectingGithubFetch } from './network-guard.js';
import { ownerTodoParams } from './owner-message.js';
import { readStepFixture } from './step-groups-fixture.js';

const servers: TestServer[] = [];
afterAll(() => {
  for (const s of servers) s.dispose();
});
beforeEach(() => {
  providerHealth.reset();
});

interface World {
  s: TestServer;
  machineToken: string;
  machineId: string;
  projectId: string;
  threadId: string;
  chiefId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({
    claimHoldMs: 50,
    githubFetch: async (input, init) => {
      const probe = /^\/repos\/([^/]+\/[^/]+)$/.exec(new URL(String(input)).pathname);
      if (probe === null) return rejectingGithubFetch(input, init);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ id: 123, full_name: probe[1] }),
        text: async () => JSON.stringify({ id: 123, full_name: probe[1] }),
      };
    },
  });
  servers.push(s);
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify(
      readyMachine({ teamId: s.team.id, name: 'tier-box', cliVersion: '0.3.0' }),
    ),
  });
  expect(res.status).toBe(200);
  const machineToken = ((await res.json()) as { token: string }).token;
  const machineId = s.db
    .select({ id: machineTable.id })
    .from(machineTable)
    .where(eq(machineTable.teamId, s.team.id))
    .get()!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.id, machineId)).run();
  const projectId = await postProject(s.app, 'tier-proj');
  const chiefId = `chief-${s.user.id}-${s.team.id}`;
  const threadId = `chief-${newUuidv7()}`;
  const now = nowMs();
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      watches: [],
      wakes: [],
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId: s.user.id,
      teamId: s.team.id,
      title: 'tier thread',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
  return { s, machineToken, machineId, projectId, threadId, chiefId };
}

function addApiProvider(
  w: World,
  providerId: string,
  models: ProviderModel[],
  opts: { api?: 'openai-completions' | 'anthropic-messages'; apiKey?: string | null } = {},
) {
  return createProvider(
    { db: w.s.db, box: w.s.secretBox },
    {
      teamId: w.s.team.id,
      body: {
        providerId,
        label: providerId,
        baseUrl:
          opts.api === 'anthropic-messages'
            ? 'https://api.anthropic.com'
            : `https://${providerId}.example.invalid/v1`,
        api: opts.api ?? 'openai-completions',
        ...(opts.apiKey === null ? {} : { apiKey: opts.apiKey ?? `${providerId}-key` }),
        models,
      },
      createdBy: w.s.user.id,
    },
  );
}

async function relayTool(w: World, name: string, params: Record<string, unknown>) {
  const text = await executeChiefTool(
    {
      db: w.s.db,
      hub: w.s.hub,
      machineHub: w.s.machineHub,
      box: w.s.secretBox,
      user: w.s.user,
      reposDir: w.s.reposDir,
      attachmentsDir: w.s.attachmentsDir,
      skillsDir: w.s.skillsDir,
      githubFetch: w.s.svc.githubFetch,
    },
    {
      teamId: w.s.team.id,
      userId: w.s.user.id,
      chiefId: w.chiefId,
      threadId: w.threadId,
      chiefAgentId: 'coord-1',
      conversationId: w.threadId,
    },
    name,
    params,
  );
  return JSON.parse(text) as Record<string, unknown>;
}

async function createAndBuild(
  w: World,
  words: string,
  extra: Record<string, unknown> = {},
): Promise<{ todoId: string; buildId: string }> {
  const created = await relayTool(w, 'create_todo', {
    ...ownerTodoParams(w.s.db, w.threadId, w.projectId, words),
    title: words.slice(0, 30),
    ...extra,
  });
  const todoId = String(created.id);
  const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  return { todoId, buildId: todoRow.latestBuildId! };
}

async function claim(w: World, token = w.machineToken): Promise<ClaimedStep | null> {
  const res = await w.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { step: unknown };
  return body.step ? claimedStepSchema.parse(body.step) : null;
}

async function done(
  w: World,
  stepId: string,
  body: Record<string, unknown>,
  token = w.machineToken,
) {
  return w.s.app.request(`/api/machine/done/${stepId}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ generation: claimedGeneration(w.s.db, stepId), ...body }),
  });
}

function systemNotes(w: World, buildId: string): string[] {
  return w.s.db
    .select()
    .from(messageTable)
    .where(and(eq(messageTable.conversationId, buildId), eq(messageTable.role, 'system')))
    .all()
    .map((m) => String(m.content));
}

describe('one source with 1, 2, or many models across API, Antigravity, Claude Code, and Devin', () => {
  test('one source with 1/2/many models across API, Antigravity, Claude Code, and Devin', async () => {
    const w = await setupWorld();
    addApiProvider(w, 'solo', [{ id: 'solo-1', name: 'Solo 1' }]);
    seedRoute(w.s, 'session', { provider: 'solo', modelId: 'solo-1' });
    const soloEasy = await createAndBuild(w, 'fix one typo', { difficulty: 'easy' });
    const soloHard = await createAndBuild(w, 'redesign entire state machine', {
      difficulty: 'hard',
    });
    expect((await claim(w))?.agent?.modelId).toBe('solo-1');
    expect((await claim(w))?.agent?.modelId).toBe('solo-1');
    expect(systemNotes(w, soloEasy.buildId).some((n) => n.includes('已换备用模型'))).toBe(false);
    expect(systemNotes(w, soloHard.buildId).some((n) => n.includes('已换备用模型'))).toBe(false);

    const w2 = await setupWorld();
    addApiProvider(w2, 'duo', [
      {
        id: 'duo-mini',
        name: 'Duo Mini',
        cost: { input: 0.1, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'duo-core',
        name: 'Duo Core',
        cost: { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    seedRoute(w2.s, 'session', { provider: 'duo', modelId: 'duo-core' });
    await createAndBuild(w2, 'tiny copy tweak', { difficulty: 'easy' });
    await createAndBuild(w2, 'medium feature', { difficulty: 'standard' });
    await createAndBuild(w2, 'complex refactor', { difficulty: 'hard' });
    expect((await claim(w2))?.agent?.modelId).toBe('duo-mini');
    expect((await claim(w2))?.agent?.modelId).toBe('duo-core');
    expect((await claim(w2))?.agent?.modelId).toBe('duo-core');

    const w3 = await setupWorld();
    addApiProvider(
      w3,
      'anthropic-ultra',
      [
        { id: 'claude-opus-5-5', name: 'claude-opus-5-5' },
        { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5' },
        { id: 'claude-haiku-5-5', name: 'claude-haiku-5-5' },
      ],
      { api: 'anthropic-messages' },
    );
    seedRoute(w3.s, 'coordinator', { provider: 'anthropic-ultra', modelId: 'claude-sonnet-5-5' });
    seedRoute(w3.s, 'session', { provider: 'anthropic-ultra', modelId: 'claude-sonnet-5-5' });
    const e3 = await createAndBuild(w3, 'one-line CSS fix', { difficulty: 'easy' });
    const m3 = await createAndBuild(w3, 'add form validation', { difficulty: 'standard' });
    const h3 = await createAndBuild(w3, 'architect new queue engine', { difficulty: 'hard' });
    const cEasy = await claim(w3);
    const cMid = await claim(w3);
    const cHard = await claim(w3);
    expect(cEasy?.agent?.modelId).toBe('claude-haiku-5-5');
    expect(cMid?.agent?.modelId).toBe('claude-sonnet-5-5');
    expect(cHard?.agent?.modelId).toBe('claude-opus-5-5');
    expect(readStepFixture(w3.s.db, cEasy!.step.id)?.ranModel).toEqual({
      provider: 'anthropic-ultra',
      modelId: 'claude-haiku-5-5',
    });
    expect(readStepFixture(w3.s.db, cHard!.step.id)?.ranModel).toEqual({
      provider: 'anthropic-ultra',
      modelId: 'claude-opus-5-5',
    });
    expect(systemNotes(w3, e3.buildId).some((n) => n.includes('已换备用模型'))).toBe(false);
    expect(systemNotes(w3, m3.buildId).some((n) => n.includes('已换备用模型'))).toBe(false);
    expect(systemNotes(w3, h3.buildId).some((n) => n.includes('已换备用模型'))).toBe(false);

    const wAg = await setupWorld();
    insertAntigravitySubscription(wAg.s, { token: 'ag-test-token' });
    wAg.s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          antigravity: {
            installed: true,
            authenticated: true,
            models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
          },
          antigravityOAuthProfile: true,
        },
      })
      .where(eq(machineTable.id, wAg.machineId))
      .run();
    seedRoute(wAg.s, 'session', { provider: 'antigravity', modelId: 'gemini-4-hydrogen' });
    await createAndBuild(wAg, 'simple label tweak', { difficulty: 'easy' });
    await createAndBuild(wAg, 'complex architecture overhaul', { difficulty: 'hard' });
    const agEasy = await claim(wAg);
    const agHard = await claim(wAg);
    expect(agEasy?.agent).toMatchObject({ provider: 'antigravity', modelId: 'gemini-3.8-flash' });
    expect(agHard?.agent?.provider).toBe('antigravity');
    expect(agHard?.agent?.modelId).not.toBe('gemini-3.8-flash');

    const wCc = await setupWorld();
    insertClaudeSubscription(wCc.s);
    wCc.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          installed: true,
          hostname: 'tier-box',
          models: DEFAULT_CLAUDE_CODE_MODELS.map(({ id, name }) => ({ id, name })),
          auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
        },
      })
      .where(eq(machineTable.id, wCc.machineId))
      .run();
    seedRoute(wCc.s, 'session', { provider: 'claude-code', modelId: 'claude-opus-5-5' });
    await createAndBuild(wCc, 'small fix', { difficulty: 'easy' });
    expect((await claim(wCc))?.agent).toMatchObject({
      provider: 'claude-code',
      modelId: 'claude-haiku-5-5',
    });

    const wDv = await setupWorld();
    insertDevinSubscription(wDv.s);
    wDv.s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          devin: {
            installed: true,
            models: DEFAULT_DEVIN_MODELS.map(({ id, name }) => ({ id, name })),
          },
        },
      })
      .where(eq(machineTable.id, wDv.machineId))
      .run();
    seedRoute(wDv.s, 'session', { provider: 'devin', modelId: 'swe-2-high' });
    await createAndBuild(wDv, 'small tweak', { difficulty: 'easy' });
    await createAndBuild(wDv, 'deep migration', { difficulty: 'hard' });
    expect((await claim(wDv))?.agent).toMatchObject({
      provider: 'devin',
      modelId: 'swe-2-flash-medium',
    });
    expect((await claim(wDv))?.agent).toMatchObject({
      provider: 'devin',
      modelId: 'swe-2-1-medium',
    });
  });

  test('size-differentiated models pick distinct tiers', async () => {
    const w = await setupWorld();
    addApiProvider(w, 'open-weights', [
      { id: 'acme-7b', name: 'Acme 7B' },
      { id: 'acme-32b', name: 'Acme 32B' },
      { id: 'acme-70b', name: 'Acme 70B' },
    ]);
    seedRoute(w.s, 'session', { provider: 'open-weights', modelId: 'acme-32b' });
    await createAndBuild(w, 'small fix', { difficulty: 'easy' });
    await createAndBuild(w, 'hard refactor', { difficulty: 'hard' });
    expect((await claim(w))?.agent?.modelId).toBe('acme-7b');
    expect((await claim(w))?.agent?.modelId).toBe('acme-70b');
  });

  test('zero-signal custom relay keeps rule default', async () => {
    const w = await setupWorld();
    addApiProvider(w, 'opaque-relay', [
      {
        id: 'alias-a',
        name: 'Alias A',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'alias-b',
        name: 'Alias B',
        cost: { input: 2, output: 6, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'alias-c',
        name: 'Alias C',
        cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    seedRoute(w.s, 'session', { provider: 'opaque-relay', modelId: 'alias-b' });
    await createAndBuild(w, 'easy with cost', { difficulty: 'easy' });
    await createAndBuild(w, 'hard with cost', { difficulty: 'hard' });
    expect((await claim(w))?.agent?.modelId).toBe('alias-a');
    expect((await claim(w))?.agent?.modelId).toBe('alias-c');

    w.s.db
      .update(providerTable)
      .set({
        models: [
          { id: 'alias-a', name: 'Alias A' },
          { id: 'alias-b', name: 'Alias B' },
          { id: 'alias-c', name: 'Alias C' },
        ],
      })
      .where(eq(providerTable.providerId, 'opaque-relay'))
      .run();
    const easyZero = await createAndBuild(w, 'easy task', { difficulty: 'easy' });
    const hardZero = await createAndBuild(w, 'hard task', { difficulty: 'hard' });
    const easyClaim = await claim(w);
    const hardClaim = await claim(w);
    expect(easyClaim?.agent?.modelId).toBe('alias-b');
    expect(hardClaim?.agent?.modelId).toBe('alias-b');
    const easyRoute = w.s.db
      .select()
      .from(stepRoute)
      .where(eq(stepRoute.stepId, easyClaim!.step.id))
      .get();
    const hardRoute = w.s.db
      .select()
      .from(stepRoute)
      .where(eq(stepRoute.stepId, hardClaim!.step.id))
      .get();
    expect(easyRoute?.difficulty).toBe('easy');
    expect(hardRoute?.difficulty).toBe('hard');
    expect(easyZero.todoId).not.toBe(hardZero.todoId);
  });

  test('empty or non-chat provider falls back to secondary source', async () => {
    const w = await setupWorld();
    const p1 = addApiProvider(w, 'embed-only', [{ id: 'text-embedding-3-large', name: 'Embed' }]);
    addApiProvider(w, 'backup-api', [
      {
        id: 'b-fast',
        name: 'B Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'b-pro', name: 'B Pro', cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 } },
    ]);
    seedRoute(w.s, 'session', { provider: 'embed-only', modelId: 'text-embedding-3-large' });
    const { buildId } = await createAndBuild(w, 'simple task', { difficulty: 'easy' });
    const claimed = await claim(w);
    expect(claimed?.agent).toMatchObject({ provider: 'backup-api', modelId: 'b-fast' });
    expect(systemNotes(w, buildId).some((n) => n.includes('已换备用模型'))).toBe(true);
    expect(p1.providerId).toBe('embed-only');
  });
});

describe('Coordinator difficulty and fallback lifecycle', () => {
  test('Coordinator create_todo difficulty drives claimed ranModel', async () => {
    const createTodoDef = CHIEF_REMOTE_TOOLS.find((t) => t.name === 'create_todo');
    expect(createTodoDef?.parameters).toBeDefined();
    const props = (
      createTodoDef!.parameters as { properties: Record<string, { description: string }> }
    ).properties;
    expect(props.difficulty?.description).toContain('Always judge and pass this');
    expect(COORDINATOR_SYSTEM_PROMPT).toContain('difficulty');

    const w = await setupWorld();
    addApiProvider(w, 'tiered', [
      {
        id: 'm-fast',
        name: 'Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'm-mid', name: 'Mid', cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 } },
      { id: 'm-pro', name: 'Pro', cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 } },
    ]);
    seedRoute(w.s, 'session', { provider: 'tiered', modelId: 'm-mid' });
    await createAndBuild(w, 'ambiguous request with short text', { difficulty: 'hard' });
    const claimed = await claim(w);
    expect(claimed?.agent?.modelId).toBe('m-pro');
  });

  test('update_todo refreshes stale difficulty and board tasks fall back to spec length', async () => {
    const w = await setupWorld();
    addApiProvider(w, 'tiered', [
      {
        id: 'm-fast',
        name: 'Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'm-pro', name: 'Pro', cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 } },
    ]);
    seedRoute(w.s, 'session', { provider: 'tiered', modelId: 'm-pro' });
    const created = await relayTool(w, 'create_todo', {
      ...ownerTodoParams(w.s.db, w.threadId, w.projectId, 'rename label'),
      title: 'rename label',
      difficulty: 'easy',
      start: false,
    });
    const extraMsg = ownerTodoParams(w.s.db, w.threadId, w.projectId, 'x'.repeat(3500))
      .messageIds[0]!;
    await relayTool(w, 'update_todo', { todoId: String(created.id), addMessageIds: [extraMsg] });
    const updatedTodo = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, String(created.id)))
      .get()!;
    expect(updatedTodo.request?.difficulty).toBeNull();
    expect(profileForStep(w.s.db, updatedTodo, 'session')?.modelId).toBe('m-pro');

    const boardRes = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
      title: 'board tiny',
      spec: 'one line',
    });
    const boardId = ((await boardRes.json()) as { id: string }).id;
    const boardTodo = w.s.db.select().from(todoTable).where(eq(todoTable.id, boardId)).get()!;
    expect(profileForStep(w.s.db, boardTodo, 'session')?.modelId).toBe('m-fast');
  });

  test('two sources failover, source removal, rename, and pending reorder', async () => {
    const w = await setupWorld();
    const p1 = addApiProvider(w, 'primary-gw', [
      {
        id: 'p1-fast',
        name: 'P1 Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'p1-pro', name: 'P1 Pro', cost: { input: 5, output: 15, cacheRead: 0, cacheWrite: 0 } },
    ]);
    addApiProvider(w, 'secondary-gw', [
      {
        id: 'p2-fast',
        name: 'P2 Fast',
        cost: { input: 0.2, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'p2-pro', name: 'P2 Pro', cost: { input: 6, output: 18, cacheRead: 0, cacheWrite: 0 } },
    ]);
    seedRoute(w.s, 'session', { provider: 'primary-gw', modelId: 'p1-pro' });
    writeProviderOrder(w.s.db, w.s.team.id, [`provider:${p1.id}`]);
    const t1 = await createAndBuild(w, 'easy job', { difficulty: 'easy' });
    const c1 = await claim(w);
    expect(c1?.agent).toMatchObject({ provider: 'primary-gw', modelId: 'p1-fast' });
    await done(w, c1!.step.id, { status: 'success' });
    await req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/providers/${p1.id}`, {
      providerId: 'renamed-gw',
    });
    expect(readStepFixture(w.s.db, c1!.step.id)?.ranModel?.provider).toBe('renamed-gw');
    expect(
      w.s.db.select().from(stepRoute).where(eq(stepRoute.stepId, c1!.step.id)).get()?.provider,
    ).toBe('renamed-gw');

    const t2 = await createAndBuild(w, 'hard job after delete', { difficulty: 'hard' });
    w.s.db.delete(providerTable).where(eq(providerTable.id, p1.id)).run();
    const c2 = await claim(w);
    expect(c2?.agent).toMatchObject({ provider: 'secondary-gw', modelId: 'p2-pro' });
    expect(systemNotes(w, t2.buildId).some((n) => n.includes('已换备用模型'))).toBe(true);
    expect(t1.todoId).not.toBe(t2.todoId);
  });

  test('mid-step 429/quota/outage/auth fallback, stale fallback advance, quota-wait release clears tried, and zero-usage pins ranModel', async () => {
    const w = await setupWorld();
    const p1 = addApiProvider(w, 'gw-a', [
      {
        id: 'a-fast',
        name: 'A Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'a-mid', name: 'A Mid', cost: { input: 1, output: 3, cacheRead: 0, cacheWrite: 0 } },
      { id: 'a-pro', name: 'A Pro', cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 } },
    ]);
    addApiProvider(w, 'gw-b', [
      {
        id: 'b-fast',
        name: 'B Fast',
        cost: { input: 0.2, output: 0.4, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'b-pro', name: 'B Pro', cost: { input: 8, output: 24, cacheRead: 0, cacheWrite: 0 } },
    ]);
    seedRoute(w.s, 'session', { provider: 'gw-a', modelId: 'a-mid' });

    const { buildId: b429 } = await createAndBuild(w, 'rate limited work', { difficulty: 'easy' });
    const c429 = await claim(w);
    expect(c429?.agent).toMatchObject({ provider: 'gw-a', modelId: 'a-fast' });
    await done(w, c429!.step.id, { status: 'failed', errorMessage: '429 Too Many Requests' });
    const retried429 = await claim(w);
    expect(retried429?.step.id).toBe(c429!.step.id);
    expect(retried429?.agent).toMatchObject({ provider: 'gw-a', modelId: 'a-mid' });
    expect(systemNotes(w, b429).some((n) => n.includes('已换备用模型'))).toBe(true);

    await done(w, retried429!.step.id, {
      status: 'failed',
      errorMessage: 'insufficient quota',
      quotaBlock: { kind: 'quota', providerId: 'gw-a', reason: 'insufficient quota' },
    });
    const jumped = await claim(w);
    expect(jumped?.agent?.provider).toBe('gw-b');

    await done(w, jumped!.step.id, {
      status: 'success',
      noOutput: true,
      hasChanges: false,
      usage: [],
    });
    const zeroRetry = await claim(w);
    expect(zeroRetry?.agent).toEqual(
      expect.objectContaining({ provider: 'gw-b', modelId: jumped!.agent!.modelId }),
    );

    await done(w, zeroRetry!.step.id, {
      status: 'failed',
      errorMessage: '402 quota',
      quotaBlock: { kind: 'quota', providerId: 'gw-b', reason: 'exhausted' },
    });
    const stalePending = readStepFixture(w.s.db, zeroRetry!.step.id)!;
    if (stalePending.status === 'pending' && stalePending.fallback?.model) {
      w.s.db
        .update(providerTable)
        .set({ models: [] })
        .where(eq(providerTable.providerId, stalePending.fallback.model.provider))
        .run();
      const advanced = await claim(w);
      expect(advanced).not.toBeNull();
    }

    const qw = await setupWorld();
    addApiProvider(qw, 'only-q', [{ id: 'q-1', name: 'Q1' }]);
    seedRoute(qw.s, 'session', { provider: 'only-q', modelId: 'q-1' });
    const { buildId: qBuild } = await createAndBuild(qw, 'quota wait job', { difficulty: 'easy' });
    const qc = await claim(qw);
    await done(qw, qc!.step.id, {
      status: 'failed',
      errorMessage: 'quota exceeded',
      quotaBlock: { kind: 'quota', providerId: 'only-q', reason: 'quota' },
    });
    const waiting = qw.s.db.select().from(stepTable).where(eq(stepTable.id, qc!.step.id)).get()!;
    expect(waiting.status).toBe('waiting_quota');
    qw.s.db.transaction((tx) =>
      writeQuota(tx, waiting.id, {
        fallback: {
          model: { provider: 'only-q', modelId: 'q-1' },
          tried: ['only-q/q-1'],
          zeroUsageRetried: false,
        },
      }),
    );
    retryQuotaWaitNow(
      { db: qw.s.db, hub: qw.s.hub, machineHub: qw.s.machineHub, user: qw.s.user },
      qBuild,
    );
    const resetRow = readStepFixture(qw.s.db, waiting.id)!;
    expect(resetRow.status).toBe('pending');
    expect(resetRow.fallback?.tried).toEqual([]);
    expect(resetRow.fallback?.model).toBeNull();
    sweepQuotaWaitSteps(
      { db: qw.s.db, hub: qw.s.hub, machineHub: qw.s.machineHub, user: qw.s.user },
      nowMs() + 10_000_000,
    );
    expect(p1.providerId).toBe('gw-a');
  });

  test('old runner protocol, legacy sandbox, old Claude CLI, capability pin, and total exhaustion', async () => {
    const w = await setupWorld();
    insertAntigravitySubscription(w.s, { token: 'ag-test-token' });
    addApiProvider(w, 'pi-backup', [{ id: 'pi-1', name: 'Pi 1' }]);
    seedRoute(w.s, 'session', { provider: 'antigravity', modelId: 'gemini-4-hydrogen' });
    w.s.db
      .update(machineTable)
      .set({
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: 'darwin',
          confinement: {
            state: 'ready',
            invocation: '0f9d3a52-6c1e-4b7a-9d3e-5a1c2b4d6e80',
            generation: 1,
            revision: 1,
          },
          antigravity: {
            installed: true,
            authenticated: true,
            models: [{ id: 'gemini-3.8-flash', name: 'Flash' }],
          },
          antigravityOAuthProfile: true,
        },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    await createAndBuild(w, 'sandboxed task', { difficulty: 'easy' });
    expect((await claim(w))?.agent).toMatchObject({ provider: 'pi-backup', modelId: 'pi-1' });

    const wOld = await setupWorld();
    insertClaudeSubscription(wOld.s);
    addApiProvider(wOld, 'pi-fallback', [{ id: 'pi-model', name: 'Pi Model' }]);
    seedRoute(wOld.s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5' });
    wOld.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          installed: true,
          hostname: 'old-cli',
          bin: { path: '/usr/bin/claude', version: '2.1.100' },
          models: DEFAULT_CLAUDE_CODE_MODELS.map(({ id, name }) => ({ id, name })),
          auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
        },
      })
      .where(eq(machineTable.id, wOld.machineId))
      .run();
    await createAndBuild(wOld, 'old claude cli task', { difficulty: 'hard' });
    expect((await claim(wOld))?.agent).toMatchObject({
      provider: 'pi-fallback',
      modelId: 'pi-model',
    });
  });

  test('explicit task model pin, checkpoint continuity, and merge/review unchanged', async () => {
    const w = await setupWorld();
    addApiProvider(w, 'tiered', [
      {
        id: 'm-fast',
        name: 'Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      { id: 'm-pro', name: 'Pro', cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 } },
    ]);
    writeTopModels(w.s.db, w.s.team.id, [
      { provider: 'tiered', modelId: 'm-pro', thinkingLevel: 'high' },
    ]);
    seedRoute(w.s, 'session', { provider: 'tiered', modelId: 'm-fast' });
    seedRoute(w.s, 'review', { provider: 'tiered', modelId: 'm-pro' });

    await createAndBuild(w, 'tiny edit pinned to pro', { difficulty: 'easy', model: 'm-pro' });
    const pinnedClaim = await claim(w);
    expect(pinnedClaim?.agent).toMatchObject({
      provider: 'tiered',
      modelId: 'm-pro',
      thinkingLevel: 'high',
    });

    const mergeStep = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, pinnedClaim!.todo!.id))
      .get()!;
    expect(profileForStep(w.s.db, { ...mergeStep, request: null }, 'review')?.modelId).toBe(
      'm-pro',
    );
    expect(profileForStep(w.s.db, { ...mergeStep, request: null }, 'merge')?.modelId).toBe(
      'm-fast',
    );

    const unpinned = await createAndBuild(w, 'small step with checkpoint', { difficulty: 'easy' });
    const first = await claim(w);
    expect(first?.agent?.modelId).toBe('m-fast');
    w.s.db
      .update(stepTable)
      .set({ status: 'pending', checkpointCommit: 'ab'.repeat(20) })
      .where(eq(stepTable.id, first!.step.id))
      .run();
    const kept = profileForStep(
      w.s.db,
      w.s.db.select().from(todoTable).where(eq(todoTable.id, unpinned.todoId)).get()!,
      'session',
      first!.step.id,
    );
    expect(kept?.modelId).toBe('m-fast');
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, first!.step.id)).run();

    addApiProvider(w, 'unauthorized-backup', [{ id: 'unauth-1', name: 'Unauth 1' }]);
    const pinnedStale = await createAndBuild(w, 'pinned stale fallback stays scoped', {
      difficulty: 'easy',
      model: 'm-pro',
    });
    const staleStep = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, pinnedStale.buildId))
      .get()!;
    w.s.db.transaction((tx) =>
      writeQuota(tx, staleStep.id, {
        fallback: {
          model: { provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
          tried: ['tiered/m-pro', 'claude-code/claude-sonnet-5-5'],
          zeroUsageRetried: false,
        },
      }),
    );
    const notEscaped = await claim(w);
    expect(notEscaped).toBeNull();

    await expect(
      relayTool(w, 'update_todo', {
        todoId: pinnedStale.todoId,
        title: 'should not partially write',
        difficulty: 'hard',
      }),
    ).rejects.toThrow(/has started/);
    const afterReject = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, pinnedStale.todoId))
      .get()!;
    expect(afterReject.title).not.toBe('should not partially write');
  });

  test('github push permission filters machines before choosing primary vs secondary source', async () => {
    const w = await setupWorld();
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          installed: true,
          hostname: 'box-no-push',
          models: [{ id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' }],
          auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
        },
        capabilities: {
          ...readyMachine({ teamId: w.s.team.id, name: 'box-no-push', cliVersion: '0.3.0' })
            .capabilities,
          mcpServers: [],
          skills: [],
          githubPush: {
            checkedAt: nowMs(),
            login: 'ok',
            repos: [{ repo: 'org/app', state: 'no-write', checkedAt: nowMs() }],
          },
        },
      })
      .where(eq(machineTable.id, w.machineId))
      .run();
    const key2 = await issueApiKey(w.s);
    const enroll2 = await w.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key2}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        readyMachine({ teamId: w.s.team.id, name: 'box-with-push', cliVersion: '0.3.0' }),
      ),
    });
    expect(enroll2.status).toBe(200);
    const token2 = ((await enroll2.json()) as { token: string }).token;
    const box2 = w.s.db
      .select()
      .from(machineTable)
      .where(eq(machineTable.name, 'box-with-push'))
      .get()!;
    w.s.db
      .update(machineTable)
      .set({
        online: true,
        capabilities: {
          ...box2.capabilities,
          mcpServers: [],
          skills: [],
          githubPush: {
            checkedAt: nowMs(),
            login: 'ok',
            repos: [{ repo: 'org/app', state: 'write', checkedAt: nowMs() }],
          },
        },
      })
      .where(eq(machineTable.id, box2.id))
      .run();

    w.s.db
      .insert(githubConnection)
      .values({
        teamId: w.s.team.id,
        login: 'octo',
        accessTokenCipher: w.s.secretBox.seal('ghp_test'),
        scope: 'repo',
        createdAt: nowMs(),
      })
      .run();
    insertClaudeSubscription(w.s);
    const backup = addApiProvider(w, 'backup-push', [
      {
        id: 'bp-fast',
        name: 'BP Fast',
        cost: { input: 0.1, output: 0.2, cacheRead: 0, cacheWrite: 0 },
      },
      {
        id: 'bp-pro',
        name: 'BP Pro',
        cost: { input: 10, output: 30, cacheRead: 0, cacheWrite: 0 },
      },
    ]);
    seedPolicy(w.s, 'session', { tools: [AGENT_TOOL_PUSH] });
    seedRoute(w.s, 'session', { provider: 'claude-code', modelId: 'claude-sonnet-5-5' });

    const repoProjId = await postProject(w.s.app, 'gh-push-proj');
    w.s.db
      .update(projectTable)
      .set({ repoKind: 'github', githubRepo: 'org/app', baseBranch: 'main' })
      .where(eq(projectTable.id, repoProjId))
      .run();
    const created = await relayTool(w, 'create_todo', {
      ...ownerTodoParams(w.s.db, w.threadId, repoProjId, 'needs github push'),
      title: 'needs github push',
      difficulty: 'easy',
    });
    expect(String(created.id).length).toBeGreaterThan(0);

    expect(await claim(w)).toBeNull();
    const claimed2 = await claim(w, token2);
    expect(claimed2?.agent).toMatchObject({ provider: backup.providerId, modelId: 'bp-fast' });
  });
});
