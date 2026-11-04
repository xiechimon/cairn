import { claimedStepSchema, conversationBranch } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { agent, build, message, project, step, todo } from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { requestMerge } from '../src/services/builds.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { finishStep } from '../src/services/machine-finish-step.js';
import { bindAllAgents, bootServer, insertMachine, issueApiKey, req } from './helpers.js';

test('base branch survives PATCH, GET, unrelated edits and reset to the repo default', async () => {
  const s = bootServer();
  const created = await req(s.app, 'POST', '/api/projects', { name: 'branches' });
  const { id } = (await created.json()) as { id: string };
  const patched = await req(s.app, 'PATCH', `/api/projects/${id}`, { baseBranch: 'dev' });
  expect(patched.status).toBe(200);
  expect(await patched.json()).toMatchObject({ baseBranch: 'dev' });
  expect(await (await req(s.app, 'GET', '/api/projects')).json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, baseBranch: 'dev' })]),
  );
  const renamed = await req(s.app, 'PATCH', `/api/projects/${id}`, { name: 'renamed' });
  expect(await renamed.json()).toMatchObject({ baseBranch: 'dev' });
  const reset = await req(s.app, 'PATCH', `/api/projects/${id}`, { baseBranch: null });
  expect(reset.status).toBe(200);
  expect(await reset.json()).toMatchObject({ baseBranch: null });
  expect(s.db.select().from(project).where(eq(project.id, id)).get()).toMatchObject({
    baseBranch: null,
  });
});

test('the next claimed build carries the configured base branch through the wire schema', async () => {
  const s = bootServer();
  const key = await issueApiKey(s);
  const enrolled = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'branch-builder' }),
  });
  const { token } = (await enrolled.json()) as { token: string };
  s.db
    .insert(agent)
    .values({
      id: 'branch-agent',
      teamId: s.team.id,
      displayName: 'Builder',
      modelId: 'stub-model',
    })
    .run();
  bindAllAgents(s);
  const created = await req(s.app, 'POST', '/api/projects', {
    name: 'branches',
    kind: 'github',
    githubRepo: 'octo/demo',
  });
  const { id } = (await created.json()) as { id: string };
  expect((await req(s.app, 'PATCH', `/api/projects/${id}`, { baseBranch: 'dev' })).status).toBe(
    200,
  );
  const createdTodo = await req(s.app, 'POST', `/api/projects/${id}/todos`, {
    title: 'Build on dev',
    spec: 'Build from the configured base',
  });
  const task = (await createdTodo.json()) as { id: string };
  expect(
    (
      await req(s.app, 'POST', `/api/projects/${id}/builds`, {
        todoIds: [task.id],
        withPlan: false,
        assignment: { plan: null, build: { agentId: 'branch-agent' } },
      })
    ).status,
  ).toBe(201);
  const claimed = await s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await claimed.json()) as { step: unknown };
  expect(claimedStepSchema.parse(body.step).project?.repo).toMatchObject({ baseBranch: 'dev' });
});

function githubWorld(baseRef = 'dev', mergeableState = 'clean') {
  const requests: { url: string; method: string }[] = [];
  const head = 'a'.repeat(40);
  const fetch: FetchLike = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push({ url, method });
    let body: unknown = [];
    if (url.endsWith('/pulls/1'))
      body = {
        number: 1,
        state: 'open',
        merged: false,
        title: 'Build on dev',
        author_association: 'OWNER',
        user: { login: 'octo', type: 'User' },
        mergeable: mergeableState !== 'dirty',
        mergeable_state: mergeableState,
        head: { ref: conversationBranch('branch-build'), sha: head, repo: { id: 1 } },
        base: { ref: baseRef, repo: { id: 1, default_branch: 'main' } },
      };
    if (method === 'PUT') body = { merged: true, sha: 'b'.repeat(40) };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  const s = bootServer({ githubFetch: fetch });
  s.db
    .insert(project)
    .values({
      id: 'branch-project',
      teamId: s.team.id,
      name: 'Branches',
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  s.db
    .insert(agent)
    .values({
      id: 'branch-agent',
      teamId: s.team.id,
      displayName: 'Builder',
      tools: ['合并分支', '推送分支'],
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'branch-todo',
      projectId: 'branch-project',
      teamId: s.team.id,
      title: 'Build on dev',
      seqNum: 1,
      phase: 'review',
      phaseAt: Date.now(),
      latestBuildId: 'branch-build',
      hasChanges: true,
      assignment: { plan: null, build: { agentId: 'branch-agent' } },
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'branch-build',
      todoId: 'branch-todo',
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now(),
      prNumber: 1,
      prUrl: 'https://github.com/octo/demo/pull/1',
    })
    .run();
  s.db
    .insert(step)
    .values({
      id: 'branch-step',
      buildId: 'branch-build',
      kind: 'build',
      status: 'done',
      checkpointCommit: head,
      createdAt: Date.now(),
    })
    .run();
  upsertGithubConnection(
    { db: s.db, box: s.secretBox },
    {
      teamId: s.team.id,
      login: 'octo',
      accessToken: 'test-token',
      scope: 'repo',
    },
  );
  return { s, requests, fetch };
}

test('a GitHub PR targeting the configured dev branch passes the base check', async () => {
  const { s, requests, fetch } = githubWorld();
  await req(s.app, 'PATCH', '/api/projects/branch-project', { baseBranch: 'dev' });
  await expect(
    requestMerge({ ...s.svc, box: s.secretBox, githubFetch: fetch }, 'branch-build'),
  ).resolves.toEqual({ delegated: true });
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
});

test('a GitHub PR targeting main is refused when the configured base is dev', async () => {
  const { s, requests, fetch } = githubWorld('main');
  await req(s.app, 'PATCH', '/api/projects/branch-project', { baseBranch: 'dev' });
  await expect(
    requestMerge({ ...s.svc, box: s.secretBox, githubFetch: fetch }, 'branch-build'),
  ).rejects.toThrow('dev');
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
});

test('the CI conflict round merges origin/dev when the project base is dev', async () => {
  const { s, fetch } = githubWorld('dev', 'dirty');
  await req(s.app, 'PATCH', '/api/projects/branch-project', { baseBranch: 'dev' });
  const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: fetch });
  await poller.sweep();
  const fix = s.db
    .select()
    .from(step)
    .all()
    .find((row) => row.status === 'pending' && row.kind === 'build');
  expect(fix?.prompt).toContain("git merge 'origin/dev'");
  expect(
    s.db
      .select()
      .from(message)
      .all()
      .map((row) => row.content)
      .join('\n'),
  ).not.toContain('origin/main');
});

test('GitHub project branches come from the upstream branches endpoint', async () => {
  const requests: string[] = [];
  const githubFetch: FetchLike = async (input) => {
    const url = String(input);
    requests.push(url);
    const body = url.includes('/branches?')
      ? [{ name: 'main' }, { name: 'dev' }]
      : { default_branch: 'main' };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  const s = bootServer({ githubFetch });
  s.db
    .insert(project)
    .values({
      id: 'github-branches',
      name: 'Branches',
      teamId: s.team.id,
      repoKind: 'github',
      githubRepo: 'octo/demo',
    })
    .run();
  const response = await req(s.app, 'GET', '/api/projects/github-branches/branches');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    defaultBranch: 'main',
    branches: [
      { name: 'main', isDefault: true },
      { name: 'dev', isDefault: false },
    ],
  });
  expect(requests).toContain('https://api.github.com/repos/octo/demo/branches?per_page=100&page=1');
});

for (const baseBranch of [
  '',
  '--upload-pack=command',
  'HEAD',
  '@',
  'dev..next',
  'dev.lock',
  'dev@{1}',
  'dev\\next',
  '/dev',
  'dev/',
  'dev name',
]) {
  test(`rejects invalid Git base branch ${JSON.stringify(baseBranch)} without changing the project`, async () => {
    const s = bootServer();
    const created = await req(s.app, 'POST', '/api/projects', { name: 'branches' });
    const { id } = (await created.json()) as { id: string };
    const response = await req(s.app, 'PATCH', `/api/projects/${id}`, { baseBranch });
    expect(response.status).toBe(400);
    expect(s.db.select().from(project).where(eq(project.id, id)).get()).toMatchObject({
      baseBranch: null,
    });
  });
}

test.each(['dev', 'release/next', 'topic./next'])(
  'accepts valid Git branch %s',
  async (baseBranch) => {
    const s = bootServer();
    const created = await req(s.app, 'POST', '/api/projects', { name: 'branches' });
    const { id } = (await created.json()) as { id: string };
    const response = await req(s.app, 'PATCH', `/api/projects/${id}`, { baseBranch });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ baseBranch });
  },
);

test('build completion looks up PRs only against the configured base', async () => {
  const { s } = githubWorld();
  await req(s.app, 'PATCH', '/api/projects/branch-project', { baseBranch: 'dev' });
  const machineId = insertMachine(s);
  s.db.update(step).set({ status: 'claimed', machineId }).where(eq(step.id, 'branch-step')).run();
  const urls: string[] = [];
  const githubFetch: FetchLike = async (input) => {
    const url = new URL(String(input));
    urls.push(url.toString());
    const body = url.pathname.endsWith('/pulls')
      ? [
          {
            number: 99,
            state: 'open',
            head: { ref: conversationBranch('branch-build'), repo: { id: 1 } },
            base: { ref: 'main', repo: { id: 1 } },
          },
          {
            number: 12,
            state: 'open',
            head: { ref: conversationBranch('branch-build'), repo: { id: 1 } },
            base: { ref: 'dev', repo: { id: 1 } },
          },
        ]
      : [];
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  await finishStep(
    {
      ...s.svc,
      box: s.secretBox,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      githubFetch,
    },
    machineId,
    'branch-step',
    { status: 'success', hasChanges: true },
  );
  const lookup = urls.find((url) => new URL(url).pathname.endsWith('/pulls'));
  expect(lookup).toBeDefined();
  expect(new URL(lookup ?? '').searchParams.get('base')).toBe('dev');
  expect(s.db.select().from(build).where(eq(build.id, 'branch-build')).get()?.prNumber).toBe(12);
});
