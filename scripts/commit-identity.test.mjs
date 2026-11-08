import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const script = resolve('scripts/commit-identity.mjs');
const workflow = readFileSync('.github/workflows/commit-author.yml', 'utf8');

const bot = {
  name: 'cairnwright[bot]',
  email: '347615582+cairnwright[bot]@users.noreply.github.com',
};
const web = { name: 'GitHub', email: 'noreply@github.com' };
const owner = { name: 'xiechimon', email: 'xiechimon@qq.com' };
const retiredUser = {
  name: 'Cairnwright',
  email: '348051526+cairnwright@users.noreply.github.com',
};
const session = { name: 'Session', email: 'kigv1zSwiHPke_Cl5Ci6D@cairn.local' };
const agentEnv = { AI_AGENT: 'claude-code_agent' };
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^(AI_AGENT|CLAUDECODE|CLAUDE_CODE_SESSION_ID|CODEX_|PI_CODING_AGENT|CAIRN_STEP_ID|GIT_)/.test(
        key,
      ),
  ),
);

function repo(t) {
  const cwd = makeTestTempDir('commit-identity-');
  t.after(() => releaseTestTempDir(cwd));
  const git = (args, author = owner, committer = author, env = {}) => {
    const result = spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...cleanEnv,
        ...env,
        GIT_AUTHOR_NAME: author.name,
        GIT_AUTHOR_EMAIL: author.email,
        GIT_COMMITTER_NAME: committer.name,
        GIT_COMMITTER_EMAIL: committer.email,
      },
    });
    return result;
  };
  const ok = (...args) => {
    const result = git(...args);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  ok(['init', '-q', '-b', 'main']);
  ok(['commit', '-q', '--allow-empty', '-m', 'base']);
  const base = ok(['rev-parse', 'HEAD']);
  return { cwd, git, ok, base };
}

async function verificationServer(t, verified) {
  const server = createServer((req, res) => {
    const sha = req.url.split('/').at(-1);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ commit: { verification: { verified: verified.has(sha) } } }));
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  return `http://127.0.0.1:${server.address().port}`;
}

function runCi(r, api) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [script, 'ci'], {
      cwd: r.cwd,
      env: {
        ...cleanEnv,
        BASE_SHA: r.base,
        GITHUB_REPOSITORY: 'xiechimon/cairn',
        GITHUB_API_URL: api,
      },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stdout += chunk;
    });
    child.on('close', (status) => done({ status, stdout }));
  });
}

const ciCases = [
  ['source 1 as the host pushes it today: bot author, git push, unverified', bot, bot, false, 1],
  ['source 2: the retired Cairnwright user', retiredUser, bot, false, 1],
  ['source 2 after a rebase merge by ian', retiredUser, { ...owner, name: 'Xmon Dai' }, false, 1],
  ['source 4: the synthetic cairn.local step identity', session, session, false, 1],
  ['baeb30d98 (#3486): a cairn task commit the App made through the GitHub API', bot, web, true, 0],
  ['a bot-shaped commit GitHub did not sign', bot, web, false, 1],
  [
    'the bot name on a forged email, signed by GitHub',
    { ...bot, email: 'bot@evil.test' },
    web,
    true,
    1,
  ],
  ['the bot email under a human name', { ...bot, name: 'xiechimon' }, web, true, 1],
  ['the owner name on a stranger email', { ...owner, email: 'xiechimon@evil.test' }, web, true, 1],
  ['ian committing by hand', owner, owner, false, 0],
];

for (const [name, author, committer, verified, expected] of ciCases) {
  test(`commit-author CI: ${name} exits ${expected}`, async (t) => {
    const r = repo(t);
    r.ok(['switch', '-q', '-c', 'cairn/conv-01a1bc77-10b5-7dec-b021-4fe865bf6370']);
    r.ok(
      [
        'commit',
        '-q',
        '--allow-empty',
        '-m',
        'docs(157): retire the planned Cloudflare relay service',
        '-m',
        'Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>',
      ],
      author,
      committer,
    );
    const sha = r.ok(['rev-parse', 'HEAD']);
    const api = await verificationServer(t, new Set(verified ? [sha] : []));
    const result = await runCi(r, api);
    assert.equal(result.status, expected, result.stdout);
    if (expected === 1) assert.match(result.stdout, /::error::/);
  });
}

test('commit-author CI: one bad commit under a good tip still fails', async (t) => {
  const r = repo(t);
  r.ok(['commit', '-q', '--allow-empty', '-m', 'session'], session);
  r.ok(['commit', '-q', '--allow-empty', '-m', 'ian'], owner);
  const result = await runCi(r, await verificationServer(t, new Set()));
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stdout, /cairn\.local/);
});

function installHook(r, name) {
  const hook = join(r.cwd, '.git', 'hooks', name);
  writeFileSync(
    hook,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(script)} ${name}\n`,
  );
  chmodSync(hook, 0o755);
}

test('pre-commit: source 3, an agent session committing with the global xiechimon config, is rejected', (t) => {
  const r = repo(t);
  installHook(r, 'pre-commit');
  const result = r.git(['commit', '-q', '--allow-empty', '-m', 'agent'], owner, owner, agentEnv);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /as-bot\.sh git commit/);
});

test('pre-commit: an agent session committing as the App, and ian by hand, are accepted', (t) => {
  const r = repo(t);
  installHook(r, 'pre-commit');
  assert.equal(
    r.git(['commit', '-q', '--allow-empty', '-m', 'agent'], bot, bot, agentEnv).status,
    0,
  );
  assert.equal(r.git(['commit', '-q', '--allow-empty', '-m', 'ian'], owner).status, 0);
});

for (const identity of [retiredUser, session])
  test(`pre-commit: ${identity.name} is rejected outside agent sessions too`, (t) => {
    const r = repo(t);
    installHook(r, 'pre-commit');
    assert.equal(r.git(['commit', '-q', '--allow-empty', '-m', 'x'], identity).status, 1);
  });

test('pre-push: an agent pushing a bot commit made with plain git is told to publish through the API', (t) => {
  const r = repo(t);
  const remote = makeTestTempDir('commit-identity-remote-');
  t.after(() => releaseTestTempDir(remote));
  spawnSync('git', ['init', '-q', '--bare', remote]);
  r.ok(['remote', 'add', 'origin', remote]);
  r.ok(['push', '-q', 'origin', 'main']);
  installHook(r, 'pre-push');
  r.ok(['commit', '-q', '--allow-empty', '-m', 'local bot'], bot);
  const pushed = r.git(['push', '-q', 'origin', 'HEAD:refs/heads/feature'], bot, bot, agentEnv);
  assert.equal(pushed.status, 1);
  assert.match(pushed.stderr, /as-bot\.sh git push/);
  r.ok(['reset', '-q', '--hard', 'HEAD~1']);
  r.ok(['commit', '-q', '--allow-empty', '-m', 'api made'], bot, web);
  assert.equal(
    r.git(['push', '-q', 'origin', 'HEAD:refs/heads/feature'], bot, bot, agentEnv).status,
    0,
  );
});

test('the workflow runs the shared check with a GitHub token and Node that runs TypeScript', () => {
  assert.match(workflow, /run: node scripts\/commit-identity\.mjs ci/);
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v/);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.doesNotMatch(workflow, /rebase/);
});

test('the hooks run the shared check before anything else', () => {
  assert.match(
    readFileSync('.husky/pre-commit', 'utf8'),
    /^#!\/usr\/bin\/env sh\nset -e\n\nnode scripts\/commit-identity\.mjs pre-commit\n/,
  );
  assert.match(
    readFileSync('.husky/pre-push', 'utf8'),
    /node scripts\/commit-identity\.mjs pre-push/,
  );
});

test('no merge rule keeps a rebase or single-commit route for bot-opened PRs', () => {
  for (const file of [
    'AGENTS.md',
    'docs/pr-review.md',
    '.claude/skills/pr-cairn/SKILL.md',
    'docs/ops/agent-bot-identity.md',
    'scripts/ops/host/README.md',
  ]) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /--rebase/, file);
    assert.doesNotMatch(text, /348051526/, file);
    assert.doesNotMatch(text, /exactly one commit/i, file);
    assert.doesNotMatch(text, /as-bot-author/, file);
  }
});
