import type { ClaimedStep } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { agent, build, step, todo } from '../src/db/schema.js';
import { runGit, systemGitOps } from '../src/lib/git.js';
import { requestMerge } from '../src/services/builds.js';
import { applyMergeLanding } from '../src/services/machine-merge-landing.js';
import { bindAllAgents, bootServer, issueApiKey, req } from './helpers.js';

async function mergeWorld() {
  const s = bootServer();
  const response = await req(s.app, 'POST', '/api/projects', {
    name: 'pinned',
    repoKind: 'hosted',
  });
  const project = (await response.json()) as { id: string; repoName: string };
  const dir = `${s.reposDir}/${s.team.id}/${project.repoName}.git`;
  const main = await systemGitOps.resolveCommit(dir, 'refs/heads/main');
  if (main === null) throw new Error('main missing');
  await systemGitOps.updateBranchRef(dir, 'dev', main);
  await req(s.app, 'PATCH', `/api/projects/${project.id}`, { baseBranch: 'dev' });
  s.db
    .insert(agent)
    .values({
      id: 'builder',
      teamId: s.team.id,
      displayName: 'Builder',
      tools: ['合并分支', '推送分支'],
    })
    .run();
  s.db
    .insert(todo)
    .values({
      id: 'task',
      teamId: s.team.id,
      projectId: project.id,
      title: 'Merge',
      seqNum: 1,
      phase: 'review',
      phaseAt: Date.now(),
      latestBuildId: 'build',
      assignment: { plan: null, build: { agentId: 'builder' } },
    })
    .run();
  s.db
    .insert(build)
    .values({
      id: 'build',
      todoId: 'task',
      withPlan: false,
      triggerSource: 'user',
      createdAt: Date.now(),
    })
    .run();
  const tree = await runGit(['rev-parse', `${main}^{tree}`], { cwd: dir });
  const result = await runGit(
    ['commit-tree', tree.stdout.toString('utf8').trim(), '-p', main, '-m', 'merge result'],
    {
      cwd: dir,
      env: {
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
      },
    },
  );
  if (result.code !== 0) throw new Error(result.stderr);
  const commit = result.stdout.toString('utf8').trim();
  await requestMerge({ ...s.svc, reposDir: s.reposDir }, 'build');
  const merge = s.db.select().from(step).where(eq(step.buildId, 'build')).get();
  if (merge === undefined) throw new Error('merge step missing');
  const deps = {
    ...s.svc,
    reposDir: s.reposDir,
    attachmentsDir: s.attachmentsDir,
    box: s.secretBox,
  };
  return { s, project, dir, main, commit, merge, deps };
}

test.each(['main', 'new-base'])(
  'landing refuses a base changed to %s after enqueue without advancing or creating refs',
  async (baseBranch) => {
    const w = await mergeWorld();
    try {
      await req(w.s.app, 'PATCH', `/api/projects/${w.project.id}`, { baseBranch });
      expect(await applyMergeLanding(w.deps, w.merge, w.commit)).toContain('base changed');
      expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/main')).toBe(w.main);
      expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/dev')).toBe(w.main);
      expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/new-base')).toBeNull();
    } finally {
      w.s.dispose();
    }
  },
);

test('landing refuses a deleted pinned base instead of recreating it', async () => {
  const w = await mergeWorld();
  try {
    await runGit(['update-ref', '-d', 'refs/heads/dev'], { cwd: w.dir });
    expect(await applyMergeLanding(w.deps, w.merge, w.commit)).toContain('dev missing');
    expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/dev')).toBeNull();
  } finally {
    w.s.dispose();
  }
});

test('the enqueued merge pins dev and lands there while main stays unchanged', async () => {
  const w = await mergeWorld();
  try {
    expect(w.merge.prompt).toContain('"baseBranch":"dev"');
    expect(await applyMergeLanding(w.deps, w.merge, w.commit)).toBeNull();
    expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/dev')).toBe(w.commit);
    expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/main')).toBe(w.main);
  } finally {
    w.s.dispose();
  }
});

test('a setting changed during landing git checks is refused before the ref write', async () => {
  const w = await mergeWorld();
  const real = systemGitOps.isAncestor.bind(systemGitOps);
  const spy = vi.spyOn(systemGitOps, 'isAncestor').mockImplementation(async (...args) => {
    await req(w.s.app, 'PATCH', `/api/projects/${w.project.id}`, { baseBranch: 'main' });
    return real(...args);
  });
  try {
    expect(await applyMergeLanding(w.deps, w.merge, w.commit)).toContain('base changed');
    expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/dev')).toBe(w.main);
    expect(await systemGitOps.resolveCommit(w.dir, 'refs/heads/main')).toBe(w.main);
  } finally {
    spy.mockRestore();
    w.s.dispose();
  }
});

test('claiming an enqueued merge keeps its pinned base in the daemon repository field', async () => {
  const w = await mergeWorld();
  try {
    const key = await issueApiKey(w.s);
    const enrolled = await w.s.app.request('/api/machine/enroll', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: w.s.team.id, name: 'pinned-builder' }),
    });
    const { token } = (await enrolled.json()) as { token: string };
    w.s.db.update(agent).set({ modelId: 'stub-model' }).where(eq(agent.id, 'builder')).run();
    bindAllAgents(w.s);
    await req(w.s.app, 'PATCH', `/api/projects/${w.project.id}`, { baseBranch: 'main' });
    const response = await w.s.app.request('/api/machine/tasks/claim', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    const claimed = (await response.json()) as { step: ClaimedStep | null };
    expect(claimed.step?.project?.repo).toMatchObject({ baseBranch: 'dev' });
    expect(claimed.step?.instruction).toContain('"baseBranch":"dev"');
  } finally {
    w.s.dispose();
  }
});
