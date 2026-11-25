import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  loadRegressionLedger,
  parseRegressionLedger,
  validateLedgerMonotonic,
  validateRegressionEntries,
} from './regression-test-ledger.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const entry = {
  id: 'known-regression',
  owner: 'xiechimon',
  regression: 'A fixed owner-visible regression must stay covered.',
  file: 'apps/server/test/behavior.test.ts',
  testTitle: 'keeps the fixed behavior',
  addedAt: '2026-11-25',
};

function fixture(t, declaration = 'test') {
  const root = makeTestTempDir('regression-ledger-');
  t.after(() => releaseTestTempDir(root));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  mkdirSync(dirname(join(root, entry.file)), { recursive: true });
  writeFileSync(
    join(root, entry.file),
    `${declaration}('${entry.testTitle}', () => {\n  expect(true).toBe(true);\n});\n`,
  );
  writeFileSync(
    join(root, 'scripts/regression-test-ledger.json'),
    JSON.stringify({ version: 1, regressions: [entry] }),
  );
  return root;
}

test('a ledger entry passes when its test file and enabled title are present', (t) => {
  const root = fixture(t);
  const entries = loadRegressionLedger({ cwd: root });
  assert.equal(entries.length, 1);
  assert.deepEqual(validateRegressionEntries(root, entries), []);
});

test('missing files, missing titles and skipped regression tests fail', (t) => {
  const root = fixture(t);
  assert.deepEqual(validateRegressionEntries(root, [{ ...entry, file: 'missing.test.ts' }]), [
    'known-regression: missing.test.ts does not exist',
  ]);
  assert.deepEqual(validateRegressionEntries(root, [{ ...entry, testTitle: 'other title' }]), [
    `known-regression: test title not found in ${entry.file}`,
  ]);
  const skipped = fixture(t, 'test.skip');
  assert.match(
    validateRegressionEntries(skipped, loadRegressionLedger({ cwd: skipped }))[0],
    /skipped or marked fixme/,
  );
});

test('schema validation requires unique ids, owner and ISO addedAt', () => {
  assert.deepEqual(parseRegressionLedger('{"version":1,"regressions":[]}'), []);
  assert.throws(
    () =>
      parseRegressionLedger(
        JSON.stringify({ version: 1, regressions: [{ ...entry, addedAt: 'today' }] }),
      ),
    /addedAt must be YYYY-MM-DD/,
  );
  assert.throws(
    () => parseRegressionLedger(JSON.stringify({ version: 1, regressions: [entry, entry] })),
    /duplicate id/,
  );
});

test('an existing ledger id cannot be removed from the head ledger', (t) => {
  const root = fixture(t);
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['add', 'scripts/regression-test-ledger.json', entry.file]);
  git(['commit', '-m', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(
    join(root, 'scripts/regression-test-ledger.json'),
    JSON.stringify({ version: 1, regressions: [] }),
  );
  assert.deepEqual(validateLedgerMonotonic(root, base), [
    'known-regression: regression ledger entry removed; update the existing row instead',
  ]);
});
