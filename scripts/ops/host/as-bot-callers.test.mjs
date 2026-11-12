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
const ghForMerge = (route, ref) =>
  recordingStub(
    'gh',
    `if (line.includes('/check-runs?')) {
  const name = /check_name=([^&]+)/.exec(line)[1];
  const expr = args[args.indexOf('--jq') + 1];
  const runs = name === 'merge-route' ? ${JSON.stringify([run(route)])} : [];
  const out = require('node:child_process').spawnSync('jq', ['-r', expr], { input: JSON.stringify({ check_runs: runs }), encoding: 'utf8' });
  process.stdout.write(out.stdout);
} else if (line.includes('headRefOid')) console.log(${JSON.stringify(HEAD)});
else if (line.includes('headRefName')) console.log(${JSON.stringify(ref)});
else if (line.includes('author')) console.log('app/cairnwright');
`,
  );

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

test('merge-pr.sh squash-merges a lane PR with the human login, pinned to the head it read', (t) => {
  const fixture = hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForMerge('success', 'lane/12'),
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
      'bin/gh': ghForMerge('success', 'lane/12'),
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

const mergeOf = (t, route, ref) =>
  hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForMerge(route, ref),
      '.cairn/tools/merge-order/deps-open.mjs': 'process.exit(0);\n',
    },
  }).run('tools/merge-pr.sh', ['7']);
const merged = (result) => result.ghLines.some((line) => line.startsWith('pr merge 7'));

test('merge-pr.sh merges a lane PR without reading a review-gate check', (t) => {
  const result = mergeOf(t, 'success', 'lane/12');
  assert.equal(result.status, 0, result.stderr);
  assert.ok(merged(result));
  assert.equal(
    result.ghLines.some((line) => line.includes('check_name=review-gate')),
    false,
  );
});

test('merge-pr.sh refuses a PR whose merge-route check failed', (t) => {
  const result = mergeOf(t, 'failure', 'feature/x');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /merge-route check for c{40} failed/);
  assert.equal(merged(result), false);
});

test('merge-pr.sh leaves a routed PR to Mergify', (t) => {
  const result = mergeOf(t, 'success', 'feature/x');
  assert.equal(result.status, 0, result.stderr);
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
