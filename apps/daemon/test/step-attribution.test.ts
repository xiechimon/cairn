import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, vi } from 'vitest';
import { runGitOk, withGitCredentialFallback } from '../src/git.js';
import { attributeStepCommits } from '../src/step-attribution.js';
import { testTempDir } from './test-temp-dir.js';

const bot = {
  name: 'cairnwright[bot]',
  email: '347615582+cairnwright[bot]@users.noreply.github.com',
};
const human = { name: 'Human', email: '12+human@users.noreply.github.com' };
const trailer = `Co-authored-by: ${human.name} <${human.email}>`;
const userToken = {
  username: 'x-access-token',
  password: 'user-token',
  url: 'https://github.com/o/r.git',
  kind: 'unattributed' as const,
};

const envOf = (author: { name: string; email: string }, committer = author) => ({
  GIT_AUTHOR_NAME: author.name,
  GIT_AUTHOR_EMAIL: author.email,
  GIT_COMMITTER_NAME: committer.name,
  GIT_COMMITTER_EMAIL: committer.email,
});

async function workspace() {
  const root = testTempDir('step-publish-');
  const remote = join(root, 'remote');
  const dir = join(root, 'work');
  await runGitOk(['init', '--bare', remote]);
  await runGitOk(['clone', remote, dir]);
  const git = (args: string[], who = { name: 'Session', email: 'machine@cairn.example' }) =>
    runGitOk(args, { cwd: dir, env: envOf(who) });
  const commit = async (name: string, who?: { name: string; email: string }, message = name) => {
    writeFileSync(join(dir, 'a'), name);
    await git(['add', 'a'], who);
    await git(['commit', '-m', message], who);
    return git(['rev-parse', 'HEAD']);
  };
  await commit('published');
  await git(['push', 'origin', 'HEAD:work']);
  const base = await git(['rev-parse', 'HEAD']);
  await commit('published during step');
  await git(['push', 'origin', 'HEAD:refs/tags/published-step']);
  const published = await git(['rev-parse', 'HEAD']);
  const log = async () =>
    (await git(['log', '--format=%an <%ae>|%cn <%ce>|%B%x00', `${published}..HEAD`]))
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean);
  return {
    dir,
    git,
    commit,
    base,
    published,
    log,
    branch: await git(['branch', '--show-current']),
  };
}

test.each([null, userToken])(
  'unpublished commits become the App with the trailer, whatever credential pushes them: %j',
  async (credential) => {
    const w = await workspace();
    await w.commit('one');
    await w.commit('two', { name: 'xiechimon', email: 'xiechimon@qq.com' }, `two\n\n${trailer}`);
    for (let i = 0; i < 2; i++)
      await attributeStepCommits({
        dir: w.dir,
        branch: w.branch,
        base: w.base,
        identity: bot,
        coAuthor: human,
        credential,
      });
    const log = await w.log();
    expect(log).toHaveLength(2);
    for (const entry of log) {
      expect(entry.startsWith(`${bot.name} <${bot.email}>|${bot.name} <${bot.email}>|`)).toBe(true);
      expect(entry.match(/Co-authored-by:/g)?.length).toBe(1);
    }
    expect(await w.git(['rev-parse', 'HEAD~2'])).toBe(w.published);
    expect(await w.git(['log', '-1', '--format=%an', w.published])).toBe('Session');
  },
);

test('without an App identity a user token never turns step commits into that user', async () => {
  const w = await workspace();
  const before = await w.commit('one');
  await attributeStepCommits({
    dir: w.dir,
    branch: w.branch,
    base: w.base,
    identity: null,
    coAuthor: null,
    credential: userToken,
  });
  expect(await w.git(['rev-parse', 'HEAD'])).toBe(before);
  expect((await w.log())[0]?.startsWith('Session <machine@cairn.example>|')).toBe(true);
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });

test('no product source builds a synthetic commit identity or publishes commits through the API', () => {
  for (const file of [
    ...sourceFiles(fileURLToPath(new URL('../src', import.meta.url))),
    ...sourceFiles(fileURLToPath(new URL('../../server/src/services', import.meta.url))),
  ]) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/@cairn\.local|cairn@localhost|cairn@users\.noreply/);
    expect(text, file).not.toMatch(/\/git\/commits['`]/);
  }
});

test.each([false, true])(
  'App authentication refreshes once without machine fallback: %s',
  async (twice) => {
    let calls = 0;
    const op = vi.fn(async (cred) => {
      expect(cred?.kind).toBe('app');
      calls++;
      if (calls === 1 || twice) throw new Error('Authentication failed');
    });
    const refresh = vi.fn(async () => ({
      username: 'git',
      password: 'replacement',
      url: 'https://github.com/o/r',
      kind: 'app' as const,
    }));
    const result = withGitCredentialFallback(
      op,
      { username: 'git', password: 'expired', url: 'https://github.com/o/r', kind: 'app' },
      { what: 'push', allowMachineFallback: true, refresh },
    );
    if (twice) await expect(result).rejects.toThrow('Authentication failed');
    else await expect(result).resolves.toBe('integration');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(op).toHaveBeenCalledTimes(2);
  },
);
