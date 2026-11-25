import { execFile } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { ACCESS_TOKEN_FILE_NAME, parseAccessTokenFile } from '@cairn/shared';
import { parseBatteryLow, runBackgroundUpdate } from './background-update.js';
import { residentWritingReply, restartResidentHost } from './resident-host.js';
import { verifyCairnSignature } from './signature.js';
import {
  fetchOfferedUpdate,
  folderWritable,
  stageBundle,
  swapInStaged,
  verifyStaged,
} from './update-core.js';
import { acquireUpdateLock, pidAlive, updateLockPath } from './update-lock.js';
import { appendUpdateLog } from './update-log.js';
import { canonicalPath } from './update-staging.js';
import { readBundleVersion } from './update-swap.js';

const run = promisify(execFile);

function appRunning(userData: string): boolean {
  try {
    const owner = readlinkSync(join(userData, 'SingletonLock'));
    const pid = Number(owner.slice(owner.lastIndexOf('-') + 1));
    return Number.isInteger(pid) && pid > 0 && pidAlive(pid);
  } catch {
    return false;
  }
}

function ownerToken(cairnHome: string): string | null {
  try {
    return parseAccessTokenFile(readFileSync(join(cairnHome, ACCESS_TOKEN_FILE_NAME), 'utf8'));
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const userData = process.env.CAIRN_USER_DATA;
  if (userData === undefined || userData === '') {
    console.error('CAIRN_USER_DATA is not set');
    process.exitCode = 2;
    return;
  }
  const bundle = canonicalPath(resolve(process.execPath, '..', '..', '..'));
  const cairnHome = join(userData, 'home');
  const log = (line: string): void => appendUpdateLog(userData, `background updater: ${line}`);
  const outcome = await runBackgroundUpdate({
    bundle,
    userData,
    bundleVersion: async () =>
      bundle.endsWith('.app') && (await verifyCairnSignature(bundle)) === 'accepted'
        ? readBundleVersion(bundle)
        : null,
    writable: () => folderWritable(bundle),
    appRunning: () => appRunning(userData),
    lowBattery: async () =>
      parseBatteryLow(
        (await run('/usr/bin/pmset', ['-g', 'batt']).catch(() => null))?.stdout ?? '',
      ),
    offeredUpdate: (version) => fetchOfferedUpdate(version),
    stage: (update, version) =>
      stageBundle(bundle, update, version, { downloading: () => {}, extracting: () => {} }),
    verify: (staged) => verifyStaged(bundle, staged),
    swap: (staged, version) => swapInStaged(bundle, staged, version),
    lock: () => acquireUpdateLock(updateLockPath(userData), 'background-updater', 0),
    residentBusy: async () => {
      const token = ownerToken(cairnHome);
      if (token === null) return false;
      return residentWritingReply(cairnHome, token).catch((error: unknown) => {
        log(`could not ask the resident server about replies: ${String(error)}`);
        return false;
      });
    },
    restartResident: async () => {
      await restartResidentHost({ homeDir: homedir() }).then(
        (restarted) => restarted && log('restarted the resident server'),
        (error: unknown) => log(`could not restart the resident server: ${String(error)}`),
      );
    },
    log,
  });
  console.log(`${new Date().toISOString()} ${outcome}`);
}

await main();
