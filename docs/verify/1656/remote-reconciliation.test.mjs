import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parseEntry } from '../../../scripts/lessons-ledger-gate.mjs';

const root = join(import.meta.dirname, '../../..');

test('remote rebase reconciliation preserves every remote record and text field', () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dirname, 'remote-reconciliation.json'), 'utf8'));
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', manifest.source, 'docs/lessons'], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter((path) => path.endsWith('.md') && !path.endsWith('/README.md'));
  assert.equal(manifest.entries.length, paths.length, 'every remote record must be reconciled');
  assert.deepEqual(manifest.entries.map(({ remote }) => remote), paths);
  for (const { remote, target, fields } of manifest.entries) {
    const source = execFileSync('git', ['show', `${manifest.source}:${remote}`], { cwd: root, encoding: 'utf8' });
    assert.deepEqual(parseEntry(source).fields, fields, remote);
    const actual = parseEntry(readFileSync(join(root, target), 'utf8')).fields;
    for (const key of ['Category', 'Source', 'Safeguard', 'Notes']) assert.ok(actual[key].includes(fields[key]), `${remote}: ${key}`);
    assert.ok(Number(actual.Level) <= Number(fields.Level), remote);
    for (const key of ['Intercepts', 'Recurrences']) assert.ok(Number(actual[key]) >= Number(fields[key]), `${remote}: ${key}`);
  }
});
