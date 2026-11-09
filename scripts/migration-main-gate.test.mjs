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

function fixture(t, added = []) {
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
  write([common, ...added]);
  if (added.length) commit();
  const head = git('rev-parse', 'HEAD');
  git('switch', '-q', '--detach', base);
  write([common, main]);
  commit();
  git('update-ref', 'refs/remotes/origin/main', git('rev-parse', 'HEAD'));
  git('switch', '-q', '--detach', head);
  return {
    git,
    run: () => spawnSync(process.execPath, [script], { cwd, encoding: 'utf8' }),
    applyAdvice: (output) => {
      const repaired = added.map((entry, index) => {
        const line = output
          .split('\n')
          .find((value) => value.startsWith(`apps/server/drizzle/${entry.tag}.sql:`));
        if (!line) return entry;
        const next = /; renumber to (\d+) and set when/.exec(line)?.[1];
        return {
          idx: next ? Number(next) : entry.idx,
          tag: next ? entry.tag.replace(/^\d+_/, `${next}_`) : entry.tag,
          when: 6000 + index,
        };
      });
      const combined = [common, main, ...repaired];
      for (const values of [
        combined.map((entry) => entry.idx),
        combined.map((entry) => entry.tag),
        combined.map((entry) => Number(entry.tag.split('_')[0])),
      ])
        assert.equal(new Set(values).size, values.length, output);
      git('rm', '--', ...added.map((entry) => `apps/server/drizzle/${entry.tag}.sql`));
      write([common, ...repaired]);
      commit();
    },
  };
}

for (const [name, added] of [
  ['reused number', { idx: 137, tag: '0137_pr', when: 4000 }],
  ['reused tag', { ...main, when: 4000 }],
  ['stale timestamp', { idx: 138, tag: '0138_pr', when: 2000 }],
  ['equal timestamp', { idx: 138, tag: '0138_pr', when: 3000 }],
]) {
  test(`rejects ${name} against main that advanced after branching`, (t) => {
    const { run } = fixture(t, [added]);
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(result.stderr.includes(`apps/server/drizzle/${added.tag}.sql`), result.stderr);
    const repair = name.startsWith('reused')
      ? 'renumber to 0138 and set when to the current time in ms'
      : 'set when to the current time in ms';
    assert.ok(result.stderr.includes(`; ${repair}\n`), result.stderr);
  });
}

test('timestamp-only repair preserves the second added migration number', (t) => {
  const { run } = fixture(t, [
    { idx: 138, tag: '0138_pr', when: 4000 },
    { idx: 139, tag: '0139_pr', when: 2000 },
  ]);
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(
    result.stderr,
    'apps/server/drizzle/0139_pr.sql: when must exceed origin/main maximum; set when to the current time in ms\n',
  );
});

test('two colliding additions receive distinct repair numbers in journal order', (t) => {
  const { run } = fixture(t, [
    { idx: 136, tag: '0136_pr', when: 4000 },
    { idx: 137, tag: '0137_pr', when: 5000 },
  ]);
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(
    result.stderr,
    'apps/server/drizzle/0136_pr.sql: migration number or tag already exists on origin/main; renumber to 0138 and set when to the current time in ms\n' +
      'apps/server/drizzle/0137_pr.sql: migration number or tag already exists on origin/main; renumber to 0139 and set when to the current time in ms\n',
  );
});

test('collision repair counts valid added migrations before the failing entry', (t) => {
  const { run } = fixture(t, [
    { idx: 138, tag: '0138_pr', when: 4000 },
    { idx: 137, tag: '0137_pr', when: 5000 },
  ]);
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(
    result.stderr,
    'apps/server/drizzle/0137_pr.sql: migration number or tag already exists on origin/main; renumber to 0139 and set when to the current time in ms\n',
  );
});

for (const [name, added, targets] of [
  [
    'two additions when main takes the first number',
    [
      { idx: 137, tag: '0137_pr', when: 4000 },
      { idx: 138, tag: '0138_pr', when: 5000 },
    ],
    ['0138', '0139'],
  ],
  [
    'three additions when main takes the first number',
    [
      { idx: 137, tag: '0137_pr', when: 4000 },
      { idx: 138, tag: '0138_pr', when: 5000 },
      { idx: 139, tag: '0139_pr', when: 6000 },
    ],
    ['0138', '0139', '0140'],
  ],
  [
    'a stale timestamp inside the displaced suffix',
    [
      { idx: 137, tag: '0137_pr', when: 4000 },
      { idx: 138, tag: '0138_pr', when: 2000 },
      { idx: 139, tag: '0139_pr', when: 5000 },
    ],
    ['0138', '0139', '0140'],
  ],
  [
    'a valid prefix before a collision and its displaced successor',
    [
      { idx: 138, tag: '0138_pr', when: 4000 },
      { idx: 137, tag: '0137_pr', when: 5000 },
      { idx: 139, tag: '0139_pr', when: 6000 },
    ],
    ['0139', '0140'],
  ],
  [
    'a reused tag followed by a valid addition',
    [
      { ...main, when: 4000 },
      { idx: 138, tag: '0138_pr', when: 5000 },
    ],
    ['0138', '0139'],
  ],
  [
    'a timestamp-only failure without a number collision',
    [
      { idx: 138, tag: '0138_pr', when: 2000 },
      { idx: 139, tag: '0139_pr', when: 5000 },
    ],
    [],
  ],
]) {
  test(`advertised repairs leave no duplicates for ${name}`, (t) => {
    const { run, applyAdvice } = fixture(t, added);
    const result = run();
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.deepEqual(
      [...result.stderr.matchAll(/; renumber to (\d+) and set when/g)].map((match) => match[1]),
      targets,
      result.stderr,
    );
    applyAdvice(result.stderr);
    const repaired = run();
    assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  });
}

test('accepts main highest + 1 with a newer timestamp', (t) => {
  const { run } = fixture(t, [{ idx: 138, tag: '0138_pr', when: 4000 }]);
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
