import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../test-tmpdir.mjs';
import { decide } from './tools/worktree-reaper.mjs';

const SCRIPT = join(import.meta.dirname, 'tools/worktree-reaper.mjs');
const NOW = Date.parse('2026-11-08T12:00:00Z');
const HOUR_AGO = '2026-11-08T11:00:00Z';

const tree = (overrides = {}) => ({
  path: '/repo/.claude/worktrees/a',
  head: 'aaa',
  branch: 'fix/a',
  locked: false,
  ...overrides,
});
const pr = (overrides = {}) => ({
  number: 7,
  state: 'MERGED',
  headRefName: 'fix/a',
  headRefOid: 'aaa',
  mergedAt: HOUR_AGO,
  closedAt: HOUR_AGO,
  ...overrides,
});
const FOUR_DAYS_AGO = NOW - 4 * 24 * 60 * 60_000;
const facts = {
  dirty: () => false,
  busy: () => [],
  pushedHead: () => null,
  savedOn: () => null,
  idleSince: () => FOUR_DAYS_AGO,
  nested: () => [],
};
const saved = { ...facts, savedOn: () => 'origin/main' };

test('a clean idle tree whose merged PR names its exact head is removed', () => {
  assert.deepEqual(decide(tree(), [pr()], NOW, facts), {
    action: 'remove',
    reason: 'PR #7 merged',
  });
});

test('a clean idle tree whose closed PR names its exact head is removed', () => {
  assert.deepEqual(decide(tree(), [pr({ state: 'CLOSED', mergedAt: null })], NOW, facts), {
    action: 'remove',
    reason: 'PR #7 closed',
  });
});

test('a pushed pr-assets/<n> tree follows PR n', () => {
  const assets = tree({ branch: 'pr-assets/7', head: 'img' });
  const pushed = { ...facts, pushedHead: () => 'img' };
  assert.deepEqual(decide(assets, [pr()], NOW, pushed), {
    action: 'remove',
    reason: 'PR #7 merged',
  });
  assert.deepEqual(decide(assets, [pr({ state: 'OPEN' })], NOW, pushed), {
    action: 'keep',
    reason: 'PR #7 is open',
  });
  assert.deepEqual(decide(assets, [pr()], NOW, { ...facts, pushedHead: () => 'older' }), {
    action: 'keep',
    reason: 'HEAD img of pr-assets/7 is not pushed',
  });
});

test('a clean tree idle for 3+ days whose HEAD is on a remote branch is removed without a PR', () => {
  const cases = [
    [tree({ branch: null }), [], 'detached HEAD, HEAD is on origin/main, idle 3+ days'],
    [tree(), [], 'no PR for fix/a, HEAD is on origin/main, idle 3+ days'],
    [
      tree({ branch: 'pr-assets/named' }),
      [],
      'no PR for pr-assets/named, HEAD is on origin/main, idle 3+ days',
    ],
    [
      tree({ branch: 'pr-assets/7' }),
      [],
      'no PR for pr-assets/7, HEAD is on origin/main, idle 3+ days',
    ],
    [
      tree({ head: 'bbb' }),
      [pr()],
      'HEAD bbb is not the head of any merged or closed PR, HEAD is on origin/main, idle 3+ days',
    ],
  ];
  for (const [worktree, prs, reason] of cases)
    assert.deepEqual(decide(worktree, prs, NOW, saved), { action: 'remove', reason });
  assert.deepEqual(decide(tree(), [pr({ state: 'OPEN' })], NOW, saved), {
    action: 'keep',
    reason: 'PR #7 is open',
  });
});

test('every reason to keep a tree is reported', () => {
  const cases = [
    [tree({ locked: true }), [pr()], facts, 'locked'],
    [tree({ branch: null }), [pr()], facts, 'detached HEAD and HEAD is on no remote branch'],
    [tree(), [], facts, 'no PR for fix/a and HEAD is on no remote branch'],
    [
      tree(),
      [],
      { ...saved, idleSince: () => NOW - 60 * 60_000 },
      'no PR for fix/a and the tree changed less than 3 days ago',
    ],
    [tree({ path: join(homedir(), '.t3/worktrees/cairn/a') }), [pr()], facts, 'managed by T3 Code'],
    [
      tree(),
      [pr()],
      { ...facts, nested: () => ['/repo/.claude/worktrees/a/.claude/worktrees/b'] },
      'contains worktree /repo/.claude/worktrees/a/.claude/worktrees/b',
    ],
    [tree(), [pr(), pr({ number: 9, state: 'OPEN' })], facts, 'PR #9 is open'],
    [
      tree({ head: 'bbb' }),
      [pr()],
      facts,
      'HEAD bbb is not the head of any merged or closed PR and HEAD is on no remote branch',
    ],
    [
      tree(),
      [pr({ mergedAt: '2026-11-08T11:50:00Z', closedAt: '2026-11-08T11:50:00Z' })],
      facts,
      'PR #7 merged less than 30 minutes ago',
    ],
    [tree(), [pr()], { ...facts, dirty: () => true }, 'uncommitted or untracked changes'],
    [tree(), [pr()], { ...facts, busy: () => [42, 43] }, 'in use by pid 42, 43'],
  ];
  for (const [worktree, prs, checks, reason] of cases)
    assert.deepEqual(decide(worktree, prs, NOW, checks), { action: 'keep', reason });
});

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
    cwd,
    encoding: 'utf8',
  }).trim();
}

function fixture(prs) {
  const dir = realpathSync(makeTestTempDir('worktree-reaper-'));
  const repo = join(dir, 'repo');
  mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'main');
  git(dir, 'init', '-q', '--bare', 'origin.git');
  git(repo, 'remote', 'add', 'origin', join(dir, 'origin.git'));
  writeFileSync(join(repo, '.gitignore'), 'node_modules/\n.claude/\n');
  git(repo, 'add', '.gitignore');
  git(repo, 'commit', '-q', '-m', 'init');
  const trees = {};
  const places = {
    merged: join(repo, '.claude/worktrees/merged'),
    dirty: join(repo, '.claude/worktrees/dirty'),
    open: join(repo, '.claude/worktrees/open'),
    moved: join(repo, '.claude/worktrees/moved'),
    busy: join(repo, '.claude/worktrees/busy'),
    holder: join(repo, '.claude/worktrees/holder'),
    fresh: join(repo, '.claude/worktrees/fresh'),
    local: join(repo, '.claude/worktrees/local'),
    named: join(dir, 'cache/named-assets'),
    foreign: join(dir, '.t3/worktrees/cairn/foreign'),
  };
  for (const [name, path] of Object.entries(places)) {
    git(repo, 'worktree', 'add', '-q', '-b', `fix/${name}`, path);
    writeFileSync(join(path, `${name}.txt`), name);
    git(path, 'add', `${name}.txt`);
    git(path, 'commit', '-q', '-m', name);
    mkdirSync(join(path, 'node_modules'));
    writeFileSync(join(path, 'node_modules/x.js'), '');
    trees[name] = { path, head: git(path, 'rev-parse', 'HEAD') };
  }
  const outside = join(dir, 'outside');
  git(repo, 'worktree', 'add', '-q', '-b', 'fix/outside', outside);
  trees.outside = { path: outside, head: git(outside, 'rev-parse', 'HEAD') };
  const baseline = join(dir, 'cache/baseline');
  git(repo, 'worktree', 'add', '-q', '--detach', baseline, 'main');
  trees.baseline = { path: baseline, head: git(baseline, 'rev-parse', 'HEAD') };
  const inner = join(places.holder, '.claude/worktrees/inner');
  git(repo, 'worktree', 'add', '-q', '-b', 'fix/inner', inner);
  writeFileSync(join(inner, 'unsaved.txt'), 'wip');
  trees.inner = { path: inner, head: git(inner, 'rev-parse', 'HEAD') };
  git(repo, 'push', '-q', 'origin', 'main', 'fix/named:pr-assets/named', 'fix/fresh');
  for (const name of ['named', 'baseline', 'local']) {
    const gitDir = git(trees[name].path, 'rev-parse', '--absolute-git-dir');
    const then = new Date(Date.now() - 4 * 24 * 60 * 60_000);
    for (const file of ['HEAD', 'index', 'logs/HEAD'])
      if (existsSync(join(gitDir, file))) utimesSync(join(gitDir, file), then, then);
  }
  writeFileSync(join(trees.dirty.path, 'scratch.txt'), 'wip');
  git(trees.moved.path, 'commit', '-q', '--allow-empty', '-m', 'after the PR');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\ncat ${JSON.stringify(join(dir, 'prs.json'))}\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  writeFileSync(join(dir, 'prs.json'), JSON.stringify(prs(trees)));
  return {
    dir,
    repo,
    trees,
    env: { ...process.env, HOME: dir, PATH: `${bin}:${process.env.PATH}` },
  };
}

const fixturePrs = (trees) => [
  pr({ number: 1, headRefName: 'fix/merged', headRefOid: trees.merged.head }),
  pr({ number: 2, headRefName: 'fix/dirty', headRefOid: trees.dirty.head }),
  pr({
    number: 3,
    headRefName: 'fix/open',
    headRefOid: trees.open.head,
    state: 'OPEN',
    mergedAt: null,
    closedAt: null,
  }),
  pr({ number: 4, headRefName: 'fix/moved', headRefOid: trees.moved.head }),
  pr({ number: 5, headRefName: 'fix/busy', headRefOid: trees.busy.head }),
  pr({ number: 6, headRefName: 'fix/outside', headRefOid: trees.outside.head }),
  pr({ number: 7, headRefName: 'fix/holder', headRefOid: trees.holder.head }),
  pr({ number: 8, headRefName: 'fix/foreign', headRefOid: trees.foreign.head }),
];

test('the reaper removes only the reapable tree and leaves every other one intact', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const { repo, trees, env } = fixture(fixturePrs);
  const user = spawn('sleep', ['30'], { cwd: trees.busy.path, stdio: 'ignore' });
  t.after(() => user.kill('SIGKILL'));
  const dry = spawnSync(process.execPath, [SCRIPT, '--repo', repo, '--dry-run'], {
    env,
    encoding: 'utf8',
  });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would remove .*\/merged \(PR #1 merged\)/);
  assert.equal(existsSync(trees.merged.path), true);
  const run = spawnSync(process.execPath, [SCRIPT, '--repo', repo], { env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /removed .*\/merged \(PR #1 merged\)/);
  assert.match(run.stdout, /kept .*\/dirty: uncommitted or untracked changes/);
  assert.match(run.stdout, /kept .*\/open: PR #3 is open/);
  assert.match(
    run.stdout,
    /kept .*\/moved: HEAD [0-9a-f]+ is not the head of any merged or closed PR and HEAD is on no remote branch/,
  );
  assert.match(run.stdout, new RegExp(`kept .*/busy: in use by pid ${user.pid}`));
  assert.match(run.stdout, /removed .*\/outside \(PR #6 merged\)/);
  assert.match(
    run.stdout,
    /removed .*\/named-assets \(no PR for fix\/named, HEAD is on origin\/pr-assets\/named, idle 3\+ days\)/,
  );
  assert.match(
    run.stdout,
    /removed .*\/baseline \(detached HEAD, HEAD is on origin\/\S+, idle 3\+ days\)/,
  );
  assert.match(
    run.stdout,
    /kept .*\/fresh: no PR for fix\/fresh and the tree changed less than 3 days ago/,
  );
  assert.match(run.stdout, /kept .*\/local: no PR for fix\/local and HEAD is on no remote branch/);
  assert.match(run.stdout, /kept .*\/holder: contains worktree .*\/inner/);
  assert.match(run.stdout, /kept .*\/foreign: managed by T3 Code/);
  assert.doesNotMatch(run.stdout, new RegExp(`(kept|removed) ${repo}[:( ]`));
  for (const name of ['merged', 'outside', 'named', 'baseline'])
    assert.equal(existsSync(trees[name].path), false, name);
  for (const name of [
    'dirty',
    'open',
    'moved',
    'busy',
    'holder',
    'inner',
    'fresh',
    'local',
    'foreign',
  ])
    assert.equal(existsSync(trees[name].path), true, name);
  assert.equal(existsSync(join(trees.inner.path, 'unsaved.txt')), true);
  assert.match(git(repo, 'branch', '--list', 'fix/merged'), /fix\/merged/);
  assert.equal(existsSync(join(trees.dirty.path, 'scratch.txt')), true);
});

test('a failing gh removes nothing', () => {
  const { repo, trees, env, dir } = fixture(fixturePrs);
  writeFileSync(join(dir, 'bin/gh'), '#!/bin/sh\necho offline >&2\nexit 1\n');
  const run = spawnSync(process.execPath, [SCRIPT, '--repo', repo], { env, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /gh pr list failed/);
  assert.equal(existsSync(trees.merged.path), true);
});

test('a failing fetch removes nothing', () => {
  const { repo, trees, env, dir } = fixture(fixturePrs);
  rmSync(join(dir, 'origin.git'), { recursive: true });
  const run = spawnSync(process.execPath, [SCRIPT, '--repo', repo], { env, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /git fetch failed/);
  assert.equal(existsSync(trees.merged.path), true);
});
