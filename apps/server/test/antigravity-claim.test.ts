import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  antigravitySubscription as antigravitySubscriptionTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  step as stepTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { antigravityUsable } from '../src/services/dispatch-eligibility.js';
import { claimStep, stepToken } from '../src/services/machines.js';
import {
  bootServer,
  insertAntigravitySubscription,
  insertMachine,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
});

function claim(s: TestServer, machineId: string) {
  return claimStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
    },
    machineId,
    s.team.id,
    10,
    'http://localhost',
  );
}

describe('Antigravity dispatch, worker claim, and Coordinator claim', () => {
  test('antigravityUsable truth table for host-keyring vs token fallback', () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const machineId = insertMachine(s, {
      name: 'agy-host',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: false },
      },
    });
    expect(machineId).toBeDefined();
    expect(antigravityUsable(s.db, s.team.id)).toBe(false);

    const hostSubId = insertAntigravitySubscription(s, { label: 'Host', token: null });
    expect(antigravityUsable(s.db, s.team.id)).toBe(false);

    insertMachine(s, {
      name: 'agy-host-authed',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });
    expect(antigravityUsable(s.db, s.team.id)).toBe(true);

    s.db
      .update(antigravitySubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(antigravitySubscriptionTable.id, hostSubId))
      .run();
    const tokenSubId = insertAntigravitySubscription(s, {
      label: 'Token',
      token: `AIzaSyA${'t'.repeat(28)}`,
    });
    expect(tokenSubId).toBeDefined();
    expect(antigravityUsable(s.db, s.team.id)).toBe(true);
  });

  test('claims worker build step with host keyring (omits antigravityToken) and refuses unauthenticated host', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const subId = insertAntigravitySubscription(s, { label: 'Keyring', token: null });
    const unauthMachine = insertMachine(s, {
      name: 'agy-unauth',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: false },
      },
    });
    const authMachine = insertMachine(s, {
      name: 'agy-auth',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });

    const projectId = await postProject(s.app, 'ag-worker');
    const todo = (await (
      await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
        title: 'Task',
        spec: 'Spec',
      })
    ).json()) as { id: string };
    s.db
      .insert(buildTable)
      .values({
        id: 'b1',
        todoId: todo.id,
        withPlan: false,
        planDocId: null,
        triggerSource: 'user',
        createdAt: 1,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: 'b1', kind: 'build', status: 'pending', createdAt: 2 })
      .run();

    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: unauthMachine,
    });
    await expect(claim(s, unauthMachine)).resolves.toBeNull();

    seedRoute(s, 'session', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId: authMachine,
    });
    const claimed = await claim(s, authMachine);
    expect(claimed?.agent).toMatchObject({
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
    });
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get()?.antigravitySubscriptionId,
    ).toBe(subId);

    const tokenRes = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      authMachine,
      's1',
    );
    expect(tokenRes.antigravityToken).toBeUndefined();
  });

  test('claims Coordinator chief step with token fallback, delivers antigravityToken, and resets session on switch', async () => {
    setCoordinatorInServer(true);
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const tokenA = `AIzaSyA${'a'.repeat(28)}`;
    const tokenB = `AIzaSyB${'b'.repeat(28)}`;
    const subA = insertAntigravitySubscription(s, { label: 'Account A', token: tokenA });
    const machineId = insertMachine(s, {
      name: 'agy-coord',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: false },
      },
    });
    seedRoute(s, 'coordinator', {
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
      machineId,
    });
    s.db
      .insert(chiefTable)
      .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 'chief-ag-1',
        chiefId: 'c1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'coord',
        createdAt: 2,
        updatedAt: 2,
        sessionId: '',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 'cs1', buildId: 'chief-ag-1', kind: 'chief', status: 'pending', createdAt: 3 })
      .run();

    const firstClaim = await claim(s, machineId);
    expect(firstClaim?.agent).toMatchObject({
      provider: 'antigravity',
      modelId: 'gemini-4-carbon',
    });
    expect(
      s.db.select().from(stepTable).where(eq(stepTable.id, 'cs1')).get()?.antigravitySubscriptionId,
    ).toBe(subA);

    const firstToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      machineId,
      'cs1',
    );
    expect(firstToken.antigravityToken).toBe(tokenA);

    s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'ag-sess-1' })
      .where(eq(chiefThreadTable.id, 'chief-ag-1'))
      .run();
    s.db
      .update(stepTable)
      .set({ status: 'done', sessionId: 'ag-sess-1' })
      .where(eq(stepTable.id, 'cs1'))
      .run();

    const subB = insertAntigravitySubscription(s, { label: 'Account B', token: tokenB });
    s.db
      .update(antigravitySubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(antigravitySubscriptionTable.id, subA))
      .run();
    s.db
      .update(antigravitySubscriptionTable)
      .set({ enabledAt: 99 })
      .where(eq(antigravitySubscriptionTable.id, subB))
      .run();

    s.db
      .insert(stepTable)
      .values({ id: 'cs2', buildId: 'chief-ag-1', kind: 'chief', status: 'pending', createdAt: 10 })
      .run();

    const secondClaim = await claim(s, machineId);
    expect(secondClaim?.session).toEqual({ action: 'new', sessionId: null });
    const secondToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      machineId,
      'cs2',
    );
    expect(secondToken.antigravityToken).toBe(tokenB);
  });
});
