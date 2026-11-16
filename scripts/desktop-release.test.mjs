import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parse } from 'yaml';
import { makeTestTempDir, releaseTestTempDir } from './test-tmpdir.mjs';

test('automatic Mac releases require shipped source changes; manual releases can rebuild', (t) => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8'),
  );
  const script = workflow.jobs.decide.steps.find((step) => step.id === 'changed').run;
  const root = makeTestTempDir('desktop-release-');
  t.after(() => releaseTestTempDir(root));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '--quiet');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.com');
  mkdirSync(join(root, 'apps/desktop/test'), { recursive: true });
  writeFileSync(join(root, 'apps/desktop/main.js'), 'initial source');
  git('add', 'apps/desktop/main.js');
  git('commit', '--quiet', '-m', 'Initial source');

  const decide = (event, expected) => {
    const output = join(root, 'output');
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: event,
        GITHUB_SHA: git('rev-parse', 'HEAD').trim(),
        GITHUB_OUTPUT: output,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), `release=${expected}\n`, event);
  };

  decide('push', true);
  decide('schedule', true);
  git('tag', 'desktop-v0.1.1');
  decide('push', false);
  decide('schedule', false);
  decide('workflow_dispatch', true);

  writeFileSync(join(root, 'apps/desktop/README.md'), 'Documentation only');
  writeFileSync(join(root, 'apps/desktop/test/main.test.js'), 'Test only');
  git('add', 'apps/desktop/README.md', 'apps/desktop/test/main.test.js');
  git('commit', '--quiet', '-m', 'Non-shipped changes');
  decide('push', false);
  decide('schedule', false);

  writeFileSync(join(root, 'apps/desktop/main.js'), 'updated source');
  git('add', 'apps/desktop/main.js');
  git('commit', '--quiet', '-m', 'Shipped source change');
  decide('push', true);
  decide('schedule', true);

  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.deepEqual(workflow.on.schedule, [{ cron: '17 * * * *' }]);
});
