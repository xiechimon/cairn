import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hostFixture } from './host-fixture.mjs';

const tierNone = '#!/bin/sh\necho none\n';

const tierSimple = '#!/bin/sh\necho simple\n';

const depsClear = 'process.exit(0);\n';

const checkPagesGh = `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.CALLS, JSON.stringify(['gh', ...args]) + '\\n');
const data = JSON.parse(fs.readFileSync(process.env.GH_DATA, 'utf8'));
const line = args.join(' ');
if (line.startsWith('issue view') && line.includes('--json state')) console.log(data.state ?? 'OPEN');
else if (line.startsWith('pr list')) console.log(data.prHeads ?? '');
else if (line.startsWith('api repos/xiechimon/cairn/commits/main ')) console.log(data.mainSha ?? 'a'.repeat(40));
else if (line.includes('/check-runs')) {
  if (args.includes('--slurp') && args.includes('--jq')) {
    console.error('gh: --slurp cannot be combined with --jq');
    process.exit(1);
  }
  if (data.checkFail) process.exit(1);
  const pages = data.checkPages ?? [{ check_runs: [] }];
  const visible = args.includes('--paginate') ? pages : pages.slice(0, 1);
  for (const page of visible) for (const run of page.check_runs ?? []) console.log(JSON.stringify(run));
}
`;

function dispatch(t, options, env = {}) {
  const { hostFiles = {}, ...rest } = options;
  const fixture = hostFixture(t, {
    ...rest,
    hostFiles: { '.cairn/tools/governor/tier.sh': tierNone, ...hostFiles },
  });
  return fixture.run('lanes/dispatch-issue.sh', ['77', 'implement'], env);
}

test('dispatch-issue refuses a closed issue', (t) => {
  const result = dispatch(t, { gh: { state: 'CLOSED' } });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /#77 not dispatched: issue state is CLOSED/);
});

test('dispatch-issue refuses an issue whose state cannot be read', (t) => {
  const result = dispatch(t, { gh: { state: '' } });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /issue state is unreadable/);
});

test('dispatch-issue lets a main-red note bypass the state check', (t) => {
  const result = dispatch(t, { gh: { state: 'CLOSED' } }, { EXTRA_NOTE: 'main-red follow-up' });
  assert.doesNotMatch(result.stdout, /issue state is/);
});

test('dispatch-issue refuses an issue on the never list before reading its state', (t) => {
  const result = dispatch(t, { gh: { state: 'OPEN' }, lists: { never: ['77'] } });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /#77 is on the never-dispatch list/);
  assert.deepEqual(result.ghLines, []);
});

test('dispatch-issue never-list match is exact, not a prefix', (t) => {
  const result = dispatch(t, { gh: { state: 'OPEN' }, lists: { never: ['770', '7'] } });
  assert.doesNotMatch(result.stdout, /never-dispatch/);
});

test('dispatch-issue does not look at batch labels today', (t) => {
  const result = dispatch(t, {
    gh: { state: 'OPEN', labels: ['batch:now', 'batch:next'] },
  });
  assert.match(result.stdout, /#77 has no tier yet; not dispatching/);
  assert.equal(
    result.ghLines.some((line) => /labels/.test(line)),
    false,
  );
});

test('dispatch-issue treats a failure on a later check-runs page as red main', (t) => {
  const result = dispatch(t, {
    gh: {
      state: 'OPEN',
      checkPages: [
        { check_runs: [{ name: 'check', conclusion: 'success' }] },
        { check_runs: [{ name: 'e2e-gate', conclusion: 'failure' }] },
      ],
    },
    hostFiles: {
      '.cairn/tools/governor/tier.sh': tierSimple,
      '.cairn/tools/deps-open.mjs': depsClear,
      'bin/gh': checkPagesGh,
    },
  });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /#77 not dispatched: main is red/);
});

test('dispatch-issue refuses when the check-runs read fails instead of counting zero', (t) => {
  const result = dispatch(t, {
    gh: { state: 'OPEN', checkFail: true },
    hostFiles: {
      '.cairn/tools/governor/tier.sh': tierSimple,
      '.cairn/tools/deps-open.mjs': depsClear,
      'bin/gh': checkPagesGh,
    },
  });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /check-runs unreadable/);
  assert.doesNotMatch(result.stdout, /dispatched #77/);
});

test('dispatch-issue refuses an empty check-runs read instead of counting zero', (t) => {
  const result = dispatch(t, {
    gh: { state: 'OPEN', checkPages: [{ check_runs: [] }] },
    hostFiles: {
      '.cairn/tools/governor/tier.sh': tierSimple,
      '.cairn/tools/deps-open.mjs': depsClear,
      'bin/gh': checkPagesGh,
    },
  });
  assert.equal(result.status, 3);
  assert.match(result.stdout, /check-runs read empty/);
  assert.doesNotMatch(result.stdout, /dispatched #77/);
});

test('dispatch-issue proceeds past the check-runs read when no page holds a failure', (t) => {
  const result = dispatch(t, {
    gh: {
      state: 'OPEN',
      checkPages: [
        { check_runs: [{ name: 'check', conclusion: 'success' }] },
        { check_runs: [{ name: 'e2e-gate', conclusion: 'success' }] },
      ],
    },
    hostFiles: {
      '.cairn/tools/governor/tier.sh': tierSimple,
      '.cairn/tools/deps-open.mjs': depsClear,
      'bin/gh': checkPagesGh,
    },
  });
  assert.match(result.stdout, /dispatched #77/);
});
