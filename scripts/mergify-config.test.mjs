import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { configPath, mergifyConfig } from './mergify-config.mjs';

const prGate = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const gatePaths = JSON.parse(readFileSync('packages/shared/merge-gate-paths.json', 'utf8'));
const config = readFileSync(configPath, 'utf8');

test('.mergify.yml is generated from merge-gate-paths.json, pr-gate.js and merge-checks.mjs', () => {
  assert.equal(config, mergifyConfig(prGate, gatePaths), 'run node scripts/mergify-config.mjs');
});

test('negative control: a limit changed in merge-gate-paths.json changes .mergify.yml', () => {
  const changed = {
    ...gatePaths,
    limits: { ...gatePaths.limits, maxQueueFiles: gatePaths.limits.maxQueueFiles + 1 },
  };
  assert.notEqual(mergifyConfig(prGate, changed), config);
});

test('the queue starts a batch immediately, admits 80 files, and accepts a stack dependency', () => {
  assert.equal(gatePaths.limits.maxQueueFiles, 80);
  assert.match(config, /batch_max_wait_time: 0 s\n/);
  for (const name of ['default', 'bot']) {
    const [queue] = rules[name].split('    merge_conditions:\n');
    assert.match(queue, /- '#files <= 80'\n/, name);
    assert.doesNotMatch(queue, /#added-lines|#deleted-lines/, name);
    assert.match(queue, /- or:\n {10}- base = main\n {10}- "#depends-on > 0"\n/, name);
  }
});

test('path class does not keep a pull request out of the queue', () => {
  assert.doesNotMatch(config, /-files ~=| -removed-files ~=|owner-route/);
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
  test(`the ${name} rule requires the review-gate check from GitHub Actions and keeps PR-only gates off the draft`, () => {
    const [queue, merge] = rules[name].split('    merge_conditions:\n');
    assert.ok(queue.includes(`      ${author}\n`));
    assert.match(queue, /- check-success = @github-actions\/review-gate\n/);
    assert.doesNotMatch(queue, /status-success = review-gate/);
    assert.match(queue, /- check-success = merge-route\n/);
    assert.doesNotMatch(queue, /check-skipped = merge-route/);
    assert.doesNotMatch(queue, /owner-route/);
    for (const check of ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence', 'gates'])
      assert.match(queue, new RegExp(`check-success = ${check}\\n`), check);
    for (const check of ['check', 'pack-smoke', 'e2e-gate', 'gates'])
      assert.match(merge, new RegExp(`check-success = ${check}\\n`), check);
    for (const check of ['pr-evidence', 'merge-route'])
      assert.doesNotMatch(merge, new RegExp(check));
    assert.match(merge, new RegExp(`merge_method: ${method}\\n`));
    assert.match(merge, /max_checks_retries: 1$/m);
  });

test('neither queue caps commit count; merge-pr.sh still enforces bot single-commit rebase identity', () => {
  assert.doesNotMatch(rules.bot, /#commits/);
  assert.doesNotMatch(rules.default, /#commits/);
});

test('web and backend are separate scopes and shared packages touch both', () => {
  assert.match(config, /merge_queue:\n {2}mode: parallel\n/);
  assert.match(config, / {6}web:\n {8}include:\n {10}- apps\/web\/\*\*\/\*\n/);
  assert.match(config, / {6}backend:\n {8}include:\n {10}- apps\/server\/\*\*\/\*\n/);
  assert.match(config, / {2}barrier_files:\n {4}include:\n {6}- packages\/\*\*\/\*\n/);
});

test('eligible PRs enter the queue on their own, and no merge protection rule can reach the drafts', () => {
  assert.match(config, /merge_protections_settings:\n {2}auto_merge_conditions: true\n/);
  assert.doesNotMatch(config, /^merge_protections:/m);
});

test('merge conditions never require a PR-only fact the queue draft cannot carry', () => {
  for (const name of ['default', 'bot']) {
    const merge = rules[name].split('    merge_conditions:\n')[1];
    for (const fact of ['review-gate', 'merge-route', 'pr-evidence', 'commit-author'])
      assert.doesNotMatch(merge, new RegExp(fact), `${name}: ${fact}`);
  }
});

test('Mergify merges past its own required queue check as the merge bot account', () => {
  for (const name of ['default', 'bot']) {
    assert.match(rules[name], /branch_protection_injection_mode: none\n/, name);
    assert.match(rules[name], /merge_bot_account: xiechimon(\n|$)/, name);
  }
});

test('queue entry needs a green commit-author check, and batch PRs need the admit label', () => {
  for (const name of ['default', 'bot']) {
    const [queue] = rules[name].split('    merge_conditions:\n');
    assert.match(queue, /- check-success = commit-author\n/, name);
    assert.match(
      queue,
      / {6}- or:\n {10}- -head ~= \^B\[0-9\]\+\/\n {10}- label = queue-admit\n/,
      name,
    );
    assert.doesNotMatch(queue, /queue-hold/, name);
  }
});

test('a PR the coordinator holds never enters the queue', () => {
  for (const name of ['default', 'bot']) {
    const [queue] = rules[name].split('    merge_conditions:\n');
    assert.match(queue, /- -label = coordinator-hold\n/, name);
    assert.doesNotMatch(queue, /needs-decision/, name);
  }
});

test('the review-gate bot may run dequeue, and writers keep the default', () => {
  assert.match(config, /commands_restrictions:\n {2}dequeue:\n {4}conditions:\n/);
  assert.match(config, / {10}- sender = github-actions\[bot\]\n/);
  assert.match(config, / {10}- sender-permission >= write\n/);
});
