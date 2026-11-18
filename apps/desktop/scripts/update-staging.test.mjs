import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeStagingFolders } from '../src/update-staging.ts';

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
