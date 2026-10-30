import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { prepushPlan } from '../../prepush.mjs';
import { memoryAddress } from './process-memory.mjs';
import { requestToken } from './token-scope-probe.mjs';

test('memory probe selects a readable mapped address and never zero', () => {
  assert.equal(
    memoryAddress('0000-1000 r--p 0 0 0\n1000-2000 ---p 0 0 0\n3000-4000 rw-p 0 0 0'),
    0x3000,
  );
  assert.equal(memoryAddress('1000-2000 ---p 0 0 0'), null);
});
test('client rejects relative sockets before connecting', async () => {
  await assert.rejects(requestToken('relative.sock'), /absolute/i);
});
test('secret tests run in the ops CI job and local prepush plan', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  assert.ok(
    ci
      .slice(ci.indexOf('  ops-backup-test:'))
      .includes('node --test scripts/ops/secret-reach/*.test.mjs'),
  );
  const plan = prepushPlan(['scripts/ops/secret-reach/canary.sh']);
  for (const file of readdirSync(import.meta.dirname).filter((name) => name.endsWith('.test.mjs')))
    assert.ok(plan.some((step) => step.includes(`scripts/ops/secret-reach/${file}`)));
  assert.ok(
    plan.some(
      (step) =>
        step[0] === 'node' &&
        step[1] === '--test' &&
        step.some((arg) => arg.includes('secret-reach/') && arg.endsWith('.test.mjs')),
    ),
  );
});
