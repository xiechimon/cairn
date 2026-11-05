import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir, releaseTestTempDir } from '../test-tmpdir.mjs';
import { queuedBeforeMerge } from './merge-route-audit.mjs';

const labeled = (name, at) => ({ event: 'labeled', label: { name }, created_at: at });

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
console.error('unexpected ' + args.join(' ')); process.exit(1);
`,
    { mode: 0o755 },
  );
  return {
    dir,
    run: (sha, data) => {
      writeFileSync(join(dir, 'data.json'), JSON.stringify(data));
      return spawnSync(process.execPath, ['scripts/ops/merge-route-audit.mjs', 'commit', sha], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, DATA: join(dir, 'data.json') },
      });
    },
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
