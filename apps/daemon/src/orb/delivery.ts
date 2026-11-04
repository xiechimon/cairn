import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { runGit, runGitOk } from '../git.js';
import { readOrbFile } from './runtime-fs.js';

export const ORB_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface OrbLocalDelivery {
  outboxDir: string;
  repoPath: string;
  conversationId: string;
}

export async function deliverOrbBundle(input: OrbLocalDelivery, filename: string): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-orb-delivery-'));
  try {
    const content = readOrbFile(input.outboxDir, filename, ORB_MAX_BUNDLE_BYTES);
    const bundle = join(directory, 'verified.bundle');
    writeFileSync(bundle, content, { mode: 0o600 });
    const opts = { cwd: input.repoPath, timeoutMs: 120_000 };
    await runGitOk(['bundle', 'verify', bundle], opts);
    const refs = await runGitOk(['bundle', 'list-heads', bundle], opts);
    const ref = `refs/heads/${conversationBranch(input.conversationId)}`;
    const lines = refs.split('\n');
    const [oid, name] = (lines[0] ?? '').split(' ');
    if (
      !oid ||
      lines.length !== 1 ||
      name !== ref ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid ?? '')
    )
      throw new Error('Bundle must contain only the claimed Thread branch');
    const fetched = await runGit(
      [
        'fetch',
        '--no-tags',
        '--no-write-fetch-head',
        '--refmap=',
        '--end-of-options',
        bundle,
        `${ref}:${ref}`,
      ],
      opts,
    );
    if (fetched.code !== 0) {
      if (
        !/non-fast-forward/.test(fetched.stderr) ||
        (await runGit(['merge-base', '--is-ancestor', '--end-of-options', oid, ref], opts)).code !==
          0
      )
        throw new Error(`Bundle delivery rejected: ${fetched.stderr.trim()}`);
    }
  } catch (error) {
    throw new Error(
      `Local bundle delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
