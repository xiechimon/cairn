import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, useApiMutations } from '../src/api/hooks.js';

const clients: QueryClient[] = [];

function setup(teamId = 'team-1') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(qc);
  let mutations: ApiMutations | undefined;
  function Harness() {
    mutations = useApiMutations(teamId);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
  if (mutations === undefined) throw new Error('Mutation harness did not render');
  return { qc, mutations };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const qc of clients.splice(0)) qc.clear();
});

it('deleteMachine calls DELETE /api/machines/{id} and invalidates machines, routing-settings, model-routing, and teams', async () => {
  const { qc, mutations } = setup('team-1');
  const delSpy = vi.spyOn(api, 'del').mockResolvedValue(undefined);
  const invalidateSpy = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);

  await mutations.deleteMachine.mutateAsync('machine/a b');

  expect(delSpy).toHaveBeenCalledWith('/api/machines/machine%2Fa%20b');
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['machines', 'team-1'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['routing-settings', 'team-1'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['model-routing', 'team-1'] });
  expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['teams'] });
  expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: ['members', 'team-1'] });
});
