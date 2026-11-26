import { createHash } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { processLiveness, processStartTime } from './parent-watch.js';

const ROOT = 'credential-profiles';
const PROFILE = /^profile-([1-9]\d*)-[a-zA-Z0-9]{6}$/;
const DETERMINISTIC_PROFILE = /^antigravity-oauth-[a-f0-9]{12}$/;
const OWNER = 'owner.json';
const START_TIME_VERSION = 1;
const MAX_LEGACY_LOCAL_OFFSET_MS = 26 * 60 * 60 * 1000;
const PS_START_TIME = /^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;
const activeDeterministicProfiles = new Map<string, number>();

type Owner = { pid: number; startTime: string; startTimeVersion: number | null | undefined };

function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) {
    throw new Error('Credential profile directory is not private');
  }
}

function profileRoot(appData: string): string {
  const root = join(appData, ROOT);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assertPrivateDirectory(root);
  return realpathSync(root);
}

function currentOwner(): Owner {
  const startTime = processStartTime(process.pid);
  if (startTime === null) throw new Error('Credential profile owner identity is unavailable');
  return { pid: process.pid, startTime, startTimeVersion: START_TIME_VERSION };
}

function readOwner(dir: string): Owner | null {
  const text = readRegularCredentialFile(join(dir, OWNER));
  if (text === null) return null;
  try {
    const { pid, startTime, startTimeVersion } = JSON.parse(text) as Partial<Owner>;
    return Number.isSafeInteger(pid) &&
      typeof pid === 'number' &&
      pid > 0 &&
      typeof startTime === 'string' &&
      startTime !== ''
      ? {
          pid,
          startTime,
          startTimeVersion:
            startTimeVersion === undefined || startTimeVersion === START_TIME_VERSION
              ? startTimeVersion
              : null,
        }
      : null;
  } catch {
    return null;
  }
}

function ownerIsGone(owner: Owner | null, directoryPid: number): boolean {
  const pid = owner?.pid ?? directoryPid;
  if (processLiveness(pid) === 'gone') return true;
  if (owner === null || owner.startTimeVersion === null) return false;
  const startTime = processStartTime(pid);
  if (startTime === null) return processLiveness(pid) === 'gone';
  if (owner.startTimeVersion === START_TIME_VERSION) return startTime !== owner.startTime;
  if (process.platform === 'linux') {
    return /^\d+$/.test(owner.startTime) && startTime !== owner.startTime;
  }
  if (process.platform === 'darwin' && PS_START_TIME.test(owner.startTime)) {
    return (
      Date.parse(`${startTime} UTC`) - Date.parse(`${owner.startTime} UTC`) >
      MAX_LEGACY_LOCAL_OFFSET_MS
    );
  }
  return false;
}

export function reapCredentialProfiles(appData: string): void {
  const root = profileRoot(appData);
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(root, entry.name);
    const match = PROFILE.exec(entry.name);
    if (match !== null) {
      if (ownerIsGone(readOwner(dir), Number(match[1]))) removeProfile(dir);
      continue;
    }
    if (DETERMINISTIC_PROFILE.test(entry.name) && !activeDeterministicProfiles.has(dir)) {
      const owner = readOwner(dir);
      if (owner === null || ownerIsGone(owner, owner.pid)) removeProfile(dir);
    }
  }
}

function removeProfile(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}

function profileHandle(home: string, cleanup: () => void) {
  return {
    home,
    env: {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      XDG_DATA_HOME: join(home, '.local', 'share'),
      XDG_CACHE_HOME: join(home, '.cache'),
      XDG_STATE_HOME: join(home, '.local', 'state'),
    },
    readCredential(path: string, authenticated: boolean): string | null {
      if (!authenticated || !isAbsolute(path)) return null;
      const fromHome = relative(home, path);
      if (fromHome === '' || fromHome === '..' || fromHome.startsWith(`..${sep}`)) return null;
      try {
        if (realpathSync(path) !== path) return null;
        return readRegularCredentialFile(path, { singleLink: true });
      } catch {
        return null;
      }
    },
    cleanup,
  };
}

export function createCredentialProfile(appData: string) {
  const owner = currentOwner();
  const dir = mkdtempSync(join(profileRoot(appData), `profile-${owner.pid}-`));
  const home = join(dir, 'home');
  try {
    writeFileSync(join(dir, OWNER), JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    mkdirSync(home, { mode: 0o700 });
  } catch (error) {
    removeProfile(dir);
    throw error;
  }
  return profileHandle(home, () => removeProfile(dir));
}

export function acquireDeterministicCredentialProfile(appData: string, key: string) {
  const owner = currentOwner();
  const hash = createHash('sha256').update(key).digest('hex').slice(0, 12);
  const dir = join(profileRoot(appData), `antigravity-oauth-${hash}`);
  const home = join(dir, 'home');
  const activeCount = activeDeterministicProfiles.get(dir) ?? 0;
  if (activeCount === 0) {
    const existingStat = (() => {
      try {
        return lstatSync(dir);
      } catch {
        return null;
      }
    })();
    if (existingStat !== null) {
      if (!existingStat.isDirectory() || existingStat.uid !== process.getuid?.()) {
        removeProfile(dir);
      } else {
        const previous = readOwner(dir);
        if (previous === null || ownerIsGone(previous, previous.pid)) removeProfile(dir);
      }
    }
    try {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      assertPrivateDirectory(dir);
      const ownerStaging = join(dir, `${OWNER}.tmp`);
      writeFileSync(ownerStaging, JSON.stringify(owner), { mode: 0o600 });
      renameSync(ownerStaging, join(dir, OWNER));
      mkdirSync(home, { recursive: true, mode: 0o700 });
      assertPrivateDirectory(home);
    } catch (error) {
      removeProfile(dir);
      throw error;
    }
  }
  activeDeterministicProfiles.set(dir, activeCount + 1);
  let released = false;
  return profileHandle(home, () => {
    if (released) return;
    released = true;
    const next = (activeDeterministicProfiles.get(dir) ?? 1) - 1;
    if (next > 0) {
      activeDeterministicProfiles.set(dir, next);
      return;
    }
    activeDeterministicProfiles.delete(dir);
    removeProfile(dir);
  });
}

export function adoptCredentialProfile(home: string, parentPid: number): () => void {
  const dir = dirname(home);
  const root = dirname(dir);
  if (basename(home) !== 'home' || !PROFILE.test(basename(dir)) || basename(root) !== ROOT) {
    throw new Error('Invalid credential profile');
  }
  for (const path of [root, dir, home]) assertPrivateDirectory(path);
  const previous = readOwner(dir);
  if (
    previous?.pid !== parentPid ||
    previous.startTimeVersion !== START_TIME_VERSION ||
    processStartTime(parentPid) !== previous.startTime
  ) {
    throw new Error('Invalid credential profile parent');
  }
  const staging = join(dir, 'worker-owner.json');
  writeFileSync(staging, JSON.stringify(currentOwner()), { mode: 0o600, flag: 'wx' });
  renameSync(staging, join(dir, OWNER));
  return () => removeProfile(dir);
}

export function readRegularCredentialFile(
  path: string,
  options?: { singleLink: boolean },
): string | null {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    return null;
  }
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > 1_000_000n) return null;
    if (options?.singleLink === true && before.nlink !== 1n) return null;
    const text = readFileSync(fd, 'utf8');
    const after = fstatSync(fd, { bigint: true });
    return after.mtimeNs === before.mtimeNs && after.ctimeNs === before.ctimeNs ? text : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}
