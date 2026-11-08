import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const hostRoot = resolve('scripts/ops/host');
const appToken = join(hostRoot, 'tools/app-token');
const bot = {
  name: 'cairnwright[bot]',
  email: '347615582+cairnwright[bot]@users.noreply.github.com',
};
const web = { name: 'GitHub', email: 'noreply@github.com' };
const retiredUser = {
  name: 'Cairnwright',
  email: '348051526+cairnwright@users.noreply.github.com',
};
const session = { name: 'Session', email: 'kigv1zSwiHPke_Cl5Ci6D@cairn.local' };
const coAuthor = 'Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>';
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !key.startsWith('GIT_') && key !== 'CAIRN_COAUTHOR',
  ),
);

function sh(cwd, args, env = {}) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...cleanEnv, ...env } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

const as = (identity, committer = identity) => ({
  GIT_AUTHOR_NAME: identity.name,
  GIT_AUTHOR_EMAIL: identity.email,
  GIT_COMMITTER_NAME: committer.name,
  GIT_COMMITTER_EMAIL: committer.email,
});

async function fakeGithub(t, bare) {
  const requests = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      requests.push(`${req.method} ${req.url}`);
      const body = raw ? JSON.parse(raw) : null;
      const prefix = '/repos/xiechimon/cairn';
      res.setHeader('content-type', 'application/json');
      if (req.method === 'POST' && req.url === `${prefix}/git/commits`) {
        const sha = sh(
          bare,
          ['commit-tree', body.tree, ...body.parents.flatMap((p) => ['-p', p]), '-m', body.message],
          as(bot, web),
        );
        res.end(JSON.stringify({ sha, author: bot, verification: { verified: true } }));
        return;
      }
      const ref = req.url.slice(`${prefix}/git/`.length);
      if (req.method === 'PATCH') sh(bare, ['update-ref', ref, body.sha]);
      if (req.method === 'DELETE') sh(bare, ['update-ref', '-d', ref]);
      res.statusCode = req.method === 'DELETE' ? 204 : 200;
      res.end(req.method === 'DELETE' ? '' : '{}');
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, requests };
}

function host(t) {
  const home = makeTestTempDir('identity-compat-');
  t.after(() => releaseTestTempDir(home));
  const tools = join(home, '.cairn/tools/app-token');
  mkdirSync(tools, { recursive: true });
  for (const file of ['as-bot.sh', 'as-bot-policy.mjs', 'bot-git.mjs'])
    copyFileSync(join(appToken, file), join(tools, file));
  chmodSync(join(tools, 'as-bot.sh'), 0o755);
  copyFileSync(
    resolve('packages/shared/src/commit-identity.ts'),
    join(tools, 'commit-identity.ts'),
  );
  copyFileSync(
    resolve('packages/shared/commit-identity.json'),
    join(tools, 'commit-identity.json'),
  );
  writeFileSync(join(tools, 'token.mjs'), "process.stdout.write('stub-token');\n");
  const lanes = join(home, 'lanes');
  mkdirSync(lanes);
  copyFileSync(join(hostRoot, 'lanes/sign-commits.sh'), join(lanes, 'sign-commits.sh'));
  chmodSync(join(lanes, 'sign-commits.sh'), 0o755);
  const bare = join(home, 'remote.git');
  sh(home, ['init', '-q', '--bare', '-b', 'main', bare]);
  const work = join(home, 'work');
  sh(home, ['init', '-q', '-b', 'main', work]);
  sh(
    work,
    ['commit', '-q', '--allow-empty', '-m', 'base'],
    as({ name: 'xiechimon', email: 'xiechimon@qq.com' }),
  );
  sh(work, ['remote', 'add', 'origin', 'https://github.com/xiechimon/cairn.git']);
  sh(work, ['config', `url.${bare}.insteadOf`, 'https://github.com/xiechimon/cairn.git']);
  sh(work, ['push', '-q', 'origin', 'main']);
  sh(work, ['checkout', '-q', '-b', 'feature']);
  const run = (command, args, api, env = {}) =>
    new Promise((done) => {
      const child = spawn(command, args, {
        cwd: work,
        env: { ...cleanEnv, HOME: home, CAIRN_GITHUB_API_URL: api, ...env },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (status) => done({ status, stderr }));
    });
  const asBot = (args, api, env) => run('/bin/bash', [join(tools, 'as-bot.sh'), ...args], api, env);
  const log = (ref) =>
    sh(work, ['log', '--format=%an <%ae>|%cn <%ce>|%B%x00', ref])
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean);
  return { home, bare, work, asBot, run, log };
}

test('as-bot.sh commits as the App for both author and committer', async (t) => {
  const h = host(t);
  const result = await h.asBot(
    ['git', 'commit', '-q', '--allow-empty', '-m', 'change'],
    'http://unused',
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    sh(h.work, ['log', '-1', '--format=%an <%ae>|%cn <%ce>']),
    `${bot.name} <${bot.email}>|${bot.name} <${bot.email}>`,
  );
});

test('as-bot.sh git push replays every unpublished commit through the API, verified, with the co-author trailer', async (t) => {
  const h = host(t);
  const github = await fakeGithub(t, h.bare);
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'session: one'], as(session));
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'fix: two'], as(retiredUser, bot));
  const result = await h.asBot(
    ['git', 'push', '-q', '--no-verify', 'origin', 'HEAD:feature'],
    github.url,
  );
  assert.equal(result.status, 0, result.stderr);
  const commits = h.log('feature');
  assert.equal(commits.length, 3);
  for (const commit of commits.slice(0, 2)) {
    assert.ok(commit.startsWith(`${bot.name} <${bot.email}>|${web.name} <${web.email}>|`), commit);
    assert.ok(commit.endsWith(coAuthor), commit);
  }
  assert.equal(sh(h.bare, ['rev-parse', 'feature']), sh(h.work, ['rev-parse', 'HEAD']));
  assert.equal(sh(h.work, ['status', '--porcelain']), '');
  assert.equal(sh(h.bare, ['for-each-ref', 'refs/cairn']), '');
  assert.equal(github.requests.filter((r) => r.startsWith('POST')).length, 2);
});

test('a push with nothing unpublished goes straight to git without calling the API', async (t) => {
  const h = host(t);
  const github = await fakeGithub(t, h.bare);
  const result = await h.asBot(['git', 'push', '-q', 'origin', 'HEAD:feature'], github.url);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(github.requests, []);
});

test('sign-commits.sh republishes commits pushed earlier under the retired identity', async (t) => {
  const h = host(t);
  const github = await fakeGithub(t, h.bare);
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'lane: work'], as(retiredUser, bot));
  sh(h.work, ['push', '-q', 'origin', 'HEAD:feature']);
  sh(h.work, ['fetch', '-q', 'origin']);
  const result = await h.run('/bin/bash', [join(h.home, 'lanes/sign-commits.sh')], github.url);
  assert.equal(result.status, 0, result.stderr);
  const [tip] = h.log('HEAD');
  assert.ok(
    tip.startsWith(`${bot.name} <${bot.email}>|${web.name} <${web.email}>|lane: work`),
    tip,
  );
  assert.ok(tip.endsWith(coAuthor), tip);
});

test('CAIRN_COAUTHOR set to empty publishes autonomous work without a human trailer', async (t) => {
  const h = host(t);
  const github = await fakeGithub(t, h.bare);
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'chore: scheduled'], as(bot));
  const result = await h.asBot(['git', 'push', '-q', 'origin', 'HEAD:feature'], github.url, {
    CAIRN_COAUTHOR: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    h.log('HEAD')[0],
    `${bot.name} <${bot.email}>|${web.name} <${web.email}>|chore: scheduled`,
  );
});

test('an unverified API commit stops the push and leaves the branch untouched', async (t) => {
  const h = host(t);
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(
        req.method === 'POST'
          ? JSON.stringify({ sha: 'f'.repeat(40), author: bot, verification: { verified: false } })
          : '{}',
      );
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'x'], as(bot));
  const result = await h.asBot(
    ['git', 'push', '-q', 'origin', 'HEAD:feature'],
    `http://127.0.0.1:${server.address().port}`,
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not verified/);
  assert.equal(
    spawnSync('git', ['rev-parse', '--verify', 'refs/heads/feature'], { cwd: h.bare }).status,
    128,
  );
});

const listFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

test('no host script keeps the retired user, the author-only wrapper, a rebase merge or a squash-to-one step', () => {
  assert.equal(existsSync(join(appToken, 'as-bot-author.sh')), false);
  for (const file of listFiles(hostRoot).filter(
    (f) => /\.(sh|mjs|md)$/.test(f) && !f.endsWith('.test.mjs'),
  )) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /348051526|Cairnwright|as-bot-author/, file);
    assert.doesNotMatch(text, /--rebase|reset -q --soft/, file);
  }
});

test('merge-pr.sh squashes every PR, whoever opened it and however many commits it has', () => {
  const source = readFileSync(join(hostRoot, 'tools/merge-pr.sh'), 'utf8');
  assert.match(source, /run=\(gh pr merge "\$pr" -R "\$R" --squash --match-head-commit "\$head"\)/);
  assert.doesNotMatch(source, /app\/cairnwright|commits\|length|ACCEPTED_BOT_AUTHORS/);
});
