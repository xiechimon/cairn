import { eq, inArray } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chiefMessage as chiefMessageTable,
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  insertAntigravitySubscription,
  insertMachine,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterEach(() => {
  for (const d of disposables.splice(0)) d();
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

describe('cross-machine Coordinator session claim routing', () => {
  test('starts fresh when a machine-local session last ran on another machine and preserves same-machine, locked, A-B-A, and pi behavior', async () => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());

    const machineA = insertMachine(s, {
      name: 'mac-a',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });
    const machineB = insertMachine(s, {
      name: 'mac-b',
      capabilities: {
        mcpServers: [],
        skills: [],
        antigravity: { installed: true, authenticated: true },
      },
    });
    s.db
      .update(machineTable)
      .set({ latestCliVersion: '0.2.4' })
      .where(inArray(machineTable.id, [machineA, machineB]))
      .run();
    insertAntigravitySubscription(s, { label: 'Shared Token', token: 'ag-tok-1' });
    seedRoute(s, 'coordinator', {
      provider: 'antigravity',
      modelId: 'gemini-4-hydrogen',
      machineId: null,
    });
    s.db
      .insert(chiefTable)
      .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, createdAt: 1 })
      .run();
    s.db
      .insert(chiefThreadTable)
      .values({
        id: 't1',
        chiefId: 'c1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'coord',
        createdAt: 2,
        updatedAt: 2,
        sessionRuntime: 'antigravity',
        sessionId: 'sess-a',
        sessionOpenedAt: 2,
      })
      .run();
    s.db
      .insert(chiefMessageTable)
      .values([
        {
          id: 'm1',
          threadId: 't1',
          role: 'user',
          content: 'hello',
          createdAt: 10,
        },
        {
          id: 'm2',
          threadId: 't1',
          role: 'assistant',
          content: [{ type: 'text', text: 'hi there' }],
          createdAt: 11,
        },
      ])
      .run();

    s.db
      .insert(stepTable)
      .values([
        {
          id: 's1',
          buildId: 't1',
          kind: 'chief',
          status: 'done',
          machineId: machineA,
          sessionId: 'sess-a',
          createdAt: 12,
          finishedAt: 13,
        },
        {
          id: 's-other',
          buildId: 't1',
          kind: 'chief',
          status: 'failed',
          machineId: machineB,
          sessionId: 'sess-other',
          createdAt: 14,
          finishedAt: 15,
        },
        {
          id: 's-pending-b',
          buildId: 't1',
          kind: 'chief',
          status: 'pending',
          ownerMessageIds: ['m3'],
          prompt: 'second question',
          createdAt: 20,
        },
      ])
      .run();

    const claimB = await claim(s, machineB);
    expect(claimB).not.toBeNull();
    expect(claimB?.session).toEqual({ action: 'new', sessionId: null });
    expect(claimB?.chief?.history).toContain('用户：hello');
    expect(claimB?.chief?.history).toContain('Coordinator：hi there');

    s.db
      .update(stepTable)
      .set({ status: 'failed', finishedAt: 21 })
      .where(eq(stepTable.id, 's-pending-b'))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 's-pending-a',
        buildId: 't1',
        kind: 'chief',
        status: 'pending',
        ownerMessageIds: ['m4'],
        prompt: 'back on A',
        createdAt: 22,
      })
      .run();

    const claimA = await claim(s, machineA);
    expect(claimA?.session).toEqual({ action: 'continue', sessionId: 'sess-a' });
    s.db
      .update(stepTable)
      .set({ status: 'done', sessionId: 'sess-a', finishedAt: 23 })
      .where(eq(stepTable.id, 's-pending-a'))
      .run();

    s.db
      .insert(stepTable)
      .values({
        id: 's-locked-b',
        buildId: 't1',
        kind: 'chief',
        status: 'pending',
        prompt: '[wake:wake] provenance=mail:mail-1\nNew email',
        createdAt: 24,
      })
      .run();
    const claimBLocked = await claim(s, machineB);
    expect(claimBLocked?.session).toEqual({ action: 'new', sessionId: null });
    expect(claimBLocked?.chief?.history).toBeUndefined();
    s.db
      .update(stepTable)
      .set({ status: 'done', sessionId: 'sess-b', finishedAt: 25 })
      .where(eq(stepTable.id, 's-locked-b'))
      .run();

    s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'sess-b' })
      .where(eq(chiefThreadTable.id, 't1'))
      .run();
    s.db
      .insert(stepTable)
      .values({
        id: 's-after-b',
        buildId: 't1',
        kind: 'chief',
        status: 'pending',
        ownerMessageIds: ['m5'],
        prompt: 'back on A after B succeeded',
        createdAt: 26,
      })
      .run();
    const claimAAfterB = await claim(s, machineA);
    expect(claimAAfterB?.session).toEqual({ action: 'new', sessionId: null });
    s.db
      .update(stepTable)
      .set({ status: 'done', sessionId: 'sess-a2', finishedAt: 27 })
      .where(eq(stepTable.id, 's-after-b'))
      .run();

    s.db
      .update(chiefThreadTable)
      .set({ sessionId: 'sess-null' })
      .where(eq(chiefThreadTable.id, 't1'))
      .run();
    s.db
      .insert(stepTable)
      .values([
        {
          id: 's-null-origin',
          buildId: 't1',
          kind: 'chief',
          status: 'done',
          machineId: null,
          sessionId: 'sess-null',
          createdAt: 28,
          finishedAt: 29,
        },
        {
          id: 's-claim-null',
          buildId: 't1',
          kind: 'chief',
          status: 'pending',
          ownerMessageIds: ['m6'],
          prompt: 'null origin',
          createdAt: 30,
        },
      ])
      .run();
    const claimNullOrigin = await claim(s, machineB);
    expect(claimNullOrigin?.session).toEqual({ action: 'continue', sessionId: 'sess-null' });
    s.db
      .update(stepTable)
      .set({ status: 'done', finishedAt: 31 })
      .where(eq(stepTable.id, 's-claim-null'))
      .run();

    seedRoute(s, 'coordinator', {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-6',
      machineId: null,
    });
    s.db
      .update(chiefThreadTable)
      .set({ sessionRuntime: 'pi', sessionId: 'pi-sess-a' })
      .where(eq(chiefThreadTable.id, 't1'))
      .run();
    s.db
      .insert(stepTable)
      .values([
        {
          id: 's-pi-a',
          buildId: 't1',
          kind: 'chief',
          status: 'done',
          machineId: machineA,
          sessionId: 'pi-sess-a',
          createdAt: 32,
          finishedAt: 33,
        },
        {
          id: 's-pi-b',
          buildId: 't1',
          kind: 'chief',
          status: 'pending',
          ownerMessageIds: ['m7'],
          prompt: 'pi cross machine',
          createdAt: 34,
        },
      ])
      .run();
    const claimPiB = await claim(s, machineB);
    expect(claimPiB?.session).toEqual({ action: 'continue', sessionId: 'pi-sess-a' });
  });
});
