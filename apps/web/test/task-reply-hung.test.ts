import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import {
  discardTaskFailed,
  enqueueTaskSend,
  taskOutbox,
  unlandedTaskBubbles,
} from '../src/board/task-outbox.js';
import { type ThreadChat, useThreadChat } from '../src/board/use-thread-chat.js';
import { I18nProvider } from '../src/i18n/provider.js';

vi.mock('react', async (original) => {
  const react = await original<typeof import('react')>();
  return {
    ...react,
    useSyncExternalStore: <T>(
      subscribe: (onChange: () => void) => () => void,
      snapshot: () => T,
      serverSnapshot = snapshot,
    ) => react.useSyncExternalStore(subscribe, snapshot, serverSnapshot),
  };
});
vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: true, teamId: 'team', userName: 'Owner' }),
}));
const sendSteerFailure = vi.hoisted(() => ({
  variables: undefined as Record<string, unknown> | undefined,
}));
vi.mock('../src/api/hooks.js', async (original) => {
  const hooks = await original<typeof import('../src/api/hooks.js')>();
  return {
    ...hooks,
    useApiMutations: (teamId: string | undefined) => {
      const mutations = hooks.useApiMutations(teamId);
      return sendSteerFailure.variables === undefined
        ? mutations
        : {
            ...mutations,
            sendSteer: {
              ...mutations.sendSteer,
              isError: true,
              error: new Error('request failed'),
              variables: sendSteerFailure.variables,
            },
          };
    },
  };
});
vi.mock('../src/board/use-mark-thread-read.js', () => ({ useMarkThreadRead: () => {} }));

function runningTaskChat(todoId = 'running-task'): ThreadChat {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['todo', todoId], {
    id: todoId,
    title: 'Running',
    phase: 'building',
    phaseAt: 1,
    latestBuildId: 'running-build',
  });
  qc.setQueryData(['steps', 'running-build'], [{ id: 'step', kind: 'build', status: 'claimed' }]);
  let chat: ThreadChat | undefined;
  function Probe() {
    chat = useThreadChat(todoId, undefined);
    return null;
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: qc,
      children: createElement(MemoryRouter, {
        children: createElement(I18nProvider, {
          initialLocale: 'en',
          children: createElement(Probe),
        }),
      }),
    }),
  );
  if (chat === undefined) throw new Error('hook did not render');
  return chat;
}

test('queue and stop-and-send show as sending at once and hand the composer back while the request hangs', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => {})),
  );
  const chat = runningTaskChat();
  expect(chat.queue?.('queue this')).toBeUndefined();
  expect(chat.stopAndSend?.('stop and send this')).toBeUndefined();
  expect(unlandedTaskBubbles(taskOutbox.entries(), 'running-task', new Set())).toMatchObject([
    { text: 'queue this', delivery: 'sending' },
    { text: 'stop and send this', delivery: 'sending' },
  ]);
});

test('only the outbox reports a typed send, so a late arrival can take its error away', () => {
  sendSteerFailure.variables = { mode: 'queue', clientMessageId: 'typed' };
  expect(runningTaskChat().sendError).toBeNull();
  sendSteerFailure.variables = { queuedMessageId: 'queued-chip' };
  expect(runningTaskChat().sendError).not.toBeNull();
  sendSteerFailure.variables = undefined;
});

test('once the task composer has seen a late arrival, the same words are a new message even if the draft had moved on', async () => {
  const typed = {
    account: null,
    todoId: 'idle-task',
    buildId: 'idle-task-build',
    text: 'continue',
    mode: 'queue' as const,
    onFailed: () => {},
  };
  const first = enqueueTaskSend({
    ...typed,
    deliver: async () => {
      throw new Error('no reply');
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(discardTaskFailed(first)).toBe('continue');
  const stop = runningTaskChat('idle-task').unsent?.onArrivedLate(() => false);
  taskOutbox.land(first, 'stored-message');
  stop?.();
  expect(enqueueTaskSend({ ...typed, deliver: () => new Promise(() => {}) })).not.toBe(first);
});
