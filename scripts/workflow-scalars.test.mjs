import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const workflows = resolve(import.meta.dirname, '../.github/workflows');
const GUARDED_KEY = /^\s*(?:- )?(run|name|if):\s+(\S.*)$/;
const BLOCK_OR_QUOTED = /^(?:[|>]|["'])/;

function plainScalarsWithComment(text) {
  const found = [];
  text.split('\n').forEach((line, index) => {
    const match = GUARDED_KEY.exec(line);
    if (!match || BLOCK_OR_QUOTED.test(match[2])) return;
    if (/\s#/.test(match[2])) found.push({ line: index + 1, text: line.trim() });
  });
  return found;
}

test('a run, name or if plain scalar never contains a space before a hash', () => {
  for (const file of readdirSync(workflows).filter((name) => /\.ya?ml$/.test(name))) {
    const found = plainScalarsWithComment(readFileSync(join(workflows, file), 'utf8'));
    assert.deepEqual(found, [], `${file}: YAML reads " #" in a plain scalar as a comment`);
  }
});

test('the detector flags the cleanup step form and accepts block and quoted scalars', () => {
  assert.equal(plainScalarsWithComment('        run: echo "for #$PR"').length, 1);
  assert.equal(plainScalarsWithComment('      - name: Gate (advisory, #1520)').length, 1);
  assert.equal(plainScalarsWithComment('        run: |\n          echo "for #$PR"').length, 0);
  assert.equal(plainScalarsWithComment('      - name: "Gate (advisory, #1520)"').length, 0);
  assert.equal(plainScalarsWithComment('        run: echo a#b').length, 0);
});
