import { expect, test } from 'vitest';
import { readyMachine } from './fixtures/machine.js';

test('machine defaults preserve custom capabilities and machine fields', () => {
  expect(
    readyMachine({ id: 'custom', capabilities: { mcpServers: ['figma'], skills: ['verify'] } }),
  ).toMatchObject({
    id: 'custom',
    capabilities: {
      mcpServers: ['figma'],
      skills: ['verify'],
    },
  });
});

test('explicit null capabilities remain available to negative fixtures', () => {
  expect(readyMachine({ capabilities: null }).capabilities).toBeNull();
});

test('default capability arrays are independent between fixtures', () => {
  const first = readyMachine({});
  const second = readyMachine({});
  expect(first.capabilities).not.toBe(second.capabilities);
  expect(first.capabilities?.mcpServers).not.toBe(second.capabilities?.mcpServers);
});
