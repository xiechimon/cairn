import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ops/host/tools/overnight/lane-replaced.sh');

function replaced(t, { linked, own = '', ghFails = false, state = 'OPEN' }) {
  const bin = mkdtempSync(join(tmpdir(), 'lane-replaced-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const issue = JSON.stringify({
    state,
    closedByPullRequestsReferences: linked.map((number) => ({ number })),
  });
  writeFileSync(join(bin, 'issue.json'), issue);
  writeFileSync(
    join(bin, 'gh'),
    ghFails
      ? '#!/bin/sh\nexit 1\n'
      : `#!/bin/sh\n[ "$1 $2 $3" = "issue view 2420" ] || exit 1\nwhile [ $# -gt 0 ]; do [ "$1" = --jq ] && f=$2; shift; done\njq -r "$f" "${join(bin, 'issue.json')}"\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync('bash', [script, '2420', own], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { code: result.status, out: result.stdout.trim() };
}

test('a lane whose issue another open PR closes is replaced (#2542 after #2537)', (t) => {
  assert.deepEqual(replaced(t, { linked: [2537] }), { code: 0, out: '2537' });
});

test('a lane with its own PR is replaced when a second open PR also closes the issue', (t) => {
  assert.deepEqual(replaced(t, { linked: [2542, 2537], own: '2542' }), { code: 0, out: '2537' });
});

test('a lane whose own PR is the only one closing the issue is not replaced', (t) => {
  assert.equal(replaced(t, { linked: [2542], own: '2542' }).code, 1);
});

test('a lane whose issue no open PR closes is not replaced', (t) => {
  assert.equal(replaced(t, { linked: [] }).code, 1);
});

test('an unreadable issue counts as replaced so the driver never pushes a duplicate', (t) => {
  const r = replaced(t, { linked: [], ghFails: true });
  assert.equal(r.code, 0);
  assert.equal(r.out, 'unknown');
});

test('a lane whose issue is closed is obsolete, so its stale rebase markers are never surfaced', (t) => {
  assert.deepEqual(replaced(t, { linked: [], state: 'CLOSED' }), { code: 0, out: 'closed' });
});

test('a closed issue wins over the lane still having its own PR', (t) => {
  assert.deepEqual(replaced(t, { linked: [2542], own: '2542', state: 'CLOSED' }), {
    code: 0,
    out: 'closed',
  });
});
