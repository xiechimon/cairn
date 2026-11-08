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
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../../test-tmpdir.mjs';

const hostRoot = resolve('scripts/ops/host');
const appToken = join(hostRoot, 'tools/app-token');
const bot = {
  name: 'cairnwright[bot]',
  email: '347615582+cairnwright[bot]@users.noreply.github.com',
};
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

function host(t) {
  const home = makeTestTempDir('identity-compat-');
  t.after(() => releaseTestTempDir(home));
  const tools = join(home, '.cairn/tools/app-token');
  mkdirSync(tools, { recursive: true });
  for (const file of ['as-bot.sh', 'as-bot-policy.mjs', 'bot-identity.mjs'])
    copyFileSync(join(appToken, file), join(tools, file));
  chmodSync(join(tools, 'as-bot.sh'), 0o755);
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
  const run = (command, args, env = {}) =>
    new Promise((done) => {
      const child = spawn(command, args, {
        cwd: work,
        env: { ...cleanEnv, HOME: home, ...env },
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });
      child.on('close', (status) => done({ status, stderr }));
    });
  const asBot = (args, env) => run('/bin/bash', [join(tools, 'as-bot.sh'), ...args], env);
  const log = (ref) =>
    sh(work, ['log', '--format=%an <%ae>|%cn <%ce>|%B%x00', ref])
      .split('\0')
      .map((s) => s.trim())
      .filter(Boolean);
  return { home, bare, work, asBot, run, log };
}

test('as-bot.sh commits as the App for author and committer and adds the co-author trailer once', async (t) => {
  const h = host(t);
  const result = await h.asBot(['git', 'commit', '-q', '--allow-empty', '-m', 'fix: two']);
  assert.equal(result.status, 0, result.stderr);
  const [tip] = h.log('HEAD');
  assert.ok(tip.startsWith(`${bot.name} <${bot.email}>|${bot.name} <${bot.email}>|fix: two`), tip);
  assert.equal(tip.split(coAuthor).length, 2, tip);
});

test('CAIRN_COAUTHOR set to empty commits autonomous work without a human trailer', async (t) => {
  const h = host(t);
  const result = await h.asBot(['git', 'commit', '-q', '--allow-empty', '-m', 'chore: scheduled'], {
    CAIRN_COAUTHOR: '',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    h.log('HEAD')[0],
    `${bot.name} <${bot.email}>|${bot.name} <${bot.email}>|chore: scheduled`,
  );
});

test('as-bot.sh git push is a plain push that leaves no temporary refs', async (t) => {
  const h = host(t);
  await h.asBot(['git', 'commit', '-q', '--allow-empty', '-m', 'fix: one']);
  const result = await h.asBot(['git', 'push', '-q', 'origin', 'HEAD:feature']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(sh(h.bare, ['rev-parse', 'feature']), sh(h.work, ['rev-parse', 'HEAD']));
  assert.equal(sh(h.bare, ['for-each-ref', 'refs/cairn']), '');
});

test('sign-commits.sh rewrites every lane commit since main to the App with the trailer', async (t) => {
  const h = host(t);
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'session: one'], as(session));
  sh(h.work, ['commit', '-q', '--allow-empty', '-m', 'lane: work'], as(retiredUser, bot));
  sh(h.work, ['fetch', '-q', 'origin']);
  const result = await h.run('/bin/bash', [join(h.home, 'lanes/sign-commits.sh')]);
  assert.equal(result.status, 0, result.stderr);
  const commits = h.log('origin/main..HEAD');
  assert.equal(commits.length, 2);
  for (const commit of commits) {
    assert.ok(commit.startsWith(`${bot.name} <${bot.email}>|${bot.name} <${bot.email}>|`), commit);
    assert.equal(commit.split(coAuthor).length, 2, commit);
  }
});

const listFiles = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });

test('no host script keeps the retired user, the author-only wrapper, a rebase merge, a squash-to-one step or API replay', () => {
  assert.equal(existsSync(join(appToken, 'as-bot-author.sh')), false);
  assert.equal(existsSync(join(appToken, 'bot-git.mjs')), false);
  for (const file of listFiles(hostRoot).filter(
    (f) => /\.(sh|mjs|md)$/.test(f) && !f.endsWith('.test.mjs'),
  )) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /348051526|Cairnwright|as-bot-author|bot-git|git sign/, file);
    assert.doesNotMatch(text, /--rebase|reset -q --soft/, file);
  }
});

test('merge-pr.sh squashes every PR, whoever opened it and however many commits it has', () => {
  const source = readFileSync(join(hostRoot, 'tools/merge-pr.sh'), 'utf8');
  assert.match(source, /run=\(gh pr merge "\$pr" -R "\$R" --squash --match-head-commit "\$head"\)/);
  assert.doesNotMatch(source, /app\/cairnwright|commits\|length|ACCEPTED_BOT_AUTHORS/);
});
