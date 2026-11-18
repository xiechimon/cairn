import { DEFAULT_ANTIGRAVITY_MODELS } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
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
    expect(await okVerify.json()).toEqual({ ok: true });

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
