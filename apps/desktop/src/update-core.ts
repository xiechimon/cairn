import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream, existsSync } from 'node:fs';
import { access, mkdtemp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  type DesktopUpdate,
  desktopReleaseManifestSchema,
  desktopUpdateFrom,
  resolveUpdateFeedBase,
} from '@cairn/shared';
import { verifyCairnSignature } from './signature.js';
import { isStagedBundleFor, removeFolder, STAGING_PREFIX } from './update-staging.js';
import type { InstalledUpdate, StagedUpdate, UpdateState } from './update-state.js';
import {
  APP_BUNDLE_NAME,
  APP_EXECUTABLE,
  applyStagedUpdate,
  previousAppPath,
  readBundleVersion,
} from './update-swap.js';

const run = promisify(execFile);
const REQUEST_HEADERS = { 'User-Agent': 'Cairn-Desktop' };
const NO_MANIFEST = 404;

export const SIGNATURE_REFUSAL = 'the staged update is not signed by the Cairn certificate';

export type VerifySignature = typeof verifyCairnSignature;

export class SignatureRefused extends Error {
  readonly mismatch: boolean;

  constructor(mismatch: boolean) {
    super(SIGNATURE_REFUSAL);
    this.mismatch = mismatch;
  }
}

export class StagedUnusable extends Error {}

export async function fetchOfferedUpdate(
  runningVersion: string,
  arch: string = process.arch,
  platform: NodeJS.Platform = process.platform,
): Promise<DesktopUpdate | null> {
  const { releasesBase, desktopManifestUrl } = resolveUpdateFeedBase(process.env);
  const response = await fetch(desktopManifestUrl, { headers: REQUEST_HEADERS });
  if (response.status === NO_MANIFEST) return null;
  if (!response.ok) throw new Error(`GitHub answered HTTP ${response.status}`);
  return desktopUpdateFrom(
    desktopReleaseManifestSchema.parse(await response.json()),
    runningVersion,
    arch,
    platform,
    releasesBase,
  );
}

export async function download(
  update: DesktopUpdate,
  target: string,
  onPercent: (percent: number) => void,
): Promise<void> {
  const response = await fetch(update.url, { headers: REQUEST_HEADERS });
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

export interface StageProgress {
  downloading(percent: number): void;
  extracting(): void;
}

export async function stageBundle(
  bundle: string,
  update: DesktopUpdate,
  runningVersion: string,
  progress: StageProgress,
  now: () => number = Date.now,
): Promise<StagedUpdate> {
  const staging = await mkdtemp(join(dirname(bundle), STAGING_PREFIX));
  try {
    progress.downloading(0);
    const zip = join(staging, `Cairn-${update.version}.zip`);
    await download(update, zip, (percent) => progress.downloading(percent));
    progress.extracting();
    await run('/usr/bin/ditto', ['-x', '-k', zip, staging]);
    const stagedApp = join(staging, APP_BUNDLE_NAME);
    const version = await readBundleVersion(stagedApp);
    if (version !== update.version) {
      throw new Error(
        `the downloaded app is version ${version ?? 'unknown'}, not ${update.version}`,
      );
    }
    return {
      version: update.version,
      zip,
      app: stagedApp,
      previousVersion: runningVersion,
      at: now(),
    };
  } catch (error) {
    await removeFolder(staging).catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
    throw error;
  }
}

export function stagedBundleExists(staged: StagedUpdate): boolean {
  return existsSync(join(staged.app, APP_EXECUTABLE));
}

export async function verifyStaged(
  bundle: string,
  staged: StagedUpdate,
  verify: VerifySignature = verifyCairnSignature,
): Promise<void> {
  if (!stagedBundleExists(staged)) throw new StagedUnusable('the staged update is missing');
  if (!isStagedBundleFor(bundle, staged.app)) {
    throw new StagedUnusable('the staged update is not where Cairn put it');
  }
  const signature = await verify(staged.app);
  if (signature !== 'accepted') {
    throw new SignatureRefused(signature === 'requirement-mismatch');
  }
  const version = await readBundleVersion(staged.app);
  if (version !== staged.version) {
    throw new StagedUnusable(
      `the staged app is version ${version ?? 'unknown'}, not ${staged.version}`,
    );
  }
  await removeFolder(previousAppPath(bundle));
}

export async function swapInStaged(
  bundle: string,
  staged: StagedUpdate,
  runningVersion: string,
  now: () => number = Date.now,
): Promise<InstalledUpdate> {
  await applyStagedUpdate({
    bundle,
    previousApp: previousAppPath(bundle),
    stagedApp: staged.app,
  });
  return {
    version: staged.version,
    previousVersion: runningVersion,
    previousApp: previousAppPath(bundle),
    at: now(),
  };
}

export function afterSwap(state: UpdateState, installed: InstalledUpdate): UpdateState {
  return { ...state, staged: null, installed, knownVersion: installed.version };
}

export async function folderWritable(bundle: string): Promise<boolean> {
  return access(dirname(bundle), constants.W_OK).then(
    () => true,
    () => false,
  );
}

export function outsideUpdaterNote(state: UpdateState, version: string): string | null {
  if (state.knownVersion === null || state.knownVersion === version) return null;
  if (state.installed?.version === version) return null;
  return `found ${version} installed outside the updater (last known ${state.knownVersion})`;
}
