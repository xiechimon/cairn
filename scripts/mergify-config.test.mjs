import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { configPath, mergifyConfig } from './mergify-config.mjs';

const prGate = readFileSync('.claude/workflows/pr-gate.js', 'utf8');
const gatePaths = JSON.parse(readFileSync('packages/shared/merge-gate-paths.json', 'utf8'));
const config = readFileSync(configPath, 'utf8');

test('.mergify.yml is generated from merge-gate-paths.json, pr-gate.js and merge-checks.mjs', () => {
  assert.equal(config, mergifyConfig(prGate, gatePaths), 'run node scripts/mergify-config.mjs');
  assert.match(config, /^ {2}max_parallel_checks: 1$/m);
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

function admissionPattern(queue) {
  const match = queue.match(/-files ~= \(\?i\)\^(\(\?:.*\))\$/);
  assert.ok(match, 'owner-route file exclusion');
  return new RegExp(match[1], 'i');
}

test('owner-route classes stay out of the queue and a non-sensitive path does not', () => {
  for (const name of ['default', 'bot']) {
    const [queue] = rules[name].split('    merge_conditions:\n');
    assert.doesNotMatch(queue, /-label = owner-route/, name);
    const pattern = admissionPattern(queue);
    for (const path of [
      '.github/workflows/ci.yml',
      '.mergify.yml',
      '.claude/workflows/pr-gate.js',
      'scripts/merge-route.mjs',
      'scripts/autonomy-brake.mjs',
      'scripts/ops/review-gate/codex-gate.mjs',
      'packages/shared/merge-gate-paths.json',
      'integration/eval/owner-route.txt',
      '.claude/hillclimb/owner-route.txt',
      'apps/server/src/trajectory-export.ts',
      'apps/server/src/services/secrets.ts',
      'apps/server/src/services/machinesample.ts',
      'apps/daemon/src/backend/command-gate.ts',
      'apps/server/src/services/mcp-face.ts',
    ])
      assert.match(path, pattern, `${name} ${path}`);
    for (const path of [
      'apps/web/src/a.ts',
      'scripts/x.mjs',
      'apps/server/src/db/client.ts',
      'scripts/ops/deploy-self.sh',
      'apps/server/src/services/harness-eval-sample.ts',
      '.github/CODEOWNERS',
      'README.md',
    ])
      assert.doesNotMatch(path, pattern, `${name} ${path}`);
  }
});

const rules = Object.fromEntries(
  config
    .split('merge_queue:\n')[0]
    .split('\n  - name: ')
    .slice(1)
    .map((block) => [block.split('\n')[0], block]),
);

for (const [name, author, method] of [
  ['default', '- -author = cairnwright[bot]', 'fast-forward'],
  ['bot', '- author = cairnwright[bot]', 'fast-forward'],
])
  test(`the ${name} rule requires the review-gate check from GitHub Actions and keeps PR-only gates off the draft`, () => {
    const [queue, merge] = rules[name].split('    merge_conditions:\n');
    assert.ok(queue.includes(`      ${author}\n`));
    assert.match(queue, /- check-success = @github-actions\/review-gate\n/);
    assert.doesNotMatch(queue, /status-success = review-gate/);
    assert.match(queue, /- check-success = merge-route\n/);
    assert.doesNotMatch(queue, /check-skipped = merge-route/);
    assert.doesNotMatch(queue, /-label = owner-route/);
    for (const check of ['check', 'pack-smoke', 'e2e-gate', 'pr-evidence', 'gates'])
      assert.match(queue, new RegExp(`check-success = ${check}\\n`), check);
    for (const check of ['check', 'pack-smoke', 'e2e-gate', 'gates'])
      assert.match(merge, new RegExp(`check-success = ${check}\\n`), check);
    for (const check of ['pr-evidence', 'merge-route'])
      assert.doesNotMatch(merge, new RegExp(check));
    assert.match(merge, new RegExp(`merge_method: ${method}\\n`));
    assert.match(merge, /max_checks_retries: 1$/m);
  });

test('neither queue caps commit count, and both fast-forward the tested draft commit', () => {
  assert.doesNotMatch(readFileSync(configPath, 'utf8'), /merge_method: (rebase|squash)/);
  assert.doesNotMatch(rules.bot, /#commits/);
  assert.doesNotMatch(rules.default, /#commits/);
});

test('web and backend are separate scopes and shared packages touch both', () => {
  assert.match(config, /merge_queue:\n {2}mode: serial\n/);
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
    for (const fact of ['review-gate', 'merge-route', 'pr-evidence', 'commit-author', 'pr-size'])
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

test('only writers may dequeue by command; the review-gate bot leaves it to the queue conditions', () => {
  assert.match(
    config,
    /commands_restrictions:\n {2}dequeue:\n {4}conditions:\n {6}- sender-permission >= write\nmerge_queue:/,
  );
  assert.doesNotMatch(config, /github-actions\[bot\]/);
});

test('both queues size batches dynamically from one to four pull requests', () => {
  for (const name of ['default', 'bot']) {
    assert.match(rules[name], /\n {4}batch_size:\n {6}min: 1\n {6}max: 4\n/, name);
    assert.doesNotMatch(rules[name], /batch_size: \d/, name);
  }
});

test('queue entry needs a green pr-size check, and batch PRs are not held to it', () => {
  for (const name of ['default', 'bot']) {
    const [queue, merge] = rules[name].split('    merge_conditions:\n');
    assert.match(queue, /- check-success = merge-route\n {6}- check-success = pr-size\n/, name);
    assert.doesNotMatch(queue, /check-skipped = pr-size/, name);
    assert.doesNotMatch(merge, /pr-size/, name);
  }
});

test('both queues require zero unresolved review threads exactly once immediately after draft', () => {
  for (const name of ['default', 'bot']) {
    const [queue] = rules[name].split('    merge_conditions:\n');
    assert.match(queue, /- -draft\n {6}- '#review-threads-unresolved = 0'\n/, name);
    assert.equal(queue.match(/#review-threads-unresolved = 0/g)?.length, 1, name);
  }
});

test('no tracked code or workflow posts a Mergify command; the queue conditions drive the queue', () => {
  const sources = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
    .split('\0')
    .filter(
      (path) =>
        /\.(mjs|cjs|js|ts|tsx|sh|py|ya?ml)$/.test(path) &&
        !/\.(test|spec)\.[cm]?[jt]sx?$|\.test\.py$/.test(path) &&
        !path.startsWith('docs/'),
    );
  const posting = sources.filter((path) => /@mergifyio\s+[a-z]/.test(readFileSync(path, 'utf8')));
  assert.deepEqual(posting, ['scripts/autonomy-brake.mjs']);
  assert.deepEqual(
    [...readFileSync('scripts/autonomy-brake.mjs', 'utf8').matchAll(/@mergifyio\s+([a-z]+)/g)].map(
      (match) => match[1],
    ),
    ['requeue', 'requeue'],
  );
});
