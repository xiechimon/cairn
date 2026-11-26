import { QUEUED_MESSAGE_CANCELLED } from '@cairn/shared';
import { ApiError } from '../api/client.js';
import type { ChiefStreamItem } from '../fixtures/records.js';
import { randomId } from '../lib/random-id.js';
import { SendCancelledError, SendStaleError, SendTimeoutError } from '../lib/send-errors.js';

export type OutboxState = 'sending' | 'failed' | 'sent';

export type OutboxFailure = 'error' | 'timeout' | 'stale' | 'cancelled';

export type TaskSendMode = 'reply' | 'queue' | 'stop-and-send';

export interface TaskSend {
  todoId: string;
  mode: TaskSendMode;
}

export interface OutboxEntry {
  key: string;
  scope: string | null;
  threadId: string | null;
  projectId: string | null;
  text: string;
  designCommentIds?: readonly string[];
  task?: TaskSend;
  failure?: OutboxFailure;
  state: OutboxState;
  messageId: string | null;
  createdAt: number;
  unsaved?: true;
}

export interface StoredOutboxEntry {
  key: string;
  scope: string;
  owner: string;
  threadId: string | null;
  projectId: string | null;
  text: string;
  designCommentIds?: readonly string[];
  task?: TaskSend;
  failure?: OutboxFailure;
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

export type Deliver = (entry: OutboxEntry, signal?: AbortSignal) => Promise<Delivered>;

export type SendFailed = (entry: OutboxEntry, error: unknown, repeat?: boolean) => void;

export type LateArrival = (entry: OutboxEntry) => boolean;

export interface UnsentSends {
  failed: readonly OutboxEntry[];
  discard: (outboxKey: string) => string | null;
  onArrivedLate: (listener: LateArrival) => () => void;
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
      task?: TaskSend;
    },
    deliver: Deliver,
    options?: { awaitRefetch?: boolean; onFailed?: SendFailed },
  ): string;
  discard(key: string): OutboxEntry | null;
  land(key: string, messageId: string): void;
  subscribeLateArrival(listener: LateArrival): () => void;
  markRefetched(key: string): void;
  sentKey(messageId: string): string | null;
  settle(
    threadId: string | null,
    known: ReadonlySet<string>,
    belongs?: (entry: OutboxEntry) => boolean,
  ): void;
  resume(
    scope: string,
    deliver: Deliver,
    options?: { onFailed?: SendFailed; awaitRefetch?: (entry: OutboxEntry) => boolean },
  ): Promise<void>;
}

export const RETURNED_KEY_TTL_MS = 10 * 60_000;

export const RESEND_WINDOW_MS = 10 * 60_000;

export const SEND_TIMEOUT_MS = 30_000;

const LOAD_TIMEOUT_MS = 5_000;

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

export function indexedDbOutboxStore(name = 'cairn-chief-outbox'): OutboxStore {
  let opened: Promise<IDBDatabase> | null = null;
  const database = () => {
    if (opened !== null) return opened;
    const request = indexedDB.open(name, 1);
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
  const id = randomId();
  void locks
    .request(`${OWNER_LOCK}${id}`, () => new Promise<never>(() => {}))
    .catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
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

function failureOf(error: unknown): OutboxFailure {
  if (error instanceof SendTimeoutError) return 'timeout';
  return error instanceof ApiError && error.reason === QUEUED_MESSAGE_CANCELLED
    ? 'cancelled'
    : 'error';
}

function restoredError(failure: OutboxFailure | undefined): Error | null {
  if (failure === 'stale') return new SendStaleError();
  if (failure === 'timeout') return new SendTimeoutError();
  return failure === 'cancelled' ? new SendCancelledError() : null;
}

function conversationOf(
  entry: Pick<OutboxEntry, 'scope' | 'threadId' | 'projectId' | 'task'>,
): string {
  if (entry.task !== undefined) return `task:${entry.task.todoId}`;
  return entry.threadId === null
    ? `new:${entry.scope}:${entry.projectId}`
    : `thread:${entry.scope}:${entry.threadId}`;
}

export function createOutbox({
  now = Date.now,
  mintKey = randomId,
  store = unstored,
  owner = solitary,
  writeTimeoutMs = 1000,
  sendTimeoutMs = SEND_TIMEOUT_MS,
}: {
  now?: () => number;
  mintKey?: () => string;
  store?: OutboxStore;
  owner?: OutboxOwner;
  writeTimeoutMs?: number;
  sendTimeoutMs?: number;
} = {}): Outbox {
  let list: readonly OutboxEntry[] = [];
  let returned: readonly OutboxEntry[] = [];
  let loading: Promise<unknown> | null = null;
  const lanes = new Map<string, Promise<void>>();
  const laneAliases = new Map<string, string>();
  const lateListeners = new Set<LateArrival>();
  const resumed = new Map<string, Promise<void>>();
  const sentKeys = new Map<string, string>();
  const pendingRefetchKeys = new Set<string>();
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
          ...(entry.task !== undefined ? { task: entry.task } : {}),
          ...(entry.failure !== undefined ? { failure: entry.failure } : {}),
          state,
          createdAt: entry.createdAt,
        };
  const unwritten = new Set<string>();
  const bounded = (write: Promise<void>) =>
    Promise.race([
      write.then(
        () => true,
        (error) => {
          console.debug('cairn: recoverable operation failed', error);
          return false;
        },
      ),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), writeTimeoutMs)),
    ]);
  const keep = async (entry: OutboxEntry, state: StoredOutboxEntry['state']) => {
    const row = rowOf(entry, state);
    if (row === null) return;
    if (await bounded(store.put(row))) unwritten.delete(entry.key);
    else unwritten.add(entry.key);
  };
  const amend = async (entry: OutboxEntry, state: StoredOutboxEntry['state']) => {
    const row = rowOf(entry, state);
    if (row === null) return true;
    return (await bounded(store.putIfPresent(row))) && !unwritten.has(entry.key);
  };
  const forget = (key: string) => {
    void store.remove(key).catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
  };
  const replace = (next: readonly OutboxEntry[]) => {
    list = next;
    for (const listener of listeners) listener();
  };
  const sendingEntry = (key: string) => {
    const entry = list.find((candidate) => candidate.key === key);
    return entry?.state === 'sending' ? entry : null;
  };
  const laneOf = (entry: OutboxEntry) => {
    const own = conversationOf(entry);
    return laneAliases.get(own) ?? own;
  };
  const withinTimeout = async (entry: OutboxEntry, deliver: Deliver) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        const error = new SendTimeoutError();
        controller.abort(error);
        reject(error);
      }, sendTimeoutMs);
    });
    try {
      return await Promise.race([deliver(entry, controller.signal), expired]);
    } finally {
      clearTimeout(timer);
    }
  };
  const fail = async (
    key: string,
    failure: OutboxFailure,
    error: unknown,
    onFailed: SendFailed | undefined,
  ) => {
    const failing = sendingEntry(key);
    if (failing === null) return;
    const saved = await amend({ ...failing, failure }, 'failed');
    const current = sendingEntry(key);
    if (current === null) return;
    const failed: OutboxEntry = {
      ...current,
      state: 'failed',
      failure,
      ...(saved ? {} : { unsaved: true as const }),
    };
    replace(list.map((other) => (other === current ? failed : other)));
    onFailed?.(failed, error);
  };
  const send = async (key: string, lane: string, deliver: Deliver, onFailed?: SendFailed) => {
    const entry = sendingEntry(key);
    if (entry === null) return;
    try {
      const delivered = await withinTimeout(entry, deliver);
      if (delivered.messageId !== null) sentKeys.set(delivered.messageId, key);
      if (delivered.threadId !== entry.threadId)
        laneAliases.set(conversationOf({ ...entry, threadId: delivered.threadId }), lane);
      replace(
        list.map((other) =>
          other.key === key
            ? {
                ...other,
                state: 'sent',
                threadId: delivered.threadId,
                messageId: delivered.messageId ?? other.messageId,
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
    } catch (error) {
      await fail(key, failureOf(error), error, onFailed);
    }
  };
  const chain = (lane: string, work: () => Promise<void>) => {
    lanes.set(
      lane,
      (lanes.get(lane) ?? Promise.resolve()).then(work).catch((error) => {
        console.debug('cairn: recoverable operation failed', error);
      }),
    );
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    entries: () => list,
    enqueue({ globalThreadId, ...input }, deliver, options) {
      const conversation = conversationOf(input);
      const replaced = returned.filter(
        (entry) =>
          conversationOf(entry) === conversation ||
          (entry.scope === input.scope &&
            entry.threadId === null &&
            input.threadId === globalThreadId),
      );
      returned = returned.filter((entry) => !replaced.includes(entry));
      const key =
        replaced.find(
          (entry) =>
            entry.text === input.text &&
            entry.projectId === input.projectId &&
            now() - entry.createdAt <= RETURNED_KEY_TTL_MS,
        )?.key ?? mintKey();
      for (const retired of replaced) if (retired.key !== key) forget(retired.key);
      if (options?.awaitRefetch === true) pendingRefetchKeys.add(key);
      const entry: OutboxEntry = {
        ...input,
        key,
        state: 'sending',
        messageId: null,
        createdAt: now(),
      };
      replace([...list, entry]);
      const written = keep(entry, 'sending');
      const start = () => {
        const lane = laneOf(entry);
        chain(lane, async () => {
          await written;
          await send(key, lane, deliver, options?.onFailed);
        });
      };
      if (loading === null) start();
      else void loading.then(start);
      return key;
    },
    discard(key) {
      const entry = list.find((candidate) => candidate.key === key);
      if (entry?.state !== 'failed') return null;
      pendingRefetchKeys.delete(key);
      replace(list.filter((candidate) => candidate.key !== key));
      if (entry.failure === 'cancelled') {
        forget(key);
        return entry;
      }
      const handedBack = { ...entry, createdAt: now() };
      returned = [...returned, handedBack];
      void amend(handedBack, 'returned');
      return entry;
    },
    land(key, messageId) {
      pendingRefetchKeys.delete(key);
      const handedBack = returned.find((candidate) => candidate.key === key);
      if (handedBack !== undefined) {
        const seenByItsComposer = [...lateListeners].map((listener) => listener(handedBack));
        if (seenByItsComposer.includes(true)) {
          returned = returned.filter((candidate) => candidate !== handedBack);
          sentKeys.set(messageId, key);
          forget(key);
        }
        return;
      }
      const entry = list.find((candidate) => candidate.key === key);
      if (entry === undefined) return;
      sentKeys.set(messageId, key);
      replace(
        list.map((other) => (other === entry ? { ...other, state: 'sent', messageId } : other)),
      );
      forget(key);
    },
    subscribeLateArrival(listener) {
      lateListeners.add(listener);
      return () => lateListeners.delete(listener);
    },
    markRefetched(key) {
      if (!pendingRefetchKeys.delete(key)) return;
      for (const listener of listeners) listener();
    },
    sentKey: (messageId) => sentKeys.get(messageId) ?? null,
    settle(threadId, known, belongs) {
      const kept = list.filter(
        (entry) =>
          (belongs !== undefined && !belongs(entry)) ||
          entry.state !== 'sent' ||
          pendingRefetchKeys.has(entry.key) ||
          (entry.threadId === threadId && entry.messageId !== null && !known.has(entry.messageId)),
      );
      if (kept.length !== list.length) replace(kept);
    },
    resume(scope, deliver, options) {
      const started = resumed.get(scope);
      if (started !== undefined) return started;
      const place = async () => {
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
        const entryOf = ({ owner: _owner, state, ...row }: StoredOutboxEntry): OutboxEntry => {
          const tooOld = state === 'sending' && now() - row.createdAt > RESEND_WINDOW_MS;
          return {
            ...row,
            ...(tooOld ? { failure: 'stale' as const } : {}),
            state: state === 'sending' && !tooOld ? 'sending' : 'failed',
            messageId: null,
          };
        };
        const onRecord = new Set(
          restored.filter((row) => row.state === 'failed').map((row) => row.key),
        );
        const unsent: OutboxEntry[] = [];
        const writes: Promise<void>[] = [];
        for (const row of restored) {
          const entry = entryOf(row);
          if (row.state === 'returned') {
            returned = [...returned, entry];
            writes.push(keep(entry, 'returned'));
          } else {
            unsent.push(entry);
            writes.push(keep(entry, entry.state === 'sending' ? 'sending' : 'failed'));
          }
        }
        const written = Promise.all(writes);
        for (const entry of unsent) {
          if (entry.state !== 'sending') continue;
          if (options?.awaitRefetch?.(entry) === true) pendingRefetchKeys.add(entry.key);
          const lane = laneOf(entry);
          chain(lane, async () => {
            await written;
            await send(entry.key, lane, deliver, options?.onFailed);
          });
        }
        if (unsent.length > 0) replace([...unsent, ...list]);
        for (const entry of unsent)
          if (entry.state === 'failed')
            options?.onFailed?.(entry, restoredError(entry.failure), onRecord.has(entry.key));
      };
      const run = place().catch((error) => {
        console.debug('cairn: recoverable operation failed', error);
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited: Promise<void> = Promise.race([
        run,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, LOAD_TIMEOUT_MS);
        }),
      ]).then(() => {
        clearTimeout(timer);
        if (loading === waited) loading = null;
      });
      loading = waited;
      resumed.set(scope, run);
      return run;
    },
  };
}

export function withoutReturnedText(draft: string, text: string): string {
  if (draft === text) return '';
  if (draft.endsWith(`\n${text}`)) return draft.slice(0, -text.length - 1);
  if (draft.startsWith(`${text}\n`)) return draft.slice(text.length + 1);
  return draft.replace(`\n${text}\n`, () => '\n');
}

export function hasPendingSend(entries: readonly OutboxEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.state === 'sending' ||
      (entry.state === 'failed' &&
        (entry.task !== undefined || entry.scope === null || entry.unsaved === true)),
  );
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
