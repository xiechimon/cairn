import { dirname } from 'node:path';
import type { DesktopUpdate } from '@cairn/shared';
import {
  afterSwap,
  outsideUpdaterNote,
  SignatureRefused,
  StagedUnusable,
  stagedBundleExists,
} from './update-core.js';
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

export const LOW_BATTERY_PERCENT = 20;

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
  log(line: string): void;
}

export function parseBatteryLow(pmset: string): boolean {
  if (!pmset.includes("'Battery Power'")) return false;
  const percent = /(\d+)%/.exec(pmset);
  return percent !== null && Number(percent[1]) < LOW_BATTERY_PERCENT;
}

function reusable(state: UpdateState, update: DesktopUpdate, version: string): StagedUpdate | null {
  const staged = state.staged;
  if (staged === null || staged.version !== update.version) return null;
  if (staged.previousVersion !== version || !stagedBundleExists(staged)) return null;
  return staged;
}

export async function runBackgroundUpdate(deps: BackgroundDeps): Promise<BackgroundOutcome> {
  const statePath = updateStatePath(deps.userData);
  const version = await deps.bundleVersion();
  if (version === null) return 'not-cairn';
  if (!(await deps.writable())) return 'read-only';
  if (deps.appRunning()) return 'app-running';
  if (await deps.lowBattery()) return 'low-battery';
  const state = readUpdateState(statePath);
  if (state.installed !== null && state.installed.version === version) return 'unconfirmed';
  const note = outsideUpdaterNote(state, version);
  if (note !== null) {
    deps.log(note);
    writeUpdateState(statePath, { ...readUpdateState(statePath), knownVersion: version });
  }
  let staged: StagedUpdate | null = null;
  try {
    const update = await deps.offeredUpdate(version);
    if (update === null) return 'current';
    if (isAutoInstallBlocked(state, update.version)) return 'blocked';
    staged = reusable(readUpdateState(statePath), update, version);
    if (staged === null) {
      await removeStagingFolders(dirname(deps.bundle));
      if (deps.appRunning()) return 'app-running';
      staged = await deps.stage(update, version);
      if (deps.appRunning()) {
        await removeFolder(dirname(staged.app)).catch(() => {});
        return 'app-running';
      }
      writeUpdateState(statePath, { ...readUpdateState(statePath), staged });
    }
    await deps.verify(staged);
    if (await deps.residentBusy()) {
      deps.log(`holding ${staged.version}: the resident server is writing a reply`);
      return 'resident-busy';
    }
    const release = await deps.lock();
    if (release === null) return 'lock-busy';
    try {
      if (deps.appRunning()) return 'app-running';
      const installed = await deps.swap(staged, version);
      writeUpdateState(statePath, afterSwap(readUpdateState(statePath), installed));
    } finally {
      release();
    }
    await removeFolder(dirname(staged.app)).catch(() => {});
    deps.log(`installed ${staged.version} over ${version} while Cairn was closed`);
    await deps.restartResident();
    return 'installed';
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
      await removeFolder(dirname(staged.app)).catch(() => {});
    }
    return 'failed';
  }
}
