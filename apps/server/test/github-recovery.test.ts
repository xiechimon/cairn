import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { autonomousMergeAdmission, build, project, todo } from '../src/db/schema.js';
import { createCiPoller } from '../src/services/ci-loop.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { prepareRecoveryBranch } from '../src/services/github-recovery.js';
import { bootServer, postProject } from './helpers.js';

test('recovery publishes one exact revert commit on a named branch and preserves later changes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'server-recovery-'));
  try {
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    writeFileSync(join(dir, 'file'), 'good\n');
    git('add', 'file');
    git('commit', '-m', 'green');
    writeFileSync(join(dir, 'file'), 'bad\n');
    git('add', 'file');
    git('commit', '-m', 'bad');
    const bad = git('rev-parse', 'HEAD');
    writeFileSync(join(dir, 'later'), 'keep\n');
    git('add', 'later');
    git('commit', '-m', 'later');
    const base = git('rev-parse', 'HEAD');
    const branch = await prepareRecoveryBranch(dir, base, bad, 'token');
    expect(branch).toBe(`cairn-recovery/${bad.slice(0, 8)}`);
    expect(git('show', `${branch}:file`)).toBe('good');
    expect(git('show', `${branch}:later`)).toBe('keep');
    expect(git('rev-list', '--count', `${base}..${branch}`)).toBe('1');
    expect(git('show', '-s', '--format=%B', branch)).toContain(`This reverts commit ${bad}`);
    expect(git('rev-parse', 'main')).toBe(base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CI polling opens and labels a recovery PR after an autonomous main merge goes red, without merging it', async () => {
  const writes: { path: string; body: unknown }[] = [];
  const sha = 'a'.repeat(40);
  let opened = false;
  let labelAttempts = 0;
  const fetchImpl: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (init?.method === 'POST') writes.push({ path, body: JSON.parse(String(init.body)) });
    if (path.endsWith('/branches/main')) return Response.json({ commit: { sha } });
    if (path.includes('/git/commits/'))
      return Response.json({ parents: [{ sha: 'b'.repeat(40) }] });
    if (path.includes('b'.repeat(40)) && path.endsWith('/check-runs'))
      return Response.json({
        check_runs: [
          {
            id: 1,
            name: 'check',
            status: 'completed',
            conclusion: 'success',
            app: { slug: 'github-actions' },
          },
        ],
      });
    if (path.endsWith('/check-runs'))
      return Response.json({
        check_runs: [
          {
            name: 'check',
            status: 'completed',
            conclusion: 'failure',
            app: { slug: 'github-actions' },
          },
        ],
      });
    if (path.endsWith('/pulls/7'))
      return Response.json({ state: 'closed', merged: true, merge_commit_sha: sha });
    if (path.includes('/compare/')) return Response.json({ status: 'identical' });
    if (path.endsWith('/issues') && init?.method !== 'POST') return Response.json([]);
    if (path.endsWith('/pulls') && init?.method !== 'POST')
      return Response.json(opened ? [{ number: 8, state: 'open' }] : []);
    if (path.endsWith('/pulls') && init?.method === 'POST') opened = true;
    if (path.endsWith('/issues/8/labels') && ++labelAttempts === 1)
      return new Response('', { status: 500 });
    return Response.json({ number: 8 });
  };
  const s = bootServer({ githubFetch: fetchImpl });
  try {
    const projectId = await postProject(s.app, 'github', { mergePolicy: 'autonomous' });
    s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'owner/repo' })
      .where(eq(project.id, projectId))
      .run();
    s.db
      .insert(todo)
      .values({
        id: 'todo-brake',
        teamId: s.team.id,
        projectId,
        title: 'merged',
        phase: 'done',
        phaseAt: 1,
        seqNum: 1,
        latestBuildId: 'build-brake',
      })
      .run();
    s.db
      .insert(build)
      .values({
        id: 'build-brake',
        todoId: 'todo-brake',
        withPlan: false,
        triggerSource: 'user',
        prNumber: 7,
        createdAt: 1,
      })
      .run();
    s.db
      .insert(autonomousMergeAdmission)
      .values({
        buildId: 'build-brake',
        teamId: s.team.id,
        state: 'merged',
        createdAt: 1,
        landedAt: 2,
      })
      .run();
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId: s.team.id, login: 'owner', accessToken: 'token', scope: 'repo' },
    );
    const poller = createCiPoller({ ...s.svc, box: s.secretBox }, { githubFetch: fetchImpl });
    await poller.sweep();
    await poller.sweep();
    expect(labelAttempts).toBe(2);
    expect(writes.filter((write) => write.path.endsWith('/pulls'))).toHaveLength(1);
    expect(writes).toContainEqual(
      expect.objectContaining({
        path: '/repos/owner/repo/pulls',
        body: expect.objectContaining({ head: `cairn-recovery/${sha.slice(0, 8)}`, base: 'main' }),
      }),
    );
    expect(writes).toContainEqual({
      path: '/repos/owner/repo/issues/8/labels',
      body: { labels: ['cairn-recovery'] },
    });
    expect(writes.some((write) => write.path.endsWith('/merge'))).toBe(false);
  } finally {
    s.dispose();
  }
});
