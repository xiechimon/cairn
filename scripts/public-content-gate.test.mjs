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
]) {
  test(`allows near-miss: ${text}`, () => {
    assert.deepEqual(fileViolations('docs/ops/example.md', text), []);
  });
}

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

test('push scan reads committed additions and ignores removed or unchanged disclosures', (t) => {
  const { cwd, git, run } = repository(t);
  writeFileSync(join(cwd, 'example.md'), 'safe\nusage: 37\u0025\n');
  git('add', 'example.md');
  git('commit', '-qm', 'synthetic addition');
  writeFileSync(join(cwd, 'example.md'), 'safe\n');
  assert.equal(run().status, 1);
  git('add', 'example.md');
  git('commit', '-qm', 'remove synthetic addition');
  assert.equal(run().status, 0);
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
  for (const name of ['commit-identity.mjs', 'check-lockfile-commit.mjs'])
    writeFileSync(join(cwd, 'scripts', name), '');
  const result = spawnSync('sh', [join(import.meta.dirname, '../.husky/pre-commit')], {
    cwd,
    encoding: 'utf8',
    env: scrubGitEnv({ ...process.env }),
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /"link.md":1: public-content identifier/);
  assert.ok(!result.stderr.includes(uuid));
});

test('invalid options and missing base fail closed', (t) => {
  const { run } = repository(t);
  assert.equal(run('--unknown').status, 2);
  assert.equal(run('--base', 'missing-ref').status, 2);
});
