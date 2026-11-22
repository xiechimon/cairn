import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { DesktopUpdate } from '@cairn/shared';
import { removeFolder, removeStagingFolders, STAGING_PREFIX } from './update-staging.ts';
import { readUpdateState, type StagedUpdate, writeUpdateState } from './update-state.ts';
import { APP_BUNDLE_NAME, readBundleVersion } from './update-swap.ts';

const run = promisify(execFile);

export const UPDATE_REQUEST_HEADERS = { 'User-Agent': 'Cairn-Desktop' };

export interface StageRequest {
  statePath: string;
  bundleFolder: string;
  runningVersion: string;
  update: DesktopUpdate;
  onProgress: (phase: 'downloading' | 'installing', percent: number) => void;
}

async function downloadUpdate(
  update: DesktopUpdate,
  target: string,
  onPercent: (percent: number) => void,
): Promise<void> {
  const response = await fetch(update.url, { headers: UPDATE_REQUEST_HEADERS });
  if (!response.ok || response.body === null) {
    throw new Error(`download failed with HTTP ${response.status}`);
  }
  const hash = createHash('sha256');
  const file = createWriteStream(target);
  let received = 0;
  let reported = -1;
  for await (const chunk of response.body) {
    hash.update(chunk);
    received += chunk.byteLength;
    if (!file.write(chunk)) await new Promise((drained) => file.once('drain', drained));
    const percent = Math.min(99, Math.floor((received / update.size) * 100));
    if (percent !== reported) {
      reported = percent;
      onPercent(percent);
    }
  }
  await new Promise<void>((closed, failed) =>
    file.end((error?: Error | null) => (error ? failed(error) : closed())),
  );
  if (hash.digest('hex') !== update.sha256)
    throw new Error('the download does not match its SHA-256 digest');
}

async function prepareStagedUpdate(request: StageRequest, staging: string): Promise<StagedUpdate> {
  const zip = join(staging, `Cairn-${request.update.version}.zip`);
  await downloadUpdate(request.update, zip, (percent) =>
    request.onProgress('downloading', percent),
  );
  request.onProgress('installing', 100);
  await run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
  const app = join(staging, APP_BUNDLE_NAME);
  const version = await readBundleVersion(app);
  if (version !== request.update.version) {
    throw new Error(
      `the downloaded app is version ${version ?? 'unknown'}, not ${request.update.version}`,
    );
  }
  return {
    version,
    zip,
    app,
    previousVersion: request.runningVersion,
    at: Date.now(),
  };
}

async function discardStagingOnFailure<T>(staging: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await removeFolder(staging).catch(() => {});
    throw error;
  }
}

async function commitStagedUpdate(
  statePath: string,
  bundleFolder: string,
  next: StagedUpdate,
): Promise<void> {
  writeUpdateState(statePath, { ...readUpdateState(statePath), staged: next });
  await removeStagingFolders(bundleFolder, [next.app]);
}

export async function stageUpdate(request: StageRequest): Promise<StagedUpdate> {
  const staging = await mkdtemp(join(request.bundleFolder, STAGING_PREFIX));
  const staged = await discardStagingOnFailure(staging, () =>
    prepareStagedUpdate(request, staging),
  );
  await commitStagedUpdate(request.statePath, request.bundleFolder, staged);
  return staged;
}
