import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { MachineClient } from '../../daemon/src/machine-client.js';
import { NspawnOrbProvider } from '../../daemon/src/orb/provider.js';
import { boot, defer, FakeMachineApi, waitFor } from '../../daemon/test/machine-loop-harness.js';
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
    ['unrequested-build', 'closed', s.team.id, machineId],
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
  expect(
    await wire.closedOrbConversations(['closed-build', 'other-team', 'other-machine']),
  ).toEqual(['closed-build']);
  expect(await wire.closedOrbConversations([])).toEqual([]);
  class Api extends FakeMachineApi {
    async closedOrbConversations(ids: string[]) {
      return wire.closedOrbConversations(ids);
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
    expect((await s.app.request('/api/machine/orbs/closed', { method: 'POST' })).status).toBe(401);
  } finally {
    await handle.stop();
    await handle.done;
    s.dispose();
  }
});

test.each([
  null,
  {},
  { conversationIds: 'closed-build' },
  { conversationIds: [1] },
  { conversationIds: [''] },
  { conversationIds: ['bad/id'] },
  { conversationIds: ['a'.repeat(129)] },
  { conversationIds: Array.from({ length: 251 }, (_, i) => `build-${i}`) },
])('rejects malformed or oversized orb cleanup input: %j', async (body) => {
  const s = bootServer();
  const machineId = insertMachine(s);
  const token = 'orb-cleanup-test-token';
  s.db
    .update(machine)
    .set({ tokenHash: hashCredential(token) })
    .where(eq(machine.id, machineId))
    .run();
  try {
    const response = await s.app.request('/api/machine/orbs/closed', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
  } finally {
    s.dispose();
  }
});

test('a failed closed-orb poll still stops idle orbs and waits 60 seconds before retrying', async () => {
  const requests: string[][] = [];
  class Api extends FakeMachineApi {
    async closedOrbConversations(ids: string[]): Promise<string[]> {
      requests.push(ids);
      throw new Error('cleanup unavailable');
    }
  }
  const provider = new NspawnOrbProvider({
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const orb = await provider.ensure({ conversationId: 'idle-build', projectId: 'P' });
  provider.touch(orb, Date.now() - 21 * 60_000);
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  const { handle } = await boot({
    api: new Api(),
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => requests.length > 0);
    await expect.poll(() => orb.running).toBe(false);
    expect(requests).toEqual([['idle-build']]);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(requests).toEqual([['idle-build'], ['idle-build']]);
  } finally {
    await handle.stop();
    await handle.done;
    vi.useRealTimers();
  }
});

test('orb cleanup batches only the currently held conversations within the wire limit', async () => {
  const requests: string[][] = [];
  class Api extends FakeMachineApi {
    async closedOrbConversations(ids: string[]) {
      requests.push(ids);
      return [];
    }
  }
  const provider = new NspawnOrbProvider({
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const ids = Array.from({ length: 501 }, (_, i) => `build-${i}`);
  for (const conversationId of ids) await provider.ensure({ conversationId, projectId: 'P' });
  const { handle } = await boot({
    api: new Api(),
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await waitFor(() => requests.flat().length >= ids.length);
    expect(requests.map((ids) => ids.length)).toEqual([250, 250, 1]);
    expect(requests.flat()).toEqual(ids);
  } finally {
    await handle.stop();
    await handle.done;
  }
});

test('a slow closed-orb request does not hold up the local idle sweep', async () => {
  const release = defer();
  class Api extends FakeMachineApi {
    async closedOrbConversations(): Promise<string[]> {
      await release.promise;
      return [];
    }
  }
  const provider = new NspawnOrbProvider({
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  const orb = await provider.ensure({ conversationId: 'idle-build', projectId: 'P' });
  provider.touch(orb, Date.now() - 21 * 60_000);
  const { handle } = await boot({
    api: new Api(),
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await expect.poll(() => orb.running).toBe(false);
  } finally {
    release.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('closed ids from a slow poll survive intervening local sweeps', async () => {
  const release = defer();
  class Api extends FakeMachineApi {
    async closedOrbConversations(): Promise<string[]> {
      await release.promise;
      return ['closed-build'];
    }
  }
  const provider = new NspawnOrbProvider({
    runner: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  await provider.ensure({ conversationId: 'closed-build', projectId: 'P' });
  const { handle } = await boot({
    api: new Api(),
    orbProvider: provider,
    capEnv: { CAIRN_EXECUTOR: 'orb' },
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_050));
    release.resolve();
    await expect.poll(() => provider.list()).toEqual([]);
  } finally {
    release.resolve();
    await handle.stop();
    await handle.done;
  }
});

test('rejects an orb cleanup body over 64 KiB before parsing it', async () => {
  const s = bootServer();
  const machineId = insertMachine(s);
  const token = 'orb-cleanup-test-token';
  s.db
    .update(machine)
    .set({ tokenHash: hashCredential(token) })
    .where(eq(machine.id, machineId))
    .run();
  try {
    const response = await s.app.request('/api/machine/orbs/closed', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ conversationIds: ['closed-build'], padding: 'x'.repeat(70_000) }),
    });
    expect(response.status).toBe(413);
  } finally {
    s.dispose();
  }
});
