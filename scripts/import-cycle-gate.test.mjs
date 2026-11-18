import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffViolations, violationKeys } from './import-cycle-gate.mjs';

const cycle = (from, names) => ({
  type: 'cycle',
  from,
  cycle: names.map((name) => ({ name })),
});

test('violationKeys renders from plus cycle path, deduped and sorted', () => {
  const keys = violationKeys([
    cycle('src/b.ts', ['src/c.ts', 'src/b.ts']),
    cycle('src/a.ts', ['src/b.ts', 'src/a.ts']),
    cycle('src/b.ts', ['src/c.ts', 'src/b.ts']),
  ]);
  assert.deepEqual(keys, ['src/a.ts → src/b.ts → src/a.ts', 'src/b.ts → src/c.ts → src/b.ts']);
});

test('diffViolations reports additions and removals against the baseline', () => {
  const baseline = ['a → b → a', 'c → d → c'];
  const current = ['a → b → a', 'x → y → x'];
  assert.deepEqual(diffViolations(current, baseline), {
    added: ['x → y → x'],
    fixed: ['c → d → c'],
  });
});
