import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runGitOk } from '../git.js';

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
      '--no-hardlinks',
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
