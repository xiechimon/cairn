import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { expect, test, vi } from 'vitest';
import { taskOutbox, unlandedTaskBubbles } from '../src/board/task-outbox.js';
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
vi.mock('../src/board/use-mark-thread-read.js', () => ({ useMarkThreadRead: () => {} }));

function runningTaskChat(): ThreadChat {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['todo', 'running-task'], {
    id: 'running-task',
    title: 'Running',
    phase: 'building',
    phaseAt: 1,
    latestBuildId: 'running-build',
  });
  qc.setQueryData(['steps', 'running-build'], [{ id: 'step', kind: 'build', status: 'claimed' }]);
  let chat: ThreadChat | undefined;
  function Probe() {
    chat = useThreadChat('running-task', undefined);
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
