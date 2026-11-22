import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { canonicalPath, isStagedBundleFor, removeStagingFolders } from '../src/update-staging.ts';

test('a folder holding a staged update is kept while the rest are cleared', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'applications-'));
  try {
    const staged = join(applications, '.cairn-update-keepme', 'Cairn.app');
    await mkdir(staged, { recursive: true });
    await mkdir(join(applications, '.cairn-update-stale'));
    await mkdir(join(applications, 'Cairn.app'));
    await removeStagingFolders(applications, [join(staged, 'Contents', 'MacOS', 'Cairn')]);
    assert.deepEqual((await readdir(applications)).sort(), ['.cairn-update-keepme', 'Cairn.app']);
    assert.deepEqual(await readdir(join(applications, '.cairn-update-keepme')), ['Cairn.app']);
  } finally {
    await rm(applications, { recursive: true, force: true });
  }
});

test('a staged app is only accepted from a staging folder beside the bundle', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'applications-'));
  try {
    const base = realpathSync(applications);
    const bundle = join(base, 'Cairn.app');
    const good = join(base, '.cairn-update-abc', 'Cairn.app');
    await mkdir(good, { recursive: true });
    assert.equal(isStagedBundleFor(bundle, good), true);
    const outside = join(base, 'elsewhere', 'Cairn.app');
    await mkdir(outside, { recursive: true });
    assert.equal(isStagedBundleFor(bundle, outside), false);
    const notStaging = join(base, 'Cairn.app.bak', 'Cairn.app');
    await mkdir(notStaging, { recursive: true });
    assert.equal(isStagedBundleFor(bundle, notStaging), false);
    assert.equal(isStagedBundleFor(bundle, join(base, '.cairn-update-abc', 'Other.app')), false);
    assert.equal(
      isStagedBundleFor(bundle, join(base, '.cairn-update-abc', 'Cairn.app', 'x')),
      false,
    );
    const alias = join(applications, '..', `${applications.split('/').pop()}-alias3`);
    await symlink(applications, alias);
    assert.equal(
      isStagedBundleFor(bundle, join(alias, '.cairn-update-abc', 'Cairn.app')),
      false,
      'a path that is not what its own canonical form says is refused',
    );
    await rm(alias, { force: true });
  } finally {
    await rm(applications, { recursive: true, force: true });
  }
});

test('canonicalising a path keeps a missing tail in order and resolves a real prefix', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'applications-'));
  try {
    const deep = join(applications, '.cairn-update-x', 'Cairn.app', 'Contents', 'MacOS', 'Cairn');
    await mkdir(join(applications, '.cairn-update-x', 'Cairn.app'), { recursive: true });
    assert.equal(
      canonicalPath(deep),
      join(
        realpathSync(applications),
        '.cairn-update-x',
        'Cairn.app',
        'Contents',
        'MacOS',
        'Cairn',
      ),
      'the missing tail keeps its order and the existing prefix is resolved',
    );
    const alias = join(applications, '..', `${applications.split('/').pop()}-alias2`);
    await symlink(applications, alias);
    assert.equal(
      canonicalPath(join(alias, '.cairn-update-x', 'Cairn.app')),
      join(realpathSync(applications), '.cairn-update-x', 'Cairn.app'),
    );
    await rm(alias, { force: true });
  } finally {
    await rm(applications, { recursive: true, force: true });
  }
});

test('a staged update is kept even when its recorded path came through a symlink', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'applications-'));
  try {
    const staged = join(applications, '.cairn-update-kept', 'Cairn.app');
    await mkdir(staged, { recursive: true });
    const alias = join(applications, '..', `${applications.split('/').pop()}-alias`);
    await symlink(applications, alias);
    await removeStagingFolders(applications, [join(alias, '.cairn-update-kept', 'Cairn.app')]);
    assert.deepEqual(await readdir(applications), ['.cairn-update-kept']);
    await rm(alias, { force: true });
  } finally {
    await rm(applications, { recursive: true, force: true });
  }
});

test('leftover staging folders go away, including a previous bundle with its app.asar', async () => {
  const applications = await mkdtemp(join(tmpdir(), 'applications-'));
  try {
    const resources = join(
      applications,
      '.cairn-update-abc123',
      'previous-Cairn.app',
      'Contents',
      'Resources',
    );
    await mkdir(resources, { recursive: true });
    await writeFile(join(resources, 'app.asar'), 'archive');
    await mkdir(join(applications, '.cairn-update-empty'));
    await mkdir(join(applications, 'Cairn.app'));
    await removeStagingFolders(applications);
    assert.deepEqual(await readdir(applications), ['Cairn.app']);
  } finally {
    await rm(applications, { recursive: true, force: true });
  }
});
