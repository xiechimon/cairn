import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import test from 'node:test';

const CLI = join(import.meta.dirname, 'smoke-mac.mjs');

test('the smoke refuses to signal the installed app', () => {
  const result = spawnSync(process.execPath, [CLI, '/Applications/Cairn.app', 'out.png'], {
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /installed app/);
});
