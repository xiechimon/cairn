import { expect, test } from 'vitest';
import { FakeMachineApi } from './machine-loop-harness.js';

test('fake machine API defaults to a complete confinement-ready report', async () => {
  expect(await new FakeMachineApi().me()).toMatchObject({
    capabilities: {
      confinement: { state: 'ready', generation: 1, revision: 1 },
    },
  });
});
