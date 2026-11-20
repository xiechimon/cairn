import { createHash } from 'node:crypto';
import { machineTokenResponseSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  devinSubscription as devinSubscriptionTable,
  machine as machineTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { devinUsable } from '../src/services/dispatch-eligibility.js';
import { claimStep } from '../src/services/machines.js';
import { listDevinSources } from '../src/services/providers.js';
import { stepQueueProjector } from '../src/services/step-queue.js';
import {
  bootServer,
  insertDevinSubscription,
  insertMachine,
  postProject,
  seedRoute,
  type TestServer,
} from './helpers.js';

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

let seq = 11_400;

const DEVIN_CAPABILITIES = { mcpServers: [], skills: [], devin: { installed: true } };

function claimAs(s: TestServer, machineId: string) {
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

async function world(
  opts: { subscription?: boolean } = {},
): Promise<{ s: TestServer; projectId: string }> {
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  disposables.push(() => s.dispose());
  if (opts.subscription === true) insertDevinSubscription(s);
  const projectId = await postProject(s.app, 'devin-claim');
  return { s, projectId };
}

function routeSession(s: TestServer, machineId: string, provider = 'devin'): void {
  seedRoute(s, 'session', {
    provider,
    modelId: provider === 'devin' ? 'swe-2-high' : 'stub-model',
    thinkingLevel: 'off',
    machineId,
  });
}

function insertBuildStep(s: TestServer, projectId: string): string {
  seq += 1;
  const suffix = `${seq}`;
  const todoId = `todo-devin-${suffix}`;
  const buildId = `build-devin-${suffix}`;
  const stepId = `step-devin-${suffix}`;
  s.db
    .insert(todoTable)
    .values({
      id: todoId,
      teamId: s.team.id,
      projectId,
      seqNum: seq,
      title: `devin probe ${suffix}`,
      spec: '',
      phase: 'queued',
      phaseAt: seq,
    })
    .run();
  s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      planDocId: null,
      triggerSource: 'user',
      createdAt: seq,
    })
    .run();
  s.db
    .insert(stepTable)
    .values({
      id: stepId,
      buildId,
      kind: 'build',
      machineId: null,
      status: 'pending',
      prompt: null,
      freshSession: false,
      createdAt: seq,
    })
    .run();
  return stepId;
}

function stepRow(s: TestServer, stepId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get();
}

function credentialsOf(s: TestServer, machineId: string, stepId: string) {
  const machineToken = `machine-${stepId}`;
  s.db
    .update(machineTable)
    .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
    .where(eq(machineTable.id, machineId))
    .run();
  return s.app.request(`/api/machine/token/${stepId}`, {
    headers: { authorization: `Bearer ${machineToken}` },
  });
}

describe('devinUsable truth table', () => {
  test.each([
    ['usable subscription + online capable Runner', true, 'online', true],
    ['usable subscription + capability missing everywhere', true, 'none', false],
    ['usable subscription + only an offline capable Runner', true, 'offline', false],
    ['no subscription + online capable Runner', false, 'online', false],
    ['no subscription + no Runner', false, 'none', false],
    ['expired subscription + online capable Runner', true, 'online', false],
  ])('%s -> usable=%s', async (_name, subscription, machine, expected) => {
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    if (subscription) {
      insertDevinSubscription(s, {
        expiresAt: _name.startsWith('expired') ? 1 : null,
      });
    }
    if (machine !== 'none') {
      const machineId = insertMachine(s, {
        name: `devin-${machine}`,
        capabilities: DEVIN_CAPABILITIES,
      });
      if (machine === 'offline') {
        s.db
          .update(machineTable)
          .set({ online: false })
          .where(eq(machineTable.id, machineId))
          .run();
      }
    }
    expect(devinUsable(s.db, s.team.id)).toBe(expected);
  });
});

describe('claimStep and the Devin subscription', () => {
  test('without a subscription a devin step stays pending and the queue reports devin-subscription', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'devin-runner',
      capabilities: DEVIN_CAPABILITIES,
    });
    routeSession(s, machineId);
    const stepId = insertBuildStep(s, projectId);
    expect(await claimAs(s, machineId)).toBeNull();
    expect(stepRow(s, stepId)).toMatchObject({ status: 'pending', devinSubscriptionId: null });
    const info = stepQueueProjector(s.db, s.team.id).project({
      id: stepId,
      createdAt: seq,
      homeMachineId: machineId,
      holdReason: null,
      holdUntil: null,
    });
    expect(info?.blocked).toEqual({ kind: 'devin-subscription', missing: [] });
  });

  test('a machine without the devin capability never claims a devin step', async () => {
    const { s, projectId } = await world({ subscription: true });
    const machineId = insertMachine(s, { name: 'plain-runner' });
    routeSession(s, machineId);
    insertBuildStep(s, projectId);
    expect(await claimAs(s, machineId)).toBeNull();
  });

  test('with a subscription the devin step binds the enabled account and serves its token only while claimed', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'devin-bound',
      capabilities: DEVIN_CAPABILITIES,
    });
    routeSession(s, machineId);
    const stepId = insertBuildStep(s, projectId);
    const token = `wsk-bound-account-token-${'c'.repeat(48)}`;
    const subscriptionId = insertDevinSubscription(s, { label: 'Bound', token });
    const events: object[] = [];
    s.hub.subscribe(s.team.id, {
      nextSeq: () => 1,
      send: async (event: object) => {
        events.push(event);
      },
    });
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.devinSubscriptionId).toBe(subscriptionId);
    expect(JSON.stringify({ claimed, events })).not.toContain(token);
    const response = await credentialsOf(s, machineId, stepId);
    expect(response.status).toBe(200);
    const body = machineTokenResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ devinToken: token });
    for (const status of ['done', 'failed', 'stopped', 'waiting_quota', 'pending'] as const) {
      s.db.update(stepTable).set({ status }).where(eq(stepTable.id, stepId)).run();
      const finished = await credentialsOf(s, machineId, stepId);
      expect(finished.status).toBe(200);
      const finishedBody = machineTokenResponseSchema.parse(await finished.json());
      expect(finishedBody).not.toHaveProperty('devinToken');
      expect(JSON.stringify(finishedBody)).not.toContain(token);
    }
    s.db
      .update(stepTable)
      .set({
        status: 'claimed',
        fallback: {
          model: { provider: 'stub-gw', modelId: 'stub-model' },
          tried: [],
          zeroUsageRetried: false,
        },
      })
      .where(eq(stepTable.id, stepId))
      .run();
    const piCredentials = await credentialsOf(s, machineId, stepId);
    expect(piCredentials.status).toBe(200);
    const piBody = machineTokenResponseSchema.parse(await piCredentials.json());
    expect(piBody).not.toHaveProperty('devinToken');
    expect(JSON.stringify(piBody)).not.toContain(token);
  });

  test('a step claimed on the enabled account keeps its token after the enabled row changes', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'devin-swap',
      capabilities: DEVIN_CAPABILITIES,
    });
    const first = insertDevinSubscription(s, { label: 'First', token: `wsk-${'a'.repeat(64)}` });
    insertDevinSubscription(s, { label: 'Second', token: `wsk-${'b'.repeat(64)}` });
    routeSession(s, machineId);
    const stepId = insertBuildStep(s, projectId);
    expect((await claimAs(s, machineId))?.step.id).toBe(stepId);
    expect(stepRow(s, stepId)?.devinSubscriptionId).toBe(first);
    const second = s.db
      .select()
      .from(devinSubscriptionTable)
      .all()
      .find((row) => row.id !== first)!;
    s.db
      .update(devinSubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(devinSubscriptionTable.id, first))
      .run();
    s.db
      .update(devinSubscriptionTable)
      .set({ enabledAt: Date.now() })
      .where(eq(devinSubscriptionTable.id, second.id))
      .run();
    const response = await credentialsOf(s, machineId, stepId);
    const body = machineTokenResponseSchema.parse(await response.json());
    expect(body).toMatchObject({ devinToken: `wsk-${'a'.repeat(64)}` });
  });

  test('a step with no recorded account receives no token even when one is enabled', async () => {
    const { s, projectId } = await world();
    const machineId = insertMachine(s, {
      name: 'devin-unbound',
      capabilities: DEVIN_CAPABILITIES,
    });
    routeSession(s, machineId);
    const stepId = insertBuildStep(s, projectId);
    s.db
      .update(stepTable)
      .set({ machineId, status: 'claimed' })
      .where(eq(stepTable.id, stepId))
      .run();
    expect(stepRow(s, stepId)?.devinSubscriptionId).toBeNull();
    const token = `wsk-${'d'.repeat(64)}`;
    insertDevinSubscription(s, { token });
    const response = await credentialsOf(s, machineId, stepId);
    expect(await response.text()).not.toContain(token);
  });

  test('the database refuses a second enabled row in a team', async () => {
    const { s } = await world();
    const first = insertDevinSubscription(s);
    const second = insertDevinSubscription(s);
    expect(() =>
      s.db
        .update(devinSubscriptionTable)
        .set({ enabledAt: 5 })
        .where(eq(devinSubscriptionTable.id, second))
        .run(),
    ).toThrow(/UNIQUE/i);
    s.db
      .update(devinSubscriptionTable)
      .set({ enabledAt: null })
      .where(eq(devinSubscriptionTable.id, first))
      .run();
  });
});

describe('model sources', () => {
  test('a devin-capable Runner contributes a static devin source online or offline; incapable ones do not', async () => {
    const { s } = await world();
    const online = insertMachine(s, {
      name: 'devin-online',
      capabilities: DEVIN_CAPABILITIES,
    });
    const offline = insertMachine(s, {
      name: 'devin-offline',
      capabilities: DEVIN_CAPABILITIES,
    });
    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, offline)).run();
    insertMachine(s, { name: 'no-devin' });
    const statics = [
      {
        id: 'swe-2-high',
        name: 'SWE-2',
        slot: 'builtin',
        thinkingLevels: ['medium', 'high', 'max'],
        thinkingDefault: 'high',
      },
      {
        id: 'swe-2-flash-medium',
        name: 'SWE-2 Flash',
        slot: 'builtin',
        thinkingLevels: ['medium', 'high', 'max'],
        thinkingDefault: 'medium',
      },
      { id: 'adaptive', name: 'Adaptive', slot: 'builtin', thinkingLevels: [] },
    ];
    expect(listDevinSources(s.db, s.team.id)).toEqual([
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-offline',
        machineId: offline,
        models: statics,
      },
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-online',
        machineId: online,
        models: statics,
      },
    ]);
  });

  test('the enabled subscription selection reaches an offline devin-capable Runner', async () => {
    const { s } = await world();
    const subscriptionId = insertDevinSubscription(s);
    s.db
      .update(devinSubscriptionTable)
      .set({ models: [{ id: 'swe-3', name: 'SWE-3 picked' }] })
      .where(eq(devinSubscriptionTable.id, subscriptionId))
      .run();
    const machineId = insertMachine(s, {
      name: 'devin-asleep',
      capabilities: DEVIN_CAPABILITIES,
    });
    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.id, machineId)).run();
    expect(listDevinSources(s.db, s.team.id)).toEqual([
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-asleep',
        machineId,
        models: [{ id: 'swe-3', name: 'SWE-3 picked' }],
      },
    ]);
  });

  test('a machine reporting devin.models lists the advertised catalog verbatim', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'devin-catalog',
      capabilities: {
        mcpServers: [],
        skills: [],
        devin: {
          installed: true,
          models: [
            { id: 'swe-3', name: 'SWE-3' },
            { id: 'gpt-5.5', name: 'GPT-5.5' },
            { id: 'swe-2-high', name: 'SWE-2' },
          ],
        },
      },
    });
    expect(listDevinSources(s.db, s.team.id)).toEqual([
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-catalog',
        machineId,
        models: [
          { id: 'swe-3', name: 'SWE-3' },
          { id: 'gpt-5.5', name: 'GPT-5.5' },
          {
            id: 'swe-2-high',
            name: 'SWE-2',
            thinkingLevels: ['medium', 'high', 'max'],
            thinkingDefault: 'high',
          },
        ],
      },
    ]);
  });

  test('an empty devin.models falls back to the static three', async () => {
    const { s } = await world();
    const machineId = insertMachine(s, {
      name: 'devin-empty',
      capabilities: { mcpServers: [], skills: [], devin: { installed: true, models: [] } },
    });
    expect(listDevinSources(s.db, s.team.id)).toEqual([
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-empty',
        machineId,
        models: [
          {
            id: 'swe-2-high',
            name: 'SWE-2',
            slot: 'builtin',
            thinkingLevels: ['medium', 'high', 'max'],
            thinkingDefault: 'high',
          },
          {
            id: 'swe-2-flash-medium',
            name: 'SWE-2 Flash',
            slot: 'builtin',
            thinkingLevels: ['medium', 'high', 'max'],
            thinkingDefault: 'medium',
          },
          { id: 'adaptive', name: 'Adaptive', slot: 'builtin', thinkingLevels: [] },
        ],
      },
    ]);
  });

  test('the enabled subscription selection leads, machine catalogs append, first-wins dedupe', async () => {
    const { s } = await world();
    const subscriptionId = insertDevinSubscription(s);
    s.db
      .update(devinSubscriptionTable)
      .set({
        models: [
          { id: 'swe-3', name: 'SWE-3 picked', costTier: 'High cost' },
          { id: 'gpt-5.5', name: 'GPT-5.5' },
        ],
      })
      .where(eq(devinSubscriptionTable.id, subscriptionId))
      .run();
    const machineId = insertMachine(s, {
      name: 'devin-merged',
      capabilities: {
        mcpServers: [],
        skills: [],
        devin: {
          installed: true,
          models: [
            { id: 'gpt-5.5', name: 'GPT-5.5 reported' },
            { id: 'swe-2-high', name: 'SWE-2' },
          ],
        },
      },
    });
    expect(listDevinSources(s.db, s.team.id)).toEqual([
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-merged',
        machineId,
        models: [
          { id: 'swe-3', name: 'SWE-3 picked' },
          { id: 'gpt-5.5', name: 'GPT-5.5' },
          {
            id: 'swe-2-high',
            name: 'SWE-2',
            thinkingLevels: ['medium', 'high', 'max'],
            thinkingDefault: 'high',
          },
        ],
      },
    ]);
  });

  test('a disabled or expired subscription contributes nothing to the merged list', async () => {
    const { s } = await world();
    const disabled = insertDevinSubscription(s, { label: 'Disabled' });
    const expired = insertDevinSubscription(s, { label: 'Expired' });
    s.db
      .update(devinSubscriptionTable)
      .set({ enabledAt: null, models: [{ id: 'gone', name: 'Gone' }] })
      .where(eq(devinSubscriptionTable.id, disabled))
      .run();
    s.db
      .update(devinSubscriptionTable)
      .set({
        enabledAt: 5,
        expiresAt: 1,
        models: [{ id: 'expired-model', name: 'Expired Model' }],
      })
      .where(eq(devinSubscriptionTable.id, expired))
      .run();
    const machineId = insertMachine(s, {
      name: 'devin-plain',
      capabilities: {
        mcpServers: [],
        skills: [],
        devin: { installed: true, models: [{ id: 'swe-2-high', name: 'SWE-2' }] },
      },
    });
    expect(listDevinSources(s.db, s.team.id)).toEqual([
      {
        runtime: 'devin',
        installed: true,
        hostname: 'devin-plain',
        machineId,
        models: [
          {
            id: 'swe-2-high',
            name: 'SWE-2',
            thinkingLevels: ['medium', 'high', 'max'],
            thinkingDefault: 'high',
          },
        ],
      },
    ]);
  });
});
