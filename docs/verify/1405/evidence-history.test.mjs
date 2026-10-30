import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const name of ['red', 'green']) {
  test(`${name} evidence retains the previously committed history`, () => {
    const path = `docs/verify/1405/${name}.log`;
    const original = execFileSync('git', ['show', `HEAD:${path}`]);
    const current = readFileSync(path);
    assert.ok(current.subarray(0, original.length).equals(original));
  });
}
