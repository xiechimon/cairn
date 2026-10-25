import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkLedger } from './lessons-ledger-gate.mjs';

const head =
  '| Category | First seen | Level | Protection | Intercepted | Recurred | Notes |\n|---|---|---|---|---|---|---|\n';

test('level 5 row without a reason is rejected', () => {
  assert.equal(checkLedger(`${head}| mistake | x | 5 | memory | 0 | 0 | |\n`).length, 1);
});

test('pending upgrade without a ticket is rejected', () => {
  assert.equal(
    checkLedger(`${head}| mistake | x | 5 | memory | 0 | 0 | upgrade pending to level 2 |\n`)
      .length,
    1,
  );
});

test('pending upgrade with a ticket passes', () => {
  assert.deepEqual(
    checkLedger(
      `${head}| mistake | x | 5 | memory | 0 | 0 | upgrade pending to level 2, see #12 |\n`,
    ),
    [],
  );
});

test('the real ledger passes', () => {
  assert.deepEqual(
    checkLedger(readFileSync(new URL('../docs/lessons.md', import.meta.url), 'utf8')),
    [],
  );
});
