import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { hostFixture } from './host-fixture.mjs';

const appTokenDir = resolve('scripts/ops/host/tools/app-token');
const HEAD = 'c'.repeat(40);

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

const ghForMerge = (ref) =>
  recordingStub(
    'gh',
    `if (line.includes('headRefOid')) console.log(${JSON.stringify(HEAD)});
else if (line.includes('headRefName')) console.log(${JSON.stringify(ref)});
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
      'bin/gh': ghForMerge('lane/12'),
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
      'bin/gh': ghForMerge('lane/12'),
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

const mergeOf = (t, ref) =>
  hostFixture(t, {
    hostFiles: {
      ...botFiles,
      'bin/gh': ghForMerge(ref),
      '.cairn/tools/merge-order/deps-open.mjs': 'process.exit(0);\n',
    },
  }).run('tools/merge-pr.sh', ['7']);
const merged = (result) => result.ghLines.some((line) => line.startsWith('pr merge 7'));

test('merge-pr.sh merges any PR without reading a check run', (t) => {
  for (const ref of ['lane/12', 'feature/x']) {
    const result = mergeOf(t, ref);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(merged(result), ref);
    assert.equal(
      result.ghLines.some((line) => line.includes('/check-runs')),
      false,
      ref,
    );
  }
});

test('evidence-prune.sh uses the user compatibility entry and arms a pinned squash auto-merge', (t) => {
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
  assert.equal(commit.includes('--trailer'), false);
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
