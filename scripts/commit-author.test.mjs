import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/commit-author.yml', import.meta.url),
  'utf8',
);
const shell = workflow.match(/ {8}run: \|\n((?: {10}.*\n)+)/)?.[1].replace(/^ {10}/gm, '');
const bot = ['cairnwright[bot]', '347615582+cairnwright[bot]@users.noreply.github.com'];

const git = (cwd, args, identity = {}) => {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name ?? 'Human',
      GIT_AUTHOR_EMAIL: identity.email ?? 'human@example.com',
      GIT_COMMITTER_NAME: identity.name ?? 'Human',
      GIT_COMMITTER_EMAIL: identity.email ?? 'human@example.com',
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const runCheck = (cwd, env = {}) => {
  assert.ok(shell);
  return spawnSync('bash', ['-e', '-c', shell], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
};

test('PR validation reads the explicit head without executing PR code', () => {
  assert.match(workflow, / {2}pull_request:/);
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(
    workflow,
    /if: github.event_name == 'push'\n {8}run: node --test scripts\/commit-author.test.mjs/,
  );
  assert.match(workflow, /permissions:\n {2}contents: read/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v/);
  assert.match(workflow, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
});

test('a bot-authored commit beneath a human tip is rejected', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'commit-author-'));
  try {
    git(cwd, ['init', '--quiet']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'base']);
    git(cwd, ['branch', 'base']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'bot'], {
      name: bot[0],
      email: bot[1],
    });
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'human tip']);
    const result = runCheck(cwd, { BASE_SHA: git(cwd, ['rev-parse', 'base']) });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /::error::/);
    assert.match(result.stdout, /cairnwright\[bot\]/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test('a squash commit authored by the bot is rejected', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'commit-author-'));
  try {
    git(cwd, ['init', '--quiet']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'base']);
    git(cwd, ['branch', 'base']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'squash (#1)'], {
      name: bot[0],
      email: bot[1],
    });
    const result = runCheck(cwd, { BASE_SHA: git(cwd, ['rev-parse', 'base']) });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /cairnwright\[bot\]/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const scenario of [
  'bot squash',
  'bot beneath human tip',
  'historical bot',
  'missing before',
  'zero before',
]) {
  test(`main push checks ${scenario}`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'commit-author-'));
    try {
      git(cwd, ['init', '--quiet']);
      git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'human root']);
      if (scenario === 'historical bot') {
        git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'historical bot'], {
          name: bot[0],
          email: bot[1],
        });
      }
      const before = git(cwd, ['rev-parse', 'HEAD']);
      git(
        cwd,
        ['commit', '--quiet', '--allow-empty', '-m', 'pushed commit'],
        scenario === 'historical bot' ? {} : { name: bot[0], email: bot[1] },
      );
      if (scenario === 'bot beneath human tip') {
        git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'human tip']);
      }
      const result = runCheck(cwd, {
        BASE_SHA: '',
        BEFORE_SHA:
          scenario === 'missing before' ? '' : scenario === 'zero before' ? '0'.repeat(40) : before,
      });
      assert.equal(
        result.status,
        scenario === 'historical bot' ? 0 : 1,
        result.stdout + result.stderr,
      );
      if (scenario !== 'historical bot') assert.match(result.stdout, /::error::/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}

test('every commit in a clean human range passes', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'commit-author-'));
  try {
    git(cwd, ['init', '--quiet']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'base']);
    git(cwd, ['branch', 'base']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'first']);
    git(cwd, ['commit', '--quiet', '--allow-empty', '-m', 'second'], {
      name: 'Cairnwright',
      email: 'cairnwright@example.invalid',
    });
    const result = runCheck(cwd, { BASE_SHA: git(cwd, ['rev-parse', 'base']) });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /author:/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

for (const [name, email, expected] of [
  ['cairnwright[bot]', '347615582+cairnwright[bot]@users.noreply.github.com', 1],
  ['Human', '347615582+cairnwright[bot]@users.noreply.github.com', 1],
  ['cairnwright[bot]', 'other@example.com', 1],
  ['Human', 'human@example.com', 0],
  ['Cairnwright', 'cairnwright@example.com', 0],
]) {
  test(`author ${name} <${email}> exits ${expected} with a bot committer`, () => {
    const cwd = mkdtempSync(join(tmpdir(), 'commit-author-'));
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: name,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: 'cairnwright[bot]',
      GIT_COMMITTER_EMAIL: '347615582+cairnwright[bot]@users.noreply.github.com',
    };
    try {
      for (const args of [
        ['init', '--quiet'],
        ['commit', '--quiet', '--allow-empty', '-m', 'fixture'],
      ]) {
        const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
        assert.equal(result.status, 0, result.stderr);
      }
      assert.ok(shell);
      const result = runCheck(cwd);
      assert.equal(result.status, expected, result.stdout + result.stderr);
      assert.match(result.stdout, /author:/);
      if (expected === 1) assert.match(result.stdout, /::error::/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
}
