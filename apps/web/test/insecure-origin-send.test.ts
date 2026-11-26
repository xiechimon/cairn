import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { enqueueTaskSend, taskOutbox, unlandedTaskBubbles } from '../src/board/task-outbox.js';
import { createOutbox } from '../src/chief/outbox.js';
import { markErrorSurfaced } from '../src/lib/mutation-error-report.js';
import { useComposerWire } from '../src/overlay/composer-wire.js';

const toastError = vi.hoisted(() => vi.fn());

vi.mock('react', () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useId: () => 'test-id',
  useMemo: (factory: () => unknown) => factory(),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock('../src/components/ui/toaster.js', () => ({ toastError }));

const secureCrypto = globalThis.crypto;

beforeEach(() => {
  toastError.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function composer(onSend: (text: string) => void | Promise<void>) {
  const onDraftChange = vi.fn();
  const wire = useComposerWire({ editable: true, draft: 'hello', onDraftChange, onSend });
  return { wire, onDraftChange };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 5));

test('on a plain-http origin, without crypto.randomUUID, a send shows its bubble and is delivered', async () => {
  vi.stubGlobal('crypto', {
    getRandomValues: secureCrypto.getRandomValues.bind(secureCrypto),
  });
  const box = createOutbox();
  const delivered: string[] = [];
  const deliver = async (entry: { key: string }) => {
    delivered.push(entry.key);
    return { threadId: 't1', messageId: 'm1' };
  };
  const input = { scope: null, globalThreadId: null, threadId: 't1', projectId: null, text: 'hello' };
  const first = box.enqueue(input, deliver);
  const second = box.enqueue(input, deliver);
  expect(box.entries().map((entry) => entry.text)).toEqual(['hello', 'hello']);
  await settled();
  expect(delivered).toEqual([first, second]);
  expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(second).not.toBe(first);
});

test('a send that throws says so and keeps the text for a retry', () => {
  const failure = new TypeError('crypto.randomUUID is not a function');
  const { wire, onDraftChange } = composer(() => {
    throw failure;
  });
  expect(() => wire.send()).not.toThrow();
  expect(toastError).toHaveBeenCalledExactlyOnceWith('Send failed. Try again.', null);
  expect(onDraftChange).not.toHaveBeenCalled();
});

test('a rejected send is reported once, and keeps the text for a retry', async () => {
  const reported = new Error('refused');
  const first = composer(async () => {
    markErrorSurfaced(reported);
    throw reported;
  });
  first.wire.send();
  await settled();
  const unreported = new Error('offline');
  const second = composer(() => Promise.reject(unreported));
  second.wire.send();
  await settled();
  expect(toastError).toHaveBeenCalledExactlyOnceWith('Send failed. Try again.', unreported);
  expect(first.onDraftChange).not.toHaveBeenCalled();
  expect(second.onDraftChange).not.toHaveBeenCalled();
});

test('a reply that only queues on the server shows as sending until the server has it', async () => {
  let accept = () => {};
  const key = enqueueTaskSend({
    todoId: 'todo-queued',
    buildId: 'build-1',
    text: 'hold this',
    queueOnly: true,
    deliver: () =>
      new Promise((resolve) => {
        accept = () => resolve({ threadId: 'build-1', messageId: null });
      }),
    onError: () => {},
  });
  const bubbles = () => unlandedTaskBubbles(taskOutbox.entries(), 'todo-queued', new Set());
  await settled();
  expect(bubbles()).toMatchObject([{ outboxKey: key, text: 'hold this', delivery: 'sending' }]);
  accept();
  await settled();
  expect(bubbles()).toEqual([]);
});
