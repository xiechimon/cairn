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
