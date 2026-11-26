import { afterEach, expect, test, vi } from 'vitest';
import {
  createOutbox,
  type Deliver,
  type OutboxEntry,
  type OutboxStore,
  type StoredOutboxEntry,
  withoutReturnedText,
} from '../src/chief/outbox.js';

const MINUTE = 60_000;
const NOW = 100 * MINUTE;

function memoryStore(initial: StoredOutboxEntry[] = []) {
  const rows = new Map(initial.map((row) => [row.key, row]));
  const store: OutboxStore = {
    put: async (row) => void rows.set(row.key, row),
    putIfPresent: async (row) => {
      if (rows.has(row.key)) rows.set(row.key, row);
    },
    remove: async (key) => void rows.delete(key),
    load: async () => [...rows.values()],
  };
  return { rows, store };
}

function gate() {
  const calls: {
    entry: OutboxEntry;
    signal: AbortSignal | undefined;
    resolve: (threadId: string) => void;
  }[] = [];
  const deliver: Deliver = (entry, signal) =>
    new Promise((resolve) => {
      calls.push({
        entry,
        signal,
        resolve: (threadId) => resolve({ threadId, messageId: null }),
      });
    });
  return { calls, deliver, texts: () => calls.map((call) => call.entry.text) };
}

function page(store: OutboxStore, id: string, sendTimeoutMs?: number) {
  let minted = 0;
  return createOutbox({
    now: () => NOW,
    mintKey: () => `${id}-${++minted}`,
    store,
    owner: { id, live: async () => new Set<string>() },
    ...(sendTimeoutMs !== undefined ? { sendTimeoutMs } : {}),
  });
}

const send = (threadId: string | null, text: string) => ({
  scope: 'u/team',
  globalThreadId: null,
  threadId,
  projectId: null,
  text,
});

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

test.each(['reply', 'queue', 'stop-and-send'] as const)(
  'a %s send that is still hanging when the page reloads is sent again with the same key and mode',
  async (mode) => {
    const mem = memoryStore();
    const first = page(mem.store, 'a');
    first.enqueue(
      { ...send('build-1', 'keep me'), task: { todoId: 'todo-1', mode } },
      gate().deliver,
    );
    await wait();

    const next = gate();
    void page(mem.store, 'b').resume('u/team', next.deliver);
    await wait(5);

    expect(next.calls.map((call) => call.entry)).toMatchObject([
      { key: 'a-1', text: 'keep me', threadId: 'build-1', task: { todoId: 'todo-1', mode } },
    ]);
  },
);

test('task replies are kept in browser storage', async () => {
  const open = vi.fn(() => ({}));
  vi.stubGlobal('indexedDB', { open });
  vi.resetModules();
  const { enqueueTaskSend } = await import('../src/board/task-outbox.js');
  enqueueTaskSend({
    account: 'u/team',
    todoId: 'todo-1',
    buildId: 'build-1',
    text: 'keep me',
    mode: 'reply',
    deliver: () => new Promise(() => {}),
    onFailed: () => {},
  });
  expect(open).toHaveBeenCalledWith('cairn-task-outbox', 1);
});

test('a send older than 10 minutes is not sent again by itself and its text is handed back', async () => {
  const mem = memoryStore([
    {
      key: 'old',
      scope: 'u/team',
      owner: 'gone',
      threadId: 't1',
      projectId: null,
      text: 'from this morning',
      state: 'sending',
      createdAt: NOW - 11 * MINUTE,
    },
  ]);
  const box = page(mem.store, 'b');
  const next = gate();
  const failed: string[] = [];
  void box.resume('u/team', next.deliver, { onFailed: (entry) => failed.push(entry.text) });
  await wait(5);

  expect(next.calls).toHaveLength(0);
  expect(box.entries()).toMatchObject([
    { text: 'from this morning', state: 'failed', failure: 'stale' },
  ]);
  expect(mem.rows.get('old')?.state).toBe('failed');
  expect(failed).toEqual(['from this morning']);
});

test('a hung send does not delay a send in another conversation', async () => {
  const box = page(memoryStore().store, 'a');
  const { deliver, texts } = gate();
  box.enqueue(send('t1', 'hangs'), deliver);
  box.enqueue(send('t2', 'goes out'), deliver);
  await wait(5);
  expect(texts()).toEqual(['hangs', 'goes out']);
});

test('a new conversation keeps its order once it has an id', async () => {
  const box = page(memoryStore().store, 'a');
  const { calls, deliver, texts } = gate();
  box.enqueue(send(null, 'one'), deliver);
  box.enqueue(send(null, 'two'), deliver);
  await wait(5);
  calls[0]?.resolve('t-new');
  await wait(5);
  box.enqueue(send('t-new', 'three'), deliver);
  await wait(5);
  expect(texts()).toEqual(['one', 'two']);
  calls[1]?.resolve('t-new');
  await wait(5);
  expect(texts()).toEqual(['one', 'two', 'three']);
});

test('a send with no reply is aborted, fails visibly, and the next one in the conversation goes out', async () => {
  const box = page(memoryStore().store, 'a', 20);
  const { calls, deliver, texts } = gate();
  const failures: unknown[] = [];
  box.enqueue(send('t1', 'hangs'), deliver, { onFailed: (_entry, error) => failures.push(error) });
  box.enqueue(send('t1', 'next'), deliver);
  await wait(30);

  expect(calls[0]?.signal?.aborted).toBe(true);
  expect(box.entries()[0]).toMatchObject({ state: 'failed', failure: 'timeout' });
  expect(failures).toMatchObject([{ name: 'SendTimeoutError' }]);
  expect(texts()).toEqual(['hangs', 'next']);
});

test('a message that arrives after its timeout counts as sent', async () => {
  const mem = memoryStore();
  const box = page(mem.store, 'a', 10);
  box.enqueue(send('t1', 'slow'), gate().deliver);
  await wait(30);
  expect(box.entries()[0]?.state).toBe('failed');
  box.land('a-1', 'message-1');
  await wait();
  expect(box.entries()).toMatchObject([{ state: 'sent', messageId: 'message-1' }]);
  expect(mem.rows.size).toBe(0);
});

test('a message that arrives after its text went back to the composer reports that text', async () => {
  const mem = memoryStore();
  const box = page(mem.store, 'a', 10);
  const late: string[] = [];
  box.subscribeLateArrival((entry) => {
    late.push(entry.text);
    return true;
  });
  box.enqueue(send('t1', 'slow'), gate().deliver);
  await wait(30);
  expect(box.discard('a-1')?.text).toBe('slow');
  box.land('a-1', 'message-1');
  await wait();
  expect(late).toEqual(['slow']);
  expect(mem.rows.size).toBe(0);
});

test('a failed send that is stored does not hold back an app update, an in-flight one does', async () => {
  const { hasPendingSend } = await import('../src/chief/outbox.js');
  const box = page(memoryStore().store, 'a', 20);
  box.enqueue(send('t1', 'hangs'), gate().deliver);
  expect(hasPendingSend(box.entries())).toBe(true);
  await wait(40);
  expect(box.entries()[0]?.state).toBe('failed');
  expect(hasPendingSend(box.entries())).toBe(false);
});

test('a timeout tells the user delivery is unknown and to look before resending', async () => {
  const { SendTimeoutError } = await import('../src/lib/send-errors.js');
  const { describeError } = await import('../src/lib/error-copy.js');
  expect(describeError(new SendTimeoutError(), (source) => source)).toBe(
    '不确定是否送达，重发前请先看对话里有没有这条。',
  );
});

test('the same words typed after the ten-minute window are a new message, not a replay', async () => {
  let clock = NOW;
  let minted = 0;
  const box = createOutbox({ now: () => clock, mintKey: () => `k${++minted}` });
  const refused: Deliver = async () => {
    throw new Error('refused');
  };
  const first = box.enqueue(send('t1', 'continue'), refused);
  await wait();
  box.discard(first);
  clock += 11 * MINUTE;
  expect(box.enqueue(send('t1', 'continue'), refused)).not.toBe(first);
});

test('a task reply resent after the task moved to a new build keeps its key and its place in line', async () => {
  let minted = 0;
  const box = createOutbox({ now: () => NOW, mintKey: () => `k${++minted}`, sendTimeoutMs: 20 });
  const task = { todoId: 'todo-1', mode: 'reply' as const };
  const silent: Deliver = () => new Promise(() => {});
  const first = box.enqueue({ ...send('old-build', 'Say it once'), task }, silent);
  await new Promise((resolve) => setTimeout(resolve, 40));
  box.discard(first);
  expect(box.enqueue({ ...send('new-build', 'Say it once'), task }, silent)).toBe(first);

  const started: string[] = [];
  box.enqueue({ ...send('newer-build', 'and then this'), task }, async (entry) => {
    started.push(entry.text);
    return { threadId: 'newer-build', messageId: null };
  });
  await wait();
  expect(started).toEqual([]);
});

test('a joined draft drops whichever returned message turns out to have arrived', () => {
  expect(withoutReturnedText('first one\nsecond one', 'first one')).toBe('second one');
  expect(withoutReturnedText('first one\nsecond one\nthird one', 'second one')).toBe('first one\nthird one');
  expect(withoutReturnedText('first one\nsecond one', 'second one')).toBe('first one');
  expect(withoutReturnedText('first one, edited\nsecond one', 'first one')).toBe('first one, edited\nsecond one');
});

test('a failure already on record is not announced again on the next load', async () => {
  const mem = memoryStore();
  const first = page(mem.store, 'a', 10);
  first.enqueue(send('t1', 'refused for good'), gate().deliver);
  await vi.waitFor(() => expect(mem.rows.get('a-1')?.state).toBe('failed'), { timeout: 5000 });
  const repeats: (boolean | undefined)[] = [];
  const next = page(mem.store, 'b');
  await next.resume('u/team', gate().deliver, {
    onFailed: (_entry, _error, repeat) => repeats.push(repeat),
  });
  await wait();
  expect(next.entries()).toMatchObject([{ state: 'failed', text: 'refused for good' }]);
  expect(repeats).toEqual([true]);
});

test('a failed send that could not be stored holds back an app update', async () => {
  const { hasPendingSend } = await import('../src/chief/outbox.js');
  const broken: OutboxStore = {
    ...memoryStore().store,
    put: () => Promise.reject(new Error('quota')),
  };
  const box = page(broken, 'a', 10);
  box.enqueue(send('t1', 'only in memory'), gate().deliver);
  await vi.waitFor(() => expect(box.entries()[0]?.state).toBe('failed'), { timeout: 5000 });
  expect(hasPendingSend(box.entries())).toBe(true);
});
