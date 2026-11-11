import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '@earendil-works/chord/context';
import type { Models } from '@earendil-works/pi-ai/models';
import type { Harness } from '@earendil-works/pi-durable';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import { threadConversation } from '../../db/schema.js';
import { acquireLease, LEASE_STALE_MS, LeaseHeldError } from '../lease.js';
import { openCoordinatorHarness } from './harness.js';
import { coordinatorStoreId } from './store-identity.js';
import { threadStorePath } from './thread-harnesses.js';

export async function openDurableThreadStore(
  db: Db,
  dataDir: string,
  threadId: string,
  models: Models,
  context: Context,
  options: { enabled?: boolean } = {},
) {
  if (options.enabled !== true) return undefined;
  const storageDir = join(dataDir, 'threads');
  const path = threadStorePath(storageDir, threadId);
  const lease = acquireLease(db, `durable-thread:${threadId}`, randomUUID());
  let harness: Harness | undefined;
  let closing: Promise<void> | undefined;
  let leaseError: unknown;
  const close = () => {
    closing ??= (async () => {
      clearInterval(timer);
      try {
        await harness?.close(context);
      } finally {
        lease.release();
      }
    })();
    return closing;
  };
  const timer = setInterval(() => {
    try {
      if (!lease.heartbeat()) throw new LeaseHeldError(threadId);
    } catch (error) {
      leaseError = error;
      if (harness !== undefined) void close().catch(() => undefined);
    }
  }, LEASE_STALE_MS / 3);
  timer.unref();
  try {
    mkdirSync(storageDir, { recursive: true });
    harness = await openCoordinatorHarness(path, models, context, { resume: false });
    if (leaseError !== undefined) throw leaseError;
    const storeId = await coordinatorStoreId(harness, context);
    const root = await harness.root(context);
    if (leaseError !== undefined) throw leaseError;
    if (!lease.heartbeat()) throw new LeaseHeldError(threadId);
    db.transaction((tx) => {
      const current = tx
        .select()
        .from(threadConversation)
        .where(eq(threadConversation.threadId, threadId))
        .get();
      if (
        current !== undefined &&
        (current.storeId !== storeId || current.conversationId !== String(root.id))
      ) {
        throw new Error(`durable thread store identity mismatch: ${threadId}`);
      }
      tx.insert(threadConversation)
        .values({
          threadId,
          storeId,
          conversationId: String(root.id),
          updatedAt: Date.now(),
        })
        .onConflictDoNothing()
        .run();
    });
    return { storeId, conversationId: String(root.id), close };
  } catch (error) {
    await close();
    throw error;
  }
}
