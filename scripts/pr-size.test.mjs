import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sizeLabelPlan, sizeOf } from './pr-size.mjs';

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
