import type { ClaudeCodeReport } from '@cairn/shared';
import { afterEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  chiefThread as chiefThreadTable,
  step as stepTable,
} from '../src/db/schema.js';
import { setCoordinatorInServer } from '../src/services/coordinator-context.js';
import { coordinatorRouteVerdict } from '../src/services/coordinator-route.js';
import { claimStep } from '../src/services/machines.js';
import {
  bootServer,
  insertClaudeSubscription,
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
    .values({ id: 'c1', userId: s.svc.user.id, teamId: s.team.id, charter: '', createdAt: 1 })
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
