import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { removeFolder } from './update-staging.js';
import {
  type InstalledUpdate,
  type RepairHold,
  readUpdateState,
  writeUpdateState,
} from './update-state.js';
import { APP_EXECUTABLE, previousAppPath, readBundleVersion } from './update-swap.js';

const run = promisify(execFile);
const SQLITE = '/usr/bin/sqlite3';
const STEP_MARKER = 'step_require_writer_generation_update';
const MARKER_CREATION = new RegExp(
  `(?:^|;)\\s*CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:(?:"main"|main)\\.)?(?:${STEP_MARKER}|"${STEP_MARKER}"|\`${STEP_MARKER}\`|\\[${STEP_MARKER}\\])(?=\\s)`,
  'i',
);
const HELD_PREFIX = 'held-';

export type StepMarker = 'present' | 'absent' | 'error';

export async function probeStepMarker(cairnHome: string): Promise<StepMarker> {
  const dbPath = join(cairnHome, 'server', 'server.db');
  if (!existsSync(dbPath)) {
    return existsSync(`${dbPath}-wal`) || existsSync(`${dbPath}-shm`) ? 'error' : 'absent';
  }
  try {
    const { stdout } = await run(SQLITE, [
      '-readonly',
      dbPath,
      '.timeout 5000',
      `SELECT 1 FROM sqlite_master WHERE type='trigger' AND name='${STEP_MARKER}';`,
    ]);
    const found = stdout.trim();
    return found === '1' ? 'present' : found === '' ? 'absent' : 'error';
  } catch {
    return 'error';
  }
}

export function stripSqlNoise(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const char = sql[i] ?? '';
    const next = sql[i + 1];
    if (char === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      out += ' ';
    } else if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
    } else if (char === "'") {
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      i += 1;
      out += "''";
    } else {
      out += char;
      i += 1;
    }
  }
  return out;
}

export function createsStepMarker(sql: string): boolean {
  return MARKER_CREATION.test(stripSqlNoise(sql));
}

export async function artifactSupportsStepMarker(app: string): Promise<boolean> {
  const folder = join(app, 'Contents', 'Resources', 'server', 'drizzle');
  try {
    for (const name of await readdir(folder)) {
      if (!name.endsWith('.sql')) continue;
      if (createsStepMarker(await readFile(join(folder, name), 'utf8'))) return true;
    }
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  return false;
}

export async function confirmStop(
  stop: (() => Promise<boolean>) | undefined,
  log: (line: string) => void,
): Promise<boolean> {
  if (stop === undefined) return true;
  try {
    return await stop();
  } catch (error) {
    log(`stop failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export interface RollbackDecision {
  stopped: boolean;
  proceed: boolean;
}

export async function stopThenDecide(opts: {
  stop: (() => Promise<boolean>) | undefined;
  held?: boolean;
  cairnHome: string;
  previousApp: string;
  log: (line: string) => void;
}): Promise<RollbackDecision> {
  if (!(await confirmStop(opts.stop, opts.log))) return { stopped: false, proceed: false };
  if (opts.held === true) return { stopped: true, proceed: false };
  const marker = await probeStepMarker(opts.cairnHome);
  if (marker === 'absent') return { stopped: true, proceed: true };
  if (marker === 'present' && (await artifactSupportsStepMarker(opts.previousApp))) {
    return { stopped: true, proceed: true };
  }
  opts.log(
    marker === 'error'
      ? 'could not read the step storage marker; holding instead of rolling back'
      : 'the previous app cannot write the fenced step storage; holding instead of rolling back',
  );
  return { stopped: true, proceed: false };
}

function heldFolder(bundle: string): string {
  return dirname(previousAppPath(bundle));
}

function ownsPin(bundle: string, pinnedApp: string): boolean {
  const folder = dirname(pinnedApp);
  return dirname(folder) === heldFolder(bundle) && basename(folder).startsWith(HELD_PREFIX);
}

export async function completeHoldPins(bundle: string, repair: RepairHold): Promise<void> {
  if (!ownsPin(bundle, repair.pinnedApp)) throw new Error('invalid Cairn repair pin');
  if (existsSync(join(repair.pinnedApp, APP_EXECUTABLE))) return;
  const slot = previousAppPath(bundle);
  if (!existsSync(slot)) return;
  if ((await readBundleVersion(slot)) !== repair.previousVersion) {
    throw new Error('the bundle at the repair pin source is not the recorded previous version');
  }
  await mkdir(dirname(repair.pinnedApp), { recursive: true, mode: 0o700 });
  await rename(slot, repair.pinnedApp);
}

export type HoldResult = 'held' | 'busy' | 'stale';

export async function holdRepair(opts: {
  statePath: string;
  bundle: string;
  installed: InstalledUpdate;
  reason: string;
  at: number;
  lock: () => Promise<(() => void) | null>;
}): Promise<HoldResult> {
  const { statePath, bundle, installed, reason, at } = opts;
  const release = await opts.lock();
  if (release === null) return 'busy';
  try {
    const state = readUpdateState(statePath);
    const current = state.installed;
    if (
      current === null ||
      current.version !== installed.version ||
      (current.attemptId ?? null) !== (installed.attemptId ?? null)
    ) {
      return 'stale';
    }
    const attempts = state.blocked?.version === installed.version ? state.blocked.attempts : 0;
    const blocked = { version: installed.version, at, reason, attempts: attempts + 1 };
    if (state.repair != null) {
      writeUpdateState(statePath, {
        ...state,
        installed: null,
        blocked,
        notice: null,
        repair: { ...state.repair, reason, at, replacement: null },
      });
      return 'held';
    }
    const attemptId = installed.attemptId ?? randomUUID();
    const repair: RepairHold = {
      attemptId,
      failedVersion: installed.version,
      previousVersion: installed.previousVersion,
      pinnedApp: join(heldFolder(bundle), `${HELD_PREFIX}${attemptId}`, basename(bundle)),
      pinnedSnapshot: installed.dbSnapshot ?? null,
      reason,
      at,
      replacement: null,
    };
    writeUpdateState(statePath, { ...state, installed: null, blocked, notice: null, repair });
    await completeHoldPins(bundle, repair);
    return 'held';
  } finally {
    release();
  }
}

export async function finishRepair(
  statePath: string,
  bundle: string,
  replacementAttemptId: string | null | undefined,
  lock: () => Promise<(() => void) | null>,
): Promise<'none' | 'finished' | 'stale'> {
  if (readUpdateState(statePath).repair == null) return 'none';
  const release = await lock();
  if (release === null) return 'stale';
  try {
    const state = readUpdateState(statePath);
    const repair = state.repair ?? null;
    if (repair === null) return 'stale';
    if (
      replacementAttemptId == null ||
      repair.replacement?.attemptId !== replacementAttemptId ||
      state.installed?.attemptId !== replacementAttemptId ||
      (state.installed.guardPid != null && state.installed.guardPid !== process.pid)
    ) {
      return 'stale';
    }
    writeUpdateState(statePath, { ...state, installed: null, repair: null });
    if (ownsPin(bundle, repair.pinnedApp)) {
      await removeFolder(dirname(repair.pinnedApp)).catch((error) => {
        console.debug('cairn: recoverable operation failed', error);
      });
    }
    if (
      repair.pinnedSnapshot !== null &&
      dirname(repair.pinnedSnapshot) === join(dirname(statePath), 'home', 'server') &&
      /^preupdate-[^/]+\.db$/.test(basename(repair.pinnedSnapshot))
    ) {
      rmSync(repair.pinnedSnapshot, { force: true });
    }
    return 'finished';
  } finally {
    release();
  }
}
