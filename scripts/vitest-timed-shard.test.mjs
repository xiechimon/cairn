import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseWeights } from './vitest-shard-weights.mjs';
import { partitionByWeight, shardKey } from './vitest-timed-shard.mjs';

const keys = Array.from({ length: 23 }, (_, i) => `@cairn/integration:test/f${i}.test.ts`);
const weights = Object.fromEntries(keys.map((key, i) => [key, (i + 1) * 1000]));

test('every file lands in exactly one shard', () => {
  for (const count of [1, 2, 3, 4, 7]) {
    const shards = partitionByWeight(keys, weights, count);
    assert.equal(shards.length, count);
    assert.deepEqual(shards.flat().sort(), [...keys].sort());
    for (const shard of shards) assert.ok(shard.length > 0);
  }
});

test('the partition does not depend on the order the runner listed files in', () => {
  const reversed = partitionByWeight([...keys].reverse(), weights, 4);
  const shuffled = partitionByWeight(
    [...keys].sort((a, b) => (a.length % 3) - (b.length % 3) || (a < b ? 1 : -1)),
    weights,
    4,
  );
  assert.deepEqual(reversed, partitionByWeight(keys, weights, 4));
  assert.deepEqual(shuffled, partitionByWeight(keys, weights, 4));
});

test('tied weights still split deterministically', () => {
  const tied = Object.fromEntries(keys.map((key) => [key, 5000]));
  assert.deepEqual(
    partitionByWeight([...keys].reverse(), tied, 3),
    partitionByWeight(keys, tied, 3),
  );
});

test('the two slowest files go to different shards', () => {
  const heavy = { ...weights, [keys[0]]: 79_000, [keys[1]]: 74_000 };
  const shards = partitionByWeight(keys, heavy, 4);
  assert.notEqual(
    shards.findIndex((shard) => shard.includes(keys[0])),
    shards.findIndex((shard) => shard.includes(keys[1])),
  );
  const totals = shards.map((shard) => shard.reduce((sum, key) => sum + heavy[key], 0));
  assert.ok(Math.max(...totals) - Math.min(...totals) <= 79_000);
});

test('a file without a recorded time weighs the median and is still assigned', () => {
  const fresh = '@cairn/integration:test/new.test.ts';
  const shards = partitionByWeight([...keys, fresh], weights, 3);
  assert.equal(shards.flat().filter((key) => key === fresh).length, 1);
});

test('no recorded times at all still yields non-empty shards', () => {
  const shards = partitionByWeight(keys, {}, 4);
  assert.deepEqual(shards.flat().sort(), [...keys].sort());
  for (const shard of shards) assert.ok(shard.length > 0);
});

test('shard keys match the project name and path vitest prints', () => {
  assert.equal(
    shardKey('@xiechimon/cairn', '/repo/apps/server', '/repo/apps/server/test/a.test.ts'),
    '@xiechimon/cairn:test/a.test.ts',
  );
});

test('weights parse from a CI vitest log, file lines only', () => {
  const log = [
    '2026-11-02T03:54:36.7335519Z  ✓  @xiechimon/cairn  test/trajectory-export.test.ts (29 tests) 52538ms',
    '2026-11-02T03:58:17.4279950Z      ✓ an unanswered question parks 70355ms',
    '2026-11-02T03:54:14.8036587Z  ✓  @cairn/integration  test/prompt-set-resume.test.ts (1 test) 79038ms',
    '2026-11-02T03:54:14.8036587Z  ❯  @cairn/web  test/a.test.ts (3 tests | 1 failed) 812ms',
  ].join('\n');
  assert.deepEqual(parseWeights(log), {
    '@xiechimon/cairn:test/trajectory-export.test.ts': 52538,
    '@cairn/integration:test/prompt-set-resume.test.ts': 79038,
    '@cairn/web:test/a.test.ts': 812,
  });
});

test('the committed weights are keyed the way shardKey builds keys', () => {
  const committed = JSON.parse(
    readFileSync(new URL('./vitest-shard-weights.json', import.meta.url), 'utf8'),
  );
  const entries = Object.entries(committed);
  assert.ok(entries.length > 500);
  for (const [key, ms] of entries) {
    assert.match(key, /^@[\w-]+\/[\w-]+:[\w./-]+\.test\.tsx?$/);
    assert.ok(Number.isInteger(ms) && ms > 0, key);
  }
});

test('ci shards both vitest suites by the matrix size', () => {
  const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
  for (const [name, suite] of [
    ['vitest-light', 'light'],
    ['vitest-integration', 'integration'],
  ]) {
    const job = workflow.split(`\n  ${name}:\n`)[1].split(/\n {2}[a-z][\w-]*:\n/)[0];
    assert.match(job, /^ {6}fail-fast: false$/m, name);
    assert.match(job, /^ {8}shard: \[1(, \d+)+\]$/m, name);
    assert.ok(
      job.includes(
        `run: VITEST_PROJECT_SET=${suite} pnpm test --shard=\${{ matrix.shard }}/\${{ strategy.job-total }}`,
      ),
      name,
    );
  }
  assert.match(readFileSync('vitest.config.ts', 'utf8'), /sequencer: TimedShardSequencer/);
});
