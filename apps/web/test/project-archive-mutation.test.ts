import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { type ApiMutations, useApiMutations } from '../src/api/hooks.js';
import type { ProjectRecord } from '@cairn/shared';

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

function project(id: string, archivedAt: number | null): ProjectRecord {
  return {
    id,
    name: `Project ${id}`,
    teamId: 'team-1',
    splitPolicy: 'human',
    evidenceStore: 'attachments',
    archivedAt,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const qc of clients.splice(0)) qc.clear();
});

it('unarchive clears archivedAt in the projects cache before the POST settles', async () => {
  const { qc, mutations } = setup('team-1');
  qc.setQueryData<ProjectRecord[]>(
    ['projects', 'team-1'],
    [project('p1', 111), project('p2', null)],
  );
  let resolvePost!: (value: ProjectRecord) => void;
  vi.spyOn(api, 'post').mockImplementation(
    () =>
      new Promise<ProjectRecord>((resolve) => {
        resolvePost = resolve;
      }),
  );

  const pending = mutations.setProjectArchived.mutateAsync({ id: 'p1', archived: false });

  await vi.waitFor(() => {
    const rows = qc.getQueryData<ProjectRecord[]>(['projects', 'team-1']);
    expect(rows?.find((row) => row.id === 'p1')?.archivedAt).toBeNull();
  });
  expect(api.post).toHaveBeenCalledWith('/api/projects/p1/unarchive');

  const record = project('p1', null);
  resolvePost(record);
  await pending;
  const rows = qc.getQueryData<ProjectRecord[]>(['projects', 'team-1']);
  expect(rows?.find((row) => row.id === 'p1')).toEqual(record);
});

it('archive stamps archivedAt in the projects cache before the POST settles', async () => {
  const { qc, mutations } = setup('team-1');
  qc.setQueryData<ProjectRecord[]>(['projects', 'team-1'], [project('p1', null)]);
  vi.spyOn(api, 'post').mockImplementation(() => new Promise<ProjectRecord>(() => {}));

  void mutations.setProjectArchived.mutateAsync({ id: 'p1', archived: true }).catch(() => {});

  await vi.waitFor(() => {
    const rows = qc.getQueryData<ProjectRecord[]>(['projects', 'team-1']);
    expect(typeof rows?.find((row) => row.id === 'p1')?.archivedAt).toBe('number');
  });
  expect(api.post).toHaveBeenCalledWith('/api/projects/p1/archive');
});

it('rolls the projects cache back when the unarchive POST fails', async () => {
  const { qc, mutations } = setup('team-1');
  qc.setQueryData<ProjectRecord[]>(['projects', 'team-1'], [project('p1', 111)]);
  vi.spyOn(api, 'post').mockRejectedValue(new Error('offline'));

  await expect(
    mutations.setProjectArchived.mutateAsync({ id: 'p1', archived: false }),
  ).rejects.toThrow('offline');

  const rows = qc.getQueryData<ProjectRecord[]>(['projects', 'team-1']);
  expect(rows?.find((row) => row.id === 'p1')?.archivedAt).toBe(111);
});
