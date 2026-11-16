import { expect, test } from 'vitest';
import { MachineClient } from '../src/machine-client.js';

test('every claim advertises attachment verification support while preserving claim limits', async () => {
  const bodies: unknown[] = [];
  const client = new MachineClient({
    serverUrl: 'http://server',
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ step: null });
    },
  });
  await client.claim();
  await client.claim(undefined, { maxWorkers: 2, role: 'coordinator' });
  expect(bodies).toEqual([
    { verifyAttachments: true },
    { maxWorkers: 2, role: 'coordinator', verifyAttachments: true },
  ]);
});

test('me() keeps working when the server stored a sandbox cause this daemon does not know', async () => {
  const confinement = {
    state: 'unavailable',
    reason: 'startup-failed',
    invocation: '7d4f6a2e-8b1c-4e3a-9f5d-2c6b8a1e4f70',
    generation: 3,
    revision: 2,
  };
  const client = new MachineClient({
    serverUrl: 'http://server',
    fetchImpl: async () =>
      Response.json({
        id: 'm1',
        name: 'box',
        teamId: 't1',
        online: true,
        latestCliVersion: null,
        kind: 'remote',
        enabledRuntimes: [],
        capabilities: {
          mcpServers: [],
          skills: [],
          osPlatform: 'linux',
          confinement,
          confinementCause: { kind: 'cgroup-too-old' },
        },
      }),
  });
  const me = await client.me();
  expect(me.capabilities?.confinement).toEqual(confinement);
  expect(me.capabilities?.confinementCause).toBeUndefined();
});
