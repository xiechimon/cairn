import { describe, expect, test } from 'vitest';
import {
  DEGRADED_AFTER_FAILURES,
  HALF_OPEN_AFTER_MS,
  OPEN_AFTER_FAILURES,
  PROBE_LEASE_MS,
  ProviderHealthTracker,
} from '../src/services/provider-health.js';

function tracker(start = 1_000_000): { t: ProviderHealthTracker; clock: { now: number } } {
  const clock = { now: start };
  return { t: new ProviderHealthTracker(() => clock.now), clock };
}

function fail(t: ProviderHealthTracker, providerId: string, n: number): void {
  for (let i = 0; i < n; i++) t.recordFailure(providerId);
}

describe('the provider circuit breaker (#1493)', () => {
  test('the threshold constants match the ticket', () => {
    expect(DEGRADED_AFTER_FAILURES).toBe(3);
    expect(OPEN_AFTER_FAILURES).toBe(5);
    expect(HALF_OPEN_AFTER_MS).toBe(30_000);
  });

  test('an unseen provider = healthy and selectable', () => {
    const { t } = tracker();
    expect(t.state('relay-a')).toBe('healthy');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H1: 2 consecutive failures still healthy, 3 degraded (still selectable), 5 open (not selectable)', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 2);
    expect(t.state('relay-a')).toBe('healthy');
    fail(t, 'relay-a', 1);
    expect(t.state('relay-a')).toBe('degraded');
    expect(t.tryAcquire('relay-a')).toBe(true);
    fail(t, 'relay-a', 2);
    expect(t.state('relay-a')).toBe('open');
    expect(t.tryAcquire('relay-a')).toBe(false);
  });

  test('providers do not affect each other', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 5);
    expect(t.state('relay-a')).toBe('open');
    expect(t.state('relay-b')).toBe('healthy');
    expect(t.tryAcquire('relay-b')).toBe(true);
  });

  test('H2: open for 30 seconds -> half_open, selectable once', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS - 1;
    expect(t.state('relay-a')).toBe('open');
    expect(t.tryAcquire('relay-a')).toBe(false);
    clock.now += 1;
    expect(t.state('relay-a')).toBe('half_open');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H3: while the half_open probe slot is taken, no more passes', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    expect(t.tryAcquire('relay-a')).toBe(true);
    expect(t.tryAcquire('relay-a')).toBe(false);
  });

  test('a successful half_open probe -> healthy, the failure streak reset', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    t.tryAcquire('relay-a');
    t.recordSuccess('relay-a');
    expect(t.state('relay-a')).toBe('healthy');
    fail(t, 'relay-a', 2);
    expect(t.state('relay-a')).toBe('healthy');
  });

  test('H4: a failed half_open probe -> back to open with the timer restarted', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    t.tryAcquire('relay-a');
    t.recordFailure('relay-a');
    expect(t.state('relay-a')).toBe('open');
    expect(t.tryAcquire('relay-a')).toBe(false);
    clock.now += HALF_OPEN_AFTER_MS - 1;
    expect(t.state('relay-a')).toBe('open');
    clock.now += 1;
    expect(t.state('relay-a')).toBe('half_open');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H5: one success in between resets the streak', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 4);
    expect(t.state('relay-a')).toBe('degraded');
    t.recordSuccess('relay-a');
    expect(t.state('relay-a')).toBe('healthy');
    fail(t, 'relay-a', 4);
    expect(t.state('relay-a')).toBe('degraded');
  });

  test('H6: the probe slot frees after its lease, the next step can retry', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    expect(t.tryAcquire('relay-a')).toBe(true);
    clock.now += PROBE_LEASE_MS - 1;
    expect(t.tryAcquire('relay-a')).toBe(false);
    clock.now += 1;
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('H7: the probe step ends provider-unrelated (404 / stopped / ordinary failure) -> the probe slot freed, the state unchanged', () => {
    const { t, clock } = tracker();
    fail(t, 'relay-a', 5);
    clock.now += HALF_OPEN_AFTER_MS;
    expect(t.tryAcquire('relay-a')).toBe(true);
    t.releaseProbe('relay-a');
    expect(t.state('relay-a')).toBe('half_open');
    expect(t.tryAcquire('relay-a')).toBe(true);
  });

  test('reset clears all state (restart semantics: in-memory, starting from healthy)', () => {
    const { t } = tracker();
    fail(t, 'relay-a', 5);
    t.reset();
    expect(t.state('relay-a')).toBe('healthy');
  });
});
