import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { loadDaemonConfig } from '../../daemon/src/config.js';
import { ensureStateDirs, statePaths } from '../../daemon/src/state.js';
import { project } from '../src/db/schema.js';
import { runGit, systemGitOps } from '../src/lib/git.js';
import { localWorkspaceRoot } from '../src/lib/workspace-root.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { readFile } from '../src/services/git.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

type Docs = { files: { path: string; commit?: string; content?: string; error?: string }[] };

async function bindRepo(kind: 'github' | 'local' | 'hosted') {
  const dir = join(H.s.reposDir, 'docs-fixture');
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/owned-process.mjs'), 'export const spawn = true;\n');
  writeFileSync(join(dir, '.env'), 'PRIVATE_FIXTURE=not-a-real-secret\n');
  symlinkSync('/outside-project/credentials', join(dir, 'link'));
  for (const args of [
    ['init', '--initial-branch=main'],
    ['add', 'scripts/owned-process.mjs', '.env', 'link'],
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', 'fixture'],
  ]) {
    const result = await runGit(args, { cwd: dir });
    expect(result.code, result.stderr).toBe(0);
  }
  H.s.db
    .update(project)
    .set({
      repoKind: kind,
      baseBranch: 'main',
      githubRepo: kind === 'github' ? 'fixture/repository' : null,
      localPath: kind === 'hosted' ? null : dir,
      repoName: kind === 'hosted' ? 'docs' : null,
    })
    .where(eq(project.id, H.projectId))
    .run();
  if (kind === 'hosted') {
    const bare = join(H.s.reposDir, H.teamId, 'docs.git');
    mkdirSync(join(H.s.reposDir, H.teamId), { recursive: true });
    expect((await runGit(['clone', '--bare', dir, bare])).code).toBe(0);
  }
  return dir;
}

async function docs(paths: string[], ref?: string): Promise<Docs> {
  return (await relay('docs', { projectId: H.projectId, paths, ...(ref ? { ref } : {}) })) as Docs;
}

describe('Coordinator repository reads', () => {
  for (const kind of ['github', 'local', 'hosted'] as const) {
    test(`${kind}: reads committed source and returns its immutable version`, async () => {
      const dir = await bindRepo(kind);
      const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.toString().trim();
      writeFileSync(join(dir, 'scripts/owned-process.mjs'), 'uncommitted replacement');
      expect((await docs(['scripts/owned-process.mjs'])).files).toEqual([
        expect.objectContaining({
          path: 'scripts/owned-process.mjs',
          commit,
          content: 'export const spawn = true;\n',
        }),
      ]);
    });
  }

  test('github uses its identity-checked project repository cache, not another thread', async () => {
    const dir = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', dir, cache])).code).toBe(0);
    expect(
      (
        await runGit(['remote', 'set-url', 'origin', 'https://github.com/fixture/repository.git'], {
          cwd: cache,
        })
      ).code,
    ).toBe(0);
    H.s.db
      .update(project)
      .set({ localPath: '/different-machine/repo' })
      .where(eq(project.id, H.projectId))
      .run();
    const read = async (ref?: string) =>
      JSON.parse(
        await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
          projectId: H.projectId,
          paths: ['scripts/owned-process.mjs'],
          ...(ref ? { ref } : {}),
        }),
      ) as Docs;
    expect((await read()).files[0]?.content).toBe('export const spawn = true;\n');
    writeFileSync(join(dir, 'scripts/owned-process.mjs'), 'updated upstream source\n');
    expect((await runGit(['add', 'scripts/owned-process.mjs'], { cwd: dir })).code).toBe(0);
    expect(
      (
        await runGit(
          [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '-m',
            'upstream',
          ],
          { cwd: dir },
        )
      ).code,
    ).toBe(0);
    expect(
      (await runGit(['fetch', dir, 'main:refs/remotes/origin/main'], { cwd: cache })).code,
    ).toBe(0);
    expect((await read()).files[0]?.content).toBe('updated upstream source\n');
    expect((await read('main')).files[0]?.content).toBe('updated upstream source\n');
    expect((await read('refs/heads/main')).files[0]?.content).toBe('updated upstream source\n');
    expect(
      (
        await runGit(['remote', 'set-url', 'origin', 'https://github.com/other/project.git'], {
          cwd: cache,
        })
      ).code,
    ).toBe(0);
    expect((await read()).files[0]?.content).toBeUndefined();
    expect((await read()).files[0]?.error).toMatch(/repository.*mismatch/i);
  });

  test('uses the persisted daemon CLI root, including changes after server startup', async () => {
    const dir = await bindRepo('github');
    const home = join(H.s.reposDir, 'daemon-home');
    const defaultRoot = join(home, 'workspaces');
    const deps = {
      ...toolDeps(),
      get workspacesDir() {
        return localWorkspaceRoot(home, defaultRoot);
      },
    };
    expect(deps.workspacesDir).toBe(defaultRoot);
    const config = loadDaemonConfig({ home, workspacesDir: join(H.s.reposDir, 'cli-root') }, {});
    ensureStateDirs(statePaths(config.home, config.workspacesDir));
    expect(deps.workspacesDir).toBe(config.workspacesDir);
    const cache = join(config.workspacesDir, H.projectId, 'repo');
    mkdirSync(join(config.workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', dir, cache])).code).toBe(0);
    expect(
      (
        await runGit(['remote', 'set-url', 'origin', 'https://github.com/fixture/repository.git'], {
          cwd: cache,
        })
      ).code,
    ).toBe(0);
    H.s.db.update(project).set({ localPath: null }).where(eq(project.id, H.projectId)).run();
    const result = JSON.parse(
      await executeChiefTool(deps, ctx(), 'docs', {
        projectId: H.projectId,
        paths: ['scripts/owned-process.mjs'],
      }),
    ) as Docs;
    expect(result.files[0]?.content).toBe('export const spawn = true;\n');
    expect(result.files[0]?.commit).toBe(
      (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.toString().trim(),
    );
    const state = join(home, 'workspace-root.json');
    chmodSync(state, 0o644);
    expect(() => deps.workspacesDir).toThrow('unsafe local workspace root state');
    chmodSync(state, 0o600);
    writeFileSync(state, JSON.stringify({ workspacesDir: '../outside' }));
    expect(() => deps.workspacesDir).toThrow();
  });

  for (const kind of ['local', 'github'] as const) {
    test(`${kind}: omitted ref reads configured base, not the feature checkout`, async () => {
      const dir = await bindRepo(kind);
      const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.toString().trim();
      H.s.db.update(project).set({ baseBranch: 'main' }).where(eq(project.id, H.projectId)).run();
      expect((await runGit(['checkout', '-b', 'feature'], { cwd: dir })).code).toBe(0);
      writeFileSync(join(dir, 'scripts/owned-process.mjs'), 'feature source\n');
      expect((await runGit(['add', '.'], { cwd: dir })).code).toBe(0);
      expect(
        (
          await runGit(
            [
              '-c',
              'user.name=Fixture',
              '-c',
              'user.email=fixture@example.test',
              'commit',
              '-m',
              'feature',
            ],
            { cwd: dir },
          )
        ).code,
      ).toBe(0);
      expect((await docs(['scripts/owned-process.mjs'])).files[0]).toMatchObject({
        commit,
        content: 'export const spawn = true;\n',
      });
      expect((await docs(['scripts/owned-process.mjs'], 'feature')).files[0]?.content).toBe(
        'feature source\n',
      );
      H.s.db.update(project).set({ baseBranch: null }).where(eq(project.id, H.projectId)).run();
      expect((await docs(['scripts/owned-process.mjs'])).files[0]?.error).toContain(
        'default branch is unknown',
      );
      expect(
        (await runGit(['update-ref', 'refs/remotes/origin/main', commit], { cwd: dir })).code,
      ).toBe(0);
      expect(
        (
          await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], {
            cwd: dir,
          })
        ).code,
      ).toBe(0);
      expect((await docs(['scripts/owned-process.mjs'])).files[0]?.commit).toBe(commit);
    });
  }

  test('preflights oversized blobs and bounds aggregate serialized document output', async () => {
    const dir = await bindRepo('local');
    writeFileSync(join(dir, 'large.bin'), Buffer.alloc(1024 * 1024));
    writeFileSync(join(dir, 'medium.txt'), '\\'.repeat(16 * 1024));
    expect((await runGit(['add', 'large.bin', 'medium.txt'], { cwd: dir })).code).toBe(0);
    expect(
      (
        await runGit(
          [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'commit',
            '-m',
            'artifacts',
          ],
          { cwd: dir },
        )
      ).code,
    ).toBe(0);
    const read = vi.spyOn(systemGitOps, 'readFileAt');
    try {
      const result = await docs(['large.bin']);
      expect(result.files[0]?.error).toMatch(/limit|too large/i);
      expect(read).not.toHaveBeenCalled();
      const batch = await relay('docs', {
        projectId: H.projectId,
        paths: Array(24).fill('medium.txt'),
      });
      expect(Buffer.byteLength(JSON.stringify(batch))).toBeLessThanOrEqual(128 * 1024);
      expect((batch as Docs).files.some((file) => file.error !== undefined)).toBe(true);
      expect(read.mock.calls.length).toBeLessThan(24);
      for (const file of (batch as Docs).files) {
        if (file.error !== undefined) expect(file.content).toBeUndefined();
        else expect(file.content).toBe('\\'.repeat(16 * 1024));
      }
    } finally {
      read.mockRestore();
    }
  });

  test('github without a local binding reports the actual missing repository', async () => {
    H.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'fixture/repository', localPath: null })
      .where(eq(project.id, H.projectId))
      .run();
    const result = await docs(['scripts/owned-process.mjs']);
    expect(result.files[0]?.error).toMatch(/github.*repository.*unavailable/i);
    expect(result.files[0]?.error).not.toContain('hosted');
  });

  test('missing local directory and missing file/ref remain visible per path', async () => {
    await bindRepo('github');
    expect((await docs(['absent'])).files[0]?.error).toContain('file absent');
    expect((await docs(['scripts/owned-process.mjs'], 'absent-ref')).files[0]?.error).toContain(
      'ref absent-ref',
    );
    H.s.db
      .update(project)
      .set({ localPath: join(H.s.reposDir, 'missing') })
      .where(eq(project.id, H.projectId))
      .run();
    expect((await docs(['scripts/owned-process.mjs'])).files[0]?.error).toMatch(
      /repository.*unavailable/i,
    );
  });

  test('credential restrictions apply to Coordinator reads, not authenticated file browsing', async () => {
    await bindRepo('local');
    const file = await readFile({ db: H.s.db, reposDir: H.s.reposDir }, H.projectId, '.env');
    expect(file.content).toBe('PRIVATE_FIXTURE=not-a-real-secret\n');
    expect((await docs(['.env'])).files[0]?.error).toBe('credential file access denied');
  });

  test('refuses traversal and credential files without following repository symlinks', async () => {
    await bindRepo('local');
    for (const path of ['../outside', '/etc/passwd', '.git/config', '.env']) {
      const result = (await docs([path])).files[0];
      expect(result?.error).toBeDefined();
      expect(result?.content).toBeUndefined();
    }
    expect((await docs(['link'])).files[0]?.content).toBe('/outside-project/credentials');
  });

  test('a missing project, missing hosted repository, and non-repository binding are visible', async () => {
    await expect(
      relay('docs', { projectId: 'missing', paths: ['source.ts'] }),
    ).rejects.toMatchObject({ status: 404 });
    H.s.db
      .update(project)
      .set({ repoKind: 'hosted', repoName: 'missing' })
      .where(eq(project.id, H.projectId))
      .run();
    expect((await docs(['source.ts'])).files[0]?.error).toBeDefined();
    const dir = join(H.s.reposDir, 'not-git');
    mkdirSync(dir, { recursive: true });
    H.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'fixture/repository', localPath: dir })
      .where(eq(project.id, H.projectId))
      .run();
    expect((await docs(['source.ts'])).files[0]?.error).toContain('not a git repository');
  });

  test('another team cannot read a bound repository', async () => {
    await bindRepo('github');
    await expect(
      relay(
        'docs',
        { projectId: H.projectId, paths: ['scripts/owned-process.mjs'] },
        { teamId: 'other-team' },
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('reads the actual owned-process source through the Coordinator tool executor', async () => {
    H.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'xiechimon/cairn', localPath: resolve('.') })
      .where(eq(project.id, H.projectId))
      .run();
    const result = await docs(['scripts/owned-process.mjs'], 'HEAD');
    expect(result.files[0]?.content).toBe(readFileSync('scripts/owned-process.mjs', 'utf8'));
    expect(result.files[0]?.commit).toBe(
      (await runGit(['rev-parse', 'HEAD'])).stdout.toString().trim(),
    );
  });
});
