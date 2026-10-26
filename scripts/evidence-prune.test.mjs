import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { scrubGitEnv } from './scrub-git-env.mjs';
import { makeTestTempDir } from './test-tmpdir.mjs';

const script = resolve(import.meta.dirname, 'evidence-prune.mjs');
const NOW = '2026-10-25T12:00:00Z';
const daysAgo = (days) => new Date(Date.parse(NOW) - days * 86400000).toISOString();
const env = scrubGitEnv({ ...process.env });

const fixture = () => {
  const cwd = makeTestTempDir('evidence-prune-');
  const git = (date, ...args) =>
    execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    });
  git(daysAgo(60), 'init', '-b', 'main');
  git(daysAgo(60), 'config', 'user.email', 'test@example.com');
  git(daysAgo(60), 'config', 'user.name', 'Test');
  return {
    cwd,
    commit: (date, tree) => {
      for (const [path, content] of Object.entries(tree)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), content);
      }
      git(date, 'add', '.');
      git(date, 'commit', '-m', 'change');
      return git(date, 'rev-parse', 'HEAD').trim();
    },
    run: (...args) =>
      spawnSync(process.execPath, [script, '--now', NOW, ...args], {
        cwd,
        encoding: 'utf8',
        env,
      }),
    ledger: () => JSON.parse(readFileSync(join(cwd, 'docs/verify/pruned.json'), 'utf8')),
    has: (path) => existsSync(join(cwd, path)),
    staged: () => git(NOW, 'diff', '--cached', '--name-status').trim(),
    cleanup: () => rmSync(cwd, { recursive: true, force: true }),
  };
};

test('prunes evidence folders older than the window and records their last commit', () => {
  const repo = fixture();
  try {
    const oldSha = repo.commit(daysAgo(30), { 'docs/verify/100/shot.png': 'a' });
    repo.commit(daysAgo(3), { 'docs/verify/200/shot.png': 'b' });
    const result = repo.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.has('docs/verify/100'), false);
    assert.equal(repo.has('docs/verify/200/shot.png'), true);
    assert.deepEqual(repo.ledger(), { 100: oldSha });
    assert.match(repo.staged(), /^D\tdocs\/verify\/100\/shot\.png$/m);
    assert.match(repo.staged(), /docs\/verify\/pruned\.json/);
  } finally {
    repo.cleanup();
  }
});

test('the last commit touching any file in the folder decides its age', () => {
  const repo = fixture();
  try {
    repo.commit(daysAgo(40), { 'docs/verify/100/a.png': 'a' });
    repo.commit(daysAgo(2), { 'docs/verify/100/b.png': 'b' });
    const result = repo.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.has('docs/verify/100/a.png'), true);
  } finally {
    repo.cleanup();
  }
});

test('keeps folders that code, CI or scripts reference, matching whole folder names', () => {
  const repo = fixture();
  try {
    repo.commit(daysAgo(30), {
      'docs/verify/1542/reach.test.mjs': 'x',
      'docs/verify/1404/a.txt': 'x',
      'docs/verify/14040/a.txt': 'x',
      'docs/verify/900/a.txt': 'x',
      'docs/verify/1262/row.txt': 'x',
      '.claude/skills/verify-x/scripts/drive.mjs': "join(REPO, 'docs/verify/1262/row.txt')\n",
      '.claude/skills/verify-x/changelog/a.md': 'docs/verify/900/\n',
      '.github/workflows/ci.yml': 'run: node --test docs/verify/1542/reach.test.mjs\n',
      'apps/daemon/test/x.test.ts': "read('docs/verify/14040/a.txt')\n",
      'docs/spec/01.md': 'see docs/verify/900/a.txt\n',
    });
    const result = repo.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.has('docs/verify/1542/reach.test.mjs'), true);
    assert.equal(repo.has('docs/verify/14040/a.txt'), true);
    assert.equal(repo.has('docs/verify/1262/row.txt'), true);
    assert.equal(repo.has('docs/verify/1404'), false);
    assert.equal(repo.has('docs/verify/900'), false);
    assert.deepEqual(Object.keys(repo.ledger()), ['900', '1404']);
  } finally {
    repo.cleanup();
  }
});

test('dry run reports without touching the tree or the ledger', () => {
  const repo = fixture();
  try {
    repo.commit(daysAgo(30), { 'docs/verify/100/shot.png': 'a' });
    const result = repo.run('--dry-run');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /prune docs\/verify\/100\//);
    assert.equal(repo.has('docs/verify/100/shot.png'), true);
    assert.equal(repo.has('docs/verify/pruned.json'), false);
    assert.equal(repo.staged(), '');
  } finally {
    repo.cleanup();
  }
});

test('merges into an existing ledger with sorted keys and honours --days', () => {
  const repo = fixture();
  try {
    repo.commit(daysAgo(50), { 'docs/verify/pruned.json': '{"7":"abc"}\n' });
    const sha = repo.commit(daysAgo(10), { 'docs/verify/XMON-9/a.png': 'a' });
    assert.equal(repo.run().status, 0);
    assert.equal(repo.has('docs/verify/XMON-9/a.png'), true);
    const result = repo.run('--days', '7');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.has('docs/verify/XMON-9'), false);
    assert.deepEqual(Object.keys(repo.ledger()), ['7', 'XMON-9']);
    assert.equal(repo.ledger()['XMON-9'], sha);
  } finally {
    repo.cleanup();
  }
});

test('nothing due leaves the tree unchanged', () => {
  const repo = fixture();
  try {
    repo.commit(daysAgo(1), { 'docs/verify/100/shot.png': 'a' });
    const result = repo.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /nothing to prune/);
    assert.equal(repo.has('docs/verify/pruned.json'), false);
  } finally {
    repo.cleanup();
  }
});

test('refuses a shallow clone, where every folder looks freshly committed', () => {
  const repo = fixture();
  const shallow = makeTestTempDir('evidence-prune-shallow-');
  try {
    repo.commit(daysAgo(30), { 'docs/verify/100/shot.png': 'a' });
    repo.commit(daysAgo(1), { 'docs/verify/200/shot.png': 'b' });
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${repo.cwd}`, shallow], { env });
    const result = spawnSync(process.execPath, [script, '--now', NOW], {
      cwd: shallow,
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /shallow/);
    assert.equal(existsSync(join(shallow, 'docs/verify/100/shot.png')), true);
  } finally {
    repo.cleanup();
    rmSync(shallow, { recursive: true, force: true });
  }
});

test('a staged folder that has no commit yet is left alone', () => {
  const repo = fixture();
  try {
    repo.commit(daysAgo(30), { 'docs/verify/100/shot.png': 'a' });
    mkdirSync(join(repo.cwd, 'docs/verify/300'), { recursive: true });
    writeFileSync(join(repo.cwd, 'docs/verify/300/new.png'), 'c');
    execFileSync('git', ['add', 'docs/verify/300/new.png'], { cwd: repo.cwd, env });
    const result = repo.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(repo.has('docs/verify/100'), false);
    assert.equal(repo.has('docs/verify/300/new.png'), true);
  } finally {
    repo.cleanup();
  }
});
