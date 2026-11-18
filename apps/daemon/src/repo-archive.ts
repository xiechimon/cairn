import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type MachineRepoArchiveCommand,
  REPO_ARCHIVE_FAILED_FILE_NAME,
  REPO_ARCHIVE_FILE_NAME,
} from '@cairn/shared';
import { gitFailureMessage, runGit } from './git.js';
import type { DaemonLogger } from './log.js';
import type { MachineApi } from './machine-client.js';

const ARCHIVE_TIMEOUT_MS = 60_000;

export interface RepoArchiveDeps {
  client: MachineApi;
  logger: DaemonLogger;
}

async function archiveBase64(cmd: MachineRepoArchiveCommand): Promise<string> {
  if (cmd.ref.startsWith('-')) throw new Error('the default branch name is not valid');
  const verified = await runGit(
    ['rev-parse', '--verify', '--end-of-options', `${cmd.ref}^{commit}`],
    { cwd: cmd.directory, timeoutMs: ARCHIVE_TIMEOUT_MS },
  );
  if (verified.code !== 0) throw new Error('the default branch does not exist');
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-repo-archive-'));
  try {
    const file = join(scratch, 'snapshot.tar.gz');
    const ran = await runGit(['archive', '--format=tar.gz', '-o', file, verified.stdout.trim()], {
      cwd: cmd.directory,
      timeoutMs: ARCHIVE_TIMEOUT_MS,
    });
    if (ran.code !== 0) throw new Error(gitFailureMessage('archive', ran, ARCHIVE_TIMEOUT_MS));
    if (statSync(file).size > cmd.maxBytes) {
      throw new Error(`the snapshot is larger than ${cmd.maxBytes} bytes`);
    }
    return readFileSync(file).toString('base64');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function performRepoArchive(
  deps: RepoArchiveDeps,
  cmd: MachineRepoArchiveCommand,
): Promise<void> {
  const { client, logger } = deps;
  let name = REPO_ARCHIVE_FILE_NAME;
  let body: string;
  try {
    body = await archiveBase64(cmd);
  } catch (err) {
    name = REPO_ARCHIVE_FAILED_FILE_NAME;
    body = err instanceof Error ? err.message : String(err);
    logger.workspace(`repo archive for step ${cmd.stepId} failed: ${body}`);
  }
  try {
    const { uploads } = await client.uploadUrls(cmd.stepId, [{ name, size: body.length }]);
    const upload = uploads.find((u) => u.name === name);
    if (upload === undefined) throw new Error('the server returned no upload url');
    await client.putUpload(upload.url, upload.headers, body, 'text/plain');
  } catch (err) {
    logger.workspace(
      `repo archive upload for step ${cmd.stepId} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
