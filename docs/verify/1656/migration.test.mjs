import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = join(import.meta.dirname, '../../..');
const entryText = (name) => readFileSync(join(repoRoot, 'docs/lessons', name), 'utf8');

test('migration preserves every source row and sums counters when categories merge', () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, 'docs/verify/1656/migration.json'), 'utf8'),
  );
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
    assert.match(text, new RegExp(`^Intercepts: ${intercepts}$`, 'm'), name);
    assert.match(
      text,
      new RegExp(`^Recurrences: ${recurrences + (manifest.recurrenceUpdates[name] ?? 0)}$`, 'm'),
      name,
    );
  }
});
