import { COORDINATOR_COMPACT_AT } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  chiefTurnUsage as chiefTurnUsageTable,
  devinSubscription as devinSubscriptionTable,
  step as stepTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { claimStep, stepToken } from '../src/services/machines.js';
import {
  bootServer,
  insertDevinSubscription,
  insertMachine,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
  setCoordinatorInServer(false);
});

function setupWorld(options: { subscription?: boolean } = {}) {
  setCoordinatorInServer(true);
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  const firstToken = `wsk-${'a'.repeat(64)}`;
  const subscriptionId =
    options.subscription !== false ? insertDevinSubscription(s, { token: firstToken }) : null;
  const machineId = insertMachine(s, {
    name: 'devin-runner',
    capabilities: { mcpServers: [], skills: [], devin: { installed: true, version: '0.1.0' } },
  });
  seedRoute(s, 'coordinator', {
    provider: 'devin',
    modelId: 'swe-2-high',
    thinkingLevel: 'off',
    machineId,
  });
  s.db
    .insert(chiefTable)
    .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
    .run();
  s.db
    .insert(chiefThreadTable)
    .values({
      id: 'chief-t1',
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
  return { s, machineId, subscriptionId, firstToken };
}

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

describe('Coordinator rule that selects Devin', () => {
  test('skips chief claim when no Devin subscription is active', async () => {
    const { s, machineId } = setupWorld({ subscription: false });
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: 'chief-t1', kind: 'chief', status: 'pending', createdAt: 3 })
      .run();
    await expect(claim(s, machineId)).resolves.toBeNull();
  });

  test('claims chief step, binds devinSubscriptionId, delivers devinToken, and resets session across accounts', async () => {
    const { s, machineId, subscriptionId, firstToken } = setupWorld({ subscription: true });
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: 'chief-t1', kind: 'chief', status: 'pending', createdAt: 3 })
      .run();

    const claimed = await claim(s, machineId);
    expect(claimed?.step).toMatchObject({ id: 's1', machineId });
    expect(claimed?.agent).toMatchObject({ provider: 'devin', modelId: 'swe-2-high' });

    const row = s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get();
    expect(row?.devinSubscriptionId).toBe(subscriptionId);

    const tokenRes = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      machineId,
      's1',
    );
    expect(tokenRes.devinToken).toBe(firstToken);

    s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'devin-sess-1' })
      .where(eq(chiefThreadTable.id, 'chief-t1'))
      .run();
    s.db
      .update(stepTable)
      .set({ status: 'done', sessionId: 'devin-sess-1' })
      .where(eq(stepTable.id, 's1'))
      .run();

    const secondToken = `wsk-${'b'.repeat(64)}`;
    const secondId = insertDevinSubscription(s, { label: 'Second', token: secondToken });
    s.db
      .update(devinSubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(devinSubscriptionTable.id, subscriptionId!))
      .run();
    s.db
      .update(devinSubscriptionTable)
      .set({ enabledAt: 99 })
      .where(eq(devinSubscriptionTable.id, secondId))
      .run();

    s.db
      .insert(stepTable)
      .values({ id: 's2', buildId: 'chief-t1', kind: 'chief', status: 'pending', createdAt: 10 })
      .run();

    const nextClaim = await claim(s, machineId);
    expect(nextClaim?.session).toEqual({ action: 'new', sessionId: null });
    const nextToken = await stepToken(
      { ...s.svc, box: s.secretBox, attachmentsDir: s.attachmentsDir, reposDir: s.reposDir },
      machineId,
      's2',
    );
    expect(nextToken.devinToken).toBe(secondToken);
  });

  test.each([
    [COORDINATOR_COMPACT_AT - 1, { action: 'continue', sessionId: 'devin-sess-1' }],
    [COORDINATOR_COMPACT_AT, { action: 'new', sessionId: null }],
  ])('a thread whose last turn held %i tokens claims %o', async (contextTokens, session) => {
    const { s, machineId, subscriptionId } = setupWorld({ subscription: true });
    s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'devin-sess-1', sessionRuntime: 'devin' })
      .where(eq(chiefThreadTable.id, 'chief-t1'))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 's1',
        buildId: 'chief-t1',
        kind: 'chief',
        status: 'done',
        machineId,
        claimedAt: 3,
        sessionId: 'devin-sess-1',
        devinSubscriptionId: subscriptionId,
        createdAt: 3,
      })
      .run();
    s.db
      .insert(chiefTurnUsageTable)
      .values({
        stepId: 's1',
        threadId: 'chief-t1',
        model: 'devin/swe-2-high',
        input: contextTokens,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        contextTokens,
        contextWindow: 1_000_000,
        compactAt: COORDINATOR_COMPACT_AT,
        createdAt: 4,
        firstReportAt: 4,
      })
      .run();
    s.db
      .insert(chiefMessageTable)
      .values({
        id: 'm-earlier',
        threadId: 'chief-t1',
        role: 'assistant',
        content: 'The release notes are drafted',
        createdAt: 5,
      })
      .run();
    s.db
      .insert(stepTable)
      .values({ id: 's2', buildId: 'chief-t1', kind: 'chief', status: 'pending', createdAt: 10 })
      .run();
    const claimed = await claim(s, machineId);
    expect(claimed?.session).toEqual(session);
    expect(claimed?.chief?.history).toContain('The release notes are drafted');
  });
});
