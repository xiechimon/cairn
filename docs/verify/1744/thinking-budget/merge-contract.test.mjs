import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

for (const [name, fixture, status] of [
  [
    'rejects the captured rearmed payload with null squash fields',
    'rearmed-merge-snapshot.json',
    1,
  ],
  [
    'accepts a payload matching the explicitly audited squash message',
    'configured-merge-fixture.json',
    0,
  ],
]) {
  test(name, () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('./check-merge-message.mjs', import.meta.url)),
        fileURLToPath(new URL(fixture, import.meta.url)),
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, status, result.stdout + result.stderr);
  });
}
