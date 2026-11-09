import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repositoryCacheRefPrefix } from '@cairn/shared/repo-cache';
import { afterEach, expect, test, vi } from 'vitest';
import { commitEnv, gitPrim, runGitOk } from '../src/git.js';
import { testTempDir } from './test-temp-dir.js';

const identity = { name: 'Fixture', email: 'fixture@example.test' };

afterEach(() => vi.restoreAllMocks());

async function repositories() {
  const root = testTempDir('cache-identity-');
  const a = join(root, 'a');
  const b = join(root, 'b');
  const cache = join(root, 'cache');
  for (const dir of [a, b]) {
    mkdirSync(dir);
    await runGitOk(['init', '--initial-branch=main'], { cwd: dir });
    writeFileSync(join(dir, 'source.txt'), dir === a ? 'repository a' : 'repository b');
    await runGitOk(['add', 'source.txt'], { cwd: dir });
    await runGitOk(['commit', '-m', 'fixture'], { cwd: dir, env: commitEnv(identity) });
    await runGitOk(['tag', 'version'], { cwd: dir });
  }
  await gitPrim.clone(a, cache, null);
  return { root, a, b, cache };
}

test('retarget fetch binds heads and colliding tags to the new origin without deleting old work', async () => {
  const { a, b, cache } = await repositories();
  await gitPrim.fetch(cache, null);
  const oldHead = await gitPrim.head(cache);
  const currentHead = await gitPrim.head(b);
  await gitPrim.setRemoteUrl(cache, b);
  await gitPrim.fetch(cache, null);
  expect(await gitPrim.head(cache)).toBe(oldHead);
  expect(await runGitOk(['rev-parse', 'refs/tags/version'], { cwd: cache })).toBe(oldHead);
  expect(
    await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(a)}/heads/main`], { cwd: cache }),
  ).toBe(oldHead);
  for (const ref of ['heads/main', 'tags/version']) {
    expect(
      await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(b)}/${ref}`], { cwd: cache }),
    ).toBe(currentHead);
  }
});

test('failed retarget fetch cannot authorize retained refs for the new origin', async () => {
  const { root, cache } = await repositories();
  await gitPrim.fetch(cache, null);
  const missing = join(root, 'missing.git');
  await gitPrim.setRemoteUrl(cache, missing);
  await expect(gitPrim.fetch(cache, null)).rejects.toThrow('git fetch failed');
  expect(
    await runGitOk(['for-each-ref', '--format=%(refname)', repositoryCacheRefPrefix(missing)], {
      cwd: cache,
    }),
  ).toBe('');
  expect(await gitPrim.head(cache)).not.toBeNull();
});

test('fetch uses the captured URL even if the origin alias changes before the command', async () => {
  const { a, b, cache } = await repositories();
  const originConfigUrl = gitPrim.originConfigUrl;
  vi.spyOn(gitPrim, 'originConfigUrl').mockImplementationOnce(async (dir) => {
    const captured = await originConfigUrl(dir);
    await gitPrim.setRemoteUrl(dir, b);
    return captured;
  });
  await gitPrim.fetch(cache, null);
  expect(await gitPrim.originConfigUrl(cache)).toBe(b);
  expect(
    await runGitOk(['rev-parse', `${repositoryCacheRefPrefix(a)}/heads/main`], { cwd: cache }),
  ).toBe(await gitPrim.head(a));
  expect(
    await runGitOk(['for-each-ref', '--format=%(refname)', repositoryCacheRefPrefix(b)], {
      cwd: cache,
    }),
  ).toBe('');
});

test('fetch prunes verified refs removed from the same origin', async () => {
  const { a, cache } = await repositories();
  await gitPrim.fetch(cache, null);
  await runGitOk(['tag', '-d', 'version'], { cwd: a });
  await gitPrim.fetch(cache, null);
  expect(
    await runGitOk(
      ['for-each-ref', '--format=%(refname)', `${repositoryCacheRefPrefix(a)}/tags/`],
      { cwd: cache },
    ),
  ).toBe('');
});

test('cache identity normalizes GitHub transports but preserves local path case', () => {
  const canonical = repositoryCacheRefPrefix('https://github.com/fixture/repository.git');
  expect(repositoryCacheRefPrefix('ssh://git@GitHub.com/Fixture/Repository.git')).toBe(canonical);
  expect(repositoryCacheRefPrefix('git@github.com:fixture/repository.git')).toBe(canonical);
  expect(repositoryCacheRefPrefix('/case/Repo')).not.toBe(repositoryCacheRefPrefix('/case/repo'));
});
