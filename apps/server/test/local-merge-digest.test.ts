import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { commitEnv, runGitOk } from '../../daemon/src/git.js';
import { inspectLocalPatch } from '../../daemon/src/local-merge.js';
import { compareFilesFromResponse, computePatchDigest } from '../src/services/merge-gate/digest.js';

test('real Git additions, deletions, renames, binaries and evidence crossings match GitHub tuples without trimming patch bytes', async () => {
  const dir = makeTestTempDir('local-digest-');
  const git = (args: string[]) =>
    runGitOk(args, { cwd: dir, env: commitEnv({ name: 'digest', email: 'digest@localhost' }) });
  try {
    await git(['init', '-b', 'main']);
    mkdirSync(join(dir, 'docs/verify/1625'), { recursive: true });
    writeFileSync(join(dir, 'delete.txt'), 'deleted\n');
    writeFileSync(join(dir, 'old.txt'), 'renamed content\n');
    writeFileSync(join(dir, 'docs/verify/1625/out.txt'), 'crossing content\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'base']);
    const base = await git(['rev-parse', 'HEAD']);
    const oldSha = await git(['rev-parse', 'HEAD:delete.txt']);
    await git(['rm', 'delete.txt']);
    renameSync(join(dir, 'old.txt'), join(dir, 'new.txt'));
    renameSync(join(dir, 'docs/verify/1625/out.txt'), join(dir, 'out.txt'));
    writeFileSync(join(dir, 'added.txt'), 'added  \n');
    writeFileSync(join(dir, 'binary.bin'), Buffer.from([0, 1, 2]));
    writeFileSync(join(dir, 'docs/verify/1625/log.txt'), 'excluded\n');
    await git(['add', '.']);
    await git(['commit', '-m', 'candidate']);
    const head = await git(['rev-parse', 'HEAD']);
    const entries = [];
    for (const [filename, status, patch, previous_filename, additions, deletions] of [
      ['added.txt', 'added', '@@ -0,0 +1 @@\n+added  ', null, 1, 0],
      ['delete.txt', 'removed', '@@ -1 +0,0 @@\n-deleted', null, 0, 1],
      ['new.txt', 'renamed', null, 'old.txt', 0, 0],
      ['out.txt', 'renamed', null, 'docs/verify/1625/out.txt', 0, 0],
      ['binary.bin', 'added', null, null, 0, 0],
      ['docs/verify/1625/log.txt', 'added', '@@ -0,0 +1 @@\n+excluded', null, 1, 0],
    ] as const) {
      entries.push({
        filename,
        status,
        patch,
        previous_filename,
        additions,
        deletions,
        sha: status === 'removed' ? oldSha : await git(['rev-parse', `${head}:${filename}`]),
      });
    }
    const github = compareFilesFromResponse({ files: entries });
    expect(github).not.toBeNull();
    const local = await inspectLocalPatch(dir, base, head);
    expect(local.files.toSorted((a, b) => a.filename.localeCompare(b.filename))).toEqual(
      github?.toSorted((a, b) => a.filename.localeCompare(b.filename)),
    );
    expect(local.patchDigest).toBe(computePatchDigest(github ?? []).patchDigest);
  } finally {
    releaseTestTempDir(dir);
  }
});
