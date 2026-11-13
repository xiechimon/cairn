import { describe, expect, test } from 'vitest';
import { createOutbox, type Deliver, type OutboxEntry, unlandedItems } from '../src/chief/outbox.js';

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
  return createOutbox(
    () => 1000,
    () => `key-${++minted}`,
  );
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('chief outbox', () => {
  test('an enqueued message is sending at once and is handed to the sender with its own key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    const key = box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    expect(box.entries()).toEqual([
      {
        key: 'key-1',
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
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm9' });
    await flush();
    expect(box.entries()[0]).toMatchObject({ state: 'sent', messageId: 'm9' });
    box.settle('t1', new Set());
    expect(box.entries()).toHaveLength(1);
    box.settle('t1', new Set(['m9']));
    expect(box.entries()).toEqual([]);
  });

  test('a rejected message turns failed and keeps its text and key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: 'p1', text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(box.entries()[0]).toMatchObject({ key: 'key-1', state: 'failed', text: 'hello' });
  });

  test('discard removes a failed message and returns it', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(box.discard('key-1')?.text).toBe('hello');
    expect(box.entries()).toEqual([]);
  });

  test('the same message sent again after it failed keeps its key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1', 'key-1']);
    calls[1]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    box.settle('t1', new Set(['m1']));
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls[2]?.entry.key).toBe('key-2');
  });

  test('a failed message that was edited before it is sent again gets a new key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello there' }, deliver);
    await flush();
    expect(calls[1]?.entry.key).toBe('key-2');
  });

  test('a first message that failed keeps its key when its conversation has appeared since', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: null, projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('response lost'));
    await flush();
    box.discard('key-1');
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls[1]?.entry).toMatchObject({ key: 'key-1', threadId: 't1' });
  });

  test('sending an edited message retires the failed one, so its old text later gets a new key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('response lost'));
    await flush();
    box.discard('key-1');
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello there' }, deliver);
    await flush();
    calls[1]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1', 'key-2', 'key-3']);
  });

  test('a send in another conversation neither takes nor retires the failed message key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ threadId: 't2', projectId: null, text: 'hello' }, deliver);
    await flush();
    calls[1]?.resolve({ threadId: 't2', messageId: 'm1' });
    await flush();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.key)).toEqual(['key-1', 'key-2', 'key-1']);
  });

  test('the same text for another project is a new message with a new key', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: 'p1', text: 'hello' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    box.discard('key-1');
    box.enqueue({ threadId: 't1', projectId: 'p2', text: 'hello' }, deliver);
    await flush();
    expect(calls[1]?.entry.key).toBe('key-2');
  });

  test('discard leaves a message that is still sending in place', async () => {
    const box = outbox();
    const { deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'hello' }, deliver);
    await flush();
    expect(box.discard('key-1')).toBeNull();
    expect(box.entries()).toHaveLength(1);
  });

  test('the second message waits for the first one to settle, and a failure does not block it', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'one' }, deliver);
    box.enqueue({ threadId: 't1', projectId: null, text: 'two' }, deliver);
    await flush();
    expect(calls.map((call) => call.entry.text)).toEqual(['one']);
    calls[0]?.reject(new Error('refused'));
    await flush();
    expect(calls.map((call) => call.entry.text)).toEqual(['one', 'two']);
  });

  test('messages waiting for a conversation follow the one the first message created', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: null, projectId: null, text: 'one' }, deliver);
    box.enqueue({ threadId: null, projectId: null, text: 'two' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't-new', messageId: 'm1' });
    await flush();
    expect(calls[1]?.entry.threadId).toBe('t-new');
  });

  test('a delivered message in another conversation does not move messages of this one', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'one' }, deliver);
    box.enqueue({ threadId: null, projectId: null, text: 'two' }, deliver);
    await flush();
    calls[0]?.resolve({ threadId: 't1', messageId: 'm1' });
    await flush();
    expect(calls[1]?.entry.threadId).toBeNull();
  });

  test('settle drops sent messages of a conversation that is no longer open', async () => {
    const box = outbox();
    const { calls, deliver } = gate();
    box.enqueue({ threadId: 't1', projectId: null, text: 'one' }, deliver);
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
    box.enqueue({ threadId: 't1', projectId: null, text: 'one' }, deliver);
    await flush();
    calls[0]?.reject(new Error('refused'));
    await flush();
    stop();
    box.discard('key-1');
    expect(heard).toBe(2);
  });
});

describe('unlanded rows', () => {
  const entry = (patch: Partial<OutboxEntry>): OutboxEntry => ({
    key: 'k1',
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

  test('messages of another conversation are left out', () => {
    expect(unlandedItems([entry({ threadId: 't2' })], 't1', new Set())).toEqual([]);
    expect(unlandedItems([entry({ threadId: null })], 't1', new Set())).toEqual([]);
    expect(unlandedItems([entry({ threadId: null })], null, new Set())).toHaveLength(1);
  });
});
