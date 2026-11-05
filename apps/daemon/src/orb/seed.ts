import { createHash, randomUUID } from 'node:crypto';
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { runGitOk } from '../git.js';
import { isOrbPathId } from './protocol.js';

export async function prepareOrbSeed(input: {
  source: string;
  directory: string;
  projectId: string;
}): Promise<{ source: string; target: string; readonly: true; releaseAfterExec: true }> {
  mkdirSync(input.directory, { recursive: true, mode: 0o700 });
  const source = join(input.directory, 'repo');
  await runGitOk(
    [
      '-c',
      'init.templateDir=',
      'clone',
      '--bare',
      '--single-branch',
      '--no-tags',
      '--no-hardlinks',
      '--no-local',
      '--end-of-options',
      input.source,
      source,
    ],
    { timeoutMs: 120_000 },
  );
  await runGitOk(['remote', 'remove', 'origin'], { cwd: source });
  return {
    source,
    target: `/seed/${input.projectId}/repo`,
    readonly: true,
    releaseAfterExec: true,
  };
}

async function publishOrbSeedSnapshot(
  directory: string,
  target: string,
  runningSeedKeys: () => readonly (string | null | undefined)[],
): Promise<void> {
  chmodSync(directory, 0o755);
  const hash = createHash('sha256');
  const files = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(directory, join(entry.parentPath, entry.name)))
    .sort();
  for (const file of files) {
    const path = join(directory, file);
    hash.update(JSON.stringify([file, statSync(path).size]));
    for await (const chunk of createReadStream(path)) hash.update(chunk);
  }
  const version = join(dirname(target), `.data-${hash.digest('hex')}`);
  if (existsSync(version)) rmSync(directory, { recursive: true, force: true });
  else renameSync(directory, version);
  const link = `${target}-${randomUUID()}`;
  try {
    symlinkSync(basename(version), link);
    renameSync(link, target);
  } finally {
    rmSync(link, { force: true });
  }
  const keys = runningSeedKeys();
  if (keys.some((key) => key === undefined)) return;
  const retained = new Set<string | null | undefined>(keys);
  retained.add(basename(version));
  for (const entry of readdirSync(dirname(target), { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      /^\.data-[a-f0-9]{64}$/.test(entry.name) &&
      !retained.has(entry.name)
    )
      rmSync(join(dirname(target), entry.name), { recursive: true, force: true });
  }
}

export async function publishOrbSeed(input: {
  source: string;
  root: string;
  projectId: string;
  runningSeedKeys: () => readonly (string | null | undefined)[];
}): Promise<void> {
  if (!isOrbPathId(input.projectId)) throw new Error('Invalid orb project id');
  const project = join(input.root, input.projectId);
  mkdirSync(project, { recursive: true, mode: 0o755 });
  const snapshot = mkdtempSync(join(project, '.snapshot-'));
  try {
    await prepareOrbSeed({
      source: input.source,
      directory: snapshot,
      projectId: input.projectId,
    });
    await publishOrbSeedSnapshot(snapshot, join(project, 'current'), input.runningSeedKeys);
    const link = join(project, `.repo-${randomUUID()}`);
    try {
      symlinkSync('current/repo', link);
      renameSync(link, join(project, 'repo'));
    } finally {
      rmSync(link, { force: true });
    }
  } catch (error) {
    rmSync(snapshot, { recursive: true, force: true });
    throw error;
  }
}
