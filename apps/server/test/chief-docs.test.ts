import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { repositoryCacheRefPrefix } from '@cairn/shared/repo-cache';
import { eq } from 'drizzle-orm';
import { describe, expect, test, vi } from 'vitest';
import { backfillRepositoryCaches } from '../../daemon/src/backend/repo-cache-backfill.js';
import { loadDaemonConfig } from '../../daemon/src/config.js';
import { gitPrim } from '../../daemon/src/git.js';
import { ensureStateDirs, statePaths } from '../../daemon/src/state.js';
import { project } from '../src/db/schema.js';
import { runGit, systemGitOps } from '../src/lib/git.js';
import type { FetchLike } from '../src/lib/github.js';
import { localWorkspaceRoot } from '../src/lib/workspace-root.js';
import { type ChiefToolDeps, executeChiefTool } from '../src/services/chief-tools.js';
import { readFile, readFiles } from '../src/services/git.js';
import { ctx, H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

const OWNED_PROCESS_PATH = resolve(import.meta.dirname, '../../../scripts/owned-process.mjs');

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
  if (kind === 'github') {
    expect(
      (
        await runGit(['remote', 'add', 'origin', 'https://github.com/fixture/repository.git'], {
          cwd: dir,
        })
      ).code,
    ).toBe(0);
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

async function fetchFixture(
  cache: string,
  source: string,
  repository = 'fixture/repository',
  backfillRoot?: string,
) {
  const url = `https://github.com/${repository}.git`;
  await gitPrim.setRemoteUrl(cache, url);
  const home = join(H.s.reposDir, `git-home-${repository.replaceAll('/', '-')}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, '.gitconfig'), `[url "${source}"]\n\tinsteadOf = ${url}\n`);
  vi.stubEnv('HOME', home);
  try {
    if (backfillRoot === undefined) await gitPrim.fetch(cache, null);
    else await backfillRepositoryCaches(backfillRoot, () => {});
  } finally {
    vi.unstubAllEnvs();
  }
}

const REPLACEMENT_SOURCE = 'replacement default branch\n';

async function replacementRepository(name: string, branch: string): Promise<string> {
  const dir = join(H.s.reposDir, name);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, 'scripts/owned-process.mjs'), REPLACEMENT_SOURCE);
  for (const args of [
    ['init', `--initial-branch=${branch}`],
    ['add', 'scripts/owned-process.mjs'],
    [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'replacement',
    ],
  ]) {
    const result = await runGit(args, { cwd: dir });
    expect(result.code, result.stderr).toBe(0);
  }
  return dir;
}

async function docs(
  paths: string[],
  ref?: string,
  over: Partial<ChiefToolDeps> = {},
): Promise<Docs> {
  return JSON.parse(
    await executeChiefTool({ ...toolDeps(), ...over }, ctx(), 'docs', {
      projectId: H.projectId,
      paths,
      ...(ref ? { ref } : {}),
    }),
  ) as Docs;
}

const API = 'https://api.github.com';
const GITHUB_COMMIT = 'a'.repeat(40);
const GITHUB_SOURCE = 'export const spawn = true;\n';

type ApiRoute = (url: URL) => { status?: number; body: unknown };

function githubApiStub(routes: Record<string, ApiRoute>) {
  const calls: string[] = [];
  const impl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    const parsed = new URL(url);
    const route =
      routes[url] ?? routes[`${parsed.pathname}${parsed.search}`] ?? routes[parsed.pathname];
    const res =
      route === undefined ? { status: 404, body: { message: 'no stub route' } } : route(parsed);
    const status = res.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => res.body,
      text: async () => JSON.stringify(res.body),
    };
  };
  return { impl, calls };
}

function contentsRoute(content: string, extra: Record<string, unknown> = {}): ApiRoute {
  return () => ({
    body: {
      type: 'file',
      size: Buffer.byteLength(content),
      encoding: 'base64',
      content: Buffer.from(content).toString('base64'),
      sha: 'c'.repeat(40),
      ...extra,
    },
  });
}

describe('Coordinator repository reads', () => {
  for (const kind of ['local', 'hosted'] as const) {
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
    await fetchFixture(cache, dir);
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
    await fetchFixture(cache, dir);
    expect((await read()).files[0]?.content).toBe('updated upstream source\n');
    expect((await read('HEAD')).files[0]?.content).toBe('export const spawn = true;\n');
    expect((await read('main')).files[0]?.content).toBe('updated upstream source\n');
    expect((await read('refs/heads/main')).files[0]?.content).toBe('updated upstream source\n');
    const originalCommit = (await runGit(['rev-parse', 'HEAD'], { cwd: cache })).stdout
      .toString()
      .trim();
    expect((await runGit(['tag', 'main', originalCommit], { cwd: cache })).code).toBe(0);
    expect((await read('main')).files[0]?.content).toBe('export const spawn = true;\n');
    expect((await read('refs/tags/main')).files[0]?.content).toBe('export const spawn = true;\n');
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

  test('retargeting the cache refreshes the default branch an omitted ref reads', async () => {
    const original = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'retarget-default-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', original, cache])).code).toBe(0);
    await fetchFixture(cache, original);
    const read = async (ref?: string) =>
      JSON.parse(
        await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
          projectId: H.projectId,
          paths: ['scripts/owned-process.mjs'],
          ...(ref ? { ref } : {}),
        }),
      ) as Docs;
    expect((await read()).files[0]?.content).toBe('export const spawn = true;\n');
    const replacement = await replacementRepository('retarget-default', 'trunk');
    const replacementCommit = (await runGit(['rev-parse', 'HEAD'], { cwd: replacement })).stdout
      .toString()
      .trim();
    H.s.db
      .update(project)
      .set({ githubRepo: 'fixture/retargeted', baseBranch: null, localPath: null })
      .where(eq(project.id, H.projectId))
      .run();
    await fetchFixture(cache, replacement, 'fixture/retargeted');
    expect((await read()).files[0]).toMatchObject({
      path: 'scripts/owned-process.mjs',
      content: REPLACEMENT_SOURCE,
      commit: replacementCommit,
    });
    expect((await read('trunk')).files[0]?.content).toBe(REPLACEMENT_SOURCE);
    expect((await read('main')).files[0]?.content).toBeUndefined();
    expect((await read('main')).files[0]?.error).toMatch(/current repository|verified repository/);
    expect((await read('refs/remotes/origin/trunk')).files[0]?.commit).toBe(replacementCommit);
    H.s.db.update(project).set({ baseBranch: 'trunk' }).where(eq(project.id, H.projectId)).run();
    expect((await read()).files[0]?.commit).toBe(replacementCommit);
  });

  test('a cache default branch left dangling by an older daemon names the refresh', async () => {
    const original = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'stale-default-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', original, cache])).code).toBe(0);
    await fetchFixture(cache, original);
    const replacement = await replacementRepository('stale-default', 'trunk');
    H.s.db
      .update(project)
      .set({ githubRepo: 'fixture/retargeted', baseBranch: null, localPath: null })
      .where(eq(project.id, H.projectId))
      .run();
    await fetchFixture(cache, replacement, 'fixture/retargeted');
    expect(
      (
        await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main'], {
          cwd: cache,
        })
      ).code,
    ).toBe(0);
    const result = JSON.parse(
      await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
        projectId: H.projectId,
        paths: ['scripts/owned-process.mjs'],
      }),
    ) as Docs;
    expect(result.files[0]?.content).toBeUndefined();
    expect(result.files[0]?.error).toMatch(/cache default branch is missing.*re-prepare/);
  });

  test.each(['docs', 'file', 'files'] as const)(
    '%s rejects refs retained from the previous cache binding',
    async (entry) => {
      const dir = await bindRepo('github');
      const workspacesDir = join(H.s.reposDir, 'retarget-workspaces');
      const cache = join(workspacesDir, H.projectId, 'repo');
      mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
      expect((await runGit(['clone', dir, cache])).code).toBe(0);
      const oldCommit = (await runGit(['rev-parse', 'HEAD'], { cwd: cache })).stdout
        .toString()
        .trim();
      expect((await runGit(['tag', 'retired', oldCommit], { cwd: cache })).code).toBe(0);
      expect((await runGit(['branch', 'retired', oldCommit], { cwd: cache })).code).toBe(0);
      const replacement = join(H.s.reposDir, 'replacement');
      mkdirSync(join(replacement, 'scripts'), { recursive: true });
      writeFileSync(join(replacement, 'scripts/owned-process.mjs'), 'replacement repository\n');
      for (const args of [
        ['init', '--initial-branch=main'],
        ['add', 'scripts/owned-process.mjs'],
        [
          '-c',
          'user.name=Fixture',
          '-c',
          'user.email=fixture@example.test',
          'commit',
          '-m',
          'replacement',
        ],
      ]) {
        expect((await runGit(args, { cwd: replacement })).code).toBe(0);
      }
      expect(
        (
          await runGit(
            ['remote', 'set-url', 'origin', 'https://github.com/fixture/replacement.git'],
            { cwd: cache },
          )
        ).code,
      ).toBe(0);
      expect(
        (
          await runGit(['fetch', '--prune', replacement, '+refs/heads/*:refs/remotes/origin/*'], {
            cwd: cache,
          })
        ).code,
      ).toBe(0);
      await fetchFixture(cache, replacement, 'fixture/replacement');
      H.s.db
        .update(project)
        .set({ githubRepo: 'fixture/replacement', localPath: null })
        .where(eq(project.id, H.projectId))
        .run();
      const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, discloseLocalPath: true };
      expect(
        (await readFile(repo, H.projectId, 'scripts/owned-process.mjs', 'refs/remotes/origin/main'))
          .content,
      ).toBe('replacement repository\n');
      for (const ref of ['HEAD', 'retired', 'refs/heads/retired', oldCommit]) {
        if (entry === 'docs') {
          const result = JSON.parse(
            await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
              projectId: H.projectId,
              paths: ['scripts/owned-process.mjs'],
              ref,
            }),
          ) as Docs;
          expect(result.files[0]?.content).toBeUndefined();
          expect(result.files[0]?.error).toMatch(/current repository|verified repository/);
        } else {
          const reads = {
            file: () => readFile(repo, H.projectId, 'scripts/owned-process.mjs', ref),
            files: () => readFiles(repo, H.projectId, ref),
          };
          await expect(reads[entry]()).rejects.toMatchObject({ status: 403 });
        }
      }
    },
  );

  test('live legacy cache: no base branch and obsolete localPath read exact source after daemon backfill', async () => {
    const source = await bindRepo('github');
    const content = readFileSync(OWNED_PROCESS_PATH, 'utf8');
    writeFileSync(join(source, 'scripts/owned-process.mjs'), content);
    for (const args of [
      ['add', 'scripts/owned-process.mjs'],
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '-m',
        'actual source',
      ],
    ])
      expect((await runGit(args, { cwd: source })).code).toBe(0);
    const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: source })).stdout.toString().trim();
    const workspacesDir = join(H.s.reposDir, 'legacy-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', source, cache])).code).toBe(0);
    await gitPrim.setRemoteUrl(cache, 'https://github.com/fixture/repository.git');
    H.s.db
      .update(project)
      .set({ baseBranch: null, localPath: '/Users/fixture/obsolete/project' })
      .where(eq(project.id, H.projectId))
      .run();
    const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, discloseLocalPath: true };
    const read = async () =>
      JSON.parse(
        await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
          projectId: H.projectId,
          paths: ['scripts/owned-process.mjs'],
        }),
      ) as Docs;
    const pending = await read();
    expect(pending.files[0]?.content).toBeUndefined();
    expect(pending.files[0]?.error).toMatch(/repository cache not verified yet.*restart.*daemon/);
    for (const operation of [
      () => readFile(repo, H.projectId, 'scripts/owned-process.mjs'),
      () => readFiles(repo, H.projectId),
    ])
      await expect(operation()).rejects.toMatchObject({
        status: 403,
        message: expect.stringContaining('repository cache not verified yet'),
      });
    await fetchFixture(cache, source, 'fixture/repository', workspacesDir);
    expect((await read()).files[0]).toMatchObject({
      path: 'scripts/owned-process.mjs',
      content,
      commit,
    });
    expect(await readFile(repo, H.projectId, 'scripts/owned-process.mjs')).toMatchObject({
      content,
      commit,
    });
    expect((await readFiles(repo, H.projectId)).commit).toBe(commit);
  });

  test('failed daemon backfill keeps an actionable refusal until a later pass succeeds', async () => {
    const source = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'failed-backfill');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', source, cache])).code).toBe(0);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, discloseLocalPath: true };
    await fetchFixture(
      cache,
      join(H.s.reposDir, 'absent-remote'),
      'fixture/repository',
      workspacesDir,
    );
    await expect(readFile(repo, H.projectId, 'scripts/owned-process.mjs')).rejects.toMatchObject({
      status: 403,
      message: expect.stringMatching(/repository cache not verified yet.*restart.*daemon/),
    });
    await fetchFixture(cache, source, 'fixture/repository', workspacesDir);
    expect((await readFile(repo, H.projectId, 'scripts/owned-process.mjs')).content).toBe(
      'export const spawn = true;\n',
    );
  });

  test('legacy and failed-retarget caches fail closed until the current origin is fetched', async () => {
    const dir = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'unverified-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', dir, cache])).code).toBe(0);
    await gitPrim.setRemoteUrl(cache, 'https://github.com/fixture/repository.git');
    H.s.db.update(project).set({ localPath: null }).where(eq(project.id, H.projectId)).run();
    const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, discloseLocalPath: true };
    await expect(readFile(repo, H.projectId, 'scripts/owned-process.mjs')).rejects.toMatchObject({
      status: 403,
    });
    await fetchFixture(cache, dir);
    expect((await readFile(repo, H.projectId, 'scripts/owned-process.mjs')).content).toBe(
      'export const spawn = true;\n',
    );
    H.s.db
      .update(project)
      .set({ githubRepo: 'fixture/replacement' })
      .where(eq(project.id, H.projectId))
      .run();
    await gitPrim.setRemoteUrl(cache, 'https://github.com/fixture/replacement.git');
    const missing = join(H.s.reposDir, 'missing-replacement');
    await expect(fetchFixture(cache, missing, 'fixture/replacement')).rejects.toThrow(
      'git fetch failed',
    );
    for (const ref of ['HEAD', 'refs/remotes/origin/main']) {
      await expect(
        readFile(repo, H.projectId, 'scripts/owned-process.mjs', ref),
      ).rejects.toMatchObject({ status: 403 });
    }
  });

  test('verified tag-only history and colliding tags resolve to the current origin', async () => {
    const dir = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'tag-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', dir, cache])).code).toBe(0);
    expect((await runGit(['tag', 'release'], { cwd: cache })).code).toBe(0);
    expect((await runGit(['checkout', '--orphan', 'tag-only'], { cwd: dir })).code).toBe(0);
    writeFileSync(join(dir, 'scripts/owned-process.mjs'), 'tag-only content\n');
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
            'tag-only',
          ],
          { cwd: dir },
        )
      ).code,
    ).toBe(0);
    const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.toString().trim();
    expect(
      (
        await runGit(
          [
            '-c',
            'user.name=Fixture',
            '-c',
            'user.email=fixture@example.test',
            'tag',
            '-a',
            'release',
            '-m',
            'fixture tag',
          ],
          { cwd: dir },
        )
      ).code,
    ).toBe(0);
    expect((await runGit(['checkout', 'main'], { cwd: dir })).code).toBe(0);
    expect((await runGit(['branch', '-D', 'tag-only'], { cwd: dir })).code).toBe(0);
    await fetchFixture(cache, dir);
    H.s.db.update(project).set({ localPath: null }).where(eq(project.id, H.projectId)).run();
    const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, discloseLocalPath: true };
    for (const ref of ['release', 'refs/tags/release', commit]) {
      expect(await readFile(repo, H.projectId, 'scripts/owned-process.mjs', ref)).toMatchObject({
        commit,
        content: 'tag-only content\n',
      });
    }
    expect((await runGit(['tag', '-d', 'release'], { cwd: dir })).code).toBe(0);
    await fetchFixture(cache, dir);
    await expect(
      readFile(repo, H.projectId, 'scripts/owned-process.mjs', commit),
    ).rejects.toMatchObject({ status: 403 });
    expect(
      (
        await runGit(
          [
            'for-each-ref',
            '--format=%(refname)',
            `${repositoryCacheRefPrefix('https://github.com/fixture/repository.git')}/tags/`,
          ],
          { cwd: cache },
        )
      ).stdout
        .toString()
        .trim(),
    ).toBe('');
  });

  for (const withCacheRoot of [false, true]) {
    test.each(['docs', 'file', 'files'] as const)(
      `%s never uses a GitHub localPath when its cache is unavailable (root=${withCacheRoot})`,
      async (entry) => {
        const dir = await bindRepo('github');
        const oldCommit = (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout
          .toString()
          .trim();
        expect((await runGit(['tag', 'retained'], { cwd: dir })).code).toBe(0);
        await gitPrim.setRemoteUrl(dir, 'https://github.com/fixture/replacement.git');
        H.s.db
          .update(project)
          .set({ githubRepo: 'fixture/replacement' })
          .where(eq(project.id, H.projectId))
          .run();
        const workspaces = withCacheRoot
          ? { workspacesDir: join(H.s.reposDir, 'absent-workspaces') }
          : {};
        const api = githubApiStub({});
        const repo = {
          db: H.s.db,
          reposDir: H.s.reposDir,
          githubFetch: api.impl,
          discloseLocalPath: true,
          ...workspaces,
        };
        for (const ref of ['HEAD', 'retained', 'refs/heads/main', oldCommit]) {
          if (entry === 'docs') {
            const result = await docs(['scripts/owned-process.mjs'], ref, {
              githubFetch: api.impl,
              ...workspaces,
            });
            expect(result.files[0]?.content).toBeUndefined();
            expect(result.files[0]?.error).toMatch(/not found/i);
          } else {
            const reads = {
              file: () => readFile(repo, H.projectId, 'scripts/owned-process.mjs', ref),
              files: () => readFiles(repo, H.projectId, ref),
            };
            await expect(reads[entry]()).rejects.toMatchObject({ status: 404 });
          }
        }
        expect(api.calls.length).toBeGreaterThan(0);
      },
    );
  }

  test.each([
    { origin: 'https://github.com/fixture/repository.git', allowed: true },
    { origin: 'git@github.com:fixture/repository.git', allowed: true },
    { origin: 'ssh://git@github.com/fixture/repository.git', allowed: true },
    { origin: 'git://github.com/fixture/repository.git', allowed: true },
    { origin: 'http://github.com/fixture/repository.git', allowed: true },
    { origin: 'https://GitHub.com/FiXtUrE/RePoSiToRy.git/', allowed: true },
    { origin: 'ssh://git@github.example/fixture/repository.git', allowed: false },
    { origin: 'git://github.com/other/repository.git', allowed: false },
    { origin: 'http://github.com/fixture/other.git', allowed: false },
    { origin: '', allowed: false },
  ])('cache: validates normalized origin $origin', async ({ origin, allowed }) => {
    const dir = await bindRepo('github');
    const workspacesDir = join(H.s.reposDir, 'workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', dir, cache])).code).toBe(0);
    await fetchFixture(cache, dir);
    H.s.db.update(project).set({ localPath: null }).where(eq(project.id, H.projectId)).run();
    expect(
      (
        await runGit(['remote', 'set-url', 'origin', origin], {
          cwd: cache,
        })
      ).code,
    ).toBe(0);
    const result = JSON.parse(
      await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
        projectId: H.projectId,
        paths: ['scripts/owned-process.mjs'],
      }),
    ) as Docs;
    if (allowed) {
      expect(result.files[0]).toMatchObject({
        content: 'export const spawn = true;\n',
        commit: (await runGit(['rev-parse', 'HEAD'], { cwd: dir })).stdout.toString().trim(),
      });
    } else {
      expect(result.files[0]?.error).toMatch(/identity mismatch/);
      expect(result.files[0]?.content).toBeUndefined();
    }
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
    await fetchFixture(cache, dir);
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

  test('local: omitted ref reads configured base, not the feature checkout', async () => {
    const dir = await bindRepo('local');
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

  test('missing local directory and missing file/ref remain visible per path', async () => {
    await bindRepo('local');
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
      /local repo path not found/i,
    );
  });

  test('credential restrictions apply to Coordinator reads, not lower-level Git reads', async () => {
    await bindRepo('local');
    const file = await readFile(
      { db: H.s.db, reposDir: H.s.reposDir, discloseLocalPath: true },
      H.projectId,
      '.env',
    );
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
      .set({ repoKind: 'local', githubRepo: null, localPath: dir })
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

  test('reads the actual owned-process source through the Coordinator cache executor', async () => {
    const source = await bindRepo('github');
    writeFileSync(join(source, 'scripts/owned-process.mjs'), readFileSync(OWNED_PROCESS_PATH));
    for (const args of [
      ['add', 'scripts/owned-process.mjs'],
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        'commit',
        '-m',
        'actual source',
      ],
      ['checkout', '--detach'],
      ['update-ref', '-d', 'refs/heads/main'],
    ]) {
      const result = await runGit(args, { cwd: source });
      expect(result.code, result.stderr).toBe(0);
    }
    const commit = (await runGit(['rev-parse', 'HEAD'], { cwd: source })).stdout.toString().trim();
    const refs = await runGit(['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/tags'], {
      cwd: source,
    });
    expect(refs.stdout.toString().trim()).toBe('');
    const workspacesDir = join(H.s.reposDir, 'actual-source-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', '--no-checkout', source, cache])).code).toBe(0);
    await fetchFixture(cache, source, 'xiechimon/cairn');
    H.s.db
      .update(project)
      .set({ repoKind: 'github', githubRepo: 'xiechimon/cairn', localPath: null })
      .where(eq(project.id, H.projectId))
      .run();
    const read = async () =>
      JSON.parse(
        await executeChiefTool({ ...toolDeps(), workspacesDir }, ctx(), 'docs', {
          projectId: H.projectId,
          paths: ['scripts/owned-process.mjs'],
          ref: 'HEAD',
        }),
      ) as Docs;
    const unverified = await read();
    expect(unverified.files[0]?.content).toBeUndefined();
    expect(unverified.files[0]?.error).toMatch(/repository cache not verified yet/);
    expect(
      (await runGit(['update-ref', 'refs/heads/cache-source', commit], { cwd: source })).code,
    ).toBe(0);
    writeFileSync(join(source, 'scripts/owned-process.mjs'), 'uncommitted fixture replacement\n');
    await fetchFixture(cache, source, 'xiechimon/cairn');
    const result = await read();
    expect(result.files[0]?.content).toBe(readFileSync(OWNED_PROCESS_PATH, 'utf8'));
    expect(result.files[0]?.commit).toBe(commit);
  });
});

describe('Coordinator reads of a GitHub project without a local cache', () => {
  const path = 'scripts/owned-process.mjs';
  const contentsUrl = `${API}/repos/fixture/repository/contents/${path}?ref=${GITHUB_COMMIT}`;

  test('docs reads the base branch through the GitHub API instead of the absent cache', async () => {
    const dir = await bindRepo('github');
    writeFileSync(join(dir, path), 'local checkout content\n');
    H.s.db
      .update(project)
      .set({ localPath: '/different-machine/repo' })
      .where(eq(project.id, H.projectId))
      .run();
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits/main`]: () => ({ body: { sha: GITHUB_COMMIT } }),
      [contentsUrl]: contentsRoute(GITHUB_SOURCE),
    });
    const result = await docs([path], undefined, {
      workspacesDir: join(H.s.reposDir, 'no-cache-here'),
      githubFetch: api.impl,
    });
    expect(result.files[0]).toMatchObject({
      path,
      commit: GITHUB_COMMIT,
      encoding: 'utf-8',
      content: GITHUB_SOURCE,
    });
    expect(api.calls).toEqual([`${API}/repos/fixture/repository/commits/main`, contentsUrl]);
  });

  test('docs falls back to the repository default branch when the project has no base branch', async () => {
    await bindRepo('github');
    H.s.db
      .update(project)
      .set({ baseBranch: null, localPath: null })
      .where(eq(project.id, H.projectId))
      .run();
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits?per_page=1`]: () => ({
        body: [{ sha: GITHUB_COMMIT }],
      }),
      [contentsUrl]: contentsRoute(GITHUB_SOURCE),
    });
    const result = await docs([path], undefined, { githubFetch: api.impl });
    expect(result.files[0]).toMatchObject({ commit: GITHUB_COMMIT, content: GITHUB_SOURCE });
    expect(api.calls[0]).toBe(`${API}/repos/fixture/repository/commits?per_page=1`);
  });

  test('an explicit ref resolves through the GitHub API and reads that commit', async () => {
    await bindRepo('github');
    const releaseCommit = 'd'.repeat(40);
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits/release`]: () => ({ body: { sha: releaseCommit } }),
      [`${API}/repos/fixture/repository/contents/${path}?ref=${releaseCommit}`]:
        contentsRoute('release content\n'),
    });
    const result = await readFile(
      { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl, discloseLocalPath: true },
      H.projectId,
      path,
      'refs/tags/release',
    );
    expect(result).toMatchObject({ ref: 'refs/tags/release', commit: releaseCommit });
    expect(result.content).toBe('release content\n');
  });

  test('binary content comes back base64-encoded like the cache path', async () => {
    await bindRepo('github');
    const bytes = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits/main`]: () => ({ body: { sha: GITHUB_COMMIT } }),
      [contentsUrl]: () => ({
        body: {
          type: 'file',
          size: bytes.byteLength,
          encoding: 'base64',
          content: bytes.toString('base64'),
          sha: 'e'.repeat(40),
        },
      }),
    });
    expect(
      await readFile(
        { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl, discloseLocalPath: true },
        H.projectId,
        path,
      ),
    ).toMatchObject({ encoding: 'base64', content: bytes.toString('base64'), size: 4 });
  });

  test('an oversized document is refused before the blob is fetched', async () => {
    await bindRepo('github');
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits/main`]: () => ({ body: { sha: GITHUB_COMMIT } }),
      [contentsUrl]: () => ({
        body: { type: 'file', size: 8 * 1024 * 1024, encoding: 'none', sha: 'f'.repeat(40) },
      }),
    });
    const result = await docs([path], undefined, { githubFetch: api.impl });
    expect(result.files[0]?.error).toMatch(/too large|limit/i);
    expect(api.calls.some((call) => call.includes('/git/blobs/'))).toBe(false);
  });

  test('a path missing at the commit reports the file and ref', async () => {
    await bindRepo('github');
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits/main`]: () => ({ body: { sha: GITHUB_COMMIT } }),
    });
    const result = await docs([path], undefined, { githubFetch: api.impl });
    expect(result.files[0]?.error).toBe(`file ${path} at ref main of fixture/repository not found`);
    expect(result.files[0]?.content).toBeUndefined();
  });

  test('a refused GitHub read names the project and asks for a connection', async () => {
    await bindRepo('github');
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits/main`]: () => ({
        status: 401,
        body: { message: 'Bad credentials' },
      }),
    });
    const result = await docs([path], undefined, { githubFetch: api.impl });
    expect(result.files[0]?.error).toMatch(
      /GitHub refused to read ref main of fixture\/repository/,
    );
    await expect(
      readFile(
        { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl, discloseLocalPath: true },
        H.projectId,
        path,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  test('the file listing reads the GitHub tree and honours the limit', async () => {
    await bindRepo('github');
    const tree = {
      tree: [
        { path: 'scripts', type: 'tree' },
        { path, type: 'blob', size: 26 },
        { path: 'vendor', type: 'commit' },
      ],
    };
    const api = githubApiStub({
      [`${API}/repos/fixture/repository/commits?per_page=1`]: () => ({
        body: [{ sha: GITHUB_COMMIT }],
      }),
      [`${API}/repos/fixture/repository/git/trees/${GITHUB_COMMIT}?recursive=1`]: () => ({
        body: tree,
      }),
    });
    const repo = {
      db: H.s.db,
      reposDir: H.s.reposDir,
      githubFetch: api.impl,
      discloseLocalPath: true,
    };
    expect(await readFiles(repo, H.projectId)).toEqual({
      ref: 'HEAD',
      commit: GITHUB_COMMIT,
      truncated: false,
      files: [
        { path: 'scripts', type: 'tree', size: null },
        { path, type: 'blob', size: 26 },
      ],
    });
    expect(await readFiles(repo, H.projectId, undefined, '1')).toMatchObject({
      truncated: true,
      files: [{ path: 'scripts', type: 'tree', size: null }],
    });
  });
});
