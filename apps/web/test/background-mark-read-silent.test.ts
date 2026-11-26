import { QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { useApiMutations } from '../src/api/hooks.js';
import { createProductQueryClient } from '../src/api/provider.js';
import { toastError } from '../src/components/ui/toaster.js';

vi.mock('../src/components/ui/toaster.js', async (original) => ({
  ...(await original<typeof import('../src/components/ui/toaster.js')>()),
  toastError: vi.fn(),
}));

afterEach(() => vi.unstubAllGlobals());

const unreachable = async (): Promise<Response> => {
  throw new TypeError('Failed to fetch');
};
const answers = (status: number) => async () => Response.json({ error: 'nope' }, { status });

test.each([
  ['the connection fails', 0, unreachable],
  ['a gateway cannot reach the server', 0, answers(502)],
  ['the server rejects it', 1, answers(403)],
  ['the server errors', 1, answers(500)],
] as const)('a background mark-read when %s toasts %i times', async (_, toasts, respond) => {
  vi.mocked(toastError).mockClear();
  vi.stubGlobal('fetch', vi.fn(respond));
  let mutations: ReturnType<typeof useApiMutations> | undefined;
  function Probe() {
    mutations = useApiMutations('team');
    return null;
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, {
      client: createProductQueryClient(),
      children: createElement(Probe),
    }),
  );
  await expect(mutations?.setThreadRead.mutateAsync({ id: 'todo', read: true })).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(toastError).toHaveBeenCalledTimes(toasts);
});
