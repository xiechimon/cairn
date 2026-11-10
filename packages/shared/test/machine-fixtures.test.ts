import { expect, test } from 'vitest';
import { z } from 'zod';
import { readyMachine } from './fixtures/machine.js';

test('default confinement report matches the strict 3854 ready contract', () => {
  const schema = z
    .object({
      state: z.literal('ready'),
      invocation: z.uuid(),
      generation: z.number().int().positive(),
      revision: z.number().int().positive(),
    })
    .strict();
  expect(schema.safeParse(readyMachine({}).capabilities?.confinement).success).toBe(true);
});

test('machine defaults preserve custom capabilities and machine fields', () => {
  expect(
    readyMachine({ id: 'custom', capabilities: { mcpServers: ['figma'], skills: ['verify'] } }),
  ).toMatchObject({
    id: 'custom',
    capabilities: {
      mcpServers: ['figma'],
      skills: ['verify'],
      confinement: { state: 'ready' },
    },
  });
});

test('explicit absent and unavailable reports remain available to negative fixtures', () => {
  expect(readyMachine({ capabilities: null }).capabilities).toBeNull();
  const capabilities = { mcpServers: [], skills: [], confinement: undefined };
  expect(readyMachine({ capabilities }).capabilities?.confinement).toBeUndefined();
  const failed = {
    ...capabilities,
    confinement: { state: 'unavailable', reason: 'startup-failed' },
  };
  expect(readyMachine({ capabilities: failed }).capabilities).toEqual(failed);
});

test('default reports and capability arrays are independent between fixtures', () => {
  const first = readyMachine({});
  const second = readyMachine({});
  expect(first.capabilities).not.toBe(second.capabilities);
  expect(first.capabilities?.confinement).not.toBe(second.capabilities?.confinement);
  expect(first.capabilities?.mcpServers).not.toBe(second.capabilities?.mcpServers);
});
