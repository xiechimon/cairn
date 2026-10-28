import { CHIEF_REMOTE_TOOLS } from '@cairn/shared';
import { afterEach, expect, test } from 'vitest';
import { project } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { bootServer, type TestServer } from './helpers.js';

const servers: TestServer[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.dispose();
});

function overlapWorld(respond: (url: URL) => { data: unknown; next?: boolean; status?: number }) {
  const calls: { url: URL; method: string; token: string | undefined }[] = [];
  const githubFetch: FetchLike = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, method: init?.method ?? 'GET', token: init?.headers?.authorization });
    const response = respond(url);
    const status = response.status ?? 200;
    return {
      ok: status === 200,
      status,
      headers: {
        get: (name) =>
          name === 'link' && response.next
            ? '<https://api.github.com/search/issues?page=2>; rel="next"'
            : null,
      },
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
    };
  };
  const server = bootServer({ githubFetch });
  servers.push(server);
  server.db
    .insert(project)
    .values({
      id: 'overlap-project',
      name: 'Overlap',
      teamId: server.team.id,
      repoKind: 'github',
      githubRepo: 'octo/repo',
    })
    .run();
  upsertGithubConnection(
    { db: server.db, box: server.secretBox },
    {
      teamId: server.team.id,
      login: 'octo',
      accessToken: 'synthetic-overlap-token',
      scope: 'repo',
    },
  );
  return {
    server,
    calls,
    read: (params: Record<string, unknown> = {}) =>
      executeChiefTool(
        {
          db: server.db,
          hub: server.hub,
          machineHub: server.machineHub,
          box: server.secretBox,
          user: server.user,
          reposDir: server.reposDir,
          attachmentsDir: server.attachmentsDir,
          skillsDir: server.skillsDir,
          githubFetch,
        },
        {
          teamId: server.team.id,
          userId: server.user.id,
          chiefId: 'overlap-chief',
          threadId: 'overlap-thread',
          chiefAgentId: null,
          conversationId: 'overlap-thread',
        },
        'github_overlaps',
        {
          projectId: 'overlap-project',
          terms: ['retry', 'temporary push'],
          paths: ['git.ts'],
          ...params,
        },
      ),
  };
}

const candidate = (number: number) => ({
  number,
  title: 'Retry transient errors',
  body: 'Repeat pushes after temporary network failures.',
  state: 'open',
});

test('chief overlap tool reads complete title/body searches and independent file overlaps without writes', async () => {
  const world = overlapWorld((url) => {
    if (url.pathname === '/search/issues') {
      const query = url.searchParams.get('q') ?? '';
      if (query.includes('is:issue'))
        return {
          data: {
            incomplete_results: false,
            total_count: 2,
            items: [candidate(url.searchParams.get('page') === '2' ? 1787 : 1786)],
          },
          next: url.searchParams.get('page') !== '2',
        };
      return {
        data: {
          incomplete_results: false,
          total_count: 1,
          items: [candidate(query.includes('is:merged') ? 10 : 11)],
        },
      };
    }
    if (url.pathname === '/repos/octo/repo/pulls')
      return { data: [{ ...candidate(9), title: 'Unrelated title', head: { ref: 'lane/9' } }] };
    if (url.pathname === '/repos/octo/repo/pulls/9/files')
      return { data: [{ filename: 'renamed.ts', previous_filename: 'git.ts' }] };
    return { data: {}, status: 404 };
  });
  const report = JSON.parse(await world.read());
  expect(report.repo).toBe('octo/repo');
  expect(report.untrusted).toBe(true);
  expect(report.openIssues.map((item: { number: number }) => item.number)).toEqual([1786, 1787]);
  expect(report.openIssues[0].body).toBe(candidate(1786).body);
  expect(
    report.filePulls.map(
      (item: { number: number; head: { ref: string }; overlappingFiles: string[] }) => [
        item.number,
        item.head.ref,
        item.overlappingFiles,
      ],
    ),
  ).toEqual([[9, 'lane/9', ['renamed.ts']]]);
  expect(
    world.calls.every(
      (call) =>
        call.url.origin === 'https://api.github.com' &&
        call.method === 'GET' &&
        call.token === 'Bearer synthetic-overlap-token',
    ),
  ).toBe(true);
  expect(
    world.calls
      .filter((call) => call.url.pathname === '/search/issues')
      .every((call) => call.url.searchParams.get('q')?.includes('in:title,body')),
  ).toBe(true);
  expect(CHIEF_REMOTE_TOOLS.find((tool) => tool.name === 'github_overlaps')?.replaySafe).toBe(true);
});

test.each([
  { data: { incomplete_results: true, total_count: 1, items: [candidate(1)] } },
  { data: { incomplete_results: false, total_count: 1001, items: [] } },
  { data: { incomplete_results: false, total_count: 1, items: [{}] } },
  { data: { message: 'Forbidden' }, status: 403 },
])(
  'chief overlap read fails closed on incomplete, malformed or rejected results: %j',
  async (response) => {
    const world = overlapWorld(() => response);
    await expect(world.read()).rejects.toThrow();
  },
);

test('chief overlap cannot read a project outside the current team or accept empty search terms', async () => {
  const world = overlapWorld(() => ({ data: [] }));
  await expect(world.read({ projectId: 'another-team-project' })).rejects.toThrow();
  await expect(world.read({ terms: [] })).rejects.toThrow();
  expect(world.calls).toEqual([]);
});

test('chief overlap later-page errors cannot return partial success', async () => {
  const world = overlapWorld((url) =>
    url.searchParams.get('page') === '2'
      ? { data: { message: 'Unavailable' }, status: 503 }
      : { data: { incomplete_results: false, total_count: 2, items: [candidate(1)] }, next: true },
  );
  await expect(world.read()).rejects.toThrow();
  expect(world.calls).toHaveLength(2);
});

test('chief overlap rejects oversized third-party bodies instead of returning a partial report', async () => {
  const world = overlapWorld(() => ({
    data: {
      incomplete_results: false,
      total_count: 1,
      items: [{ ...candidate(1), body: 'x'.repeat(65536) }],
    },
  }));
  const failure = await world.read({ paths: [] }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure)).toMatch(/64 KiB/);
});

test('chief overlap projects unused API metadata without discarding complete candidate bodies', async () => {
  const world = overlapWorld(() => ({
    data: {
      incomplete_results: false,
      total_count: 1,
      items: [{ ...candidate(1), unusedMetadata: 'x'.repeat(70000) }],
    },
  }));
  const report = JSON.parse(await world.read({ paths: [] }));
  expect(report.openIssues[0].body).toBe(candidate(1).body);
  expect(report.openIssues[0]).not.toHaveProperty('unusedMetadata');
});
