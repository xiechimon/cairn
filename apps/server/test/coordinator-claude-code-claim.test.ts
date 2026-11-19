import { createHash } from 'node:crypto';
import {
  CHIEF_THREAD_ID_PREFIX,
  type ClaudeCodeReport,
  machineTokenResponseSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { coordinatorRouteVerdict } from '../src/services/coordinator-route.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  insertClaudeSubscription,
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

function world(provider = 'claude-code') {
  setCoordinatorInServer(true);
  const s = bootServer({ githubFetch: async () => new Response('[]') });
  insertClaudeSubscription(s);
  disposables.push(() => s.dispose());
  const report = {
    installed: true,
    hostname: 'omarchy',
    models: [{ id: 'sonnet', name: 'sonnet' }],
    auth: { state: 'logged-in', method: 'claude.ai', provider: 'firstParty' },
  } as ClaudeCodeReport;
  const machineId = insertMachine(s, { name: 'omarchy', claudeCodeReport: report });
  seedRoute(s, 'coordinator', {
    provider,
    modelId: 'sonnet',
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
      id: 't1',
      chiefId: 'c1',
      userId: s.svc.user.id,
      teamId: s.team.id,
      title: 'x',
      createdAt: 2,
      updatedAt: 2,
      sessionId: '',
      sessionOpenedAt: 2,
    })
    .run();
  return { s, machineId };
}

function chiefStep(s: TestServer, id: string, createdAt: number): void {
  s.db
    .insert(stepTable)
    .values({ id, buildId: 't1', kind: 'chief', status: 'pending', createdAt })
    .run();
}

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

describe('Coordinator rule that selects Claude Code', () => {
  test('the server never takes the turn; a rule without a provider row still refuses', () => {
    const { s } = world();
    expect(coordinatorRouteVerdict(s.db, s.team.id)).toBeNull();
    const other = world('ghost-provider');
    expect(coordinatorRouteVerdict(other.s.db, other.s.team.id)).toMatchObject({
      refusal: 'rule-provider-missing',
    });
  });

  test('the Runner claims the chief step and the server does not', async () => {
    const { s, machineId } = world();
    chiefStep(s, 's1', 3);
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step).toMatchObject({ id: 's1', machineId });
    expect(claimed?.agent).toMatchObject({ provider: 'claude-code', modelId: 'sonnet' });
    expect(claimed?.remoteTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining([
        'browser_navigate',
        'browser_snapshot',
        'browser_act',
        'request_takeover',
      ]),
    );
  });
});

describe('Coordinator rule that selects Devin', () => {
  const DEVIN_THREAD = `${CHIEF_THREAD_ID_PREFIX}devin`;

  function devinWorld(withSubscription: boolean) {
    setCoordinatorInServer(true);
    const s = bootServer({ githubFetch: async () => new Response('[]') });
    disposables.push(() => s.dispose());
    const token = `wsk-coordinator-token-${'d'.repeat(48)}`;
    if (withSubscription) insertDevinSubscription(s, { token });
    const machineId = insertMachine(s, {
      name: 'devin-runner',
      capabilities: { mcpServers: [], skills: [], devin: { installed: true } },
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
        id: DEVIN_THREAD,
        chiefId: 'c1',
        userId: s.svc.user.id,
        teamId: s.team.id,
        title: 'x',
        createdAt: 2,
        updatedAt: 2,
        sessionId: '',
        sessionOpenedAt: 2,
      })
      .run();
    return { s, machineId, token };
  }

  test('the Runner claims the chief step, binds the Devin account and serves its token', async () => {
    const { s, machineId, token } = devinWorld(true);
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: DEVIN_THREAD, kind: 'chief', status: 'pending', createdAt: 3 })
      .run();
    const claimed = await claimAs(s, machineId);
    expect(claimed?.step).toMatchObject({ id: 's1', machineId });
    expect(claimed?.agent).toMatchObject({ provider: 'devin', modelId: 'swe-2-high' });
    expect(claimed?.remoteToolsOnly).toBeUndefined();
    expect(claimed?.remoteTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['browser_navigate', 'request_takeover']),
    );
    const machineToken = 'machine-devin-coordinator';
    s.db
      .update(machineTable)
      .set({ tokenHash: createHash('sha256').update(machineToken).digest('hex') })
      .where(eq(machineTable.id, machineId))
      .run();
    const response = await s.app.request('/api/machine/token/s1', {
      headers: { authorization: `Bearer ${machineToken}` },
    });
    expect(machineTokenResponseSchema.parse(await response.json())).toMatchObject({
      devinToken: token,
    });
  });

  test('without a Devin subscription the chief step stays pending', async () => {
    const { s, machineId } = devinWorld(false);
    s.db
      .insert(stepTable)
      .values({ id: 's1', buildId: DEVIN_THREAD, kind: 'chief', status: 'pending', createdAt: 3 })
      .run();
    expect(await claimAs(s, machineId)).toBeNull();
    expect(s.db.select().from(stepTable).where(eq(stepTable.id, 's1')).get()?.status).toBe(
      'pending',
    );
  });
});
