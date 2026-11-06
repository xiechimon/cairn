import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { makeTestTempDir } from '../../test-tmpdir.mjs';

const SCRIPT = join(import.meta.dirname, 'tools/ci-speed.sh');
const START = Date.parse('2026-11-06T10:00:00Z');

test('ci-speed prints median, p90 and max per event from gh run durations', () => {
  const dir = makeTestTempDir('ci-speed-');
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  const runs = [60, 120, 180, 240, 300, 360, 420, 480, 540, 600].map((seconds) => ({
    startedAt: '2026-11-06T10:00:00Z',
    updatedAt: new Date(START + seconds * 1000).toISOString().replace('.000', ''),
  }));
  writeFileSync(join(dir, 'runs.json'), JSON.stringify(runs));
  writeFileSync(
    join(bin, 'gh'),
    `#!/bin/bash\nwhile [ $# -gt 0 ]; do if [ "$1" = --jq ]; then exec jq -r "$2" "${join(dir, 'runs.json')}"; fi; shift; done\n`,
  );
  chmodSync(join(bin, 'gh'), 0o755);
  const result = spawnSync('bash', [SCRIPT], {
    env: { PATH: `${bin}:/usr/bin:/bin` },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /pull_request median 5m00s p90 9m00s max 10m00s \(10 runs\); push median 5m00s/,
  );
});
