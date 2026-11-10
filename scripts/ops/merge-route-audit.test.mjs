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
if (args[1].includes('/pulls/')) { console.log(JSON.stringify(data.pull)); process.exit(0); }
if (args[1].includes('/commits/')) { console.log(JSON.stringify(data.pulls)); process.exit(0); }
if (args[1].includes('/timeline')) { console.log(JSON.stringify([data.timeline])); process.exit(0); }
if (args[1].includes('/actions/workflows/ci.yml/runs?')) { console.log(JSON.stringify(data.runs)); process.exit(0); }
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
    tested: (shas, data) => command(['tested', ...shas], data),
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

test('tested is true only for a commit whose own merge-queue ci run passed', () => {
  const f = fixture();
  const sha = 'a'.repeat(40);
  const run = {
    head_sha: sha,
    conclusion: 'success',
    head_branch: 'mergify/merge-queue/0123456789',
    head_repository: { full_name: 'xiechimon/cairn' },
    actor: { login: 'mergify[bot]' },
  };
  const runs = (...list) => ({ runs: { workflow_runs: list } });
  for (const [name, shas, data, expected, status] of [
    ['a passed queue run on this commit', [sha], runs(run), 'true', 0],
    ['an ordinary pull request run', [sha], runs({ ...run, head_branch: 'fix/x' }), 'false', 0],
    ['a run on another commit', [sha], runs({ ...run, head_sha: 'b'.repeat(40) }), 'false', 0],
    ['a failed queue run', [sha], runs({ ...run, conclusion: 'failure' }), 'false', 0],
    [
      'a queue-named branch in a fork',
      [sha],
      runs({ ...run, head_repository: { full_name: 'someone/cairn' } }),
      'false',
      0,
    ],
    [
      'a queue-named branch another actor pushed',
      [sha],
      runs({ ...run, actor: { login: 'xiechimon' } }),
      'false',
      0,
    ],
    ['a direct push with no run', [sha], runs(), 'false', 0],
    ['a passed queue run among others', [sha], runs({ ...run, head_branch: 'x' }, run), 'true', 0],
    ['an unreadable run listing', [sha], { runs: {} }, '', 2],
    ['a malformed sha', ['main'], runs(run), '', 2],
    ['no sha', [], runs(run), '', 2],
  ]) {
    const result = f.tested(shas, data);
    assert.equal(result.status, status, `${name}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), expected, name);
  }
  releaseTestTempDir(f.dir);
});
