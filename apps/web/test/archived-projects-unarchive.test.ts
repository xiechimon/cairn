import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, useApiMutations } from '../src/api/hooks.js';
import { type InFlightIds, startUnarchive } from '../src/settings/unarchive-requests.js';

const clients: QueryClient[] = [];

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(qc);
  let mutations: ApiMutations | undefined;
  function Harness() {
    mutations = useApiMutations('t1');
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client: qc }, createElement(Harness)));
  if (mutations === undefined) throw new Error('Mutation harness did not render');
  return mutations;
}

function deferredPosts() {
  const settle = new Map<string, (ok: boolean) => void>();
  const post = vi.spyOn(api, 'post').mockImplementation(
    (path: string) =>
      new Promise((resolve, reject) => {
        settle.set(path, (ok) => (ok ? resolve({}) : reject(new Error('unarchive failed'))));
      }),
  );
  return { post, settle };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const qc of clients.splice(0)) qc.clear();
});

it('keeps each row in flight until its own unarchive request settles', async () => {
  const mutations = setup();
  const { post, settle } = deferredPosts();
  let inFlight: InFlightIds = new Set();
  const setInFlight = (update: (ids: InFlightIds) => InFlightIds) => {
    inFlight = update(inFlight);
  };
  const click = (id: string) => startUnarchive(id, inFlight, setInFlight, mutations.setProjectArchived, () => {});

  click('p1');
  click('p2');
  await flush();
  expect(post).toHaveBeenCalledTimes(2);
  expect([...inFlight].toSorted()).toEqual(['p1', 'p2']);

  settle.get('/api/projects/p1/unarchive')?.(true);
  await flush();
  expect(inFlight.has('p1')).toBe(false);
  expect(inFlight.has('p2')).toBe(true);

  click('p2');
  await flush();
  expect(post).toHaveBeenCalledTimes(2);

  settle.get('/api/projects/p2/unarchive')?.(true);
  await flush();
  expect(inFlight.size).toBe(0);
});

it('releases a failed row and reports the error once for that row', async () => {
  const mutations = setup();
  const { settle } = deferredPosts();
  let inFlight: InFlightIds = new Set();
  const setInFlight = (update: (ids: InFlightIds) => InFlightIds) => {
    inFlight = update(inFlight);
  };
  const errors: unknown[] = [];
  const click = (id: string) =>
    startUnarchive(id, inFlight, setInFlight, mutations.setProjectArchived, (error) => errors.push(error));

  click('p1');
  click('p2');
  await flush();
  settle.get('/api/projects/p1/unarchive')?.(false);
  await flush();
  expect(errors).toHaveLength(1);
  expect([...inFlight]).toEqual(['p2']);

  settle.get('/api/projects/p2/unarchive')?.(true);
  await flush();
  expect(inFlight.size).toBe(0);
  expect(errors).toHaveLength(1);
});
