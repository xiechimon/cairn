import { describe, expect, test } from 'vitest';
import { openMemoryDb } from '../src/db/client.js';
import { clientMessage } from '../src/db/schema.js';
import {
  ClientMessageConflict,
  claimClientMessage,
  coalesceClientMessage,
  completeClientMessage,
  findClientMessage,
  replayAfterConflict,
} from '../src/services/client-message.js';

describe('client message ledger', () => {
  test('a claimed key without a completed response is not replayable', () => {
    const db = openMemoryDb();
    claimClientMessage(db, 'scope', 'key');
    expect(findClientMessage(db, 'scope', 'key')).toBeUndefined();
  });

  test('a completed key replays its stored response', () => {
    const db = openMemoryDb();
    claimClientMessage(db, 'scope', 'key');
    completeClientMessage(db, 'scope', 'key', { message: { id: 'm1' } });
    expect(findClientMessage(db, 'scope', 'key')).toEqual({ message: { id: 'm1' } });
  });

  test('claiming the same scope and key twice conflicts, a different scope or key does not', () => {
    const db = openMemoryDb();
    claimClientMessage(db, 'scope', 'key');
    expect(() => claimClientMessage(db, 'scope', 'key')).toThrow(ClientMessageConflict);
    claimClientMessage(db, 'other-scope', 'key');
    claimClientMessage(db, 'scope', 'other-key');
    expect(db.select().from(clientMessage).all()).toHaveLength(3);
  });

  test('an absent key claims, completes and finds nothing', () => {
    const db = openMemoryDb();
    claimClientMessage(db, 'scope', undefined);
    completeClientMessage(db, 'scope', undefined, { x: 1 });
    expect(findClientMessage(db, 'scope', undefined)).toBeUndefined();
    expect(db.select().from(clientMessage).all()).toHaveLength(0);
  });

  test('replayAfterConflict returns the stored response for a conflict and rethrows anything else', () => {
    const db = openMemoryDb();
    claimClientMessage(db, 'scope', 'key', { id: 'first' });
    expect(replayAfterConflict(db, 'scope', 'key', new ClientMessageConflict())).toEqual({
      id: 'first',
    });
    const other = new Error('boom');
    expect(() => replayAfterConflict(db, 'scope', 'key', other)).toThrow(other);
  });

  test('coalesceClientMessage runs concurrent work for one scope and key once', async () => {
    const db = openMemoryDb();
    let runs = 0;
    const work = async () => {
      runs += 1;
      await Promise.resolve();
      return { id: 'once' };
    };
    const [first, second] = await Promise.all([
      coalesceClientMessage(db, 'scope', 'key', work),
      coalesceClientMessage(db, 'scope', 'key', work),
    ]);
    expect(runs).toBe(1);
    expect(second).toEqual(first);
    await coalesceClientMessage(db, 'scope', 'key', work);
    expect(runs).toBe(2);
  });

  test('coalesceClientMessage without a key never coalesces', async () => {
    const db = openMemoryDb();
    let runs = 0;
    const work = async () => {
      runs += 1;
      return runs;
    };
    await Promise.all([
      coalesceClientMessage(db, 'scope', undefined, work),
      coalesceClientMessage(db, 'scope', undefined, work),
    ]);
    expect(runs).toBe(2);
  });
});
