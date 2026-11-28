import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, readlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  ACCESS_TOKEN_FILE_NAME,
  type HostRollbackNotice,
  parseAccessTokenFile,
  type ServerUpdateReason,
  type ServerUpdateState,
} from '@cairn/shared';
import { parseBatteryLow, runBackgroundUpdate } from './background-update.js';
import {
  consumeHostUpdateForce,
  initialHandledHostRequestId,
  readHostRollbackNotice,
  readHostUpdateRequest,
  writeHostUpdateStatus,
} from './host-update.js';
import {
  acquireDeployLease,
  hasDomainWritesSinceSnapshot,
  isResidentInstalled,
  probeResidentHealth,
  readServerOwner,
  releaseDeployLease,
  residentWritingReply,
  restartResidentHost,
  restoreResidentDb,
  snapshotResidentDb,
  stopResidentHost,
} from './resident-host.js';
import { verifyCairnSignature } from './signature.js';
import {
  fetchOfferedUpdate,
  folderWritable,
  stageBundle,
  swapInStaged,
  verifyStaged,
} from './update-core.js';
import { acquireUpdateLock, pidAlive, updateLockPath } from './update-lock.js';
import { appendUpdateLog, updateLogPath } from './update-log.js';
import { canonicalPath } from './update-staging.js';
import { readBundleVersion, restorePrevious } from './update-swap.js';

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
  const request = readHostUpdateRequest(cairnHome);
  const previousHandledId = initialHandledHostRequestId(cairnHome);
  const appWasRunning = appRunning(userData);
  const hasResident =
    isResidentInstalled(homedir()) || readServerOwner(cairnHome)?.managedBy === 'launchd';
  const leaseOwner = randomUUID();
  const leaseTtlMs = 120_000;
  const forceActive =
    request !== null && request.force === true && request.id !== previousHandledId;
  let handledRequestId = forceActive ? previousHandledId : (request?.id ?? null);
  let rollbackNotice: HostRollbackNotice | null | undefined = forceActive
    ? null
    : (readHostRollbackNotice(cairnHome) ?? undefined);
  const writeStatus = (
    state: ServerUpdateState,
    targetVersion: string | null = null,
    percent: number | null = null,
    reason: ServerUpdateReason | null = null,
    supported = true,
  ): void => {
    if (appWasRunning) return;
    try {
      writeHostUpdateStatus(cairnHome, {
        pid: process.pid,
        kind: 'background-agent',
        supported,
        blocker: null,
        state,
        targetVersion,
        percent,
        reason,
        handledRequestId,
        updatedAt: Date.now(),
        ...(rollbackNotice !== undefined ? { rollback: rollbackNotice } : {}),
      });
    } catch (error) {
      console.debug('cairn: recoverable operation failed', error);
    }
  };
  writeStatus('checking', request?.requestedVersion ?? null);
  const outcome = await runBackgroundUpdate({
    bundle,
    userData,
    force: forceActive,
    forceVersion: request?.requestedVersion ?? null,
    logPath: updateLogPath(userData),
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
      stageBundle(bundle, update, version, {
        downloading: (percent) => writeStatus('downloading', update.version, Math.round(percent)),
        extracting: () => writeStatus('installing', update.version, 100),
      }),
    verify: (staged) => verifyStaged(bundle, staged),
    swap: (staged, version) => swapInStaged(bundle, staged, version),
    lock: () => acquireUpdateLock(updateLockPath(userData), 'background-updater', 0),
    ...(hasResident
      ? {
          acquireLease: () =>
            acquireDeployLease(cairnHome, ownerToken(cairnHome), leaseOwner, leaseTtlMs),
          releaseLease: () => releaseDeployLease(cairnHome, ownerToken(cairnHome), leaseOwner),
          snapshotDb: (fromVersion: string) => snapshotResidentDb(cairnHome, fromVersion),
          hasDomainWrites: (snapshotPath: string | null) =>
            hasDomainWritesSinceSnapshot(cairnHome, snapshotPath),
          restoreDb: (snapshotPath: string | null, failedVersion: string) =>
            restoreResidentDb(cairnHome, snapshotPath, failedVersion),
          probeHealth: () => probeResidentHealth(cairnHome, ownerToken(cairnHome)),
          stopResident: () => stopResidentHost({ homeDir: homedir(), cairnHome }),
          restoreBundle: (previousApp: string) => restorePrevious({ bundle, previousApp }),
          onRollback: (notice: HostRollbackNotice) => {
            rollbackNotice = notice;
          },
          residentBusy: async () => {
            const token = ownerToken(cairnHome);
            if (token === null) {
              const owner = readServerOwner(cairnHome);
              if (owner !== null && owner.managedBy === 'launchd' && pidAlive(owner.pid)) {
                log('holding update: resident server is alive without a readable owner token');
                return true;
              }
              return false;
            }
            const busy = await residentWritingReply(cairnHome, token).catch((error: unknown) => {
              log(`could not ask the resident server about replies: ${String(error)}`);
              return true;
            });
            if (busy) writeStatus('waiting-idle', request?.requestedVersion ?? null);
            return busy;
          },
          restartResident: async () => {
            writeStatus('restarting', request?.requestedVersion ?? null, 100);
            await restartResidentHost({ homeDir: homedir() }).then(
              (restarted) => restarted && log('restarted the resident server'),
              (error: unknown) => log(`could not restart the resident server: ${String(error)}`),
            );
          },
        }
      : {
          residentBusy: async () => false,
          restartResident: async () => {},
        }),
    log,
  });
  const deferredOutcome =
    outcome === 'app-running' ||
    outcome === 'resident-busy' ||
    outcome === 'low-battery' ||
    outcome === 'lock-busy';
  if (!deferredOutcome && request !== null) {
    handledRequestId = request.id;
    if (forceActive) consumeHostUpdateForce(cairnHome, request.id);
  }
  if (outcome === 'installed') writeStatus('restarting', request?.requestedVersion ?? null, 100);
  else if (outcome === 'confirmed') {
    rollbackNotice = null;
    writeStatus('up-to-date', null, null, null);
  } else if (outcome === 'rolled-back' || outcome === 'rolled-back-code') {
    writeStatus('idle', null, null, 'blocked');
  } else if (outcome === 'rollback-failed' || outcome === 'repair-held') {
    writeStatus('failed', null, null, 'failed');
  } else if (outcome === 'current') {
    writeStatus('up-to-date', null, null, request === null ? null : 'no-release');
  } else if (outcome === 'resident-busy') {
    writeStatus('waiting-idle', request?.requestedVersion ?? null);
  } else if (outcome === 'low-battery') {
    writeStatus('waiting-idle', request?.requestedVersion ?? null, null, 'low-battery');
  } else if (outcome === 'blocked') {
    writeStatus('idle', request?.requestedVersion ?? null, null, 'blocked');
  } else if (outcome === 'failed') {
    writeStatus('failed', request?.requestedVersion ?? null, null, 'failed');
  } else if (outcome === 'read-only') {
    writeStatus('unsupported', null, null, 'read-only', false);
  } else if (outcome === 'not-cairn') {
    writeStatus('unsupported', null, null, 'development', false);
  } else if (outcome === 'lock-busy') {
    writeStatus('waiting-idle', request?.requestedVersion ?? null, null, 'blocked');
  }
  console.log(`${new Date().toISOString()} ${outcome}`);
}

await main();
