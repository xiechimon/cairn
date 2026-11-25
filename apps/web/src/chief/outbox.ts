import type { ChiefStreamItem } from '../fixtures/records.js';

export type OutboxState = 'sending' | 'failed' | 'sent';

export interface OutboxEntry {
  key: string;
  scope: string | null;
  threadId: string | null;
  projectId: string | null;
  text: string;
  designCommentIds?: readonly string[];
  state: OutboxState;
  messageId: string | null;
  createdAt: number;
}

export interface StoredOutboxEntry {
  key: string;
  scope: string;
  owner: string;
  threadId: string | null;
  projectId: string | null;
  text: string;
  designCommentIds?: readonly string[];
  state: 'sending' | 'failed' | 'returned';
  createdAt: number;
}

export interface OutboxStore {
  put(entry: StoredOutboxEntry): Promise<void>;
  putIfPresent(entry: StoredOutboxEntry): Promise<void>;
  remove(key: string): Promise<void>;
  load(): Promise<readonly StoredOutboxEntry[]>;
}

export interface OutboxOwner {
  id: string;
  live(): Promise<ReadonlySet<string>>;
}

export interface Delivered {
  threadId: string;
  messageId: string | null;
}

export type Deliver = (entry: OutboxEntry) => Promise<Delivered>;

export interface UnsentSends {
  failed: readonly OutboxEntry[];
  discard: (outboxKey: string) => string | null;
}

export interface Outbox {
  subscribe(listener: () => void): () => void;
  entries(): readonly OutboxEntry[];
  enqueue(
    input: {
      scope: string | null;
      threadId: string | null;
      globalThreadId: string | null;
      projectId: string | null;
      text: string;
      designCommentIds?: readonly string[];
    },
    deliver: Deliver,
  ): string;
  discard(key: string): OutboxEntry | null;
  land(key: string, messageId: string): void;
  sentKey(messageId: string): string | null;
  settle(threadId: string | null, known: ReadonlySet<string>): void;
  resume(scope: string, deliver: Deliver): Promise<void>;
}

export const RETURNED_KEY_TTL_MS = 10 * 60_000;

const unstored: OutboxStore = {
  put: () => Promise.resolve(),
  putIfPresent: () => Promise.resolve(),
  remove: () => Promise.resolve(),
  load: () => Promise.resolve([]),
};

const solitary: OutboxOwner = { id: 'page', live: () => Promise.resolve(new Set()) };

function settled<T>(request: IDBRequest<T> | IDBTransaction): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    if (request instanceof IDBTransaction) {
      request.oncomplete = () => resolve(undefined);
      request.onabort = request.onerror = () => reject(request.error);
    } else {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }
  });
}

export function indexedDbOutboxStore(): OutboxStore {
  let opened: Promise<IDBDatabase> | null = null;
  const database = () => {
    if (opened !== null) return opened;
    const request = indexedDB.open('cairn-chief-outbox', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('entries', { keyPath: 'key' });
    opened = new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(request.error);
    });
    opened.then(
      (db) => {
        db.onclose = () => {
          opened = null;
        };
      },
      () => {
        opened = null;
      },
    );
    return opened;
  };
  const write = async (change: (entries: IDBObjectStore) => void) => {
    const tx = (await database()).transaction('entries', 'readwrite');
    change(tx.objectStore('entries'));
    await settled(tx);
  };
  return {
    put: (entry) => write((entries) => entries.put(entry)),
    putIfPresent: (entry) =>
      write((entries) => {
        const read = entries.getKey(entry.key);
        read.onsuccess = () => {
          if (read.result !== undefined) entries.put(entry);
        };
      }),
    remove: (key) => write((entries) => entries.delete(key)),
    load: async () => {
      const read = (await database()).transaction('entries').objectStore('entries').getAll();
      return ((await settled(read)) ?? []) as StoredOutboxEntry[];
    },
  };
}

const OWNER_LOCK = 'cairn-chief-outbox:';

export function pageLockOwner(): OutboxOwner {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (locks === undefined) return solitary;
  const id = crypto.randomUUID();
  void locks.request(`${OWNER_LOCK}${id}`, () => new Promise<never>(() => {})).catch(() => {});
  return {
    id,
    live: async () =>
      new Set(
        ((await locks.query()).held ?? []).flatMap((lock) =>
          lock.name?.startsWith(OWNER_LOCK) ? [lock.name.slice(OWNER_LOCK.length)] : [],
        ),
      ),
  };
}

export function createOutbox({
  now = Date.now,
  mintKey = () => crypto.randomUUID(),
  store = unstored,
  owner = solitary,
  writeTimeoutMs = 1000,
}: {
  now?: () => number;
  mintKey?: () => string;
  store?: OutboxStore;
  owner?: OutboxOwner;
  writeTimeoutMs?: number;
} = {}): Outbox {
  let list: readonly OutboxEntry[] = [];
  let returned: readonly OutboxEntry[] = [];
  let tail: Promise<void> = Promise.resolve();
  const resumed = new Map<string, Promise<void>>();
  const sentKeys = new Map<string, string>();
  const listeners = new Set<() => void>();
  const rowOf = (entry: OutboxEntry, state: StoredOutboxEntry['state']) =>
    entry.scope === null
      ? null
      : {
          key: entry.key,
          scope: entry.scope,
          owner: owner.id,
          threadId: entry.threadId,
          projectId: entry.projectId,
          text: entry.text,
          ...(entry.designCommentIds !== undefined
            ? { designCommentIds: entry.designCommentIds }
            : {}),
          state,
          createdAt: entry.createdAt,
        };
  const bounded = (write: Promise<void>) =>
    Promise.race([
      write.catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, writeTimeoutMs)),
    ]);
  const keep = (entry: OutboxEntry, state: StoredOutboxEntry['state']) => {
    const row = rowOf(entry, state);
    return row === null ? Promise.resolve() : bounded(store.put(row));
  };
  const amend = (entry: OutboxEntry, state: StoredOutboxEntry['state']) => {
    const row = rowOf(entry, state);
    return row === null ? Promise.resolve() : bounded(store.putIfPresent(row));
  };
  const forget = (key: string) => {
    void store.remove(key).catch(() => {});
  };
  const replace = (next: readonly OutboxEntry[]) => {
    list = next;
    for (const listener of listeners) listener();
  };
  const sendingEntry = (key: string) => {
    const entry = list.find((candidate) => candidate.key === key);
    return entry?.state === 'sending' ? entry : null;
  };
  const send = async (key: string, deliver: Deliver) => {
    const entry = sendingEntry(key);
    if (entry === null) return;
    try {
      const delivered = await deliver(entry);
      if (delivered.messageId !== null) sentKeys.set(delivered.messageId, key);
      replace(
        list.map((other) =>
          other.key === key
            ? {
                ...other,
                state: 'sent',
                threadId: delivered.threadId,
                messageId: delivered.messageId,
              }
            : other.state !== 'sent' &&
                other.threadId === null &&
                entry.threadId === null &&
                other.projectId === entry.projectId &&
                other.scope === entry.scope
              ? { ...other, threadId: delivered.threadId }
              : other,
        ),
      );
      forget(key);
    } catch {
      const failing = sendingEntry(key);
      if (failing === null) return;
      await amend(failing, 'failed');
      const current = sendingEntry(key);
      if (current === null) return;
      replace(list.map((other) => (other === current ? { ...other, state: 'failed' } : other)));
    }
  };
  const after = (work: () => Promise<void>) => {
    const run = tail.then(work).catch(() => {});
    tail = run;
    return run;
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    entries: () => list,
    enqueue({ globalThreadId, ...input }, deliver) {
      const replaced = returned.filter(
        (entry) =>
          entry.scope === input.scope &&
          (entry.threadId === input.threadId ||
            (entry.threadId === null && input.threadId === globalThreadId)),
      );
      returned = returned.filter((entry) => !replaced.includes(entry));
      const key =
        replaced.find((entry) => entry.text === input.text && entry.projectId === input.projectId)
          ?.key ?? mintKey();
      for (const retired of replaced) if (retired.key !== key) forget(retired.key);
      const entry: OutboxEntry = {
        ...input,
        key,
        state: 'sending',
        messageId: null,
        createdAt: now(),
      };
      replace([...list, entry]);
      const written = keep(entry, 'sending');
      void after(async () => {
        await written;
        await send(key, deliver);
      });
      return key;
    },
    discard(key) {
      const entry = list.find((candidate) => candidate.key === key);
      if (entry?.state !== 'failed') return null;
      returned = [...returned, entry];
      replace(list.filter((candidate) => candidate.key !== key));
      void amend(entry, 'returned');
      return entry;
    },
    land(key, messageId) {
      const entry = sendingEntry(key);
      if (entry === null) return;
      sentKeys.set(messageId, key);
      replace(
        list.map((other) => (other === entry ? { ...other, state: 'sent', messageId } : other)),
      );
      forget(key);
    },
    sentKey: (messageId) => sentKeys.get(messageId) ?? null,
    settle(threadId, known) {
      const kept = list.filter(
        (entry) =>
          entry.state !== 'sent' ||
          (entry.threadId === threadId && entry.messageId !== null && !known.has(entry.messageId)),
      );
      if (kept.length !== list.length) replace(kept);
    },
    resume(scope, deliver) {
      const started = resumed.get(scope);
      if (started !== undefined) return started;
      const run = after(async () => {
        const [rows, live] = await Promise.all([store.load(), owner.live()]);
        const held = new Set([...list, ...returned].map((entry) => entry.key));
        const orphaned = rows.filter(
          (row) => row.scope === scope && !held.has(row.key) && !live.has(row.owner),
        );
        const expired = (row: StoredOutboxEntry) =>
          row.state === 'returned' && now() - row.createdAt > RETURNED_KEY_TTL_MS;
        for (const row of orphaned) if (expired(row)) forget(row.key);
        const restored = orphaned
          .filter((row) => !expired(row))
          .toSorted((a, b) => a.createdAt - b.createdAt);
        const entryOf = (row: StoredOutboxEntry, state: OutboxState): OutboxEntry => ({
          key: row.key,
          scope: row.scope,
          threadId: row.threadId,
          projectId: row.projectId,
          text: row.text,
          ...(row.designCommentIds !== undefined ? { designCommentIds: row.designCommentIds } : {}),
          state,
          messageId: null,
          createdAt: row.createdAt,
        });
        returned = [
          ...returned,
          ...restored.flatMap((row) => (row.state === 'returned' ? [entryOf(row, 'failed')] : [])),
        ];
        const unsent = restored.flatMap((row) =>
          row.state === 'returned' ? [] : [entryOf(row, row.state)],
        );
        await Promise.all(restored.map((row) => keep(entryOf(row, 'sending'), row.state)));
        if (unsent.length > 0) replace([...unsent, ...list]);
        for (const entry of unsent) if (entry.state === 'sending') await send(entry.key, deliver);
      });
      resumed.set(scope, run);
      return run;
    },
  };
}

export function failedOutboxForChannel(
  entries: readonly OutboxEntry[],
  activeThreadId: string | null,
  channel: string | null,
): OutboxEntry[] {
  return entries.filter((entry) => {
    if (entry.state !== 'failed') return false;
    if (entry.threadId !== null) {
      return activeThreadId !== null && entry.threadId === activeThreadId;
    }
    return entry.projectId === channel;
  });
}

export function unlandedItems(
  entries: readonly OutboxEntry[],
  threadId: string | null,
  known: ReadonlySet<string>,
  globalThreadId: string | null = null,
  channel: string | null = null,
): ChiefStreamItem[] {
  return entries.flatMap((entry) =>
    entry.state === 'failed' ||
    (entry.threadId !== null
      ? entry.threadId !== threadId
      : !(
          (threadId === null && entry.projectId === channel) ||
          (threadId !== null && threadId === globalThreadId && entry.projectId === null)
        )) ||
    (entry.messageId !== null && known.has(entry.messageId))
      ? []
      : [
          {
            kind: 'user' as const,
            text: entry.text,
            outboxKey: entry.key,
            createdAt: entry.createdAt,
            ...(entry.projectId !== null ? { projectId: entry.projectId } : {}),
            ...(entry.state === 'sending' ? { delivery: 'sending' as const } : {}),
          },
        ],
  );
}

export function keepSentKeys(
  stream: readonly ChiefStreamItem[],
  outbox: Pick<Outbox, 'sentKey'>,
): ChiefStreamItem[] {
  return stream.map((item) => {
    if (item.kind !== 'user' || item.id == null || item.outboxKey != null) return item;
    const key = outbox.sentKey(item.id);
    return key === null ? item : { ...item, outboxKey: key };
  });
}

export const chiefOutbox = createOutbox({ store: indexedDbOutboxStore(), owner: pageLockOwner() });
