import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostFixture } from './host-fixture.mjs';

const SHA = 'a'.repeat(40);
const PASS = '#!/bin/sh\nexit 0\n';

const mainWatchGh = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(['gh', ...args]) + '\\n');
const data = JSON.parse(fs.readFileSync(process.env.GH_DATA, 'utf8'));
const line = args.join(' ');
if (line.includes('commits?sha=main')) console.log(data.sha);
else if (line.includes('/check-runs')) {
  if (args.includes('--slurp') && args.includes('--jq')) {
    console.error('gh: --slurp cannot be combined with --jq');
    process.exit(1);
  }
  if (data.checkFail) process.exit(1);
  const pages = data.checkPages ?? [{ check_runs: [] }];
  const mapped = (page) =>
    (page.check_runs ?? []).map((run) => ({
      n: run.name,
      c: run.conclusion ?? 'pending',
      u: run.details_url ?? '',
      app: run.app?.slug ?? 'github-actions',
    }));
  const visible = args.includes('--paginate') ? pages : pages.slice(0, 1);
  for (const page of visible) for (const run of mapped(page)) console.log(JSON.stringify(run));
} else if (line.includes('/status')) {
  if (args.includes('--slurp') && args.includes('--jq')) {
    console.error('gh: --slurp cannot be combined with --jq');
    process.exit(1);
  }
  if (data.statusFail) process.exit(1);
  const pages = data.statusPages ?? [{ statuses: [] }];
  const mapped = (page) =>
    (page.statuses ?? []).map((entry) => ({
      n: entry.context,
      c: entry.state ?? 'pending',
      u: entry.target_url ?? '',
      app: 'status',
    }));
  const visible = args.includes('--paginate') ? pages : pages.slice(0, 1);
  for (const page of visible) for (const run of mapped(page)) console.log(JSON.stringify(run));
}
`;

const hostTools = (gh) => ({
  'bin/gh': gh,
  '.cairn/tools/main-watch/tmp-clean.sh': PASS,
  '.cairn/tools/main-watch/gh-health.sh': PASS,
  '.cairn/tools/main-watch/codex-watch.sh': PASS,
  '.cairn/tools/main-watch/model-health.sh': PASS,
  '.cairn/tools/governor/brake.sh': PASS,
  '.cairn/tools/governor/lane-sentinel.sh': PASS,
  '.cairn/tools/governor/lane-health.sh': PASS,
});

const completed = { name: 'check', conclusion: 'success' };

test('main-watch keeps scanning when a check beyond page one is still pending', (t) => {
  const fixture = hostFixture(t, {
    gh: {
      sha: SHA,
      checkPages: [
        { check_runs: [completed] },
        { check_runs: [completed, { name: 'e2e-gate', conclusion: null }] },
      ],
    },
    hostFiles: hostTools(mainWatchGh),
  });
  const result = fixture.run('tools/main-watch/main-watch.sh');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.ghLines.some((line) => line.includes('issue list')),
    false,
  );
});

test('main-watch keeps scanning when a status beyond page one is still pending', (t) => {
  const fixture = hostFixture(t, {
    gh: {
      sha: SHA,
      checkPages: [{ check_runs: [completed] }],
      statusPages: [
        { statuses: [{ context: 'ci', state: 'success' }] },
        { statuses: [{ context: 'nightly', state: 'pending' }] },
      ],
    },
    hostFiles: hostTools(mainWatchGh),
  });
  const result = fixture.run('tools/main-watch/main-watch.sh');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.ghLines.some((line) => line.includes('issue list')),
    false,
  );
});

test('main-watch errors when the check-runs read fails instead of judging empty', (t) => {
  const fixture = hostFixture(t, {
    gh: { sha: SHA, checkFail: true, checkPages: [{ check_runs: [completed] }] },
    hostFiles: hostTools(mainWatchGh),
  });
  const result = fixture.run('tools/main-watch/main-watch.sh');
  assert.notEqual(result.status, 0);
  assert.equal(
    result.ghLines.some((line) => line.includes('issue list') || line.includes('issue close')),
    false,
  );
});

test('main-watch errors when the status read fails instead of judging empty', (t) => {
  const fixture = hostFixture(t, {
    gh: { sha: SHA, statusFail: true, checkPages: [{ check_runs: [completed] }] },
    hostFiles: hostTools(mainWatchGh),
  });
  const result = fixture.run('tools/main-watch/main-watch.sh');
  assert.notEqual(result.status, 0);
  assert.equal(
    result.ghLines.some((line) => line.includes('issue list') || line.includes('issue close')),
    false,
  );
});

test('main-watch errors on a commit with no check or status evidence', (t) => {
  const fixture = hostFixture(t, {
    gh: { sha: SHA, checkPages: [{ check_runs: [] }], statusPages: [{ statuses: [] }] },
    hostFiles: hostTools(mainWatchGh),
  });
  const result = fixture.run('tools/main-watch/main-watch.sh');
  assert.notEqual(result.status, 0);
  assert.equal(
    result.ghLines.some((line) => line.includes('issue list') || line.includes('issue close')),
    false,
  );
});
