import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const script = new URL('./migration-main-gate.mjs', import.meta.url).pathname;
const journal = 'apps/server/drizzle/meta/_journal.json';
const common = { idx: 136, tag: '0136_base', when: 1000 };
const main = { idx: 137, tag: '0137_cold_slim_markers', when: 3000 };

function fixture(t, added) {
  const cwd = makeTestTempDir('migration-main-gate-');
  t.after(() => releaseTestTempDir(cwd));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(join(cwd, 'apps/server/drizzle/meta'), { recursive: true });
  const write = (entries) => {
    writeFileSync(join(cwd, journal), JSON.stringify({ entries }));
    for (const entry of entries)
      writeFileSync(join(cwd, `apps/server/drizzle/${entry.tag}.sql`), 'SELECT 1;\n');
  };
  const commit = () => {
    git('add', 'apps/server/drizzle');
    git('commit', '-qm', 'fixture');
  };
  write([common]);
  commit();
  const base = git('rev-parse', 'HEAD');
  write([common, ...(added ? [added] : [])]);
  if (added) commit();
  const head = git('rev-parse', 'HEAD');
  git('switch', '-q', '--detach', base);
  write([common, main]);
  commit();
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('switch', '-q', '--detach', head);
  return { git, run: () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' }) };
}

for (const [name, added] of [
  ['reused number', { idx: 137, tag: '0137_pr', when: 4000 }],
  ['reused tag', { ...main, when: 4000 }],
  ['stale timestamp', { idx: 138, tag: '0138_pr', when: 2000 }],
  ['equal timestamp', { idx: 138, tag: '0138_pr', when: 3000 }],
]) {
  test(`rejects ${name} against main that advanced after branching`, (t) => {
    const { run } = fixture(t, added);
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(`apps/server/drizzle/${added.tag}.sql`), result.stderr);
    assert.ok(
      result.stderr.includes('renumber to 0138 and set when to the current time in ms'),
      result.stderr,
    );
  });
}

test('accepts main highest + 1 with a newer timestamp', (t) => {
  const { run } = fixture(t, { idx: 138, tag: '0138_pr', when: 4000 });
  assert.equal(run().status, 0);
});

test('accepts a PR without migrations and main itself', (t) => {
  const { git, run } = fixture(t);
  assert.equal(run().status, 0);
  git('switch', '-q', '--detach', 'origin/main');
  assert.equal(run().status, 0);
});

test('fails closed when origin/main cannot be read', (t) => {
  const { git, run } = fixture(t);
  git('update-ref', '-d', 'refs/remotes/origin/main');
  assert.notEqual(run().status, 0);
});
