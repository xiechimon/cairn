import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DesktopUpdate, HostRollbackNotice } from '@cairn/shared';
import type { ResidentHealthProbe } from './resident-host.js';
import {
  afterSwap,
  outsideUpdaterNote,
  SignatureRefused,
  StagedUnusable,
  stagedBundleExists,
} from './update-core.js';
import { pidAlive } from './update-lock.js';
import {
  artifactSupportsStepMarker,
  completeHoldPins,
  confirmStop,
  finishRepair,
  holdRepair,
  stopThenDecide,
} from './update-repair.js';
import { removeFolder, removeStagingFolders } from './update-staging.js';
import {
  type InstalledUpdate,
  isAutoInstallBlocked,
  readUpdateState,
  type StagedUpdate,
  type UpdateState,
  updateStatePath,
  writeUpdateState,
} from './update-state.js';
import { previousAppPath, restorePrevious } from './update-swap.js';

export const LOW_BATTERY_PERCENT = 20;
const PROBATION_SUSTAINED_MS = 30_000;
const PROBATION_DEADLINE_MS = 90_000;
const PROBATION_POLL_MS = 2_000;
const PROBATION_MAX_FAILURES = 3;

export type BackgroundOutcome =
  | 'not-cairn'
  | 'read-only'
  | 'app-running'
  | 'low-battery'
  | 'unconfirmed'
  | 'current'
  | 'blocked'
  | 'resident-busy'
  | 'lock-busy'
  | 'installed'
  | 'confirmed'
  | 'rolled-back'
  | 'rolled-back-code'
  | 'rollback-failed'
  | 'repair-held'
  | 'failed';

export interface BackgroundDeps {
  bundle: string;
  userData: string;
  bundleVersion(): Promise<string | null>;
  writable(): Promise<boolean>;
  appRunning(): boolean;
  lowBattery(): Promise<boolean>;
  offeredUpdate(runningVersion: string): Promise<DesktopUpdate | null>;
  stage(update: DesktopUpdate, runningVersion: string): Promise<StagedUpdate>;
  verify(staged: StagedUpdate): Promise<void>;
  swap(staged: StagedUpdate, runningVersion: string): Promise<InstalledUpdate>;
  lock(): Promise<(() => void) | null>;
  residentBusy(): Promise<boolean>;
  restartResident(): Promise<void>;
  stopResident?(): Promise<boolean>;
  log(line: string): void;
  force?: boolean;
  forceVersion?: string | null;
  logPath?: string;
  attemptId?: string;
  acquireLease?(): Promise<boolean>;
  releaseLease?(): Promise<void>;
  snapshotDb?(runningVersion: string): Promise<string | null>;
  hasDomainWrites?(snapshotPath: string | null): Promise<boolean>;
  restoreDb?(snapshotPath: string | null, failedVersion: string): Promise<string | null>;
  probeHealth?(): Promise<ResidentHealthProbe>;
  restoreBundle?(previousApp: string): Promise<string>;
  onRollback?(notice: HostRollbackNotice): void;
  now?(): number;
  sleep?(ms: number): Promise<void>;
  probationMs?: number;
  probationDeadlineMs?: number;
  probeIntervalMs?: number;
}

export function parseBatteryLow(pmset: string): boolean {
  if (!pmset.includes("'Battery Power'")) return false;
  const percent = /(?<!\d)(\d+)%/.exec(pmset);
  return percent !== null && Number(percent[1]) < LOW_BATTERY_PERCENT;
}

function reusable(state: UpdateState, update: DesktopUpdate, version: string): StagedUpdate | null {
  const staged = state.staged;
  if (staged === null || staged.version !== update.version) return null;
  if (staged.previousVersion !== version || !stagedBundleExists(staged)) return null;
  return staged;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function isActiveGuardOnInstalled(installed: InstalledUpdate, hasProbe: boolean): boolean {
  if (
    installed.guardOwner === 'desktop' &&
    installed.guardPid != null &&
    pidAlive(installed.guardPid)
  ) {
    return true;
  }
  if (
    installed.guardOwner === 'background-agent' &&
    installed.guardPid != null &&
    pidAlive(installed.guardPid)
  ) {
    return true;
  }
  return installed.guardOwner == null && !hasProbe;
}

function recordBlockedRollback(
  statePath: string,
  installed: InstalledUpdate,
  reason: string,
  logPath: string,
  at: number,
  clearSnapshot: boolean,
): HostRollbackNotice {
  const state = readUpdateState(statePath);
  const attempts =
    state.blocked !== null && state.blocked.version === installed.version
      ? state.blocked.attempts
      : 0;
  const notice = {
    failedVersion: installed.version,
    restoredVersion: installed.previousVersion,
    reason,
    logPath,
    at,
  };
  writeUpdateState(statePath, {
    ...state,
    installed: null,
    knownVersion: installed.previousVersion,
    blocked: { version: installed.version, at, reason, attempts: attempts + 1 },
    notice,
  });
  if (clearSnapshot && installed.dbSnapshot != null && existsSync(installed.dbSnapshot)) {
    rmSync(installed.dbSnapshot, { force: true });
  }
  return {
    failedVersion: installed.version,
    restoredVersion: installed.previousVersion,
    reason,
    at,
  };
}

async function runHeadlessProbation(
  deps: BackgroundDeps,
  statePath: string,
  installed: InstalledUpdate,
  previousPid: number | null,
): Promise<
  | 'confirmed'
  | 'unconfirmed'
  | 'lock-busy'
  | 'rolled-back'
  | 'rolled-back-code'
  | 'rollback-failed'
  | 'repair-held'
> {
  const probe = deps.probeHealth;
  if (probe === undefined) return 'confirmed';
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? defaultSleep;
  const probationMs = deps.probationMs ?? PROBATION_SUSTAINED_MS;
  const deadlineMs = deps.probationDeadlineMs ?? PROBATION_DEADLINE_MS;
  const intervalMs = deps.probeIntervalMs ?? PROBATION_POLL_MS;
  const startedAt = now();
  let healthySince: number | null = null;
  let consecutiveFailures = 0;
  let failureReason = 'The Cairn resident server did not become healthy after restarting.';

  for (;;) {
    const sample = await probe();
    const pidChanged = previousPid === null || sample.pid === null || sample.pid !== previousPid;
    if (sample.ok && sample.version === installed.version && pidChanged) {
      consecutiveFailures = 0;
      if (healthySince === null) healthySince = now();
      if (now() - healthySince >= probationMs) {
        const repaired = await finishRepair(statePath, deps.bundle, installed.attemptId, deps.lock);
        if (repaired === 'stale') {
          deps.log(`${installed.version} is not the replacement the held repair is waiting for`);
          return 'unconfirmed';
        }
        if (repaired === 'none') {
          const current = readUpdateState(statePath);
          writeUpdateState(statePath, { ...current, installed: null });
        }
        await removeFolder(previousAppPath(deps.bundle)).catch((error) => {
          console.debug('cairn: recoverable operation failed', error);
        });
        if (installed.dbSnapshot != null && existsSync(installed.dbSnapshot)) {
          rmSync(installed.dbSnapshot, { force: true });
        }
        deps.log(`${installed.version} started and stayed healthy`);
        return 'confirmed';
      }
    } else {
      healthySince = null;
      consecutiveFailures += 1;
      if (sample.ok && sample.version !== null && sample.version !== installed.version) {
        failureReason = `Resident server answered version ${sample.version} instead of ${installed.version}.`;
      }
      if (consecutiveFailures >= PROBATION_MAX_FAILURES) break;
    }
    if (now() - startedAt >= deadlineMs) break;
    await sleep(intervalMs);
  }

  deps.log(`rolling back ${installed.version} to ${installed.previousVersion}: ${failureReason}`);
  const at = now();
  const decision = await stopThenDecide({
    stop: deps.stopResident,
    held: readUpdateState(statePath).repair != null,
    cairnHome: join(deps.userData, 'home'),
    previousApp: installed.previousApp,
    log: deps.log,
  });
  if (!decision.proceed) {
    const held = await holdRepair({
      statePath,
      bundle: deps.bundle,
      installed,
      reason: failureReason,
      at,
      lock: deps.lock,
    });
    if (held === 'busy') return 'lock-busy';
    if (held === 'stale') return 'unconfirmed';
    deps.log(`holding ${installed.version}: no previous app was activated`);
    return decision.stopped ? 'repair-held' : 'rollback-failed';
  }
  const hasWrites =
    installed.dbSnapshot != null && deps.hasDomainWrites !== undefined
      ? await deps.hasDomainWrites(installed.dbSnapshot)
      : false;
  let bundleRestored = false;
  try {
    if (deps.restoreBundle !== undefined) {
      await deps.restoreBundle(installed.previousApp);
    } else {
      await restorePrevious({ bundle: deps.bundle, previousApp: installed.previousApp });
    }
    bundleRestored = true;
  } catch (error) {
    deps.log(
      `rollback bundle restore failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let dbRestored = true;
  if (
    bundleRestored &&
    !hasWrites &&
    installed.dbSnapshot != null &&
    deps.restoreDb !== undefined
  ) {
    try {
      await deps.restoreDb(installed.dbSnapshot, installed.version);
    } catch (error) {
      dbRestored = false;
      deps.log(
        `rollback DB restore failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  let restoredHealthy = false;
  if (bundleRestored && dbRestored) {
    await deps.restartResident();
    for (let attempt = 0; attempt < PROBATION_MAX_FAILURES; attempt += 1) {
      await sleep(intervalMs);
      const restoredSample = await probe();
      if (
        restoredSample.ok &&
        (restoredSample.version === null || restoredSample.version === installed.previousVersion)
      ) {
        restoredHealthy = true;
        break;
      }
    }
  }

  const notice = recordBlockedRollback(
    statePath,
    installed,
    failureReason,
    deps.logPath ?? statePath,
    at,
    bundleRestored && restoredHealthy && !hasWrites,
  );
  deps.onRollback?.(notice);
  if (!bundleRestored || !dbRestored || !restoredHealthy) return 'rollback-failed';
  return hasWrites ? 'rolled-back-code' : 'rolled-back';
}

export async function runBackgroundUpdate(deps: BackgroundDeps): Promise<BackgroundOutcome> {
  const statePath = updateStatePath(deps.userData);
  const version = await deps.bundleVersion();
  if (version === null) return 'not-cairn';
  if (!(await deps.writable())) return 'read-only';
  if (deps.appRunning()) return 'app-running';
  if (await deps.lowBattery()) return 'low-battery';
  let state = readUpdateState(statePath);
  if (state.installed !== null) {
    if (state.installed.version === version) {
      if (isActiveGuardOnInstalled(state.installed, deps.probeHealth !== undefined)) {
        return 'unconfirmed';
      }
      if (deps.probeHealth !== undefined) {
        let leaseHeld = false;
        if (state.repair == null && deps.acquireLease !== undefined) {
          leaseHeld = await deps.acquireLease();
          if (!leaseHeld) {
            deps.log(`holding rollback check for ${version}: could not acquire deploy lease`);
            return 'resident-busy';
          }
        }
        try {
          if (state.repair == null) {
            return await runHeadlessProbation(deps, statePath, state.installed, null);
          }
          const release = await deps.lock();
          if (release === null) return 'lock-busy';
          let resumed: InstalledUpdate;
          try {
            const current = readUpdateState(statePath);
            if (
              current.installed?.attemptId !== state.installed.attemptId ||
              current.repair?.attemptId !== state.repair.attemptId
            ) {
              return 'unconfirmed';
            }
            resumed = { ...state.installed, guardOwner: 'background-agent', guardPid: process.pid };
            writeUpdateState(statePath, { ...current, installed: resumed });
          } finally {
            release();
          }
          return await runHeadlessProbation(deps, statePath, resumed, null);
        } finally {
          if (leaseHeld) await deps.releaseLease?.();
        }
      }
    }
    state = { ...state, installed: null };
    writeUpdateState(statePath, state);
  }
  const note = outsideUpdaterNote(state, version);
  if (note !== null) {
    deps.log(note);
    writeUpdateState(statePath, { ...readUpdateState(statePath), knownVersion: version });
  }
  const repair = state.repair ?? null;
  let staged: StagedUpdate | null = null;
  let leaseHeld = false;
  try {
    const update = await deps.offeredUpdate(version);
    if (update === null) return 'current';
    const forced =
      deps.force === true && (deps.forceVersion == null || deps.forceVersion === update.version);
    if (!forced && isAutoInstallBlocked(state, update.version)) return 'blocked';
    staged = reusable(readUpdateState(statePath), update, version);
    if (staged === null) {
      await removeStagingFolders(dirname(deps.bundle));
      if (deps.appRunning()) return 'app-running';
      staged = await deps.stage(update, version);
      if (deps.appRunning()) {
        await removeFolder(dirname(staged.app)).catch((error) => {
          console.debug('cairn: recoverable operation failed', error);
        });
        return 'app-running';
      }
      writeUpdateState(statePath, { ...readUpdateState(statePath), staged });
    }
    if (repair !== null && !(await artifactSupportsStepMarker(staged.app))) {
      deps.log(
        `holding ${staged.version}: it cannot write the step storage a failed update changed`,
      );
      return 'repair-held';
    }
    await deps.verify(staged);
    if (repair === null && deps.acquireLease !== undefined) {
      leaseHeld = await deps.acquireLease();
      if (!leaseHeld) {
        deps.log(`holding ${staged.version}: could not acquire deploy lease`);
        return 'resident-busy';
      }
    }
    let busy = false;
    try {
      busy = repair === null && (await deps.residentBusy());
    } catch (error) {
      deps.log(
        `holding ${staged.version}: resident busy probe failed (${error instanceof Error ? error.message : String(error)})`,
      );
      return 'resident-busy';
    }
    if (busy) {
      deps.log(`holding ${staged.version}: the resident server is writing a reply`);
      return 'resident-busy';
    }
    const previousHealth = deps.probeHealth !== undefined ? await deps.probeHealth() : null;
    const dbSnapshot =
      repair === null && deps.snapshotDb !== undefined ? await deps.snapshotDb(version) : null;
    const release = await deps.lock();
    if (release === null) return 'lock-busy';
    let installedRecord: InstalledUpdate;
    try {
      if (deps.appRunning()) return 'app-running';
      if (repair !== null) {
        if (readUpdateState(statePath).repair?.attemptId !== repair.attemptId) {
          return 'repair-held';
        }
        await completeHoldPins(deps.bundle, repair);
        if (!(await confirmStop(deps.stopResident, deps.log))) {
          deps.log(`holding ${staged.version}: the resident server did not confirm it stopped`);
          return 'repair-held';
        }
      }
      const installed = await deps.swap(staged, version);
      installedRecord = {
        ...installed,
        ...(deps.probeHealth !== undefined
          ? {
              guardOwner: 'background-agent' as const,
              guardPid: process.pid,
              attemptId: deps.attemptId ?? randomUUID(),
            }
          : {}),
        ...(dbSnapshot !== null ? { dbSnapshot } : {}),
      };
      writeUpdateState(statePath, afterSwap(readUpdateState(statePath), installedRecord));
    } finally {
      release();
    }
    await removeFolder(dirname(staged.app)).catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
    deps.log(`installed ${staged.version} over ${version} while Cairn was closed`);
    await deps.restartResident();
    if (deps.probeHealth === undefined) return 'installed';
    return await runHeadlessProbation(
      deps,
      statePath,
      installedRecord,
      previousHealth?.pid ?? null,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.log(`background update failed: ${message}`);
    if (
      staged !== null &&
      (error instanceof SignatureRefused ||
        error instanceof StagedUnusable ||
        !stagedBundleExists(staged))
    ) {
      const latest = readUpdateState(statePath);
      if (latest.staged?.app === staged.app)
        writeUpdateState(statePath, { ...latest, staged: null });
      await removeFolder(dirname(staged.app)).catch((error) => {
        console.debug('cairn: recoverable operation failed', error);
      });
    }
    return 'failed';
  } finally {
    if (leaseHeld) {
      await deps.releaseLease?.().catch((error) => {
        console.debug('cairn: recoverable operation failed', error);
      });
    }
  }
}
