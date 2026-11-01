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
  assert.equal(lines.length, 4);
  assert.equal(lines[0], lines[2]);
  assert.equal(lines[1], lines[3]);
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

const rules = Object.fromEntries(
  config
    .split('merge_queue:\n')[0]
    .split('\n  - name: ')
    .slice(1)
    .map((block) => [block.split('\n')[0], block]),
);

for (const [name, author, method] of [
  ['default', '- -author = cairnwright[bot]', 'squash'],
  ['bot', '- author = cairnwright[bot]', 'rebase'],
])
  test(`the ${name} rule requires the review-gate status and keeps PR-only gates off the draft`, () => {
    const [queue, merge] = rules[name].split('    merge_conditions:\n');
    assert.ok(queue.includes(`      ${author}\n`));
    assert.match(queue, /- status-success = review-gate\n/);
    assert.match(queue, /- check-success = merge-route\n/);
    assert.doesNotMatch(queue, /check-skipped = merge-route/);
    assert.match(queue, /- -label = owner-route\n/);
    for (const check of ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence', 'gates'])
      assert.match(queue, new RegExp(`check-success = ${check}\\n`), check);
    for (const check of ['check', 'pack-smoke', 'e2e-gate', 'gates'])
      assert.match(merge, new RegExp(`check-success = ${check}\\n`), check);
    for (const check of ['pr-evidence', 'merge-route'])
      assert.doesNotMatch(merge, new RegExp(check));
    assert.match(merge, new RegExp(`merge_method: ${method}\\n`));
    assert.match(merge, /max_checks_retries: 1$/m);
  });

test('bot PRs need exactly one commit so a rebase keeps the Cairnwright author', () => {
  assert.match(rules.bot, /- '#commits = 1'\n/);
  assert.doesNotMatch(rules.default, /#commits/);
});

test('web and backend are separate scopes and shared packages touch both', () => {
  assert.match(config, /merge_queue:\n {2}mode: parallel\n/);
  assert.match(config, / {6}web:\n {8}include:\n {10}- apps\/web\/\*\*\/\*\n/);
  assert.match(config, / {6}backend:\n {8}include:\n {10}- apps\/server\/\*\*\/\*\n/);
  assert.match(config, / {2}barrier_files:\n {4}include:\n {6}- packages\/\*\*\/\*\n/);
});

test('eligible PRs enter the queue on their own once the gate and routing pass', () => {
  assert.match(config, /merge_protections_settings:\n {2}auto_merge_conditions: true\n/);
  const protections = config.split('merge_protections:\n')[1].split('merge_queue:\n')[0];
  assert.match(protections, / {4}if:\n {6}- base = main\n/);
  assert.match(protections, /- status-success = review-gate\n/);
  assert.match(protections, /- check-success = merge-route\n/);
});

test('Mergify merges past its own required queue check as the merge bot account', () => {
  for (const name of ['default', 'bot']) {
    assert.match(rules[name], /branch_protection_injection_mode: none\n/, name);
    assert.match(rules[name], /merge_bot_account: xiechimon(\n|$)/, name);
  }
});
