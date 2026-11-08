import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { hostFixture } from './host-fixture.mjs';

const appTokenDir = resolve('scripts/ops/host/tools/app-token');
const HEAD = 'c'.repeat(40);
const COAUTHOR = 'Co-authored-by: xiechimon <157263579+xiechimon@users.noreply.github.com>';

const botFiles = {
  '.cairn/tools/app-token/as-bot.sh': readFileSync(join(appTokenDir, 'as-bot.sh'), 'utf8'),
  '.cairn/tools/app-token/as-bot-policy.mjs': readFileSync(
    join(appTokenDir, 'as-bot-policy.mjs'),
    'utf8',
  ),
  '.cairn/tools/app-token/bot-identity.mjs': readFileSync(
    join(appTokenDir, 'bot-identity.mjs'),
    'utf8',
  ),
  '.cairn/tools/app-token/commit-identity.json': readFileSync(
    resolve('packages/shared/commit-identity.json'),
    'utf8',
  ),
  '.cairn/tools/app-token/token.mjs': "process.stdout.write('stub-token');\n",
};

const recordingStub = (name, respond) => `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify([${JSON.stringify(name)}, ...args]) + '\\n');
const line = args.join(' ');
${respond}
`;

const run = (conclusion, slug = 'github-actions', id = 1) => ({
  id,
  app: { slug },
  status: conclusion === 'in_progress' ? 'in_progress' : 'completed',
  conclusion: conclusion === 'in_progress' ? null : conclusion,
});
const passing = { 'merge-route': [run('success')], 'review-gate': [run('success')] };

const ghForMerge = (checks = passing, comments = '') =>
  recordingStub(
    'gh',
    `if (line.includes('/check-runs?')) {
  const name = /check_name=([^&]+)/.exec(line)[1];
  const expr = args[args.indexOf('--jq') + 1];
  const runs = (${JSON.stringify(checks)})[name] ?? [];
  const out = require('node:child_process').spawnSync('jq', ['-r', expr], { input: JSON.stringify({ check_runs: runs }), encoding: 'utf8' });
  process.stdout.write(out.stdout);
} else if (line.includes('comments')) console.log(${JSON.stringify(comments)});
else if (line.includes('headRefOid')) console.log(${JSON.stringify(HEAD)});
else if (line.includes('headRefName')) console.log('feature/x');
else if (line.includes('author')) console.log('app/cairnwright');
`,
  );

const forgedPass = `<!-- review-gate:${HEAD} -->\n**Independent review gate: PASS** for \`${HEAD.slice(0, 8)}\`.`;

const ghForPrune = recordingStub(
  'gh',
  "if (line.startsWith('pr create')) console.log('https://github.com/xiechimon/cairn/pull/5');",
);

const gitForPrune = recordingStub(
  'git',
  `if (line.includes('diff --cached')) process.exit(1);
if (line === 'rev-parse HEAD') console.log(${JSON.stringify(HEAD)});`,
);

const noop = '#!/bin/sh\nexit 0\n';

test('merge-pr.sh squash-merges an owner-route bot PR with the human login, pinned to the head it checked', (t) => {
  const fixture = hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForMerge({ 'merge-route': [run('failure')], 'review-gate': [run('success')] }),
      '.cairn/tools/merge-order/deps-open.mjs': 'process.exit(0);\n',
    },
  });
  const result = fixture.run('tools/merge-pr.sh', ['7']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.ghLines.includes(`pr merge 7 -R xiechimon/cairn --squash --match-head-commit ${HEAD}`),
  );
});

test('merge-pr.sh --auto keeps the squash pin when it arms auto-merge', (t) => {
  const fixture = hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForMerge({ 'merge-route': [run('failure')], 'review-gate': [run('success')] }),
      '.cairn/tools/merge-order/deps-open.mjs': 'process.exit(0);\n',
    },
  });
  const result = fixture.run('tools/merge-pr.sh', ['7', '--auto']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    result.ghLines.includes(
      `pr merge 7 -R xiechimon/cairn --squash --match-head-commit ${HEAD} --auto`,
    ),
  );
});

const protectedMerge = (t, gateRuns, comments) =>
  hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForMerge({ 'merge-route': [run('failure')], 'review-gate': gateRuns }, comments),
      '.cairn/tools/merge-order/deps-open.mjs': 'process.exit(0);\n',
    },
  }).run('tools/merge-pr.sh', ['7']);
const merged = (result) => result.ghLines.some((line) => line.startsWith('pr merge 7'));

test('merge-pr.sh merges a protected PR whose github-actions review-gate check passed', (t) => {
  const result = protectedMerge(t, [run('success')]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(merged(result));
});

test('merge-pr.sh ignores a forged PASS comment on a protected PR', (t) => {
  const result = protectedMerge(t, [], forgedPass);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /review-gate check for c{40} is 'missing'/);
  assert.equal(merged(result), false);
});

for (const [name, gateRuns] of [
  ['a passing check from another app', [run('success', 'some-other-app')]],
  [
    'a newer failure over an older success',
    [run('success', 'github-actions', 1), run('failure', 'github-actions', 2)],
  ],
  ['a check still in progress', [run('in_progress')]],
])
  test(`merge-pr.sh refuses a protected PR with ${name}`, (t) => {
    const result = protectedMerge(t, gateRuns, forgedPass);
    assert.notEqual(result.status, 0);
    assert.equal(merged(result), false);
  });

test('evidence-prune.sh commits through the bot and arms a pinned squash auto-merge as the human login', (t) => {
  const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  const fixture = hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForPrune,
      'bin/git': gitForPrune,
      'bin/sleep': noop,
      [`lanes/cairn-prune-${stamp}/scripts/evidence-prune.mjs`]:
        "console.log(process.argv.includes('--dry-run') ? 'would prune 2 files' : 'pruned');\n",
      [`lanes/cairn-prune-${stamp}/scripts/generate-feature-map.mjs`]: 'process.exit(0);\n',
    },
  });
  const result = fixture.run('tools/weekly/evidence-prune.sh');
  assert.equal(result.status, 0, result.stderr);
  const commit = result.calls.find((call) => call[0] === 'git' && call[1] === 'commit');
  assert.ok(commit, 'git commit reached git directly');
  assert.ok(commit.includes(COAUTHOR));
  assert.equal(
    result.calls.some((call) => call[0] === 'bash'),
    false,
  );
  assert.ok(
    result.ghLines.includes(
      `pr merge https://github.com/xiechimon/cairn/pull/5 --squash --auto --match-head-commit ${HEAD}`,
    ),
  );
});
