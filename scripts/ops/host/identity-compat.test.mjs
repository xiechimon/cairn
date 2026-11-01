import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const hostRoot = resolve('scripts/ops/host');
const legacy = { name: 'Cairnwright', email: '348051526+cairnwright@users.noreply.github.com' };
const bot = {
  name: 'cairnwright[bot]',
  email: '347615582+cairnwright[bot]@users.noreply.github.com',
};
const foreignBot = {
  name: 'other-app[bot]',
  email: '1+other-app[bot]@users.noreply.github.com',
};
const coAuthor = 'Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>';
const botBody = `Subject\n\nCloses #1\n\nCairn-Thread: thread-1\n\n${coAuthor}`;
const legacyBody = `Subject\n\nCloses #1\n\n${coAuthor}`;

const ghStub = `#!${process.execPath}
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(['gh', ...args]) + '\\n');
const data = JSON.parse(fs.readFileSync(process.env.GH_DATA, 'utf8'));
const expr = args[args.indexOf('--jq') + 1];
const source = args[1] === 'view' ? data.view : data.list;
if (args[0] === 'pr' && (args[1] === 'view' || args[1] === 'list') && args.includes('--jq')) {
  const out = spawnSync('jq', ['-r', expr], { input: JSON.stringify(source), encoding: 'utf8' });
  process.stdout.write(out.stdout);
}
`;

const recorderStub = (name) => `#!${process.execPath}
require('node:fs').appendFileSync(process.env.CALLS, JSON.stringify([${JSON.stringify(name)}, ...process.argv.slice(2)]) + '\\n');
`;

const asBotStub = `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
require('node:fs').appendFileSync(process.env.CALLS, JSON.stringify(['as-bot', ...args]) + '\\n');
if (args[0] === 'git') {
  const identity = { GIT_AUTHOR_NAME: 'Cairnwright', GIT_COMMITTER_NAME: 'Cairnwright', GIT_AUTHOR_EMAIL: '348051526+cairnwright@users.noreply.github.com', GIT_COMMITTER_EMAIL: '348051526+cairnwright@users.noreply.github.com' };
  process.exit(spawnSync('git', args.slice(1), { stdio: 'inherit', env: { ...process.env, ...identity } }).status ?? 1);
}
`;

function writeExecutable(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function fixture(t, data) {
  const home = mkdtempSync(join(tmpdir(), 'identity-compat-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const bin = join(home, 'bin');
  const calls = join(home, 'calls');
  writeFileSync(calls, '');
  writeFileSync(join(home, 'gh-data.json'), JSON.stringify(data));
  writeExecutable(join(bin, 'gh'), ghStub);
  writeExecutable(join(home, '.cairn/tools/merge-order/deps-open.mjs'), 'process.exit(0);\n');
  writeExecutable(join(home, '.cairn/tools/review-gate/review-gate.mjs'), 'process.exit(3);\n');
  writeExecutable(join(home, '.cairn/tools/app-token/as-bot.sh'), asBotStub);
  writeExecutable(join(home, '.cairn/tools/merge-pr.sh'), recorderStub('merge-pr'));
  const run = (command, args = [], options = {}) => {
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      ...options,
      env: {
        ...process.env,
        HOME: home,
        PATH: `${bin}:${process.env.PATH}`,
        CALLS: calls,
        GH_DATA: join(home, 'gh-data.json'),
      },
    });
    const recorded = readFileSync(calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((entry) => JSON.parse(entry));
    return { ...result, calls: recorded };
  };
  return { home, run };
}

const prView = (commits, opener = 'app/cairnwright') => ({
  view: {
    headRefName: 'feature/x',
    body: 'Closes #1',
    headRefOid: 'a'.repeat(40),
    author: { login: opener },
    commits,
  },
});

const commit = (author, messageBody) => ({
  messageHeadline: 'Subject',
  messageBody,
  authors: [{ ...author, login: author.name }],
});

const mergeWithCommits = (t, commits, opener) => {
  const f = fixture(t, prView(commits, opener));
  const result = f.run('bash', [join(hostRoot, 'tools/merge-pr.sh'), '7']);
  const rebased = result.calls.some(
    (c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge' && c.includes('--rebase'),
  );
  assert.equal(
    result.calls.some((c) => c[0] === 'as-bot' && c.includes('merge')),
    false,
  );
  return { ...result, rebased };
};

test('merge-pr rebases one Cairnwright commit', (t) => {
  const result = mergeWithCommits(t, [commit(legacy, legacyBody)]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.rebased);
});

test('merge-pr rebases one cairnwright[bot] commit with the thread and co-author trailers', (t) => {
  const result = mergeWithCommits(t, [commit(bot, botBody)]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.rebased);
});

test('merge-pr refuses a cairnwright[bot] commit without the Cairn-Thread trailer', (t) => {
  const result = mergeWithCommits(t, [commit(bot, legacyBody)]);
  assert.notEqual(result.status, 0);
  assert.equal(result.rebased, false);
});

test('merge-pr refuses a cairnwright[bot] commit without the co-author trailer', (t) => {
  const result = mergeWithCommits(t, [commit(bot, 'Subject\n\nCairn-Thread: thread-1')]);
  assert.notEqual(result.status, 0);
  assert.equal(result.rebased, false);
});

test('merge-pr still treats an unknown bot author as foreign', (t) => {
  const result = mergeWithCommits(t, [commit(foreignBot, botBody)]);
  assert.notEqual(result.status, 0);
  assert.equal(result.rebased, false);
  assert.match(result.stderr, /other-app\[bot\]/);
});

test('merge-pr still requires exactly one commit for a bot-opened PR', (t) => {
  const result = mergeWithCommits(t, [commit(bot, botBody), commit(bot, botBody)]);
  assert.notEqual(result.status, 0);
  assert.equal(result.rebased, false);
});

test('merge-pr queues an unprotected human-opened PR whatever the commit authors', (t) => {
  const result = mergeWithCommits(t, [commit(bot, botBody)], 'xiechimon');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.rebased, false);
  assert.ok(result.calls.some((c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'comment'));
  assert.ok(!result.calls.some((c) => c[0] === 'gh' && c[2] === 'merge'));
});

const rearmCalls = (t, commits, mergeMethod) => {
  const f = fixture(t, {
    ...prView(commits),
    list: [
      {
        number: 7,
        headRefName: 'feature/x',
        isDraft: false,
        author: { login: 'app/cairnwright' },
        autoMergeRequest: { mergeMethod },
      },
    ],
  });
  const result = f.run('bash', [join(hostRoot, 'tools/rearm-automerge.sh')]);
  return result.calls.filter((c) => c[0] === 'merge-pr').map((c) => c.slice(1).join(' '));
};

for (const [label, author, body] of [
  ['Cairnwright', legacy, legacyBody],
  ['cairnwright[bot]', bot, botBody],
]) {
  test(`rearm-automerge re-arms a SQUASH-armed ${label} PR through merge-pr`, (t) => {
    assert.deepEqual(rearmCalls(t, [commit(author, body)], 'SQUASH'), ['7 --auto']);
  });

  test(`rearm-automerge leaves a REBASE-armed ${label} PR alone`, (t) => {
    assert.deepEqual(rearmCalls(t, [commit(author, body)], 'REBASE'), []);
  });
}

const git = (cwd, args, identity, message) =>
  spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    input: message,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    },
  });

const signCommits = (t, author, message) => {
  const f = fixture(t, {});
  const repo = join(f.home, 'repo');
  mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main'], foreignBot);
  git(repo, ['commit', '-q', '--allow-empty', '-F', '-'], foreignBot, 'base');
  git(repo, ['update-ref', 'refs/remotes/origin/main', 'HEAD'], foreignBot);
  git(repo, ['checkout', '-q', '-b', 'lane/1'], foreignBot);
  git(repo, ['commit', '-q', '--allow-empty', '-F', '-'], author, message);
  const before = git(repo, ['rev-parse', 'HEAD'], author).stdout.trim();
  const result = f.run('bash', [join(hostRoot, 'lanes/sign-commits.sh')], { cwd: repo });
  const after = git(repo, ['rev-parse', 'HEAD'], author).stdout.trim();
  const authorAfter = git(repo, ['log', '-1', '--format=%an'], author).stdout.trim();
  return { result, unchanged: before === after, authorAfter };
};

test('sign-commits leaves an already signed Cairnwright commit alone', (t) => {
  const { result, unchanged } = signCommits(t, legacy, legacyBody);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(unchanged);
});

test('sign-commits leaves an already signed cairnwright[bot] commit with trailers alone', (t) => {
  const { result, unchanged } = signCommits(t, bot, botBody);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(unchanged);
});

test('sign-commits re-signs a commit by an unknown bot as Cairnwright', (t) => {
  const { result, unchanged, authorAfter } = signCommits(t, foreignBot, botBody);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(unchanged, false);
  assert.equal(authorAfter, 'Cairnwright');
});

const acceptedByScript = () => {
  const source = readFileSync(join(hostRoot, 'tools/merge-pr.sh'), 'utf8');
  const line = source.match(/^ACCEPTED_BOT_AUTHORS="([^"]+)"$/m);
  assert.ok(line, 'merge-pr.sh declares ACCEPTED_BOT_AUTHORS');
  return line[1].split(' ').sort();
};

const acceptedByDoc = (path) => {
  const line = readFileSync(resolve(path), 'utf8')
    .split('\n')
    .find((l) => l.includes('Accepted bot commit authors:'));
  assert.ok(line, `${path} has an "Accepted bot commit authors:" line`);
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort();
};

for (const doc of ['docs/pr-review.md', 'docs/ops/agent-bot-identity.md']) {
  test(`${doc} names the same accepted bot authors as merge-pr.sh`, () => {
    assert.deepEqual(acceptedByDoc(doc), acceptedByScript());
    assert.deepEqual(acceptedByScript(), ['Cairnwright', 'cairnwright[bot]']);
  });
}
