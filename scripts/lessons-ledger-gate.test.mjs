import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkLedger } from './lessons-ledger-gate.mjs';

const head =
  '| 类别 | 首次来源 | 级别 | 防护 | 拦截 | 复发 | 备注 |\n|---|---|---|---|---|---|---|\n';

test('level 5 row without a reason is rejected', () => {
  assert.equal(checkLedger(`${head}| 错 | x | 5 | 记忆 | 0 | 0 | |\n`).length, 1);
});

test('pending upgrade without a ticket is rejected', () => {
  assert.equal(checkLedger(`${head}| 错 | x | 5 | 记忆 | 0 | 0 | 待升到级别 2 |\n`).length, 1);
});

test('pending upgrade with a ticket passes', () => {
  assert.deepEqual(
    checkLedger(`${head}| 错 | x | 5 | 记忆 | 0 | 0 | 待升到级别 2，见 #12 |\n`),
    [],
  );
});

test('the real ledger passes', () => {
  assert.deepEqual(
    checkLedger(readFileSync(new URL('../docs/lessons.md', import.meta.url), 'utf8')),
    [],
  );
});
