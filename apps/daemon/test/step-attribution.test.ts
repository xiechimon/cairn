import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test, vi } from 'vitest';
import { runGitOk, withGitCredentialFallback } from '../src/git.js';
import { publishStepCommits } from '../src/step-attribution.js';
import { testTempDir } from './test-temp-dir.js';

const bot = {
  name: 'cairnwright[bot]',
  email: '347615582+cairnwright[bot]@users.noreply.github.com',
};
const web = { name: 'GitHub', email: 'noreply@github.com' };
const human = { name: 'Human', email: '12+human@users.noreply.github.com' };
const trailer = `Co-authored-by: ${human.name} <${human.email}>`;
const closers: (() => void)[] = [];
afterEach(() => {
  for (const close of closers.splice(0)) close();
});

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
  return {
    root,
    remote,
    dir,
    git,
    commit,
    base,
    published,
    branch: await git(['branch', '--show-current']),
  };
}

async function fakeGithub(remote: string, author = bot) {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', async () => {
      requests.push(`${req.method} ${req.url} ${req.headers.authorization}`);
      const body = raw ? JSON.parse(raw) : null;
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST') {
        const sha = await runGitOk(
          [
            'commit-tree',
            body.tree,
            ...body.parents.flatMap((p: string) => ['-p', p]),
            '-m',
            body.message,
          ],
          { cwd: remote, env: envOf(author, web) },
        );
        res.end(JSON.stringify({ sha, author, verification: { verified: true } }));
        return;
      }
      const ref = (req.url ?? '').replace('/repos/o/r/git/', '');
      if (req.method === 'PATCH') await runGitOk(['update-ref', ref, body.sha], { cwd: remote });
      if (req.method === 'DELETE') await runGitOk(['update-ref', '-d', ref], { cwd: remote });
      res.statusCode = req.method === 'DELETE' ? 204 : 200;
      res.end(req.method === 'DELETE' ? '' : '{}');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  closers.push(() => server.close());
  return { apiBase: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

test.each([null, human])(
  'a repository outside GitHub gets the software identity and trailer on unpublished commits only: %j',
  async (coAuthor) => {
    const w = await workspace();
    await w.commit('one');
    await w.commit('two', undefined, coAuthor ? `two\n\n${trailer}` : 'two');
    for (let i = 0; i < 2; i++) {
      const published = await publishStepCommits({
        dir: w.dir,
        branch: w.branch,
        base: w.base,
        identity: bot,
        coAuthor,
        credential: null,
        github: null,
      });
      expect(published.verified).toBe(false);
      await published.release();
    }
    const log = (
      await w.git(['log', '--format=%an <%ae>|%cn <%ce>|%B%x00', `${w.published}..HEAD`])
    )
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean);
    expect(log).toHaveLength(2);
    for (const entry of log) {
      expect(entry.startsWith(`${bot.name} <${bot.email}>|${bot.name} <${bot.email}>|`)).toBe(true);
      expect(entry.match(/Co-authored-by:/g)?.length ?? 0).toBe(coAuthor ? 1 : 0);
    }
    expect(await w.git(['rev-parse', 'HEAD~2'])).toBe(w.published);
    expect(await w.git(['log', '-1', '--format=%an', w.published])).toBe('Session');
  },
);

test('a GitHub repository replays unpublished commits through the API as the App, verified, then cleans up', async () => {
  const w = await workspace();
  await w.commit('one');
  await w.commit('two', { name: 'xiechimon', email: 'xiechimon@qq.com' });
  const github = await fakeGithub(w.remote);
  const published = await publishStepCommits({
    dir: w.dir,
    branch: w.branch,
    base: w.base,
    identity: bot,
    coAuthor: human,
    credential: {
      username: 'x-access-token',
      password: 'step-token',
      url: 'https://github.com/o/r.git',
      kind: 'app',
    },
    github: { owner: 'o', repo: 'r', apiBase: github.apiBase },
  });
  expect(published.verified).toBe(true);
  await runGitOk(['push', 'origin', `HEAD:refs/heads/${w.branch}`], { cwd: w.dir });
  await published.release();
  const log = (await w.git(['log', '--format=%an <%ae>|%cn <%ce>|%B%x00', `${w.published}..HEAD`]))
    .split('\0')
    .map((s) => s.trim())
    .filter(Boolean);
  expect(log).toHaveLength(2);
  for (const entry of log) {
    expect(entry.startsWith(`${bot.name} <${bot.email}>|${web.name} <${web.email}>|`)).toBe(true);
    expect(entry.endsWith(trailer)).toBe(true);
  }
  expect(await w.git(['rev-parse', 'HEAD~2'])).toBe(w.published);
  expect(await runGitOk(['for-each-ref', 'refs/cairn/publish'], { cwd: w.remote })).toBe('');
  expect(await w.git(['for-each-ref', 'refs/cairn/publish'])).toBe('');
  expect(github.requests.filter((r) => r.startsWith('POST'))).toHaveLength(2);
  expect(github.requests.every((r) => r.endsWith('Bearer step-token'))).toBe(true);
});

test('a token that commits as someone other than the App fails and leaves the branch alone', async () => {
  const w = await workspace();
  const before = await w.commit('one');
  const github = await fakeGithub(w.remote, {
    name: 'xiechimon',
    email: '157263579+xiechimon@users.noreply.github.com',
  });
  await expect(
    publishStepCommits({
      dir: w.dir,
      branch: w.branch,
      base: w.base,
      identity: bot,
      coAuthor: null,
      credential: {
        username: 'x-access-token',
        password: 'user-token',
        url: 'https://github.com/o/r.git',
        kind: 'unattributed',
      },
      github: { owner: 'o', repo: 'r', apiBase: github.apiBase },
    }),
  ).rejects.toThrow(/authored as xiechimon/);
  expect(await w.git(['rev-parse', 'HEAD'])).toBe(before);
  expect(await runGitOk(['for-each-ref', 'refs/cairn/publish'], { cwd: w.remote })).toBe('');
});

test('without an App identity a user token never publishes through the API', async () => {
  const w = await workspace();
  const before = await w.commit('one');
  const github = await fakeGithub(w.remote, {
    name: 'xiechimon',
    email: '157263579+xiechimon@users.noreply.github.com',
  });
  const published = await publishStepCommits({
    dir: w.dir,
    branch: w.branch,
    base: w.base,
    identity: null,
    coAuthor: null,
    credential: {
      username: 'x-access-token',
      password: 'user-token',
      url: 'https://github.com/o/r.git',
      kind: 'unattributed',
    },
    github: { owner: 'o', repo: 'r', apiBase: github.apiBase },
  });
  expect(published.verified).toBe(false);
  expect(github.requests).toEqual([]);
  expect(await w.git(['rev-parse', 'HEAD'])).toBe(before);
});

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });

test('no product source builds a synthetic commit identity', () => {
  for (const file of [
    ...sourceFiles(fileURLToPath(new URL('../src', import.meta.url))),
    ...sourceFiles(fileURLToPath(new URL('../../server/src/services', import.meta.url))),
  ]) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toMatch(/@cairn\.local|cairn@localhost|cairn@users\.noreply/);
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
