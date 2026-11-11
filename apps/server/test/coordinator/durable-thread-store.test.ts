import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai/models';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../../scripts/test-tmpdir.mjs';
import { LeaseHeldError } from '../../src/coordinator/lease.js';
import { openDurableThreadStore } from '../../src/coordinator/runtime/durable-thread-store.js';
import { openDbWithHandle } from '../../src/db/client.js';
import { coordinatorLease, threadConversation } from '../../src/db/schema.js';

const dir = makeTestTempDir('durable-thread-');
const product = openDbWithHandle(join(dir, 'server.db'));
const context = BACKGROUND_CONTEXT;
const models = createModels();
const opened: Awaited<ReturnType<typeof openDurableThreadStore>>[] = [];
let seq = 0;
async function open(threadId: string, enabled?: boolean) {
  const store = await openDurableThreadStore(product.db, dir, threadId, models, context, {
    enabled,
  });
  opened.push(store);
  return store;
}
afterEach(async () => {
  for (const store of opened.splice(0)) await store?.close();
  vi.useRealTimers();
});

it('defaults off without creating files or product state', async () => {
  expect(await open('disabled')).toBeUndefined();
  expect(existsSync(join(dir, 'threads'))).toBe(false);
  expect(product.db.select().from(threadConversation).all()).toEqual([]);
  expect(product.db.select().from(coordinatorLease).all()).toEqual([]);
});

it('rejects traversal before touching storage', async () => {
  await expect(open('../escape', true)).rejects.toThrow('invalid Coordinator thread id');
  expect(existsSync(join(dir, 'escape.sqlite'))).toBe(false);
});

it('holds one writer lease per thread and releases it only after close', async () => {
  const id = `lease-${seq++}`;
  const first = await open(id, true);
  expect(existsSync(join(dir, 'threads', `${id}.sqlite`))).toBe(true);
  await expect(open(id, true)).rejects.toThrow(LeaseHeldError);
  const other = await open(`other-${seq++}`, true);
  expect(other).toBeDefined();
  await first?.close();
  const again = await open(id, true);
  expect(again?.conversationId).toBe(first?.conversationId);
  expect(again?.storeId).toBe(first?.storeId);
});

it('failed sqlite open leaves no conversation and permits retry', async () => {
  const id = `failure-${seq++}`;
  mkdirSync(join(dir, 'threads'), { recursive: true });
  const path = join(dir, 'threads', `${id}.sqlite`);
  mkdirSync(path);
  await expect(open(id, true)).rejects.toThrow();
  expect(
    product.db
      .select()
      .from(threadConversation)
      .all()
      .some((r) => r.threadId === id),
  ).toBe(false);
  rmSync(path, { recursive: true });
  expect(await open(id, true)).toBeDefined();
});

it('failed product insert closes the store and releases the lease', async () => {
  const id = `insert-${seq++}`;
  product.db.run(sql`CREATE TRIGGER reject_thread BEFORE INSERT ON thread_conversation
    BEGIN SELECT RAISE(ABORT, 'insert failed'); END`);
  try {
    await expect(open(id, true)).rejects.toThrow('insert failed');
  } finally {
    product.db.run(sql`DROP TRIGGER reject_thread`);
  }
  expect(await open(id, true)).toBeDefined();
});

it('a non-directory data root fails without a product row', async () => {
  const path = join(dir, 'not-directory');
  writeFileSync(path, 'blocked');
  await expect(
    openDurableThreadStore(product.db, path, 'blocked', models, context, { enabled: true }),
  ).rejects.toThrow();
  expect(
    product.db
      .select()
      .from(threadConversation)
      .all()
      .some((r) => r.threadId === 'blocked'),
  ).toBe(false);
});

it('refuses a different sqlite identity without overwriting the product row', async () => {
  const id = `identity-${seq++}`;
  const first = await open(id, true);
  await first?.close();
  const path = join(dir, 'threads', `${id}.sqlite`);
  rmSync(path);
  await expect(open(id, true)).rejects.toThrow('identity mismatch');
  expect(
    product.db.select().from(threadConversation).where(eq(threadConversation.threadId, id)).get()
      ?.storeId,
  ).toBe(first?.storeId);
});

it('renews the lease and stops holding it after ownership is lost', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const id = `heartbeat-${seq++}`;
  const store = await open(id, true);
  const key = `durable-thread:${id}`;
  product.db
    .update(coordinatorLease)
    .set({ heartbeatAt: 0 })
    .where(eq(coordinatorLease.storeKey, key))
    .run();
  await vi.advanceTimersByTimeAsync(15_000);
  expect(
    product.db.select().from(coordinatorLease).where(eq(coordinatorLease.storeKey, key)).get()
      ?.heartbeatAt,
  ).toBeGreaterThan(0);
  product.db
    .update(coordinatorLease)
    .set({ owner: 'replacement' })
    .where(eq(coordinatorLease.storeKey, key))
    .run();
  await vi.advanceTimersByTimeAsync(15_000);
  await store?.close();
  expect(
    product.db.select().from(coordinatorLease).where(eq(coordinatorLease.storeKey, key)).get()
      ?.owner,
  ).toBe('replacement');
});

afterAll(() => {
  product.close();
  releaseTestTempDir(dir);
});
