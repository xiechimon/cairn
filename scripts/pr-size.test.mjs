import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sizeCap, sizeLabelPlan, sizeOf } from './pr-size.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const script = fileURLToPath(new URL('./pr-size.mjs', import.meta.url));

const f = (filename, additions, deletions = 0) => ({ filename, additions, deletions });

test('bands follow t3code: 9 is XS, 10 is S, 1000 is XXL', () => {
  assert.equal(sizeOf([f('apps/web/src/a.ts', 9)]).label, 'size:XS');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 10)]).label, 'size:S');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 99)]).label, 'size:M');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 499)]).label, 'size:L');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 999)]).label, 'size:XL');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 1000)]).label, 'size:XXL');
});

test('tests, evidence, snapshots, generated drizzle meta and the lockfile are not counted', () => {
  const size = sizeOf([
    f('apps/server/src/a.ts', 20),
    f('apps/server/test/a.test.ts', 900),
    f('apps/web/e2e/a.spec.ts', 900),
    f('scripts/pr-size.test.mjs', 900),
    f('packages/shared/test/__snapshots__/snapshot.test.ts.snap', 900),
    f('docs/verify/2611/run.txt', 900),
    f('apps/server/drizzle/meta/0086_snapshot.json', 4567),
    f('pnpm-lock.yaml', 900),
  ]);
  assert.deepEqual(size, { lines: 20, label: 'size:S', color: '5ebd3e' });
});

test('a test-only PR is sized by its tests', () => {
  assert.equal(sizeOf([f('apps/server/test/a.test.ts', 120)]).lines, 120);
});

test('the migration SQL counts; only its generated snapshot does not', () => {
  assert.equal(
    sizeOf([
      f('apps/server/drizzle/0086_routing_rule.sql', 17),
      f('apps/server/drizzle/meta/_journal.json', 7),
    ]).lines,
    17,
  );
});

test('the plan replaces a stale size label and leaves other labels alone', () => {
  assert.deepEqual(sizeLabelPlan([f('apps/web/src/a.ts', 50)], ['bug', 'size:XS']), {
    lines: 50,
    label: 'size:M',
    color: 'fbca04',
    add: ['size:M'],
    remove: ['size:XS'],
  });
  assert.deepEqual(sizeLabelPlan([f('apps/web/src/a.ts', 50)], ['size:M']), {
    lines: 50,
    label: 'size:M',
    color: 'fbca04',
    add: [],
    remove: [],
  });
});

test('the cap counts every changed line outside the generated list, tests included', () => {
  const cap = sizeCap([
    f('apps/server/src/a.ts', 2000),
    f('apps/server/test/a.test.ts', 900, 100),
    f('docs/feature-map.md', 5000),
    f('.claude/skills/verify-cairn/feature-map.md', 5000),
    f('.mergify.yml', 400),
    f('pnpm-lock.yaml', 9000),
    f('packages/shared/test/__snapshots__/snapshot.test.ts.snap', 900),
    f('apps/web/e2e/gallery-snapshots.spec.ts-snapshots/home-light.png', 7),
    f('apps/server/drizzle/meta/0086_snapshot.json', 4567),
    f('docs/verify/2611/run.txt', 900),
  ]);
  assert.deepEqual(
    { lines: cap.lines, limit: cap.limit, over: cap.over },
    { lines: 3000, limit: 3000, over: false },
  );
});

test('one line past 3000 non-generated lines fails and names the largest files first', () => {
  const cap = sizeCap([
    f('apps/server/src/small.ts', 1),
    f('apps/server/src/big.ts', 1500, 500),
    f('apps/web/src/mid.tsx', 700, 300),
    f('docs/feature-map.md', 9000),
  ]);
  assert.equal(cap.lines, 3001);
  assert.equal(cap.over, true);
  assert.deepEqual(
    cap.top.map((row) => [row.filename, row.lines]),
    [
      ['apps/server/src/big.ts', 2000],
      ['apps/web/src/mid.tsx', 1000],
      ['apps/server/src/small.ts', 1],
    ],
  );
});

test('the CLI cap mode exits 1 above the cap and prints the top contributors', () => {
  const dir = makeTestTempDir('pr-size-');
  const pages = join(dir, 'files.json');
  writeFileSync(
    pages,
    JSON.stringify([[f('apps/server/src/big.ts', 3001), f('pnpm-lock.yaml', 50000)]]),
  );
  const over = spawnSync(process.execPath, [script, 'cap', pages], { encoding: 'utf8' });
  writeFileSync(pages, JSON.stringify([[f('apps/server/src/big.ts', 3000)]]));
  const under = spawnSync(process.execPath, [script, 'cap', pages], { encoding: 'utf8' });
  releaseTestTempDir(dir);
  assert.equal(over.status, 1, over.stderr);
  assert.match(over.stdout, /3001 non-generated changed lines exceed the 3000-line cap/);
  assert.match(over.stdout, /3001 +apps\/server\/src\/big\.ts/);
  assert.doesNotMatch(over.stdout, /\d +pnpm-lock\.yaml/);
  assert.equal(under.status, 0, under.stderr);
  assert.match(under.stdout, /3000 non-generated changed lines \(cap 3000\)/);
});

test('the size label leaves out the same generated paths the cap does', () => {
  for (const path of [
    'docs/feature-map.md',
    '.claude/skills/verify-cairn/feature-map.md',
    '.mergify.yml',
    'pnpm-lock.yaml',
  ])
    assert.equal(sizeOf([f(path, 100), f('apps/web/src/a.ts', 5)]).lines, 5, path);
});
