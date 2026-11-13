import { expect, test, vi } from 'vitest';
import { beginGateProbe, demandGate, passGate, rejectGate, useAuth } from '../src/api/auth.js';

vi.mock('react', () => ({
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));

test('accepted tokens and gate boundaries advance a private cache generation without including the token', () => {
  const initial = useAuth();
  passGate();
  const first = useAuth();
  expect(first.generation).toBe(initial.generation + 1);
  expect(first.gateOpen).toBe(false);
  passGate();
  const replacement = useAuth();
  expect(replacement.generation).toBe(first.generation + 1);
  demandGate();
  const gated = useAuth();
  expect(gated.generation).toBe(replacement.generation + 1);
  expect(gated.gateOpen).toBe(true);
  rejectGate();
  beginGateProbe();
  expect(useAuth().generation).toBe(gated.generation);
  passGate();
  expect(useAuth().generation).toBe(gated.generation + 1);
  expect(JSON.stringify(useAuth())).not.toContain('synthetic');
});
