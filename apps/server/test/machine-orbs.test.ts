import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { MachineClient } from '../../daemon/src/machine-client.js';
import { NspawnOrbProvider } from '../../daemon/src/orb/provider.js';
import { boot, FakeMachineApi } from '../../daemon/test/machine-loop-harness.js';
import { build, machine, project, step, team, todo } from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { bootServer, insertMachine } from './helpers.js';

test('closed build cleanup uses the authenticated machine API and excludes other machines and teams', async () => {
  const s = bootServer();
  const machineId = insertMachine(s);
  const token = 'orb-cleanup-test-token';
  s.db
    .update(machine)
    .set({ tokenHash: hashCredential(token) })
    .where(eq(machine.id, machineId))
    .run();
  s.db.insert(team).values({ id: 'other-team', name: 'Other', createdAt: 1 }).run();
  for (const [id, phase, teamId, owner] of [
    ['closed-build', 'closed', s.team.id, machineId],
    ['done-build', 'done', s.team.id, machineId],
    ['archived-build', 'building', s.team.id, machineId],
    ['open-build', 'building', s.team.id, machineId],
    ['other-machine', 'closed', s.team.id, 'elsewhere'],
    ['other-team', 'closed', 'other-team', machineId],
  ] as const) {
    s.db
      .insert(project)
      .values({ id: `p-${id}`, name: id, teamId })
      .run();
    s.db
      .insert(todo)
      .values({
        id: `t-${id}`,
        projectId: `p-${id}`,
        teamId,
        title: id,
        phase,
        phaseAt: 1,
        archivedAt: id === 'archived-build' ? 1 : null,
        seqNum: 1,
      })
      .run();
    s.db
      .insert(build)
      .values({ id, todoId: `t-${id}`, withPlan: false, triggerSource: 'user', createdAt: 1 })
      .run();
    s.db
      .insert(step)
      .values({
        id: `s-${id}`,
        buildId: id,
        machineId: owner,
        kind: 'build',
        status: 'done',
        createdAt: 1,
      })
      .run();
  }
  const fetchImpl: typeof fetch = async (input, init) => s.app.request(String(input), init);
  const wire = new MachineClient({ serverUrl: 'http://server', getToken: () => token, fetchImpl });
  class Api extends FakeMachineApi {
    async closedOrbConversations() {
      return wire.closedOrbConversations();
    }
  }
  const provider = new NspawnOrbProvider({
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  for (const conversationId of [
    'closed-build',
    'done-build',
    'archived-build',
    'open-build',
    'other-machine',
    'other-team',
  ])
    await provider.ensure({ conversationId, projectId: 'P' });
  const { handle } = await boot({
    api: new Api(),
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await expect
      .poll(async () => (await provider.list()).map((orb) => orb.conversationId).sort())
      .toEqual(['open-build', 'other-machine', 'other-team']);
    expect((await s.app.request('/api/machine/orbs/closed')).status).toBe(401);
  } finally {
    await handle.stop();
    await handle.done;
    s.dispose();
  }
});
