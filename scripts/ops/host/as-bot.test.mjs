import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const sourceDir = resolve('scripts/ops/host/tools/app-token');

const recorderStub = `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.CALLS, JSON.stringify({ argv: process.argv.slice(2), token: process.env.GH_TOKEN ?? null }) + '\\n');
`;

const tokenStub = `import { appendFileSync } from 'node:fs';
appendFileSync(process.env.TOKEN_MINTS, 'minted\\n');
process.stdout.write('stub-installation-token');
`;

function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'as-bot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = join(root, 'tools');
  const bin = join(root, 'bin');
  mkdirSync(tools);
  mkdirSync(bin);
  for (const file of ['as-bot.sh', 'as-bot-policy.mjs'])
    copyFileSync(join(sourceDir, file), join(tools, file));
  writeFileSync(join(tools, 'token.mjs'), tokenStub);
  for (const name of ['gh', 'git', 'bash', 'curl']) {
    writeFileSync(join(bin, name), recorderStub);
    chmodSync(join(bin, name), 0o755);
  }
  const calls = join(root, 'calls');
  const mints = join(root, 'mints');
  writeFileSync(calls, '');
  writeFileSync(mints, '');
  const env = {
    HOME: root,
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    CALLS: calls,
    TOKEN_MINTS: mints,
  };
  return {
    run(...argv) {
      const result = spawnSync('/bin/bash', [join(tools, 'as-bot.sh'), ...argv], {
        env,
        encoding: 'utf8',
      });
      const recorded = readFileSync(calls, 'utf8').trim();
      return {
        status: result.status,
        stderr: result.stderr,
        calls: recorded ? recorded.split('\n').map((line) => JSON.parse(line)) : [],
        minted: readFileSync(mints, 'utf8').trim() !== '',
      };
    },
  };
}

const HEAD = 'a'.repeat(40);

const allowed = [
  ['gh', 'pr', 'view', '12', '-R', 'xiechimon/cairn', '--json', 'state'],
  ['gh', 'pr', 'list', '-R', 'xiechimon/cairn', '--head', 'lane/1'],
  ['gh', 'pr', 'comment', '12', '--body-file', '-'],
  [
    'gh',
    'pr',
    'create',
    '-R',
    'xiechimon/cairn',
    '--base',
    'main',
    '--head',
    'lane/1',
    '--title',
    't',
  ],
  ['gh', 'pr', 'edit', '12', '--add-label', 'review-gate'],
  ['gh', 'pr', 'close', '12', '-c', 'closed'],
  ['gh', 'pr', 'update-branch', '12', '--rebase'],
  ['gh', 'pr', 'merge', '12', '-R', 'xiechimon/cairn', '--disable-auto'],
  ['gh', 'pr', 'merge', '12', '-R', 'xiechimon/cairn', '--rebase', '--match-head-commit', HEAD],
  ['gh', 'pr', 'merge', '12', '--squash', '--auto', '--match-head-commit', HEAD],
  [
    'gh',
    'pr',
    'merge',
    'https://github.com/xiechimon/cairn/pull/12',
    '--squash',
    `--match-head-commit=${HEAD}`,
  ],
  ['gh', 'issue', 'view', '5'],
  ['gh', 'issue', 'list', '-l', 'batch:C1'],
  ['gh', 'issue', 'comment', '5', '-b', 'x'],
  ['gh', 'issue', 'create', '-t', 't', '-b', 'b', '-l', 'bug'],
  ['gh', 'issue', 'edit', '5', '--remove-label', 'waits-ian'],
  ['gh', 'issue', 'pin', '5'],
  ['gh', 'api', 'repos/xiechimon/cairn/pulls/1'],
  ['gh', 'api', '-X', 'GET', 'repos/xiechimon/cairn/issues'],
  ['gh', 'api', '--method', 'get', 'repos/xiechimon/cairn/issues', '-f', 'state=open'],
  ['git', 'fetch', '-q', 'origin', 'main'],
  ['git', 'fetch', '-q', 'origin', 'main', 'pull/3/head:review-gate-3', '--force'],
  ['git', '-C', '/tmp/repo', 'fetch', '-q', 'origin', 'main'],
  ['git', 'push', '-q', '--no-verify', '-u', 'origin', 'chore/evidence-prune-1'],
  ['git', 'push', 'origin', 'HEAD:lane/7'],
  ['git', 'push', '-q', '--no-verify', '--force-with-lease', 'origin', 'HEAD:lane/7'],
  ['git', 'push', '--force-with-lease=lane/7:abc123', 'origin', 'HEAD:refs/heads/lane/7'],
  ['git', 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'msg'],
  ['git', 'rebase', '-q', 'origin/main'],
  ['git', 'rebase', '--continue'],
  ['git', 'rebase', '-q', '-X', 'theirs', 'origin/main'],
];

for (const argv of allowed) {
  test(`allowed: ${argv.join(' ')}`, (t) => {
    const result = setup(t).run(...argv);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.calls, [{ argv: argv.slice(1), token: 'stub-installation-token' }]);
  });
}

const denied = [
  [['gh', 'pr', 'merge', '12', '--rebase'], /--match-head-commit <40-hex sha> is required/],
  [
    ['gh', 'pr', 'merge', '12', '--squash', '--auto'],
    /--match-head-commit <40-hex sha> is required/,
  ],
  [['gh', 'pr', 'merge', '12', '--rebase', '--match-head-commit', 'abc123'], /40-hex sha/],
  [['gh', 'pr', 'merge', '12', '--rebase', '--match-head-commit', 'A'.repeat(40)], /40-hex sha/],
  [
    ['gh', 'pr', 'merge', '12', '--rebase', '--admin', '--match-head-commit', HEAD],
    /--admin is not allowed/,
  ],
  [
    ['gh', 'pr', 'merge', '12', '--squash', '--delete-branch', '--match-head-commit', HEAD],
    /--delete-branch is not allowed/,
  ],
  [
    ['gh', 'pr', 'merge', '12', '--squash', '--auto', '--body', 'x', '--match-head-commit', HEAD],
    /--body is not allowed/,
  ],
  [
    ['gh', 'pr', 'merge', '12', '--squash', '--subject', 'x', '--match-head-commit', HEAD],
    /--subject is not allowed/,
  ],
  [['gh', 'pr', 'merge', '12', '--merge', '--match-head-commit', HEAD], /--merge is not allowed/],
  [['gh', 'pr', 'merge', '12', '--match-head-commit', HEAD], /exactly one of --rebase or --squash/],
  [
    ['gh', 'pr', 'merge', '12', '--rebase', '--squash', '--match-head-commit', HEAD],
    /exactly one of --rebase or --squash/,
  ],
  [['gh', 'pr', 'merge', '--rebase', '--match-head-commit', HEAD], /exactly one pull request/],
  [['gh', 'pr', 'merge', '12', '--disable-auto', '--auto'], /cannot be combined/],
  [
    ['gh', 'pr', 'merge', '12', '--disable-auto', '--rebase', '--match-head-commit', HEAD],
    /cannot be combined/,
  ],
  [
    ['gh', '-R', 'xiechimon/cairn', 'pr', 'merge', '12', '--auto'],
    /--match-head-commit <40-hex sha> is required/,
  ],
  [['gh', 'pr', 'edit', '12', '--base', 'other'], /only change labels/],
  [['gh', 'pr', 'edit', '12', '--title', 'x'], /only change labels/],
  [['gh', 'pr', 'ready', '12'], /not on the as-bot allowlist/],
  [['gh', 'pr', 'review', '12', '--approve'], /not on the as-bot allowlist/],
  [['gh', 'issue', 'delete', '5'], /not on the as-bot allowlist/],
  [['gh', 'issue', 'comment', '5', '--delete-last'], /--delete-last is refused/],
  [['gh', 'api', '-X', 'DELETE', 'repos/xiechimon/cairn/git/refs/heads/x'], /read-only/],
  [['gh', 'api', '--method', 'PUT', 'repos/xiechimon/cairn/pulls/1/merge'], /read-only/],
  [['gh', 'api', '--method=PATCH', 'repos/xiechimon/cairn'], /read-only/],
  [['gh', 'api', '-XPOST', 'repos/xiechimon/cairn/issues'], /read-only/],
  [['gh', 'api', 'repos/xiechimon/cairn/issues', '-f', 'title=x'], /implicit POST/],
  [['gh', 'api', 'repos/xiechimon/cairn/issues', '--input', '-'], /implicit POST/],
  [['gh', 'api', 'graphql', '-f', 'query=x'], /graphql/],
  [['gh', 'variable', 'set', 'X', '-b', 'y'], /not on the as-bot allowlist/],
  [['gh', 'variable', 'delete', 'X'], /not on the as-bot allowlist/],
  [['gh', 'secret', 'set', 'X'], /not on the as-bot allowlist/],
  [['gh', 'repo', 'delete', 'xiechimon/cairn'], /not on the as-bot allowlist/],
  [['gh', 'label', 'delete', 'bug'], /not on the as-bot allowlist/],
  [['gh', 'ruleset', 'list'], /not on the as-bot allowlist/],
  [['gh', 'auth', 'token'], /not on the as-bot allowlist/],
  [['gh', 'alias', 'set', 'x', 'y'], /not on the as-bot allowlist/],
  [['gh'], /not on the as-bot allowlist/],
  [['git', 'push', 'origin', 'HEAD:main'], /pushing to main is refused/],
  [['git', 'push', 'origin', 'main'], /pushing to main is refused/],
  [['git', 'push', 'origin', 'HEAD:refs/heads/main'], /pushing to main is refused/],
  [['git', 'push', 'origin', 'HEAD:heads/master'], /pushing to master is refused/],
  [['git', 'push', 'origin', 'HEAD:refs/tags/v1'], /only branches/],
  [['git', 'push', 'origin', 'HEAD'], /explicit destination/],
  [['git', 'push', 'origin'], /explicit branch refspec/],
  [['git', 'push'], /origin remote/],
  [['git', 'push', 'https://example.invalid/x.git', 'HEAD:lane/1'], /origin remote/],
  [['git', 'push', '--force', 'origin', 'HEAD:lane/1'], /refused/],
  [['git', 'push', '-f', 'origin', 'HEAD:lane/1'], /-f is not allowed/],
  [['git', 'push', '-qf', 'origin', 'HEAD:lane/1'], /-f is not allowed/],
  [['git', 'push', '--delete', 'origin', 'lane/1'], /refused/],
  [['git', 'push', '-d', 'origin', 'lane/1'], /-d is not allowed/],
  [['git', 'push', 'origin', ':lane/1'], /deleting refspec/],
  [['git', 'push', 'origin', '+HEAD:lane/1'], /forced refspec/],
  [['git', 'push', '--mirror', 'origin'], /refused/],
  [['git', 'push', '--all', 'origin'], /refused/],
  [['git', 'push', '--tags', 'origin'], /refused/],
  [['git', 'push', 'origin', 'HEAD:refs/heads/*'], /pattern refspec/],
  [['git', 'push', '-o', 'x', 'origin', 'HEAD:lane/1'], /-o is not allowed/],
  [['git', '-c', 'core.sshCommand=evil', 'fetch', 'origin'], /not on the as-bot allowlist/],
  [['git', 'fetch', '--upload-pack=evil', 'origin'], /git fetch --upload-pack=evil is refused/],
  [['git', 'fetch', 'https://example.invalid/x.git'], /origin remote/],
  [['git', 'rebase', '--exec', 'evil', 'origin/main'], /refused/],
  [['git', 'rebase', '-i', 'origin/main'], /refused/],
  [['git', 'reset', '--hard'], /not on the as-bot allowlist/],
  [['git', 'config', 'x', 'y'], /not on the as-bot allowlist/],
  [['git'], /not on the as-bot allowlist/],
  [['bash', '-c', 'gh pr merge 1'], /only gh and git/],
  [['curl', 'https://example.invalid'], /only gh and git/],
  [[], /only gh and git/],
];

for (const [argv, message] of denied) {
  test(`denied: ${argv.join(' ') || '(no command)'}`, (t) => {
    const result = setup(t).run(...argv);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /^as-bot: refused: /);
    assert.match(result.stderr, message);
    assert.deepEqual(result.calls, []);
    assert.equal(result.minted, false);
  });
}

test('as-bot.sh refuses before any token is minted and exits 126', (t) => {
  const result = setup(t).run('gh', 'pr', 'merge', '1', '--admin');
  assert.equal(result.status, 126);
  assert.equal(result.minted, false);
});

test('the policy file ships next to as-bot.sh', () => {
  assert.equal(existsSync(join(sourceDir, 'as-bot-policy.mjs')), true);
});
