import type { ChiefStreamItem } from '../fixtures/records.js';

export type OutboxState = 'sending' | 'failed' | 'sent';

export interface OutboxEntry {
  key: string;
  threadId: string | null;
  projectId: string | null;
  text: string;
  state: OutboxState;
  messageId: string | null;
  createdAt: number;
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
    input: { threadId: string | null; projectId: string | null; text: string },
    deliver: Deliver,
  ): string;
  discard(key: string): OutboxEntry | null;
  settle(threadId: string | null, known: ReadonlySet<string>): void;
}

export function createOutbox(
  now: () => number = Date.now,
  mintKey: () => string = () => crypto.randomUUID(),
): Outbox {
  let list: readonly OutboxEntry[] = [];
  const returnedKeys = new Map<string, string>();
  const signature = (send: { threadId: string | null; projectId: string | null; text: string }) =>
    [send.threadId ?? '', send.projectId ?? '', send.text].join('\n');
  let tail: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();
  const replace = (next: readonly OutboxEntry[]) => {
    list = next;
    for (const listener of listeners) listener();
  };
  const patch = (key: string, change: (entry: OutboxEntry) => OutboxEntry) =>
    replace(list.map((entry) => (entry.key === key ? change(entry) : entry)));
  const dispatch = (key: string, deliver: Deliver) => {
    tail = tail.then(async () => {
      const entry = list.find((candidate) => candidate.key === key);
      if (entry?.state !== 'sending') return;
      try {
        const delivered = await deliver(entry);
        replace(
          list.map((other) =>
            other.key === key
              ? {
                  ...other,
                  state: 'sent',
                  threadId: delivered.threadId,
                  messageId: delivered.messageId,
                }
              : other.threadId === null && entry.threadId === null
                ? { ...other, threadId: delivered.threadId }
                : other,
          ),
        );
      } catch {
        patch(key, (failed) => ({ ...failed, state: 'failed' }));
      }
    });
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    entries: () => list,
    enqueue(input, deliver) {
      const returned = returnedKeys.get(signature(input));
      returnedKeys.delete(signature(input));
      const key = returned ?? mintKey();
      replace([...list, { ...input, key, state: 'sending', messageId: null, createdAt: now() }]);
      dispatch(key, deliver);
      return key;
    },
    discard(key) {
      const entry = list.find((candidate) => candidate.key === key);
      if (entry?.state !== 'failed') return null;
      returnedKeys.set(signature(entry), entry.key);
      replace(list.filter((candidate) => candidate.key !== key));
      return entry;
    },
    settle(threadId, known) {
      const kept = list.filter(
        (entry) =>
          entry.state !== 'sent' ||
          (entry.threadId === threadId && entry.messageId !== null && !known.has(entry.messageId)),
      );
      if (kept.length !== list.length) replace(kept);
    },
  };
}

export function unlandedItems(
  entries: readonly OutboxEntry[],
  threadId: string | null,
  known: ReadonlySet<string>,
): ChiefStreamItem[] {
  return entries.flatMap((entry) =>
    entry.state === 'failed' ||
    entry.threadId !== threadId ||
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

export const chiefOutbox = createOutbox();
