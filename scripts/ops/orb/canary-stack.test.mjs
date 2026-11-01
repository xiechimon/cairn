import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { plantSentinels, scanObjects, withCleanup } from './canary.mjs';
import { startStack } from './canary-stack.mjs';

test('real scratch server enrollment and host runner deliver the fake-home attacker and hook note', {
  timeout: 90000,
}, async () => {
  await withCleanup(async (defer) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orb-canary-stack-test-')));
    defer(() => rmSync(root, { recursive: true, force: true }));
    const home = join(root, 'fake-host');
    for (const name of ['.cairn', '.ssh', '.codex', '.claude'])
      mkdirSync(join(home, name), { recursive: true });
    const planted = plantSentinels(home);
    defer(planted.cleanup);
    const config = { hostHome: home, sentinels: planted.sentinels, realPaths: [] };
    const stack = await startStack({
      root,
      config,
      defer,
      requireOrbBuild: false,
      probeNetwork: false,
    });
    const run = await stack.run('host');
    assert.equal(run.result.executor, 'host');
    assert.equal(run.result.leaked.length, 5);
    assert.equal(await scanObjects(run.repo, run.branch, planted.markers), false);
  });
});
