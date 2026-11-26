import { randomUUID } from 'node:crypto';
import type { MachineCapabilities } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { machineEligibility, runtimeGatePasses } from '../src/services/dispatch-eligibility.js';
import { claimStep } from '../src/services/machines.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
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

type Confinement = NonNullable<MachineCapabilities['confinement']>['state'];

function capabilities(
  osPlatform: 'darwin' | 'linux',
  confinement?: Confinement,
): MachineCapabilities {
  return {
    mcpServers: [],
    skills: [],
    osPlatform,
    devin: { installed: true, version: '3000.14.30821' },
    antigravity: { installed: true },
    ...(confinement === undefined
      ? {}
      : {
          confinement: {
            state: confinement,
            invocation: randomUUID(),
            generation: 1,
            revision: 1,
          },
        }),
  };
}

function devinCoordinatorTurn(runnerCapabilities: MachineCapabilities) {
  setCoordinatorInServer(true);
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  insertDevinSubscription(s, { token: `wsk-${'a'.repeat(64)}` });
  const runner = insertMachine(s, { name: 'old-mac', capabilities: runnerCapabilities });
  seedRoute(s, 'coordinator', {
    provider: 'devin',
    modelId: 'swe-2-high',
    thinkingLevel: 'off',
    machineId: runner,
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
  s.db
    .insert(stepTable)
    .values({ id: 's1', buildId: 'chief-t1', kind: 'chief', status: 'pending', createdAt: 3 })
    .run();
  return { s, runner };
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

function queueOf(s: TestServer) {
  return stepQueueProjector(s.db, s.team.id).chiefTurnQueueOf('chief-t1');
}

describe('a Mac runner from before desktop-v0.1.712, whose sandbox blocks TLS verification', () => {
  test('does not take a Devin turn; the turn waits for a Cairn update and runs after it', async () => {
    const { s, runner } = devinCoordinatorTurn(capabilities('darwin', 'ready'));

    await expect(claim(s, runner)).resolves.toBeNull();
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get()?.status).toBe(
      'pending',
    );
    expect(queueOf(s)).toMatchObject({
      waitingFor: { name: 'old-mac' },
      blocked: { kind: 'runner-outdated' },
    });

    s.db
      .update(machineTable)
      .set({ capabilities: capabilities('darwin') })
      .where(eq(machineTable.id, runner))
      .run();
    await expect(claim(s, runner)).resolves.toMatchObject({ step: { id: 's1' } });
  });

  test('still takes an Antigravity step that uses the login on that Mac', () => {
    const row = {
      id: 'mac',
      name: 'mac',
      claudeCodeReport: null,
      capabilities: capabilities('darwin', 'ready'),
    };
    expect(runtimeGatePasses(row, 'antigravity', true)).toBe(true);
    expect(runtimeGatePasses(row, 'devin', true)).toBe(false);
  });

  test('hands the Devin turn to an up-to-date runner when the team has one', async () => {
    const { s, runner } = devinCoordinatorTurn(capabilities('darwin', 'ready'));
    const current = insertMachine(s, { name: 'new-mac', capabilities: capabilities('darwin') });

    await expect(claim(s, runner)).resolves.toBeNull();
    await expect(claim(s, current)).resolves.toMatchObject({ step: { id: 's1' } });
  });

  test.each([
    ['darwin', 'ready', 'devin', 'runner-outdated'],
    ['darwin', 'checking', 'devin', 'runner-outdated'],
    ['darwin', 'ready', 'antigravity', 'runner-outdated'],
    ['darwin', 'ready', 'claude-code', undefined],
    ['darwin', 'ready', 'gemini', undefined],
    ['darwin', 'ready', 'relay', undefined],
    ['darwin', 'not-applicable', 'devin', undefined],
    ['linux', 'ready', 'devin', undefined],
    ['darwin', undefined, 'devin', undefined],
  ] as const)('%s runner reporting confinement %s, %s step: %s', (os, state, provider, kind) => {
    const row = {
      id: 'mac',
      name: 'mac',
      claudeCodeReport: { installed: true, hostname: 'mac', models: [{ id: 'm', name: 'm' }] },
      capabilities: capabilities(os, state),
    };
    const gap = machineEligibility({
      machine: row,
      agent: { machineId: 'other', requiredCapabilities: null },
      model: { provider, modelId: 'm' },
      catalog: [],
      localProject: false,
      claudeRateBlocked: false,
      claudeSubscriptionMissing: false,
      devinSubscriptionMissing: false,
    });
    expect(gap?.kind).toBe(kind);
    expect(runtimeGatePasses(row, provider)).toBe(kind === undefined);
  });
});
