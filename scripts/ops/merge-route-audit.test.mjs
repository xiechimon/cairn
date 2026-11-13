import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { queuedBeforeMerge } from './merge-route-audit.mjs';

const labeled = (name, at) => ({ event: 'labeled', label: { name }, created_at: at });
const unlabeled = (name, at) => ({ event: 'unlabeled', label: { name }, created_at: at });

test('a queued label before the merge counts as a queue merge', () => {
  assert.equal(
    queuedBeforeMerge('2026-11-05T20:17:24Z', [labeled('queued', '2026-11-05T20:11:34Z')]),
    true,
  );
});

test('a queued label after the merge does not count', () => {
  assert.equal(
    queuedBeforeMerge('2026-11-05T17:10:09Z', [labeled('queued', '2026-11-05T17:10:15Z')]),
    false,
  );
});

test('removing the queued label or marking dequeued before the merge does not count', () => {
  const mergedAt = '2026-11-10T08:00:00Z';
  assert.equal(
    queuedBeforeMerge(mergedAt, [
      labeled('queued', '2026-11-10T07:40:00Z'),
      unlabeled('queued', '2026-11-10T07:50:00Z'),
      labeled('dequeued', '2026-11-10T07:50:01Z'),
    ]),
    false,
  );
  assert.equal(
    queuedBeforeMerge(mergedAt, [
      labeled('queued', '2026-11-10T07:40:00Z'),
      unlabeled('queued', '2026-11-10T08:00:05Z'),
    ]),
    true,
  );
});

test('a PR dequeued earlier and requeued before the merge counts as a queue merge (#4020)', () => {
  const mergedAt = '2026-11-12T17:43:00Z';
  const history = [
    labeled('queued', '2026-11-12T14:48:04Z'),
    unlabeled('queued', '2026-11-12T14:56:10Z'),
    labeled('dequeued', '2026-11-12T14:56:13Z'),
    unlabeled('dequeued', '2026-11-12T15:11:58Z'),
    labeled('queued', '2026-11-12T15:46:56Z'),
    unlabeled('queued', '2026-11-12T16:25:56Z'),
    labeled('dequeued', '2026-11-12T16:26:00Z'),
    labeled('queued', '2026-11-12T16:58:02Z'),
    unlabeled('dequeued', '2026-11-12T16:59:24Z'),
    unlabeled('queued', '2026-11-12T17:43:38Z'),
  ];
  assert.equal(queuedBeforeMerge(mergedAt, history), true);
  assert.equal(
    queuedBeforeMerge(mergedAt, [...history, labeled('dequeued', '2026-11-12T17:30:00Z')]),
    false,
  );
});

test('no queued label and no merge time are both violations', () => {
  assert.equal(queuedBeforeMerge('2026-11-05T19:12:23Z', [labeled('queued', 'x')]), false);
  assert.equal(queuedBeforeMerge('2026-11-05T19:12:23Z', []), false);
  assert.equal(queuedBeforeMerge(null, [labeled('queued', '2026-11-05T19:00:00Z')]), false);
});

function fixture() {
  const dir = makeTestTempDir('queue-audit-');
  writeFileSync(
    join(dir, 'gh'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(process.env.DATA, 'utf8'));
const url = args[1];
const tail = url.split('?')[0];
if (url.includes('/check-runs')) { console.log(JSON.stringify({ check_runs: data.checks ?? [] })); process.exit(0); }
if (url.includes('/comments')) { console.log(JSON.stringify([data.comments ?? []])); process.exit(0); }
if (url.includes('/timeline')) {
  const number = parseInt(String(url.split('/issues/')[1]), 10);
  const timeline = (data.timelineByPull && data.timelineByPull[number]) || data.timeline || [];
  console.log(JSON.stringify([timeline]));
  process.exit(0);
}
if (tail.endsWith('/pulls') && tail.includes('/commits/')) { console.log(JSON.stringify(data.pulls ?? [])); process.exit(0); }
if (tail.includes('/commits/') && tail.split('/').pop().length === 40) {
  const sha = tail.split('/').pop();
  console.log(JSON.stringify({ commit: { tree: { sha: (data.trees ?? {})[sha] } } }));
  process.exit(0);
}
if (tail.includes('/pulls/')) {
  const number = Number(tail.split('/').pop());
  console.log(JSON.stringify((data.drafts ?? {})[number] ?? data.pull));
  process.exit(0);
}
console.error('unexpected ' + args.join(' ')); process.exit(1);
`,
    { mode: 0o755 },
  );
  const command = (args, data) => {
    writeFileSync(join(dir, 'data.json'), JSON.stringify(data));
    return spawnSync(process.execPath, ['scripts/ops/merge-route-audit.mjs', ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DATA: join(dir, 'data.json') },
    });
  };
  return {
    dir,
    run: (sha, data) => command(['commit', sha], data),
    landed: (shas, data) => command(['landed', ...shas], data),
  };
}

test('the command fails on a commit merged outside the queue and passes inside it', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const outside = f.run(sha, {
    pulls: [{ number: 3019, state: 'closed' }],
    pull: { number: 3019, merged_at: '2026-11-05T17:56:38Z' },
    timeline: [],
  });
  assert.equal(outside.status, 1, outside.stderr);
  assert.match(outside.stdout, /without a queued label/);
  const inside = f.run(sha, {
    pulls: [{ number: 3032, state: 'closed' }],
    pull: { number: 3032, merged_at: '2026-11-05T20:17:24Z' },
    timeline: [{ event: 'labeled', label: { name: 'queued' }, created_at: '2026-11-05T20:11:34Z' }],
  });
  assert.equal(inside.status, 0, inside.stderr);
  assert.match(inside.stdout, /through the queue/);
  releaseTestTempDir(f.dir);
});

const requiredChecks = [
  'check',
  'pack-smoke',
  'e2e-gate',
  'gates',
  'dead-class-gate',
  'ops-backup-test',
];

function provenLanding(sha, { sameTree = true, checksAt = '2026-11-10T09:30:52Z' } = {}) {
  const draftSha = 'd'.repeat(40);
  const tree = 'e'.repeat(40);
  return {
    pulls: [{ number: 3892, state: 'closed' }],
    pull: { number: 3892, merged_at: '2026-11-10T09:31:27Z' },
    comments: [{ user: { login: 'mergify[bot]' }, body: 'Passed · draft #3894' }],
    drafts: { 3894: { head: { sha: draftSha } } },
    trees: { [sha]: tree, [draftSha]: sameTree ? tree : 'f'.repeat(40) },
    checks: requiredChecks.map((name) => ({
      name,
      conclusion: 'success',
      completed_at: checksAt,
    })),
  };
}

test('landed skips only when the passed draft checked this commit tree', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const other = 'b'.repeat(40);
  for (const [name, shas, data, expected, status] of [
    ['a draft that tested this tree', [sha], provenLanding(sha), 'true', 0],
    [
      'two commits on the same tested tree',
      [sha, other],
      {
        ...provenLanding(sha),
        trees: {
          ...provenLanding(sha).trees,
          ...provenLanding(other).trees,
        },
      },
      'true',
      0,
    ],
    [
      'a queued label without a passed draft',
      [sha],
      { ...provenLanding(sha), comments: [] },
      'false',
      0,
    ],
    [
      'a passed draft whose checks finished after the merge',
      [sha],
      provenLanding(sha, { checksAt: '2026-11-10T09:31:28Z' }),
      'false',
      0,
    ],
    [
      'a passed draft that tested a different tree',
      [sha],
      provenLanding(sha, { sameTree: false }),
      'false',
      0,
    ],
    ['a direct push with no pull request', [sha], { ...provenLanding(sha), pulls: [] }, 'false', 0],
    ['no commits', [], provenLanding(sha), 'false', 0],
    ['a malformed sha', ['main'], provenLanding(sha), '', 2],
  ]) {
    const result = f.landed(shas, data);
    assert.equal(result.status, status, `${name}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), expected, name);
  }
  releaseTestTempDir(f.dir);
});

function queueDraft(number, title, body = title, headSha = 'c'.repeat(40)) {
  return {
    number,
    state: 'closed',
    draft: true,
    user: { login: 'mergify[bot]' },
    head: { ref: 'mergify/merge-queue/0123456789', sha: headSha },
    title,
    body,
  };
}

test('a queue draft landing is audited as the original that had queued', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const result = f.run(sha, {
    pulls: [
      queueDraft(
        3949,
        'merge queue: merged #3948, #3951: example',
        'pull_requests:\n  - number: 3948\n  - number: 3951\n',
      ),
    ],
    pull: { number: 3948, merged_at: '2026-11-11T06:13:12Z' },
    timelineByPull: {
      3948: [{ event: 'labeled', label: { name: 'queued' }, created_at: '2026-11-11T06:06:06Z' }],
      3951: [{ event: 'labeled', label: { name: 'queued' }, created_at: '2026-11-11T06:06:06Z' }],
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /#3948 merged through the queue/);
  assert.match(result.stdout, /#3951 merged through the queue/);
  assert.doesNotMatch(result.stdout, /#3949/);
  releaseTestTempDir(f.dir);
});

test('a pull_requests list without a trailing newline still names every original', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const result = f.run(sha, {
    pulls: [
      queueDraft(
        3949,
        'merge queue: merged #3948',
        'pull_requests:\n- number: 3948\n- number: 3951',
      ),
    ],
    pull: { number: 3948, merged_at: '2026-11-11T06:13:12Z' },
    timelineByPull: {
      3948: [{ event: 'labeled', label: { name: 'queued' }, created_at: '2026-11-11T06:06:06Z' }],
      3951: [{ event: 'labeled', label: { name: 'queued' }, created_at: '2026-11-11T06:06:06Z' }],
    },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /#3948 merged through the queue/);
  assert.match(result.stdout, /#3951 merged through the queue/);
  releaseTestTempDir(f.dir);
});

test('a queue draft landing whose original has no queued label is a violation', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const result = f.run(sha, {
    pulls: [queueDraft(3949, 'Merge of #3950')],
    pull: { number: 3950, merged_at: '2026-11-11T06:13:12Z' },
    timeline: [],
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /#3950 merged without a queued label/);
  assert.doesNotMatch(result.stdout, /#3949/);
  releaseTestTempDir(f.dir);
});

function draftLanding(sha, { sameTree, headSha = sha }) {
  const draftSha = 'd'.repeat(40);
  const tree = 'e'.repeat(40);
  return {
    pulls: [queueDraft(3894, 'Merge of #3892', 'Merge of #3892', headSha)],
    pull: { number: 3892, merged_at: '2026-11-10T09:31:27Z' },
    comments: [{ user: { login: 'mergify[bot]' }, body: '- ✅ **Passed** · draft #3894' }],
    drafts: { 3894: { head: { sha: draftSha } } },
    trees: { [sha]: tree, [draftSha]: sameTree ? tree : 'f'.repeat(40) },
    checks: requiredChecks.map((name) => ({
      name,
      conclusion: 'success',
      completed_at: '2026-11-10T09:30:52Z',
    })),
  };
}

test('a passed draft whose tree differs from the landed tree does not skip', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const result = f.landed([sha], draftLanding(sha, { sameTree: false }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'false');
  releaseTestTempDir(f.dir);
});

test('a passed draft with an equal tree and checks green before merged_at skips', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const result = f.landed([sha], draftLanding(sha, { sameTree: true, headSha: 'c'.repeat(40) }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'true');
  releaseTestTempDir(f.dir);
});
