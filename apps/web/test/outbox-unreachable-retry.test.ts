import { expect, test } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { createOutbox, type Deliver, type OutboxEntry } from '../src/chief/outbox.js';
import { ServerUnreachableError } from '../src/lib/send-errors.js';

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

function outbox(reconnect?: (retry: () => void) => () => void) {
  let minted = 0;
  return createOutbox({
    now: () => 1000,
    mintKey: () => `key-${++minted}`,
    ...(reconnect !== undefined ? { reconnect } : {}),
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const input = {
  scope: 'u/team',
  globalThreadId: null,
  threadId: 't1',
  projectId: null,
  text: '用你自己的电脑跑一下 uptime 命令',
};

test('a send that cannot reach the server stays pending instead of failing back into the draft', async () => {
  const box = outbox();
  const { calls, deliver } = gate();
  const failures: unknown[] = [];
  box.enqueue(input, deliver, { onFailed: (entry, error) => failures.push(error) });
  await flush();
  calls[0]?.reject(new ServerUnreachableError(new TypeError('Failed to fetch')));
  await flush();
  expect(box.entries()[0]).toMatchObject({ key: 'key-1', state: 'sending', text: input.text });
  expect(failures).toEqual([]);
});

test('a pending send is delivered once when the connection returns', async () => {
  let retryHint: () => void = () => {};
  let wired = false;
  const box = outbox((retry) => {
    retryHint = retry;
    wired = true;
    return () => {};
  });
  const { calls, deliver } = gate();
  box.enqueue(input, deliver);
  await flush();
  calls[0]?.reject(new ServerUnreachableError());
  await flush();
  expect(box.entries()[0]).toMatchObject({ state: 'sending' });
  expect(wired).toBe(true);
  retryHint();
  await flush();
  expect(calls).toHaveLength(2);
  expect(calls[1]?.entry.key).toBe('key-1');
  calls[1]?.resolve({ threadId: 't1', messageId: 'm1' });
  await flush();
  expect(box.entries()[0]).toMatchObject({ state: 'sent', messageId: 'm1' });
  box.settle('t1', new Set(['m1']));
  expect(box.entries()).toEqual([]);
});

test('a landed pending send is not retried again', async () => {
  let retryHint: () => void = () => {};
  const box = outbox((retry) => {
    retryHint = retry;
    return () => {};
  });
  const { calls, deliver } = gate();
  const key = box.enqueue(input, deliver);
  await flush();
  calls[0]?.reject(new ServerUnreachableError());
  await flush();
  box.land(key, 'm1');
  await flush();
  retryHint();
  await flush();
  expect(calls).toHaveLength(1);
});

test('an explicit server rejection still fails and hands the text back', async () => {
  const box = outbox();
  const { calls, deliver } = gate();
  const failures: unknown[] = [];
  box.enqueue(input, deliver, { onFailed: (entry, error) => failures.push(error) });
  await flush();
  calls[0]?.reject(new ApiError(500, 'upstream refused'));
  await flush();
  expect(box.entries()[0]).toMatchObject({ state: 'failed' });
  expect(failures).toHaveLength(1);
});