import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { sizeCap, sizeLabelPlan, sizeOf } from './pr-size.mjs';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

const script = fileURLToPath(new URL('./pr-size.mjs', import.meta.url));

const f = (filename, additions, deletions = 0) => ({ filename, additions, deletions });

test('bands follow t3code: 9 is XS, 10 is S, 1000 is XXL', () => {
  assert.equal(sizeOf([f('apps/web/src/a.ts', 9)]).label, 'size:XS');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 10)]).label, 'size:S');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 99)]).label, 'size:M');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 499)]).label, 'size:L');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 999)]).label, 'size:XL');
  assert.equal(sizeOf([f('apps/web/src/a.ts', 1000)]).label, 'size:XXL');
});

test('tests, evidence, snapshots, generated drizzle meta and the lockfile are not counted', () => {
  const size = sizeOf([
    f('apps/server/src/a.ts', 20),
    f('apps/server/test/a.test.ts', 900),
    f('apps/web/e2e/a.spec.ts', 900),
    f('scripts/pr-size.test.mjs', 900),
    f('packages/shared/test/__snapshots__/snapshot.test.ts.snap', 900),
    f('docs/verify/2611/run.txt', 900),
    f('apps/server/drizzle/meta/0086_snapshot.json', 4567),
    f('pnpm-lock.yaml', 900),
  ]);
  assert.deepEqual(size, { lines: 20, label: 'size:S', color: '5ebd3e' });
});

test('a test-only PR is sized by its tests', () => {
  assert.equal(sizeOf([f('apps/server/test/a.test.ts', 120)]).lines, 120);
});

test('the migration SQL counts; only its generated snapshot does not', () => {
  assert.equal(
    sizeOf([
      f('apps/server/drizzle/0086_routing_rule.sql', 17),
      f('apps/server/drizzle/meta/_journal.json', 7),
    ]).lines,
    17,
  );
});

test('the plan replaces a stale size label and leaves other labels alone', () => {
  assert.deepEqual(sizeLabelPlan([f('apps/web/src/a.ts', 50)], ['bug', 'size:XS']), {
    lines: 50,
    label: 'size:M',
    color: 'fbca04',
    add: ['size:M'],
    remove: ['size:XS'],
  });
  assert.deepEqual(sizeLabelPlan([f('apps/web/src/a.ts', 50)], ['size:M']), {
    lines: 50,
    label: 'size:M',
    color: 'fbca04',
    add: [],
    remove: [],
  });
});

test('the cap counts every changed line outside the generated list, tests included', () => {
  const cap = sizeCap([
    f('apps/server/src/a.ts', 2000),
    f('apps/server/test/a.test.ts', 900, 100),
    f('docs/feature-map.md', 5000),
    f('.claude/skills/verify-cairn/feature-map.md', 5000),
    f('.mergify.yml', 400),
    f('pnpm-lock.yaml', 9000),
    f('packages/shared/test/__snapshots__/snapshot.test.ts.snap', 900),
    f('apps/web/e2e/gallery-snapshots.spec.ts-snapshots/home-light.png', 7),
    f('apps/server/drizzle/meta/0086_snapshot.json', 4567),
    f('docs/verify/2611/run.txt', 900),
  ]);
  assert.deepEqual(
    { lines: cap.lines, limit: cap.limit, over: cap.over },
    { lines: 3000, limit: 3000, over: false },
  );
});

test('one line past 3000 non-generated lines fails and names the largest files first', () => {
  const cap = sizeCap([
    f('apps/server/src/small.ts', 1),
    f('apps/server/src/big.ts', 1500, 500),
    f('apps/web/src/mid.tsx', 700, 300),
    f('docs/feature-map.md', 9000),
  ]);
  assert.equal(cap.lines, 3001);
  assert.equal(cap.over, true);
  assert.deepEqual(
    cap.top.map((row) => [row.filename, row.lines]),
    [
      ['apps/server/src/big.ts', 2000],
      ['apps/web/src/mid.tsx', 1000],
      ['apps/server/src/small.ts', 1],
    ],
  );
});

const FAKE_GH = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const input = args.includes('--input') ? fs.readFileSync(0, 'utf8') : null;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, input }) + '\\n');
const world = JSON.parse(fs.readFileSync(process.env.FAKE_WORLD, 'utf8'));
const joined = args.join(' ');
const out = (value) => process.stdout.write(JSON.stringify(value));
const files = /pulls\\/(\\d+)\\/files/.exec(joined);
const one = /api repos\\/o\\/r\\/pulls\\/(\\d+)$/.exec(joined);
const labels = /api repos\\/o\\/r\\/issues\\/(\\d+)\\/labels$/.exec(joined);
if (files) out([world.files[files[1]]]);
else if (one) out(world.pulls.find((pull) => String(pull.number) === one[1]));
else if (joined.includes('pulls?state=open')) out([world.pulls]);
else if (labels && !args.includes('--method')) out(world.labels[labels[1]] ?? []);
else out({});
`;

function runReport(world, args) {
  const dir = makeTestTempDir('pr-size-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), FAKE_GH);
  chmodSync(join(bin, 'gh'), 0o755);
  const log = join(dir, 'calls.log');
  writeFileSync(join(dir, 'world.json'), JSON.stringify({ labels: {}, ...world }));
  writeFileSync(log, '');
  const result = spawnSync(process.execPath, [script, 'report', 'o/r', ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:${process.env.PATH}`, FAKE_WORLD: join(dir, 'world.json'), FAKE_LOG: log },
  });
  const calls = readFileSync(log, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  releaseTestTempDir(dir);
  const checks = calls
    .filter((call) => call.args.join(' ').includes('check-runs'))
    .map((call) => JSON.parse(call.input));
  return { result, calls, checks };
}

const pull = (number, sha, ref = `feature/${number}`) => ({
  number,
  state: 'open',
  head: { sha: sha.repeat(40), ref },
});

test('report publishes a pr-size check run on the PR head that fails above the cap and names the largest files', () => {
  const out = runReport(
    {
      pulls: [pull(7, 'a')],
      files: { 7: [f('apps/server/src/big.ts', 3001), f('pnpm-lock.yaml', 50000)] },
    },
    ['7'],
  );
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.equal(out.checks.length, 1);
  const [check] = out.checks;
  assert.equal(check.name, 'pr-size');
  assert.equal(check.head_sha, 'a'.repeat(40));
  assert.equal(check.status, 'completed');
  assert.equal(check.conclusion, 'failure');
  assert.match(check.output.title, /3001 changed lines exceed the 3000-line cap/);
  assert.match(check.output.summary, /\| 3001 \| `apps\/server\/src\/big\.ts` \|/);
  assert.doesNotMatch(check.output.summary, /\| \d+ \| `pnpm-lock\.yaml`/);
});

test('report without a PR number publishes the check on every open PR head and skips merge-queue drafts', () => {
  const out = runReport(
    {
      pulls: [pull(7, 'a'), pull(8, 'b'), pull(9, 'c', 'mergify/merge-queue/123')],
      files: { 7: [f('apps/web/src/a.ts', 3000)], 8: [f('apps/web/src/b.ts', 10)] },
    },
    [],
  );
  assert.equal(out.result.status, 0, out.result.stderr);
  assert.deepEqual(
    out.checks.map((check) => [check.head_sha[0], check.conclusion]),
    [
      ['a', 'success'],
      ['b', 'success'],
    ],
  );
});

test('report keeps the size label in step with the count', () => {
  const out = runReport(
    {
      pulls: [pull(7, 'a')],
      files: { 7: [f('apps/web/src/a.ts', 50)] },
      labels: { 7: [{ name: 'size:XS' }] },
    },
    ['7'],
  );
  const text = out.calls.map((call) => call.args.join(' '));
  assert.ok(text.some((line) => /DELETE repos\/o\/r\/issues\/7\/labels\/size%3AXS/.test(line)));
  assert.ok(text.some((line) => /label create size:M --repo o\/r/.test(line)));
});

test('the size label leaves out the same generated paths the cap does', () => {
  for (const path of [
    'docs/feature-map.md',
    '.claude/skills/verify-cairn/feature-map.md',
    '.mergify.yml',
    'pnpm-lock.yaml',
  ])
    assert.equal(sizeOf([f(path, 100), f('apps/web/src/a.ts', 5)]).lines, 5, path);
});
