import { expect, test } from 'vitest';
import {
  computerScreenRequestSchema,
  machineStreamEventSchema,
  openComputerScreenSchema,
} from '../src/index.js';

const channel = {
  id: 'a'.repeat(64),
  computerId: 'computer',
  scopeKey: 'chief:owner',
  generation: 1,
  kind: 'view',
  expiresAt: 1000,
  controlLeaseId: null,
  controlFence: 0,
};

test('screen dispatch carries the scope and fence but no socket path or credentials', () => {
  expect(machineStreamEventSchema.safeParse({ type: 'computer.screen', channel }).success).toBe(
    true,
  );
  for (const patch of [
    { path: '/tmp/arbitrary.sock' },
    { token: 'machine-token' },
    { generation: -1 },
    { scopeKey: '' },
    { id: 'short' },
  ]) {
    expect(computerScreenRequestSchema.safeParse({ ...channel, ...patch }).success).toBe(false);
  }
});

test('control and terminal requests require a lease while view remains separate', () => {
  for (const kind of ['control', 'terminal']) {
    expect(computerScreenRequestSchema.safeParse({ ...channel, kind }).success).toBe(false);
    expect(
      computerScreenRequestSchema.safeParse({ ...channel, kind, controlLeaseId: 'lease' }).success,
    ).toBe(true);
  }
  expect(openComputerScreenSchema.safeParse({ kind: 'terminal', leaseId: 'lease' }).success).toBe(
    true,
  );
  expect(
    openComputerScreenSchema.safeParse({ kind: 'admin', path: '/tmp/input.sock' }).success,
  ).toBe(false);
});
