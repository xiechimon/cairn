import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runGitOk } from '../git.js';

export async function createVerificationClone(source: string, commit: string) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit))
    throw new Error('Verify delivery commit must be an object ID');
  const root = mkdtempSync(join(tmpdir(), 'cairn-verify-'));
  const cwd = join(root, 'repo');
  const cleanup = () => rmSync(root, { recursive: true, force: true });
  try {
    await runGitOk(['clone', '--shared', '--no-checkout', '--', source, cwd], {
      timeoutMs: 30_000,
    });
    await runGitOk(['checkout', '--detach', commit, '--'], { cwd, timeoutMs: 30_000 });
    return { cwd, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}
