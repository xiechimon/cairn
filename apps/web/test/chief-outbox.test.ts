import { describe, expect, test } from 'vitest';
import { chiefStreamRowKey } from '../src/chief/chief-message-rows.js';
import {
  createOutbox,
  type Deliver,
  keepSentKeys,
  type OutboxEntry,
  type OutboxStore,
  RETURNED_KEY_TTL_MS,
  type StoredOutboxEntry,
  unlandedItems,
} from '../src/chief/outbox.js';

function gate() {
  const calls: {
    entry: OutboxEntry;
    resolve: (value: { threadId: string; messageId: string }) => void;
    reject: (error: Error) => void;
  }[] = [];
  const deliver: Deliver = (entry) =>
    new Promise((resolve, reject) => {
      calls.push({ entry, resolve, reject });
    });
  return { calls, deliver };
}

function outbox() {
  let minted = 0;
  return createOutbox({ now: () => 1000, mintKey: () => `key-${++minted}` });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chief outbox', () => {
  test('an enqueued message is sending at once and is handed to the sender with its own key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    const key = box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    expect(box.entries()).toEqual([
      {
        key: 'key-1',
        scope: 'u/team',
        threadId: 't1',
        projectId: null,
        text: 'hello',
        state: 'sending',
        messageId: null,
        createdAt: 1000,
      },
    ]);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual([key]);
  });

  test('a delivered message is kept as sent with its message id until the transcript holds it', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm9' });
    await flush();
    expect(box.entries()[0]).toMatchObject({ state: 'sent', messageId: 'm9' });
    box.settle('t1', new Set());
    expect(box.entries()).toHaveLength(1);
    box.settle('t1', new Set(['m9']));
    expect(box.entries()).toEqual([]);
  });

  test('a delivered message keeps the row key it had while sending, so its bubble is not remounted', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    const [sending] = unlandedItems(box.entries(), 't1', new Set());
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm9' });
    await flush();
    box.settle('t1', new Set(['m9']));
    const [stored, other] = keepSentKeys(
      [
        { kind: 'user', id: 'm9', text: 'hello' },
        { kind: 'user', id: 'm8', text: 'older' },
      ],
      box,
    );
    expect(sending && stored && chiefStreamRowKey(stored, 0)).toBe(sending && chiefStreamRowKey(sending, 0));
    expect(other && chiefStreamRowKey(other, 1)).toBe('m8');
  });

  test('a message the stream reports stored lands before its send call answers and stays sent', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    box.land('key-1', 'm9');
    expect(unlandedItems(box.entries(), 't1', new Set(['m9']))).toEqual([]);
    calls[0]?.reject(new Error('response lost'));
    await flush();
    expect(box.entries()[0]).toMatchObject({ state: 'sent', messageId: 'm9' });
  });

  test('landed messageId survives a deliver response that returns messageId null, and late land binds messageId after deliver', async () => {
    const box = outbox();
    const calls: { entry: OutboxEntry; resolve: (value: { threadId: string; messageId: string | null }) => void }[] = [];
    const deliver: Deliver = (entry) =>
      new Promise((resolve) => {
        calls.push({ entry, resolve });
      });

    box.enqueue({ scope: 'todo-1', globalThreadId: null, threadId: 'b1', projectId: null, text: 'first' }, deliver, { awaitRefetch: true });
    await flush();
    box.land('key-1', 'm1');
    calls[0]?.resolve({ threadId: 'b1', messageId: null });
    await flush();
    box.settle('b1', new Set(), 'todo-1');
    expect(box.entries()[0]).toMatchObject({ key: 'key-1', state: 'sent', messageId: 'm1' });

    box.enqueue({ scope: 'todo-1', globalThreadId: null, threadId: 'b1', projectId: null, text: 'second' }, deliver, { awaitRefetch: true });
    await flush();
    calls[1]?.resolve({ threadId: 'b1', messageId: null });
    await flush();
    box.land('key-2', 'm2');
    box.settle('b1', new Set(), 'todo-1');
    expect(box.entries().find((entry) => entry.key === 'key-2')).toMatchObject({
      state: 'sent',
      messageId: 'm2',
    });
    expect(box.sentKey('m2')).toBe('key-2');
    box.settle('b1', new Set(['m1', 'm2']), 'todo-1');
    expect(box.entries()).toEqual([]);
  });

  test('a rejected message turns failed and keeps its text and key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: 'p1', text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(box.entries()[0]).toMatchObject({ key: 'key-1', state: 'failed', text: 'hello' });
  });

  test('discard removes a failed message and returns it', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(box.discard('key-1')?.text).toBe('hello');
    expect(box.entries()).toEqual([]);
  });

  test('the same message sent again after it failed keeps its key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1', 'key-1']);
    calls[1]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    box.settle('t1', new Set(['m1']));
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls[2]?.entry.key).toBe('key-2');
  });

  test('a failed message that was edited before it is sent again gets a new key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello there' }, deliver);
    await flush();
    expect(calls[1]?.entry.key).toBe('key-2');
  });

  test('a first message that failed keeps its key when its conversation has appeared since', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: null, projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('response lost'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: 't1', threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls[1]?.entry).toMatchObject({ key: 'key-1', threadId: 't1' });
  });

  test('sending an edited message retires the failed one, so its old text later gets a new key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('response lost'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello there' }, deliver);
    await flush();
    calls[1]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1', 'key-2', 'key-3']);
  });

  test('a send in another conversation neither takes nor retires the failed message key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't2', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[1]?.resolve({ threadId: 't2', messageId: 'm1' });
    await flush();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1', 'key-2', 'key-1']);
  });

  test('the same text for another project is a new message with a new key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: 'p1', text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: 'p2', text: 'hello' }, deliver);
    await flush();
    expect(calls[1]?.entry.key).toBe('key-2');
  });

  test('discard leaves a message that is still sending in place', async () => {
    const box = outbox();
    const { deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(box.discard('key-1')).toBeNull();
    expect(box.entries()).toHaveLength(1);
  });

  test('the second message waits for the first one to settle, and a failure does not block it', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'one' }, deliver);
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'two' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.text)).toEqual(['one']);
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(calls.map((call) => call.entry.text)).toEqual(['one', 'two']);
  });

  test('messages waiting for a conversation follow the one the first message created', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: null, projectId: null, text: 'one' }, deliver);
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: null, projectId: null, text: 'two' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't-new', messageId: 'm1' });
    await flush();
    expect(calls[1]?.entry.threadId).toBe('t-new');
  });

  test('a delivered message in another conversation does not move messages of this one', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'one' }, deliver);
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: null, projectId: null, text: 'two' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    expect(calls[1]?.entry.threadId).toBeNull();
  });

  test('settle drops sent messages of a conversation that is no longer open', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'one' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    box.settle('t2', new Set());
    expect(box.entries()).toEqual([]);
  });

  test('subscribers hear every change', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    let heard = 0;
    const stop = box.subscribe(() => {
      heard += 1;
    });
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'one' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    stop();
    box.discard('key-1');
    expect(heard).toBe(2);
  });
});

function memoryStore(seed: StoredOutboxEntry[] = []) {
  const rows = new Map(seed.map((row) => [row.key, row]));
  let releaseWrite: (() => void) | null = null;
  const store: OutboxStore = {
    put: async (row) => {
      if (releaseWrite === null) rows.set(row.key, row);
      else
        await new Promise<void>((resolve) => {
          releaseWrite = () => {
            rows.set(row.key, row);
            resolve();
          };
        });
    },
    putIfPresent: async (row) => {
      if (rows.has(row.key)) rows.set(row.key, row);
    },
    remove: async (key) => {
      rows.delete(key);
    },
    load: async () => [...rows.values()],
  };
  return {
    store,
    rows,
    holdWrites: () => {
      releaseWrite = () => {};
    },
    release: () => releaseWrite?.(),
  };
}

function storedOutbox(store: OutboxStore, liveOwners: string[] = []) {
  let minted = 0;
  return createOutbox({
    now: () => 1000,
    mintKey: () => `key-${++minted}`,
    store,
    owner: { id: 'page-2', live: async () => new Set(['page-2', ...liveOwners]) },
    writeTimeoutMs: 20,
  });
}

const stored = (patch: Partial<StoredOutboxEntry>): StoredOutboxEntry => ({
  key: 'old-1',
  scope: 'u/team',
  owner: 'page-1',
  threadId: 't1',
  projectId: null,
  text: 'kept',
  state: 'sending',
  createdAt: 500,
  ...patch,
});

describe('persisted chief outbox', () => {
  test('a sending message is stored with its key before the send call starts', async () => {
    const mem = memoryStore();
    mem.holdWrites();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: 'p1', text: 'hello' }, deliver);
    await flush();
    expect(calls).toHaveLength(0);
    mem.release();
    await flush();
    expect(mem.rows.get('key-1')).toEqual({
      key: 'key-1',
      scope: 'u/team',
      owner: 'page-2',
      threadId: 't1',
      projectId: 'p1',
      text: 'hello',
      state: 'sending',
      createdAt: 1000,
    });
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1']);
  });

  test('a store that cannot write still lets the message go out', async () => {
    const box = storedOutbox({
      put: () => Promise.reject(new Error('quota')),
      putIfPresent: () => Promise.reject(new Error('quota')),
      remove: () => Promise.reject(new Error('quota')),
      load: () => Promise.reject(new Error('blocked')),
    });
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls).toHaveLength(1);
    void box.resume('u/team', deliver);
    await flush();
    expect(box.entries()).toHaveLength(1);
  });

  test('an accepted message is removed from the store', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    expect(mem.rows.size).toBe(0);
  });

  test('a message the stream reports stored is removed from the store before its call answers', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    box.land('key-1', 'm1');
    await flush();
    expect(mem.rows.size).toBe(0);
  });

  test('a rejected message is stored as failed, and as returned once its text goes back', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(mem.rows.get('key-1')?.state).toBe('failed');
    box.discard('key-1');
    await flush();
    expect(mem.rows.get('key-1')?.state).toBe('returned');
  });

  test('a rejected call after the stream reported the message stored writes nothing back', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    box.land('key-1', 'm1');
    calls[0]?.reject(new Error('response lost'));
    await flush();
    expect(mem.rows.size).toBe(0);
  });

  test('sending different text retires the stored returned key', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello there' }, deliver);
    await flush();
    expect([...mem.rows.keys()]).toEqual(['key-2']);
  });

  test('a message stored while sending is sent again under its key when the page comes back', async () => {
    const mem = memoryStore([stored({})]);
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    expect(unlandedItems(box.entries(), 't1', new Set())).toEqual([
      { kind: 'user', text: 'kept', outboxKey: 'old-1', createdAt: 500, delivery: 'sending' },
    ]);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['old-1']);
    calls[0]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    expect(mem.rows.size).toBe(0);
  });

  test('resumed messages go out in the order they were sent, before a message sent after the page came back', async () => {
    const mem = memoryStore([
      stored({ key: 'old-2', text: 'second', createdAt: 600 }),
      stored({ key: 'old-1', text: 'first', createdAt: 500 }),
    ]);
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'third' }, deliver);
    for (let i = 0; i < 3; i++) {
      await flush();
      calls[i]?.resolve({ threadId: 't1', messageId: `m${i}` });
    }
    await flush();
    expect(calls.map((call) => call.entry.text)).toEqual(['first', 'second', 'third']);
  });

  test('a stored failed message comes back as failed so its text returns to the composer', async () => {
    const mem = memoryStore([stored({ state: 'failed' })]);
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    await flush();
    expect(calls).toHaveLength(0);
    expect(box.entries()).toMatchObject([{ key: 'old-1', state: 'failed' }]);
  });

  test('a stored returned message keeps its key when the same text is sent again', async () => {
    const mem = memoryStore([stored({ state: 'returned' })]);
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    expect(box.entries()).toEqual([]);
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'kept' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['old-1']);
  });

  test('resume leaves messages of another team stored and runs once per team', async () => {
    const mem = memoryStore([stored({ scope: 'u/other' })]);
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    void box.resume('u/team', deliver);
    await flush();
    await flush();
    expect(box.entries()).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(mem.rows.has('old-1')).toBe(true);
  });

  test('resume skips a stored message this page already holds', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    void box.resume('u/team', deliver);
    await flush();
    await flush();
    expect(box.entries()).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  test('a write that never settles holds a send only briefly', async () => {
    const box = storedOutbox({
      put: () => new Promise(() => {}),
      putIfPresent: () => new Promise(() => {}),
      remove: () => Promise.resolve(),
      load: () => Promise.resolve([]),
    });
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(1);
    calls[0]?.reject(new Error('refused'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(box.entries()[0]?.state).toBe('failed');
  });

  test('a message turns failed only after the failed state is stored', async () => {
    const mem = memoryStore();
    let releaseFailed: () => void = () => {};
    const box = storedOutbox({
      ...mem.store,
      putIfPresent: (row) =>
        new Promise<void>((resolve) => {
          releaseFailed = () => {
            mem.rows.set(row.key, row);
            resolve();
          };
        }),
    });
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(box.entries()[0]?.state).toBe('sending');
    releaseFailed();
    await flush();
    expect(box.entries()[0]?.state).toBe('failed');
    expect(mem.rows.get('key-1')?.state).toBe('failed');
  });

  test('a failure does not bring back a stored message another page already delivered', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    mem.rows.delete('key-1');
    calls[0]?.reject(new Error('response lost'));
    await flush();
    expect(mem.rows.size).toBe(0);
  });

  test('the stream reporting a returned message does not drop its stored key', async () => {
    const mem = memoryStore();
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.land('key-1', 'm1');
    await flush();
    expect(mem.rows.get('key-1')?.state).toBe('returned');
  });

  test('a stored message another open page still owns is left to that page', async () => {
    const mem = memoryStore([stored({ owner: 'page-1' })]);
    const box = storedOutbox(mem.store, ['page-1']);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    await flush();
    expect(box.entries()).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test('a resumed message is stored again under this page so the next page can take it over', async () => {
    const mem = memoryStore([stored({})]);
    const box = storedOutbox(mem.store);
    const { deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    expect(mem.rows.get('old-1')?.owner).toBe('page-2');
  });

  test('a returned key older than its limit is dropped when the page comes back', async () => {
    const mem = memoryStore([stored({ state: 'returned', createdAt: 1000 - RETURNED_KEY_TTL_MS - 1 })]);
    const box = storedOutbox(mem.store);
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    await flush();
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'kept' }, deliver);
    await flush();
    expect(calls[0]?.entry.key).toBe('key-1');
    expect(mem.rows.has('old-1')).toBe(false);
  });

  test('a message sent while stored messages are still loading goes out after them', async () => {
    const mem = memoryStore([stored({ text: 'from before' })]);
    let finishLoad: () => void = () => {};
    const box = storedOutbox({
      ...mem.store,
      load: () =>
        new Promise((resolve) => {
          finishLoad = () => resolve([...mem.rows.values()]);
        }),
    });
    const { calls, deliver } = gate();
    void box.resume('u/team', deliver);
    box.enqueue({ scope: 'u/team', globalThreadId: null, threadId: 't1', projectId: null, text: 'typed now' }, deliver);
    await flush();
    expect(calls).toHaveLength(0);
    finishLoad();
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    expect(calls.map((call) => call.entry.text)).toEqual(['from before', 'typed now']);
  });
});

describe('unlanded rows', () => {
  const entry = (patch: Partial<OutboxEntry>): OutboxEntry => ({
    key: 'k1',
    scope: 'u/team',
    threadId: 't1',
    projectId: null,
    text: 'hello',
    state: 'sending',
    messageId: null,
    createdAt: 5,
    ...patch,
  });

  test('a sending message of the open conversation becomes a dimmed user row', () => {
    expect(unlandedItems([entry({})], 't1', new Set())).toEqual([
      { kind: 'user', text: 'hello', outboxKey: 'k1', createdAt: 5, delivery: 'sending' },
    ]);
  });

  test('a failed message is not a row: its text goes back to the composer', () => {
    expect(unlandedItems([entry({ state: 'failed', projectId: 'p1' })], 't1', new Set())).toEqual(
      [],
    );
  });

  test('a sending message keeps its project', () => {
    expect(unlandedItems([entry({ projectId: 'p1' })], 't1', new Set())).toEqual([
      {
        kind: 'user',
        text: 'hello',
        outboxKey: 'k1',
        createdAt: 5,
        projectId: 'p1',
        delivery: 'sending',
      },
    ]);
  });

  test('a sent message shows as a plain row until the transcript holds it', () => {
    const sent = entry({ state: 'sent', messageId: 'm1' });
    expect(unlandedItems([sent], 't1', new Set())).toEqual([
      { kind: 'user', text: 'hello', outboxKey: 'k1', createdAt: 5 },
    ]);
    expect(unlandedItems([sent], 't1', new Set(['m1']))).toEqual([]);
  });

  test('a message stored before its conversation existed shows in the Coordinator thread it went to', () => {
    expect(unlandedItems([entry({ threadId: null })], 't1', new Set(), 't1')).toHaveLength(1);
    expect(unlandedItems([entry({ threadId: null })], 'channel', new Set(), 't1')).toEqual([]);
  });

  test('messages of another conversation are left out', () => {
    expect(unlandedItems([entry({ threadId: 't2' })], 't1', new Set())).toEqual([]);
    expect(unlandedItems([entry({ threadId: null })], 't1', new Set())).toEqual([]);
    expect(unlandedItems([entry({ threadId: null })], null, new Set())).toHaveLength(1);
  });
});
