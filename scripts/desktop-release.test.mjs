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

test('publishing pins the built commit before creating a release even after main advances', (t) => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8'),
  );
  const script = workflow.jobs.publish.steps.find(
    (step) => step.name === 'Publish the release',
  ).run;
  const root = makeTestTempDir('desktop-publish-');
  t.after(() => releaseTestTempDir(root));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const remote = join(root, 'remote.git');
  git('init', '--bare', '--quiet', remote);
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Release Test');
  git('config', 'user.email', 'release@example.com');
  git('remote', 'add', 'origin', remote);
  mkdirSync(join(root, '.github/workflows'), { recursive: true });
  writeFileSync(join(root, '.github/workflows/build.yml'), 'initial workflow');
  git('add', '.github/workflows/build.yml');
  git('commit', '--quiet', '-m', 'Built commit');
  const built = git('rev-parse', 'HEAD');
  writeFileSync(join(root, '.github/workflows/build.yml'), 'newer workflow');
  git('add', '.github/workflows/build.yml');
  git('commit', '--quiet', '-m', 'Main advances during build');
  git('push', '--quiet', 'origin', 'main');

  const bin = join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(
    join(bin, 'gh'),
    '#!/bin/sh\nset -eu\ngit ls-remote --exit-code origin "refs/tags/$3" >/dev/null\nprintf "%s\\n" "$@" >> "$PUBLISH_ARGUMENTS"\n',
    { mode: 0o755 },
  );
  const published = join(root, 'published');
  const publish = (version) =>
    spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_SHA: built,
        VERSION: version,
        PATH: `${bin}:${process.env.PATH}`,
        PUBLISH_ARGUMENTS: published,
      },
    });
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = publish('0.1.2');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.2').split(/\s/)[0], built);
    assert.match(readFileSync(published, 'utf8'), /desktop-v0\.1\.2/);
  }

  git('push', '--quiet', 'origin', 'HEAD:refs/tags/desktop-v0.1.3');
  writeFileSync(published, '');
  assert.notEqual(publish('0.1.3').status, 0);
  assert.equal(readFileSync(published, 'utf8'), '');
  assert.equal(
    git('ls-remote', 'origin', 'refs/tags/desktop-v0.1.3').split(/\s/)[0],
    git('rev-parse', 'HEAD'),
  );
});

test('both architectures are packaged in parallel and published only after both succeed', () => {
  const workflow = parse(
    readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8'),
  );
  const manifest = readFileSync(
    new URL('../apps/desktop/scripts/release-manifest.mjs', import.meta.url),
    'utf8',
  );
  assert.deepEqual(workflow.jobs.package.strategy.matrix.arch, ['arm64', 'x64']);
  assert.match(manifest, /ARCHS = \['arm64', 'x64'\]/);
  assert.equal(workflow.jobs.publish.needs, 'package');
  assert.equal(workflow.jobs.publish.permissions.contents, 'write');
  assert.equal(workflow.jobs.package.permissions, undefined);
});
