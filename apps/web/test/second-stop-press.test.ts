import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { useApiMutations, useStopBackgroundTask } from '../src/api/hooks.js';
import { useChiefSurface } from '../src/chief/use-chief-surface.js';
import { toastError } from '../src/components/ui/toaster.js';
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
vi.mock('../src/components/ui/toaster.js', async (original) => ({
  ...(await original<typeof import('../src/components/ui/toaster.js')>()),
  toastError: vi.fn(),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toastError).mockClear();
});

function renderHooks<T>(useHooks: () => T, qc = new QueryClient()): T {
  let result: T | undefined;
  function Probe() {
    result = useHooks();
    return null;
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: qc,
      children: createElement(MemoryRouter, {
        children: createElement(I18nProvider, {
          initialLocale: 'zh',
          children: createElement(Probe),
        }),
      }),
    }),
  );
  return result as T;
}

function refuse(status: number, body: { error: string; reason?: string }) {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(body, { status })));
}

const stops = () => {
  const { chiefStop, stopBuild, stopMemoryEdit, task } = renderHooks(() => ({
    ...useApiMutations('team'),
    task: useStopBackgroundTask(),
  }));
  return {
    'Coordinator turn': () => chiefStop.mutateAsync({ threadId: 'chief-thread' }),
    'task run': () => stopBuild.mutateAsync({ buildId: 'build', discard: false }),
    'memory edit': () => stopMemoryEdit.mutateAsync({ editId: 'edit', attempt: 1 }),
    'background task': () => task.mutateAsync({ buildId: 'build', taskId: 'task' }),
  };
};

test.each(Object.keys(stops()) as (keyof ReturnType<typeof stops>)[])(
  'stopping a %s that already stopped is not a failure',
  async (name) => {
    refuse(409, { error: 'nothing in flight', reason: 'nothing-to-stop' });
    await expect(stops()[name]()).resolves.not.toThrow();
  },
);

test.each(Object.keys(stops()) as (keyof ReturnType<typeof stops>)[])(
  'any other refusal to stop a %s still fails',
  async (name) => {
    refuse(409, { error: 'the computer running this task is not connected' });
    await expect(stops()[name]()).rejects.toThrow('not connected');
  },
);

function withdrawOnce() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(
    ['chiefThreads', 'team'],
    [{ id: 'chief-thread', title: 'Coordinator', createdAt: 1, lastTurnAt: 1 }],
  );
  const surface = renderHooks(
    () => useChiefSurface({ todos: [], now: 0 }, { threadId: null, onConsumed: () => {} }),
    qc,
  );
  if (surface.onWithdraw === undefined) throw new Error('Missing withdraw');
  return surface.onWithdraw('queued-message');
}

test('a second press that finds the queued message already withdrawn stays quiet', async () => {
  refuse(404, { error: 'chief message queued-message not found' });
  await expect(withdrawOnce()).rejects.toThrow();
  expect(toastError).not.toHaveBeenCalled();
});

test('a withdraw the Coordinator already read still says so', async () => {
  refuse(409, { error: 'message already read by the running turn' });
  await expect(withdrawOnce()).rejects.toThrow();
  expect(toastError).toHaveBeenCalledOnce();
});

test('a withdraw of a message whose turn already ended stays quiet and keeps it sent', async () => {
  refuse(409, { error: 'chief turn already started', reason: 'nothing-to-stop' });
  await expect(withdrawOnce()).rejects.toThrow();
  expect(toastError).not.toHaveBeenCalled();
});
