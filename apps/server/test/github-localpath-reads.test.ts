import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { gitPrim } from '../../daemon/src/git.js';
import { project } from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import type { FetchLike } from '../src/lib/github.js';
import { executeChiefTool } from '../src/services/chief-tools.js';
import { readFile, readFiles } from '../src/services/git.js';
import { ctx, H, registerChiefHarness, toolDeps } from './chief-harness.js';

registerChiefHarness();
beforeEach(() => {
  const home = join(H.s.reposDir, 'clean-home');
  mkdirSync(home, { recursive: true });
  vi.stubEnv('HOME', home);
});
afterEach(() => vi.unstubAllEnvs());

const BINDING = 'fixture/repository';
const BOUND_URL = `https://github.com/${BINDING}.git`;
const DOC = 'scripts/owned-process.mjs';
const A_SOURCE = 'export const origin = "repository-a";\n';
const B_SOURCE = 'export const origin = "repository-b";\n';
const API_COMMIT = 'b'.repeat(40);

async function gitOk(dir: string, args: string[]): Promise<void> {
  const r = await runGit(args, { cwd: dir });
  expect(r.code, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
}

async function shaOf(dir: string, ref: string): Promise<string> {
  const r = await runGit(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
    cwd: dir,
  });
  expect(r.code, r.stderr).toBe(0);
  return r.stdout.toString('utf8').trim();
}

async function makeSource(name: string, content: string): Promise<string> {
  const dir = join(H.s.reposDir, name);
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  writeFileSync(join(dir, DOC), content);
  for (const args of [
    ['init', '--initial-branch=main'],
    ['add', DOC],
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-m', name],
  ]) {
    await gitOk(dir, args);
  }
  return dir;
}

async function cloneSource(source: string, name: string): Promise<string> {
  const dir = join(H.s.reposDir, name);
  const r = await runGit(['clone', source, dir]);
  expect(r.code, r.stderr).toBe(0);
  return dir;
}

async function repointOrigin(dir: string, url: string, via: string): Promise<void> {
  await gitOk(dir, ['remote', 'set-url', 'origin', url]);
  await gitOk(dir, ['config', `url.${via}.insteadOf`, url]);
}

async function fetchOrigin(dir: string): Promise<void> {
  await gitOk(dir, ['fetch', 'origin']);
}

function bind(dir: string, over: { githubRepo?: string; baseBranch?: string | null } = {}): void {
  H.s.db
    .update(project)
    .set({
      repoKind: 'github',
      githubRepo: over.githubRepo ?? BINDING,
      baseBranch: over.baseBranch === undefined ? 'main' : over.baseBranch,
      localPath: dir,
      repoName: null,
    })
    .where(eq(project.id, H.projectId))
    .run();
}

function apiStub(
  commit: string,
  files: Record<string, string>,
  resolvable: string[] = [],
): { impl: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const reply = (status: number, body: unknown) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
  const impl: FetchLike = async (input) => {
    const url = String(input);
    calls.push(url);
    const u = new URL(url);
    const m = /^\/repos\/fixture\/repository\/(.+)$/.exec(u.pathname);
    const suffix = m?.[1];
    if (suffix === undefined) return reply(404, { message: 'no repo' });
    const [kind = '', ...rest] = suffix.split('/');
    if (kind === 'commits') {
      const ref = rest[0] === undefined ? undefined : decodeURIComponent(rest[0] ?? '');
      if (ref === undefined) return reply(200, [{ sha: commit }]);
      if (ref === commit || resolvable.includes(ref)) return reply(200, { sha: commit });
      return reply(404, { message: 'not found' });
    }
    if (kind === 'contents') {
      const content = files[decodeURIComponent(rest.join('/'))];
      if (content === undefined) return reply(404, { message: 'not found' });
      return reply(200, {
        type: 'file',
        size: Buffer.byteLength(content),
        encoding: 'base64',
        content: Buffer.from(content).toString('base64'),
        sha: commit,
      });
    }
    if (kind === 'git' && rest[0] === 'trees') {
      return reply(200, {
        tree: Object.entries(files).map(([path, c]) => ({
          path,
          type: 'blob',
          size: Buffer.byteLength(c),
        })),
      });
    }
    return reply(404, { message: 'no route' });
  };
  return { impl, calls };
}

type Docs = { files: { path: string; commit?: string; content?: string; error?: string }[] };

async function docsRead(
  paths: string[],
  ref?: string,
  over: Record<string, unknown> = {},
): Promise<Docs> {
  return JSON.parse(
    await executeChiefTool({ ...toolDeps(), ...over }, ctx(), 'docs', {
      projectId: H.projectId,
      paths,
      ...(ref === undefined ? {} : { ref }),
    }),
  ) as Docs;
}

describe('verified GitHub localPath reads', () => {
  test('a checkout fetched from the bound origin serves readers without the GitHub API', async () => {
    const b = await makeSource('b-origin', B_SOURCE);
    const checkout = await cloneSource(b, 'proven-checkout');
    await repointOrigin(checkout, BOUND_URL, b);
    await fetchOrigin(checkout);
    const tip = await shaOf(checkout, 'HEAD');
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: 'api-must-not-serve\n' });
    const repo = { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl };
    expect(await readFile(repo, H.projectId, DOC)).toMatchObject({
      path: DOC,
      content: B_SOURCE,
      commit: tip,
    });
    expect(await readFile(repo, H.projectId, DOC, 'main')).toMatchObject({ commit: tip });
    expect(await readFiles(repo, H.projectId)).toMatchObject({ commit: tip });
    const res = await docsRead([DOC], undefined, { githubFetch: api.impl });
    expect(res.files[0]).toMatchObject({ content: B_SOURCE, commit: tip });
    expect(api.calls).toEqual([]);
  });

  test('repointed before fetch: every ref form falls back instead of serving the retained repo', async () => {
    const a = await makeSource('a-origin', A_SOURCE);
    const shaA = await shaOf(a, 'HEAD');
    await gitOk(a, ['tag', 'v1']);
    await gitOk(a, ['branch', 'side']);
    const checkout = await cloneSource(a, 'repointed-checkout');
    await fetchOrigin(checkout);
    const b = await makeSource('b-origin', B_SOURCE);
    await repointOrigin(checkout, BOUND_URL, b);
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: B_SOURCE }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl };
    for (const ref of [undefined, 'HEAD', 'main']) {
      expect(await readFile(repo, H.projectId, DOC, ref)).toMatchObject({
        content: B_SOURCE,
        commit: API_COMMIT,
      });
    }
    for (const ref of [
      'v1',
      'side',
      'refs/tags/v1',
      'refs/heads/side',
      'refs/remotes/origin/side',
      shaA,
    ]) {
      await expect(readFile(repo, H.projectId, DOC, ref)).rejects.toMatchObject({ status: 404 });
      await expect(readFiles(repo, H.projectId, ref)).rejects.toMatchObject({ status: 404 });
    }
    const res = await docsRead([DOC], 'v1', { githubFetch: api.impl });
    expect(res.files[0]?.content).toBeUndefined();
    expect(res.files[0]?.error).toBeDefined();
    expect(JSON.stringify(res)).not.toContain('repository-a');
    expect(api.calls.length).toBeGreaterThan(0);
  });

  test('after fetching the new origin, only its fetched refs serve; retained refs fall back', async () => {
    const a = await makeSource('a-origin', A_SOURCE);
    const shaA = await shaOf(a, 'HEAD');
    await gitOk(a, ['tag', 'v1']);
    await gitOk(a, ['branch', 'side']);
    const checkout = await cloneSource(a, 'moved-checkout');
    await fetchOrigin(checkout);
    const b = await makeSource('b-origin', B_SOURCE);
    const shaB = await shaOf(b, 'HEAD');
    await repointOrigin(checkout, BOUND_URL, b);
    await fetchOrigin(checkout);
    expect(await shaOf(checkout, 'refs/remotes/origin/main')).toBe(shaB);
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: B_SOURCE }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl };
    for (const ref of [undefined, 'HEAD', 'main', 'refs/remotes/origin/main', shaB]) {
      expect(await readFile(repo, H.projectId, DOC, ref)).toMatchObject({
        content: B_SOURCE,
        commit: shaB,
      });
    }
    expect(api.calls).toEqual([]);
    for (const ref of ['v1', 'side', 'refs/remotes/origin/side', shaA]) {
      await expect(readFile(repo, H.projectId, DOC, ref)).rejects.toMatchObject({ status: 404 });
    }
    await gitOk(checkout, ['checkout', '-b', 'wip']);
    writeFileSync(join(checkout, 'wip.txt'), 'local only\n');
    await gitOk(checkout, ['add', 'wip.txt']);
    await gitOk(checkout, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'wip',
    ]);
    await expect(readFile(repo, H.projectId, DOC, 'wip')).rejects.toMatchObject({ status: 404 });
    expect(api.calls.length).toBeGreaterThan(0);
  });

  test('no recorded fetch or a fetch that failed leaves the checkout unproven', async () => {
    const b = await makeSource('b-origin', B_SOURCE);
    const neverFetched = await cloneSource(b, 'never-fetched');
    await repointOrigin(neverFetched, BOUND_URL, b);
    bind(neverFetched);
    const api = apiStub(API_COMMIT, { [DOC]: B_SOURCE }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl };
    expect(await readFile(repo, H.projectId, DOC)).toMatchObject({ commit: API_COMMIT });
    const staleAfterFailure = await cloneSource(b, 'stale-after-failure');
    await repointOrigin(staleAfterFailure, BOUND_URL, b);
    await fetchOrigin(staleAfterFailure);
    const failed = await runGit(['fetch', '/definitely-missing-cairn-source'], {
      cwd: staleAfterFailure,
    });
    expect(failed.code).not.toBe(0);
    bind(staleAfterFailure);
    expect(await readFile(repo, H.projectId, DOC)).toMatchObject({ commit: API_COMMIT });
    expect(api.calls.length).toBeGreaterThan(0);
  });

  test('a project retargeted to another repository stops serving the old checkout', async () => {
    const b = await makeSource('b-origin', B_SOURCE);
    const checkout = await cloneSource(b, 'retargeted-binding');
    await repointOrigin(checkout, BOUND_URL, b);
    await fetchOrigin(checkout);
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: B_SOURCE }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl };
    bind(checkout, { githubRepo: 'fixture/other' });
    await expect(readFile(repo, H.projectId, DOC, 'main')).rejects.toMatchObject({ status: 404 });
    expect(api.calls.length).toBeGreaterThan(0);
  });

  test('an origin that is not the bound repository falls back', async () => {
    const a = await makeSource('a-origin', A_SOURCE);
    const checkout = await cloneSource(a, 'other-bound');
    await repointOrigin(checkout, 'https://github.com/other/project.git', a);
    await fetchOrigin(checkout);
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: B_SOURCE }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, githubFetch: api.impl };
    expect(await readFile(repo, H.projectId, DOC)).toMatchObject({ commit: API_COMMIT });
    expect(api.calls.length).toBeGreaterThan(0);
  });

  test('without a cache root an unproven localPath falls back to the verified cache when one appears', async () => {
    const b = await makeSource('b-origin', B_SOURCE);
    const shaB = await shaOf(b, 'HEAD');
    const a = await makeSource('a-origin', A_SOURCE);
    const checkout = await cloneSource(a, 'cached-fallback');
    await fetchOrigin(checkout);
    await repointOrigin(checkout, BOUND_URL, b);
    const workspacesDir = join(H.s.reposDir, 'localpath-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', b, cache])).code).toBe(0);
    await gitPrim.setRemoteUrl(cache, BOUND_URL);
    const home = join(H.s.reposDir, 'cache-fetch-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, '.gitconfig'), `[url "${b}"]\n\tinsteadOf = ${BOUND_URL}\n`);
    vi.stubEnv('HOME', home);
    await gitPrim.fetch(cache, null);
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: 'api-must-not-serve\n' }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, githubFetch: api.impl };
    expect(await readFile(repo, H.projectId, DOC)).toMatchObject({
      content: B_SOURCE,
      commit: shaB,
    });
    expect(api.calls).toEqual([]);
  });

  test('a proven localPath serves newer fetched history than an older verified cache', async () => {
    const b = await makeSource('b-origin', 'export const origin = "b-old";\n');
    const oldTip = await shaOf(b, 'HEAD');
    const workspacesDir = join(H.s.reposDir, 'localpath-first-workspaces');
    const cache = join(workspacesDir, H.projectId, 'repo');
    mkdirSync(join(workspacesDir, H.projectId), { recursive: true });
    expect((await runGit(['clone', b, cache])).code).toBe(0);
    await gitPrim.setRemoteUrl(cache, BOUND_URL);
    const home = join(H.s.reposDir, 'cache-fetch-home2');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, '.gitconfig'), `[url "${b}"]\n\tinsteadOf = ${BOUND_URL}\n`);
    vi.stubEnv('HOME', home);
    await gitPrim.fetch(cache, null);
    writeFileSync(join(b, DOC), B_SOURCE);
    await gitOk(b, ['add', DOC]);
    await gitOk(b, [
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '-m',
      'newer',
    ]);
    const checkout = await cloneSource(b, 'fresher-checkout');
    await repointOrigin(checkout, BOUND_URL, b);
    await fetchOrigin(checkout);
    const tip = await shaOf(checkout, 'HEAD');
    expect(tip).not.toBe(oldTip);
    bind(checkout);
    const api = apiStub(API_COMMIT, { [DOC]: 'api-must-not-serve\n' }, ['main']);
    const repo = { db: H.s.db, reposDir: H.s.reposDir, workspacesDir, githubFetch: api.impl };
    expect(await readFile(repo, H.projectId, DOC)).toMatchObject({
      content: B_SOURCE,
      commit: tip,
    });
    expect(api.calls).toEqual([]);
  });
});
