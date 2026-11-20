import { DEFAULT_ANTIGRAVITY_MODELS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  antigravitySubscription,
  build as buildTable,
  step as stepTable,
} from '../src/db/schema.js';
import { getModelSources } from '../src/services/providers.js';
import { bootServer, insertMachine, postProject, req, seedRoute } from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
});

describe('antigravity subscriptions REST & model sources', () => {
  test('supports host-keyring subscriptions without token and optional token subscriptions', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const createdHost = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      {
        label: 'Mac Studio Keyring',
      },
    );
    expect(createdHost.status).toBe(201);
    const hostBody = (await createdHost.json()) as {
      id: string;
      kind: string;
      label: string;
      hasToken: boolean;
      enabled: boolean;
    };
    expect(hostBody).toMatchObject({
      kind: 'antigravity-subscription',
      label: 'Mac Studio Keyring',
      hasToken: false,
      enabled: true,
    });

    const tokenSecret = `AIzaSyA${'x'.repeat(28)}`;
    const createdToken = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      { label: 'Fallback API Key', token: tokenSecret },
    );
    expect(createdToken.status).toBe(201);
    const tokenBody = (await createdToken.json()) as {
      id: string;
      hasToken: boolean;
      enabled: boolean;
    };
    expect(tokenBody).toMatchObject({ hasToken: true, enabled: false });

    const listed = await req(s.app, 'GET', `/api/teams/${s.team.id}/antigravity-subscriptions`);
    expect(listed.status).toBe(200);
    const rawText = await listed.text();
    expect(rawText).not.toContain(tokenSecret);
    const rows = JSON.parse(rawText) as Array<{ id: string; hasToken: boolean }>;
    expect(rows).toHaveLength(2);

    const renamed = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${hostBody.id}`,
      { label: 'Workstation Keyring' },
    );
    expect(renamed.status).toBe(200);
    expect((await renamed.json()) as { label: string }).toMatchObject({
      label: 'Workstation Keyring',
    });

    const badRename = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${tokenBody.id}`,
      { label: `bad-${tokenSecret}` },
    );
    expect(badRename.status).toBe(400);
  });

  test('verifies host-login connection from online Runner antigravity capabilities', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const machineId = insertMachine(s, {
      name: 'agy-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          version: '1.5.10',
          authenticated: true,
          source: 'local',
          models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' }],
        },
      },
    });
    expect(machineId).toBeDefined();

    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-mac',
      machineId,
      models: [{ id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' }],
    });

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Local Keyring',
    });
    const sub = (await created.json()) as { id: string };

    const okVerify = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(okVerify.status).toBe(200);
    expect(await okVerify.json()).toMatchObject({ ok: true });

    const createdSecond = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions`,
      { label: 'Second Host Keyring' },
    );
    const second = (await createdSecond.json()) as { id: string };

    const switched = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${second.id}/enable`,
    );
    expect(switched.status).toBe(200);
    const dbRows = s.db.select().from(antigravitySubscription).all();
    expect(dbRows.find((r) => r.id === sub.id)?.enabledAt).toBeNull();
    expect(dbRows.find((r) => r.id === second.id)?.enabledAt).not.toBeNull();
  });

  test('refuses disabling or deleting an account with running tasks and lists step history', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const machineId = insertMachine(s, {
      name: 'agy-box',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: false,
          models: DEFAULT_ANTIGRAVITY_MODELS.map(({ id, name }) => ({ id, name })),
        },
      },
    });
    seedRoute(s, 'session', { provider: 'antigravity', modelId: 'gemini-4-carbon', machineId });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Token Key',
      token: `AIzaSyA${'z'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };

    const projectId = await postProject(s.app, 'ag-proj');
    const todo = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Task',
        spec: 'Spec',
      })
    ).json()) as { id: string };
    s.db
      .insert(buildTable)
      .values({
        id: 'b-ag',
        todoId: todo.id,
        withPlan: false,
        planDocId: null,
        triggerSource: 'user',
        createdAt: 10,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 's-ag',
        buildId: 'b-ag',
        kind: 'build',
        status: 'claimed',
        claimedAt: 11,
        antigravitySubscriptionId: sub.id,
        createdAt: 11,
      })
      .run();

    const conflictDisable = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/disable`,
    );
    expect(conflictDisable.status).toBe(409);

    const stepsRes = await req(
      s.app,
      'GET',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/steps`,
    );
    expect(stepsRes.status).toBe(200);
    expect(((await stepsRes.json()) as { steps: Array<{ stepId: string }> }).steps[0]?.stepId).toBe(
      's-ag',
    );

    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: 20 })
      .where(eq(stepTable.id, 's-ag'))
      .run();
    const disabled = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/disable`,
    );
    expect(disabled.status).toBe(200);
    const removed = await req(
      s.app,
      'DELETE',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}`,
    );
    expect(removed.status).toBe(204);
  });
});

describe('antigravity token verification via Google API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('verifies a token by calling the Google models endpoint with the key header', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const token = `AIzaSyA${'t'.repeat(28)}`;
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'API Key',
      token,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models');
    expect(url).not.toContain(token);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(token);
  });

  test('maps Google failures to verify reasons', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const fetchMock = vi.fn(async () => new Response('{}', { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Bad Key',
      token: `AIzaSyA${'u'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'auth' });
  });

  test('treats a network failure as unavailable', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Offline Key',
      token: `AIzaSyA${'v'.repeat(28)}`,
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/verify`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, reason: 'unavailable' });
  });
});

describe('antigravity upstream models', () => {
  test('lists models reported by online runners and dedupes across machines', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'agy-one',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
          ],
        },
      },
    });
    insertMachine(s, {
      name: 'agy-two',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
          ],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Keyring',
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: 'ok',
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      ],
    });

    const rateLimited = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(rateLimited.status).toBe(429);
  });

  test('fails with upstream when no runner reports antigravity models', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'plain-box',
      capabilities: { mcpServers: [], skills: [] },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Keyring',
    });
    const sub = (await created.json()) as { id: string };
    const res = await req(
      s.app,
      'POST',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}/upstream-models`,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'failed', failure: 'upstream', httpStatus: null });
  });

  test('stores a curated model subset and offers it in model sources', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    insertMachine(s, {
      name: 'agy-mac',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: {
          installed: true,
          authenticated: true,
          models: [
            { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
            { id: 'gemini-4-argon', name: 'Gemini 4 Argon' },
          ],
        },
      },
    });
    const created = await req(s.app, 'POST', `/api/teams/${s.team.id}/antigravity-subscriptions`, {
      label: 'Curated',
    });
    const sub = (await created.json()) as { id: string; enabled: boolean };
    expect(sub.enabled).toBe(true);

    const patched = await req(
      s.app,
      'PATCH',
      `/api/teams/${s.team.id}/antigravity-subscriptions/${sub.id}`,
      {
        models: [
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
          { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
        ],
      },
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon' },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen' },
      ],
    });

    const sources = getModelSources({ db: s.db, box: s.secretBox }, s.team.id).sources;
    expect(sources).toContainEqual({
      runtime: 'antigravity',
      installed: true,
      hostname: 'agy-mac',
      machineId: 'machine-agy-mac',
      models: [
        { id: 'gemini-4-carbon', name: 'Gemini 4 Carbon', slot: 'builtin' },
        { id: 'gemini-4-hydrogen', name: 'Gemini 4 Hydrogen', slot: 'builtin' },
        { id: 'gemini-4-argon', name: 'Gemini 4 Argon', slot: 'builtin' },
      ],
    });
  });
});
