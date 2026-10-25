import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { MachineSyncCommand } from '@cairn/shared';
import { gitPrim, runGitOk } from './git.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';

export interface SyncDeps {
  client: MachineApi;
  logger: DaemonLogger;
}

export async function performSync(deps: SyncDeps, cmd: MachineSyncCommand): Promise<void> {
  const { client, logger } = deps;
  try {
    await client.syncResult(cmd.syncId, { status: 'running' });
  } catch (err) {
    logger.workspace(
      `sync ${cmd.syncId} running ack failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  logger.workspace(
    `sync ${cmd.syncId} start: ${cmd.directory} -> ${cmd.ref}@${cmd.commit.slice(0, 12)}`,
  );

  try {
    await runSyncGit(cmd);
    await client.syncResult(cmd.syncId, { status: 'synced' });
    logger.workspace(`sync ${cmd.syncId} done (commit ${cmd.commit.slice(0, 12)})`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.workspace(`sync ${cmd.syncId} failed: ${message}`);
    try {
      await client.syncResult(cmd.syncId, { status: 'failed', errorMessage: message });
    } catch (postErr) {
      logger.workspace(
        `sync ${cmd.syncId} failed-ack post failed: ${postErr instanceof Error ? postErr.message : String(postErr)}`,
      );
    }
  }
}

async function runSyncGit(cmd: MachineSyncCommand): Promise<void> {
  const { directory, cloneUrl, ref, commit, force } = cmd;
  const hasGit = existsSync(join(directory, '.git'));

  if (!hasGit) {
    if (cloneUrl === '') {
      throw new Error('clone url missing (project has no repo binding)');
    }
    rmSync(directory, { recursive: true, force: true });
    await gitPrim.clone(cloneUrl, directory, null);
  }

  try {
    await gitPrim.fetch(directory, null);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/couldn't find remote ref/i.test(msg)) {
      throw err;
    }
  }

  const checkoutRef = await resolveCheckoutRef(directory, ref);
  await gitPrim.checkout(directory, checkoutRef, force);

  await gitPrim.resetHard(directory, commit);

  if (force) {
    await gitPrim.cleanFd(directory);
  }
}

async function resolveCheckoutRef(directory: string, ref: string): Promise<string> {
  if (await gitPrim.hasRemoteBranch(directory, ref)) {
    return `refs/remotes/origin/${ref}`;
  }
  if (await gitPrim.hasLocalBranch(directory, ref)) {
    return `refs/heads/${ref}`;
  }
  try {
    return await runGitOk(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
      cwd: directory,
      timeoutMs: 30_000,
    });
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    throw new Error(`unable to resolve ref ${ref}: ${why}`);
  }
}
