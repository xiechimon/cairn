import { expect, test } from 'vitest';
import { githubFake, mergeGithubFake, type RawIssue } from './fakes/github.js';

const issue: RawIssue = {
  number: 1,
  title: 'Project task',
  state: 'open',
  labels: [{ name: 'ready' }],
  created_at: '2026-10-31T00:00:00Z',
  body: null,
};

test('each fake owns its issue fixtures and conditional response state', async () => {
  const first = githubFake('owner/repo', { issues: [issue] });
  const second = githubFake('owner/repo', { issues: [issue] });
  first.state.open[0]?.labels.push({ name: 'changed' });
  expect(second.state.open[0]?.labels).toEqual([{ name: 'ready' }]);
  expect(issue.labels).toEqual([{ name: 'ready' }]);
  const url = 'https://api.github.com/repos/owner/repo/issues';
  const response = await second.impl(url);
  const etag = response.headers.get('etag');
  expect(etag).toBeTypeOf('string');
  const cached = await second.impl(url, { headers: { 'if-none-match': etag ?? '' } });
  expect(cached.status).toBe(304);
  await expect(cached.json()).rejects.toThrow('304 has no body');
  expect(first.calls).toHaveLength(0);
});

test('merge fixtures use the shared transport and mutate the recorded pull', async () => {
  const fake = mergeGithubFake({ 1: { state: 'open', merged: false } }, () => 'thread');
  const response = await fake.fetch('https://api.github.com/repos/owner/repo/pulls/1/merge', {
    method: 'PUT',
    body: '{}',
  });
  expect(response.status).toBe(200);
  expect(fake.pulls[1]).toMatchObject({ state: 'closed', merged: true });
  expect(fake.puts()).toHaveLength(1);
  fake.getAnswer = { status: 200, raw: 'invalid json' };
  await expect(
    (await fake.fetch('https://api.github.com/repos/owner/repo/pulls/1')).json(),
  ).rejects.toThrow();
});
