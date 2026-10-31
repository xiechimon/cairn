import {
  closeSync,
  constants,
  fstatSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conversationBranch } from '@cairn/shared';
import { runGit, runGitOk } from '../git.js';

export const ORB_MAX_BUNDLE_BYTES = 64 * 1024 * 1024;

export interface OrbLocalDelivery {
  outboxDir: string;
  repoPath: string;
  conversationId: string;
}

export async function deliverOrbBundle(input: OrbLocalDelivery, filename: string): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-orb-delivery-'));
  try {
    const descriptor = openSync(
      join(input.outboxDir, filename),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    let content: Buffer;
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile() || stat.nlink !== 1)
        throw new Error('Bundle must be a regular file with one link');
      if (stat.size > ORB_MAX_BUNDLE_BYTES) throw new Error('Bundle exceeds 64 MiB size cap');
      content = Buffer.alloc(stat.size + 1);
      let offset = 0;
      while (offset < content.length) {
        const size = readSync(descriptor, content, offset, content.length - offset, offset);
        if (size === 0) break;
        offset += size;
      }
      if (offset !== stat.size) throw new Error('Bundle changed while reading');
      content = content.subarray(0, offset);
    } finally {
      closeSync(descriptor);
    }
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
