import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

export const SERVER_OWNER_FILE = 'server-owner.json';
export const CAIRN_MANAGED_BY_ENV = 'CAIRN_MANAGED_BY';
export const LAUNCHD_MANAGED_BY = 'launchd';

export interface LaunchdServerOwnerRecord {
  pid: number;
  port: number;
  origin: string;
  managedBy: typeof LAUNCHD_MANAGED_BY;
  startedAt: number;
}

export function isLaunchdManaged(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[CAIRN_MANAGED_BY_ENV] === LAUNCHD_MANAGED_BY;
}

export function writeLaunchdServerOwner(
  homeDir: string,
  port: number,
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
  startedAt: number = Date.now(),
): boolean {
  if (!isLaunchdManaged(env)) return false;
  const path = join(homeDir, SERVER_OWNER_FILE);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const record: LaunchdServerOwnerRecord = {
    pid,
    port,
    origin: `http://127.0.0.1:${port}`,
    managedBy: LAUNCHD_MANAGED_BY,
    startedAt,
  };
  const tempPath = `${path}.${pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, path);
  return true;
}

export function clearLaunchdServerOwner(
  homeDir: string,
  env: NodeJS.ProcessEnv = process.env,
  pid: number = process.pid,
): boolean {
  if (!isLaunchdManaged(env)) return false;
  const path = join(homeDir, SERVER_OWNER_FILE);
  if (!existsSync(path)) return false;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { pid?: unknown };
    if (parsed.pid !== pid) return false;
    unlinkSync(path);
    return true;
  } catch {
    return false;
  }
}
