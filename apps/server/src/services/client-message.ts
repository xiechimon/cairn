import { QUEUED_MESSAGE_CANCELLED } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clientMessage } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';

export class ClientMessageConflict extends Error {
  constructor() {
    super('client message id was already submitted');
    this.name = 'ClientMessageConflict';
  }
}

export function removedFromQueue(): HttpError {
  return new HttpError(409, 'Queued message was removed', QUEUED_MESSAGE_CANCELLED);
}

const inFlightByDb = new WeakMap<Db, Map<string, Promise<unknown>>>();

function ledgerRow(scopeId: string, clientMessageId: string) {
  return and(
    eq(clientMessage.scopeId, scopeId),
    eq(clientMessage.clientMessageId, clientMessageId),
  );
}

export function findClientMessage<T>(
  db: Db,
  scopeId: string,
  clientMessageId: string | undefined,
): T | undefined {
  if (clientMessageId === undefined) return undefined;
  const row = db
    .select({ response: clientMessage.response })
    .from(clientMessage)
    .where(ledgerRow(scopeId, clientMessageId))
    .get();
  const response = row?.response ?? undefined;
  if ((response as { cancelled?: unknown } | undefined)?.cancelled === true)
    throw removedFromQueue();
  return response as T | undefined;
}

export function claimClientMessage(
  db: Db,
  scopeId: string,
  clientMessageId: string | undefined,
  response: unknown = null,
): void {
  if (clientMessageId === undefined) return;
  const { changes } = db
    .insert(clientMessage)
    .values({ scopeId, clientMessageId, response, createdAt: nowMs() })
    .onConflictDoNothing()
    .run();
  if (changes === 0) throw new ClientMessageConflict();
}

export function completeClientMessage(
  db: Db,
  scopeId: string,
  clientMessageId: string | undefined,
  response: unknown,
): void {
  if (clientMessageId === undefined) return;
  db.update(clientMessage).set({ response }).where(ledgerRow(scopeId, clientMessageId)).run();
}

export function replayAfterConflict<T>(
  db: Db,
  scopeId: string,
  clientMessageId: string | undefined,
  error: unknown,
): T {
  if (error instanceof ClientMessageConflict) {
    const stored = findClientMessage<T>(db, scopeId, clientMessageId);
    if (stored !== undefined) return stored;
  }
  throw error;
}

export function coalesceClientMessage<T>(
  db: Db,
  scopeId: string,
  clientMessageId: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (clientMessageId === undefined) return work();
  let inFlight = inFlightByDb.get(db);
  if (!inFlight) {
    inFlight = new Map();
    inFlightByDb.set(db, inFlight);
  }
  const id = JSON.stringify([scopeId, clientMessageId]);
  const running = inFlight.get(id) as Promise<T> | undefined;
  if (running) return running;
  const started = inFlight;
  const promise = work().finally(() => started.delete(id));
  started.set(id, promise);
  return promise;
}
