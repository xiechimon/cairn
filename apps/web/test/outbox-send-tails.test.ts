import { afterEach, expect, test, vi } from 'vitest';
import { ApiError } from '../src/api/client.js';
import { createProductQueryClient } from '../src/api/provider.js';
import { createOutbox, hasPendingSend } from '../src/chief/outbox.js';
import { liveTaskDelivery } from '../src/board/task-delivery.js';
import { watchTask } from '../src/board/task-outbox.js';
import { translate } from '../src/i18n/translate.js';
import { EN } from '../src/i18n/en.js';
import { describeError } from '../src/lib/error-copy.js';
import { errorWasSurfaced } from '../src/lib/mutation-error-report.js';
import { SendTimeoutError } from '../src/lib/send-errors.js';

const zh = (source: string) => translate('zh', EN, source);

const refusals = {
  'queued-message-cancelled': '这条消息已从队列删除，没有再次发送。',
  'task-archived': '这个任务已归档。取消归档后才能继续。',
  'task-closed': '这个任务已关闭，消息没有发出。',
};

test.each(Object.entries(refusals))('the %s refusal is explained in Chinese', (reason, copy) => {
  expect(describeError(new ApiError(409, 'Unarchive to continue', reason), zh)).toBe(copy);
});

const reply = {
  scope: 'u/team',
  globalThreadId: null,
  threadId: 'build-1',
  projectId: null,
  text: 'say it once',
  task: { todoId: 'todo-1', mode: 'queue' as const },
};

const wait = () => new Promise((resolve) => setTimeout(resolve, 5));

async function failedWith(error: Error) {
  let minted = 0;
  const box = createOutbox({ mintKey: () => `key-${++minted}` });
  const key = box.enqueue(reply, () => Promise.reject(error));
  await wait();
  return { box, key };
}

const nothing = () => new Promise<never>(() => {});

test('text handed back after the message was removed from the queue is sent as a new message', async () => {
  const { box, key } = await failedWith(
    new ApiError(409, 'Queued message was removed', 'queued-message-cancelled'),
  );
  box.discard(key);
  expect(box.enqueue(reply, nothing)).not.toBe(key);
});

test('text handed back after a timeout keeps its key', async () => {
  const { box, key } = await failedWith(new SendTimeoutError());
  box.discard(key);
  expect(box.enqueue(reply, nothing)).toBe(key);
});

test('a saved failed task reply holds back the app update until it is dealt with', async () => {
  const { box, key } = await failedWith(new Error('offline'));
  expect(hasPendingSend(box.entries())).toBe(true);
  box.discard(key);
  expect(hasPendingSend(box.entries())).toBe(false);
});

afterEach(() => {
  vi.useRealTimers();
});

test.each(['open', 'closed'])(
  'a task send that times out with the chat %s raises no generic failure toast',
  async (panel) => {
    const close = panel === 'open' ? watchTask('todo-1') : () => {};
    const client = createProductQueryClient();
    const error = new SendTimeoutError();
    const mutate = () =>
      client
        .getMutationCache()
        .build(client, { mutationFn: () => Promise.reject(error) })
        .execute(undefined);
    await expect(
      liveTaskDelivery(async () => {
        await mutate();
        return { threadId: 'build-1', messageId: null };
      })({ key: 'k', task: reply.task } as never, undefined),
    ).rejects.toBe(error);
    expect(errorWasSurfaced(error)).toBe(true);
    close();
  },
);
