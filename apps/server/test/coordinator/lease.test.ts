import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLease, LEASE_STALE_MS, LeaseHeldError } from '../../src/coordinator/lease.js';
import { openDb } from '../../src/db/client.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function twoHandles() {
  const dir = mkdtempSync(join(tmpdir(), 'coord-lease-'));
  dirs.push(dir);
  const path = join(dir, 'server.db');
  return { a: openDb(path), b: openDb(path) };
}

describe('coordinator lease', () => {
  it('refuses a second owner until the first heartbeat is stale', () => {
    const { a, b } = twoHandles();
    let clock = 1_000;
    const now = () => clock;
    acquireLease(a, 'thread-1', 'owner-a', { now });
    expect(() => acquireLease(b, 'thread-1', 'owner-b', { now })).toThrow(LeaseHeldError);
    clock += LEASE_STALE_MS - 1;
    expect(() => acquireLease(b, 'thread-1', 'owner-b', { now })).toThrow(LeaseHeldError);
    clock += 2;
    const taken = acquireLease(b, 'thread-1', 'owner-b', { now });
    expect(taken.heartbeat()).toBe(true);
  });

  it('keeps the lease alive while heartbeats continue', () => {
    const { a, b } = twoHandles();
    let clock = 1_000;
    const now = () => clock;
    const lease = acquireLease(a, 'thread-1', 'owner-a', { now });
    clock += LEASE_STALE_MS - 1;
    expect(lease.heartbeat()).toBe(true);
    clock += LEASE_STALE_MS - 1;
    expect(() => acquireLease(b, 'thread-1', 'owner-b', { now })).toThrow(LeaseHeldError);
  });

  it('lets a new owner in after release and reports a lost lease to the old one', () => {
    const { a, b } = twoHandles();
    const now = () => 5_000;
    const first = acquireLease(a, 'thread-1', 'owner-a', { now });
    first.release();
    const second = acquireLease(b, 'thread-1', 'owner-b', { now });
    expect(first.heartbeat()).toBe(false);
    expect(second.heartbeat()).toBe(true);
  });

  it('keys leases per store', () => {
    const { a, b } = twoHandles();
    acquireLease(a, 'thread-1', 'owner-a');
    expect(() => acquireLease(b, 'thread-2', 'owner-b')).not.toThrow();
  });
});
