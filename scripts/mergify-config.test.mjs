import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { configPath, mergifyConfig } from './mergify-config.mjs';

const prGate = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const config = readFileSync(configPath, 'utf8');

function fileCondition(prefix) {
  const line = config.split('\n').find((entry) => entry.startsWith(`      - '${prefix} ~= `));
  assert.ok(line, `${prefix} condition`);
  const pattern = line.slice(`      - '${prefix} ~= `.length, -1).replaceAll("''", "'");
  const [, flags, body] = pattern.match(/^\(\?([a-z]+)\)(.*)$/s);
  return new RegExp(body, flags.includes('a') ? 'i' : 'iu');
}

test('.mergify.yml is generated from pr-gate.js and merge-checks.mjs', () => {
  assert.equal(config, mergifyConfig(prGate), 'run node scripts/mergify-config.mjs');
});

test('protected paths never enter the queue', () => {
  const protectedRe = fileCondition('-files');
  for (const path of [
    '.github/workflows/ci.yml',
    'scripts/x.mjs',
    'SCRIPTS/x.mjs',
    'apps/web/.claude/x.md',
    'AGENTS.md',
    'apps/server/drizzle/0099_x.sql',
    'apps/server/src/services/merge-gate/readiness.ts',
    'apps/server/src/lib/secret-box.ts',
    'pnpm-lock.yaml',
    'apps/web/package.json',
  ])
    assert.match(path, protectedRe, path);
  assert.doesNotMatch('apps/web/src/board/card.tsx', protectedRe);
});

test('only files inside the auto-merge set may enter the queue', () => {
  const lines = config.split('\n').filter((entry) => entry.startsWith("      - '-files ~= "));
  assert.equal(lines.length, 2);
  const body = lines[1].slice("      - '-files ~= (?ai)".length, -1);
  const outsideRe = new RegExp(body, 'i');
  for (const path of ['README.md', '.mergify.yml', 'docs/x.png', 'apps/web/vite.ts'])
    assert.match(path, outsideRe, path);
  for (const path of [
    'apps/web/src/a.tsx',
    'packages/shared/test/a.test.ts',
    'docs/verify/1/a.png',
  ])
    assert.doesNotMatch(path, outsideRe, path);
});

test('the queue requires the review-gate status and keeps PR-only gates off the draft', () => {
  const [queue, merge] = config.split('    merge_conditions:\n');
  assert.match(queue, /- status-success = review-gate\n/);
  assert.match(queue, /- check-success = merge-route\n/);
  assert.doesNotMatch(queue, /check-skipped = merge-route/);
  assert.match(queue, /- -label = owner-route\n/);
  assert.match(queue, /- -author = cairnwright\[bot\]\n/);
  for (const check of ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence', 'gates'])
    assert.match(queue, new RegExp(`check-success = ${check}\\n`), check);
  for (const check of ['check', 'pack-smoke', 'e2e-gate', 'gates'])
    assert.match(merge, new RegExp(`check-success = ${check}\\n`), check);
  for (const check of ['pr-evidence', 'merge-route']) assert.doesNotMatch(merge, new RegExp(check));
  assert.match(merge, /merge_method: squash\n/);
});
