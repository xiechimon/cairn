import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = join(import.meta.dirname, '../../..');
const entryText = (name) => readFileSync(join(repoRoot, 'docs/lessons', name), 'utf8');

test('migration preserves every source row and sums counters when categories merge', () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'docs/verify/1656/migration.json'), 'utf8'),
  );
  const source = execFileSync('git', ['show', `${manifest.source}:docs/lessons.md`], {
    cwd: process.env.CAIRN_MIGRATION_SOURCE_REPO ?? repoRoot,
    encoding: 'utf8',
  });
  const sourceRows = source.split('\n')
    .filter((line) => line.startsWith('| ') && !line.startsWith('| Category |'))
    .map((line) => {
      const cells = line.split(/(?<!\\)\|/).slice(1).map((cell) => cell.trim());
      if (cells.at(-1) === '') cells.pop();
      return cells;
    });
  assert.equal(manifest.rows.length, sourceRows.length, 'migration manifest must contain every source ledger row');
  assert.deepEqual(manifest.rows.map(({ cells }) => cells), sourceRows);
  const counts = new Map();
  for (const { entry, cells } of manifest.rows) {
    const text = entryText(entry);
    for (const index of [0, 1, 3, 6])
      assert.ok(text.includes(cells[index]), `${entry}: missing source field ${index}`);
    const prior = counts.get(entry) ?? [0, 0];
    counts.set(entry, [prior[0] + Number(cells[4]), prior[1] + Number(cells[5])]);
  }
  for (const [name, [intercepts, recurrences]] of counts) {
    const text = entryText(name);
    assert.match(text, new RegExp(`^Intercepts: ${intercepts + (manifest.interceptUpdates[name] ?? 0)}$`, 'm'), name);
    assert.match(
      text,
      new RegExp(`^Recurrences: ${recurrences + (manifest.recurrenceUpdates[name] ?? 0)}$`, 'm'),
      name,
    );
  }
});
