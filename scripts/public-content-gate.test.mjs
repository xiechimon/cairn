import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileViolations } from './public-content-gate.mjs';
import { scrubGitEnv } from './scrub-git-env.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const uuid = ['12345678', '1234', '4567', '89ab', '123456789abc'].join('-');
const nanoid = 'AbCdEfGhIjKlMnOpQrSt1';
const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const publicRepositoryNodePrefix = '_kwDOUSKs6c';

for (const text of [
  'Usage: 37\u0025',
  'quota remaining: 63\u0025',
  '37\u0025 of quota used',
  '\u989d\u5ea6 37\u0025',
  'weekly window: 37\u0025',
  '5-hour window 37\u0025 used',
  'Resets at ' + '18:30 UTC',
  'reset in ' + '2 hours',
  'x-ratelimit-remaining: ' + '42',
  'rate-limit status\u003a exhausted',
  `teamId: "${nanoid}"`,
  `project_id=${ulid}`,
  `machine: ${uuid}`,
  `thread id: ${uuid}`,
  `buildId = '${uuid}'`,
  `trace_id: ${nanoid}`,
  `sessionId: '${uuid}'`,
  `{"teamId":"${nanoid}"}`,
  `team ${nanoid}`,
  `project: \`${uuid}\``,
  'usage: 37.5\u0025',
  'resets in ' + '2h',
  'remaining: 63\u0025',
  'limit = 37\u0025',
  'Claude usage is 37\u0025',
  '37\u0025 remaining for Codex',
  'const status = "Usage: 37\u0025";',
  '{"usage":"37\u0025"}',
]) {
  test(`blocks synthetic disclosure: ${text.split(':')[0]}`, () => {
    assert.equal(fileViolations('docs/ops/example.md', text).length, 1);
  });
}

for (const text of [
  'CI p90 15%',
  'Coverage: 95%',
  'width: 50%;',
  'usage is reported as a percentage',
  'Set a quota limit',
  'weekly window documentation',
  'reset at startup',
  'rate-limit handling retries requests',
  'limit: 100',
  'remaining tasks: 37',
  `const id = '${uuid}';`,
  'teamId: example-team',
  'build a useful implementation',
  'coverage 95%; usage is documented separately',
  'Raise the coverage limit to 95%',
  'The remaining 10% is padding',
  'Disk usage: 15%',
  'Memory usage is 15%',
  'coverage limit: 95%',
  'rate-limit status: enabled',
  'rate-limit status: disabled',
]) {
  test(`allows near-miss: ${text}`, () => {
    assert.deepEqual(fileViolations('docs/ops/example.md', text), []);
  });
}

for (const prefix of ['PRRT', 'PRR', 'PRRC', 'IC', 'PR', 'I', 'D', 'DC']) {
  test(`allows synthetic public GitHub ${prefix} node IDs without ignoring quotas`, () => {
    const id = `${prefix}${publicRepositoryNodePrefix}`.padEnd(21, 'A');
    assert.equal(id.length, 21);
    assert.deepEqual(fileViolations('docs/review.md', `thread ${id}`), []);
    assert.deepEqual(fileViolations('docs/review.md', `thread ${id}; quota: 37\u0025`), [
      { line: 1, kind: 'quota/usage' },
    ]);
  });
  test(`GitHub ${prefix} node IDs from other repositories remain blocked`, () => {
    for (const length of [21, 26, 30]) {
      const id = `${prefix}_kwDO`.padEnd(length, 'A');
      assert.deepEqual(fileViolations('docs/review.md', `thread ${id}`), [
        { line: 1, kind: 'identifier' },
      ]);
    }
  });
}

test('private identifier shapes and GitHub-like near-misses remain blocked', () => {
  for (const id of [
    nanoid,
    ulid,
    uuid,
    'TEAM_kwDO'.padEnd(21, 'A'),
    'PRRT_kxDO'.padEnd(21, 'A'),
    'PRRT_kwDX'.padEnd(21, 'A'),
    'prrt_kwDO'.padEnd(21, 'A'),
  ]) {
    for (const key of ['team', 'project', 'machine', 'thread', 'build', 'trace', 'session'])
      assert.deepEqual(fileViolations('docs/review.md', `${key}: ${id}`), [
        { line: 1, kind: 'identifier' },
      ]);
  }
});

test('path allowlist exempts fixture identifiers but not quota disclosures', () => {
  for (const path of [
    'apps/server/test/id.test.ts',
    'apps/web/e2e/fixtures/data.ts',
    'apps/web/e2e/synthetic-id.spec.ts',
    'e2e/fixtures/data.json',
  ]) {
    assert.deepEqual(fileViolations(path, `teamId: '${uuid}'`), []);
    assert.equal(fileViolations(path, 'usage: 37\u0025').length, 1);
  }
  for (const path of [
    'apps/server/src/test/data.ts',
    'apps/web/e2e/evidence.md',
    'docs/fixtures/data.md',
  ]) {
    assert.equal(fileViolations(path, `teamId: '${uuid}'`).length, 1);
  }
});

test('allow-comment markers do not bypass detection', () => {
  assert.equal(
    fileViolations('docs/example.md', `teamId: ${uuid} // public-content-allow`).length,
    1,
  );
});

test('line numbers and diagnostics do not expose matched content', () => {
  assert.deepEqual(fileViolations('docs/example.md', `safe\nteamId: ${uuid}`), [
    { line: 2, kind: 'identifier' },
  ]);
});

test('commit hook checks the index before checks and after automatic restaging', () => {
  const hook = readFileSync(new URL('../.husky/pre-commit', import.meta.url), 'utf8');
  const command = 'node scripts/public-content-gate.mjs --staged';
  assert.ok(hook.indexOf(command) < hook.indexOf('pnpm exec biome'));
  assert.ok(hook.lastIndexOf(command) > hook.indexOf('git add "$f"'));
});

const script = join(import.meta.dirname, 'public-content-gate.mjs');
function repository(t) {
  const cwd = makeTestTempDir('public-content-gate-');
  t.after(() => releaseTestTempDir(cwd));
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: scrubGitEnv({ ...process.env }) });
  git('init', '-q');
  git('config', 'user.name', 'Synthetic Test');
  git('config', 'user.email', 'synthetic@example.invalid');
  writeFileSync(join(cwd, 'example.md'), 'safe\n');
  git('add', 'example.md');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  const run = (...args) =>
    spawnSync(process.execPath, [script, ...args], {
      cwd,
      encoding: 'utf8',
      env: scrubGitEnv({ ...process.env, PREPUSH_BASE_SHA: base }),
    });
  return { cwd, git, run };
}

for (const [kind, id] of [
  ['private identifier', nanoid],
  ['foreign repository node', 'PRRT_kwDO'.padEnd(21, 'A')],
]) {
  test(`commit messages accept this public repository's thread but reject a ${kind}`, (t) => {
    const { git, run } = repository(t);
    const publicNode = `PRRT${publicRepositoryNodePrefix}`.padEnd(21, 'A');
    git('commit', '--allow-empty', '-qm', `Resolve thread ${publicNode}`);
    assert.equal(run().status, 0);
    git('commit', '--allow-empty', '-qm', `Record thread ${id}`);
    assert.equal(run().status, 1);
  });
}

test('GitHub node IDs are benign in staged text and committed snapshots', (t) => {
  const { cwd, git, run } = repository(t);
  const publicNode = `PRRT${publicRepositoryNodePrefix}`.padEnd(21, 'A');
  writeFileSync(join(cwd, 'example.md'), `thread: ${publicNode}\n`);
  git('add', 'example.md');
  assert.equal(run('--staged').status, 0);
  git('commit', '-qm', 'synthetic public reference');
  assert.equal(run().status, 0);
  writeFileSync(join(cwd, 'example.md'), `thread: ${'PRRT_kwDO'.padEnd(21, 'A')}\n`);
  git('add', 'example.md');
  assert.equal(run('--staged').status, 1);
  git('commit', '-qm', 'synthetic foreign reference');
  assert.equal(run().status, 1);
  const foreignHead = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(cwd, 'example.md'), `teamId: ${nanoid}\n`);
  git('add', 'example.md');
  assert.equal(run('--staged').status, 1);
  git('commit', '-qm', 'synthetic private reference');
  assert.equal(run('--base', foreignHead).status, 1);
});

test('staged scan reads index, not unstaged content, and redacts diagnostics', (t) => {
  const { cwd, git, run } = repository(t);
  writeFileSync(join(cwd, 'example.md'), `safe\nteamId: ${uuid}\n`);
  git('add', 'example.md');
  writeFileSync(join(cwd, 'example.md'), 'safe\n');
  const result = run('--staged');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /"example.md":2:.*identifier/);
  assert.ok(!result.stderr.includes(uuid));
  git('add', 'example.md');
  writeFileSync(join(cwd, 'example.md'), 'usage: 37\u0025\n');
  assert.equal(run('--staged').status, 0);
});

test('push scan preserves disclosures removed by a later introduced commit', (t) => {
  const { cwd, git, run } = repository(t);
  writeFileSync(join(cwd, 'example.md'), 'safe\nusage: 37\u0025\n');
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic addition');
  writeFileSync(join(cwd, 'example.md'), 'safe\n');
  assert.equal(run().status, 1);
  git('add', 'example.md');
  git('commit', '-qm', 'remove synthetic addition');
  assert.equal(run().status, 1);
});

test('staged scan supports unusual paths, extensionless text and binary files', (t) => {
  const { cwd, git, run } = repository(t);
  mkdirSync(join(cwd, 'data'));
  writeFileSync(join(cwd, 'data', 'binary'), Buffer.from('usage: 37\u0025\0'));
  writeFileSync(join(cwd, 'data', 'odd\n name'), 'usage: 37\u0025\n');
  git('add', 'data/binary', 'data/odd\n name');
  assert.equal(run('--staged').status, 1);
  git('rm', '--cached', 'data/odd\n name');
  assert.equal(run('--staged').status, 0);
});

test('type-changing additions are checked in staged and committed diffs', (t) => {
  const { cwd, git, run } = repository(t);
  const link = join(cwd, 'link.md');
  symlinkSync('example.md', link);
  git('add', 'link.md');
  git('commit', '-qm', 'synthetic symlink');
  const base = git('rev-parse', 'HEAD').trim();
  unlinkSync(link);
  writeFileSync(link, `teamId: ${uuid}\n`);
  git('add', 'link.md');
  assert.match(git('diff', '--cached', '--name-status'), /^T\s+link\.md/m);
  assert.equal(run('--staged').status, 1);
  git('commit', '-qm', 'synthetic type change');
  assert.equal(run('--base', base).status, 1);
});

test('the real commit hook refuses a type-change-only disclosure before formatting', (t) => {
  const { cwd, git } = repository(t);
  const link = join(cwd, 'link.md');
  symlinkSync('example.md', link);
  git('add', 'link.md');
  git('commit', '-qm', 'synthetic symlink');
  unlinkSync(link);
  writeFileSync(link, `teamId: ${uuid}\n`);
  git('add', 'link.md');
  mkdirSync(join(cwd, 'scripts'));
  for (const name of ['public-content-gate.mjs', 'public-content-allowlist.json'])
    copyFileSync(join(import.meta.dirname, name), join(cwd, 'scripts', name));
  writeFileSync(join(cwd, 'scripts', 'commit-identity.mjs'), '');
  const result = spawnSync('sh', [join(import.meta.dirname, '../.husky/pre-commit')], {
    cwd,
    encoding: 'utf8',
    env: scrubGitEnv({ ...process.env }),
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /"link.md":1: public-content identifier/);
  assert.ok(!result.stderr.includes(uuid));
});

test('multiline matching preserves attribution without joining separate blocks', () => {
  for (const [content, kind] of [
    [`"teamId":\n  "${nanoid}"`, 'identifier'],
    ['quota remaining:\n  37\u0025', 'quota/usage'],
    ['37\u0025\n  quota remaining', 'quota/usage'],
    ['Resets in\n  2 hours', 'quota/usage'],
    ['rate-limit status\u003a\n  exhausted', 'quota/usage'],
  ]) {
    assert.deepEqual(fileViolations('docs/example.md', content), [
      { line: 1, kind },
      { line: 2, kind },
    ]);
  }
  for (const content of [
    'Usage documentation\n\nCoverage: 95%',
    `teamId:\n\n${nanoid}`,
    `teamId:\r\n \t\r\n${nanoid}`,
    'CI p90 15%\ncoverage 95%\nwidth: 50%;',
  ])
    assert.deepEqual(fileViolations('docs/example.md', content), []);
  assert.deepEqual(fileViolations('apps/server/test/data.ts', `teamId:\n${nanoid}`), []);
});

for (const [key, value] of [
  ['teamId:', nanoid],
  ['quota remaining:', '37\u0025'],
]) {
  for (const changed of ['key', 'value']) {
    test(`multiline ${key} catches an added ${changed} in staged and committed snapshots`, (t) => {
      const { cwd, git, run } = repository(t);
      const before = changed === 'key' ? `label:\n${value}\n` : `${key}\nexample\n`;
      writeFileSync(join(cwd, 'example.md'), before);
      git('add', 'example.md');
      git('commit', '-qm', 'synthetic baseline');
      const base = git('rev-parse', 'HEAD').trim();
      writeFileSync(join(cwd, 'example.md'), `${key}\n${value}\n`);
      git('add', 'example.md');
      const staged = run('--staged');
      assert.equal(staged.status, 1, staged.stderr);
      assert.match(staged.stderr, new RegExp(`"example.md":${changed === 'key' ? 1 : 2}:`));
      git('commit', '-qm', 'synthetic multiline change');
      assert.equal(run('--base', base).status, 1);
    });
  }
}

for (const message of ['quota remaining: 37\u0025', `teamId: ${nanoid}`]) {
  test('commit-message-only disclosures are rejected without echoing their content', (t) => {
    const { git, run } = repository(t);
    git('commit', '--allow-empty', '-qm', message);
    const result = run();
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /commit message/);
    assert.ok(!result.stderr.includes(message));
    assert.ok(!result.stderr.includes(nanoid));
    assert.equal(run('--staged').status, 0);
  });
}

test('base messages and unchanged or removed base disclosures are excluded', (t) => {
  const { cwd, git, run } = repository(t);
  writeFileSync(join(cwd, 'example.md'), `teamId:\n${nanoid}\n`);
  git('add', 'example.md');
  git('commit', '-qm', 'quota remaining: 37\u0025');
  const base = git('rev-parse', 'HEAD').trim();
  writeFileSync(join(cwd, 'example.md'), `teamId:\n${nanoid}\nclean addition\n`);
  git('add', 'example.md');
  assert.equal(run('--staged').status, 0);
  git('commit', '-qm', 'synthetic clean addition');
  assert.equal(run('--base', base).status, 0);
  writeFileSync(join(cwd, 'example.md'), 'safe\n');
  git('add', 'example.md');
  git('commit', '-qm', 'remove inherited disclosure');
  assert.equal(run('--base', base).status, 0);
});

test('side-branch intermediate disclosures survive a clean merge result', (t) => {
  const { cwd, git, run } = repository(t);
  const branch = git('branch', '--show-current').trim();
  git('switch', '-qc', 'synthetic-side');
  writeFileSync(join(cwd, 'example.md'), `teamId: ${nanoid}\n`);
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic side addition');
  writeFileSync(join(cwd, 'example.md'), 'safe\n');
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic side cleanup');
  git('switch', '-q', branch);
  git('merge', '-q', '--no-ff', 'synthetic-side', '-m', 'merge synthetic side');
  assert.equal(run().status, 1);
});

test('merging the published base does not rescan its existing disclosures', (t) => {
  const { cwd, git, run } = repository(t);
  const branch = git('branch', '--show-current').trim();
  git('switch', '-qc', 'synthetic-feature');
  git('commit', '--allow-empty', '-qm', 'synthetic feature');
  git('switch', '-q', branch);
  writeFileSync(join(cwd, 'published.md'), `teamId: ${nanoid}\n`);
  git('add', 'published.md');
  git('commit', '-qm', 'quota remaining: 37\u0025');
  const base = git('rev-parse', 'HEAD').trim();
  git('switch', '-q', 'synthetic-feature');
  git('merge', '-q', '--no-ff', branch, '-m', 'merge published base');
  assert.equal(run('--base', base).status, 0);
});

test('a merge resolution that combines a key and value from different parents is checked', (t) => {
  const { cwd, git, run } = repository(t);
  const branch = git('branch', '--show-current').trim();
  git('switch', '-qc', 'synthetic-feature');
  writeFileSync(join(cwd, 'example.md'), 'teamId:\nexample\n');
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic key');
  git('switch', '-q', branch);
  writeFileSync(join(cwd, 'example.md'), `label:\n${nanoid}\n`);
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic value');
  const base = git('rev-parse', 'HEAD').trim();
  git('switch', '-q', 'synthetic-feature');
  assert.throws(() => git('merge', '--no-commit', branch));
  writeFileSync(join(cwd, 'example.md'), `teamId:\n${nanoid}\n`);
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic merge resolution');
  assert.equal(run('--base', base).status, 1);
});

for (const attribute of ['binary', '-diff']) {
  test(`Git ${attribute} attributes cannot hide staged or historical text disclosures`, (t) => {
    const { cwd, git, run } = repository(t);
    writeFileSync(join(cwd, '.gitattributes'), `*.md ${attribute}\n`);
    writeFileSync(join(cwd, 'example.md'), 'Usage: 37\u0025\n');
    git('add', '.gitattributes', 'example.md');
    assert.equal(run('--staged').status, 1);
    git('commit', '-qm', 'synthetic attributed disclosure');
    assert.equal(run().status, 1);
    writeFileSync(join(cwd, 'example.md'), 'safe\n');
    git('add', 'example.md');
    git('commit', '-qm', 'synthetic attributed cleanup');
    assert.equal(run().status, 1);
  });

  test(`Git ${attribute} attributes preserve benign text and actual binary near-misses`, (t) => {
    const { cwd, git, run } = repository(t);
    writeFileSync(join(cwd, '.gitattributes'), `*.md ${attribute}\n`);
    writeFileSync(join(cwd, 'example.md'), 'Raise the coverage limit to 95%\n');
    writeFileSync(join(cwd, 'binary.md'), Buffer.from('Usage: 37\u0025\0'));
    git('add', '.gitattributes', 'example.md', 'binary.md');
    assert.equal(run('--staged').status, 0);
    git('commit', '-qm', 'synthetic attributed near misses');
    assert.equal(run().status, 0);
  });
}

test('invalid options and missing base fail closed', (t) => {
  const { run } = repository(t);
  assert.equal(run('--unknown').status, 2);
  assert.equal(run('--base', 'missing-ref').status, 2);
});
