import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve('scripts/ops/host/tools/overnight/lane-replaced.sh');

function replaced(t, { linked, own = '', ghFails = false }) {
  const bin = mkdtempSync(join(tmpdir(), 'lane-replaced-'));
  t.after(() => rmSync(bin, { recursive: true, force: true }));
  const refs = JSON.stringify(linked.map((number) => ({ number })));
  writeFileSync(
    join(bin, 'gh'),
    ghFails
      ? '#!/bin/sh\nexit 1\n'
      : `#!/bin/sh\ncase "$*" in "issue view 2420 "*) printf '%s' '${refs}' | jq -r '.[].number';; *) exit 1;; esac\n`,
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
