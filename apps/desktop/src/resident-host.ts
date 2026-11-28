import { execFile } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { resolveDesktopCloudUrl } from '@cairn/shared';

const execFileAsync = promisify(execFile);

export const RESIDENT_LABEL = 'app.cairn.host';
export const SERVER_OWNER_FILE = 'server-owner.json';
export const DEFAULT_RESIDENT_HOST = '127.0.0.1';
export const DEFAULT_RESIDENT_PORT = 8787;
export const RESIDENT_MANAGED_BY_ENV = 'CAIRN_MANAGED_BY';
export const RESIDENT_MANAGED_BY_VALUE = 'launchd';

export interface ServerOwnerRecord {
  pid: number;
  port: number;
  origin: string;
  managedBy: 'launchd' | 'desktop';
  startedAt: number;
}

function ownerPath(cairnHome: string): string {
  return join(cairnHome, SERVER_OWNER_FILE);
}

export function readServerOwner(cairnHome: string): ServerOwnerRecord | null {
  const path = ownerPath(cairnHome);
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<ServerOwnerRecord>;
    if (
      typeof raw.pid !== 'number' ||
      typeof raw.port !== 'number' ||
      typeof raw.origin !== 'string' ||
      (raw.managedBy !== 'launchd' && raw.managedBy !== 'desktop') ||
      typeof raw.startedAt !== 'number'
    ) {
      return null;
    }
    return raw as ServerOwnerRecord;
  } catch {
    return null;
  }
}

export function writeServerOwner(cairnHome: string, record: ServerOwnerRecord): void {
  const path = ownerPath(cairnHome);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

export function clearServerOwner(cairnHome: string, pid: number): void {
  const current = readServerOwner(cairnHome);
  if (current === null || current.pid !== pid) return;
  try {
    unlinkSync(ownerPath(cairnHome));
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function probeResidentServer(
  cairnHome: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ServerOwnerRecord | null> {
  const record = readServerOwner(cairnHome);
  if (record === null || record.managedBy !== 'launchd') return null;
  if (!pidAlive(record.pid)) return null;
  try {
    const res = await fetchImpl(`${record.origin}/api/remote/descriptor`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (res.ok) return record;
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  return null;
}

export function residentPlistPath(homeDir: string): string {
  return join(homeDir, 'Library', 'LaunchAgents', `${RESIDENT_LABEL}.plist`);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function buildResidentPlist(opts: {
  executablePath: string;
  serverEntry: string;
  cairnHome: string;
  port: number;
  logDir: string;
  host?: string;
  cloudUrl?: string | null;
}): string {
  const outLog = join(opts.logDir, 'resident-host.out.log');
  const errLog = join(opts.logDir, 'resident-host.err.log');
  const host = opts.host ?? DEFAULT_RESIDENT_HOST;
  const cloudUrl =
    opts.cloudUrl !== undefined ? opts.cloudUrl : resolveDesktopCloudUrl(process.env);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>Label</key>',
    `  <string>${RESIDENT_LABEL}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${escapeXml(opts.executablePath)}</string>`,
    `    <string>${escapeXml(opts.serverEntry)}</string>`,
    '  </array>',
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    '    <key>ELECTRON_RUN_AS_NODE</key>',
    '    <string>1</string>',
    '    <key>HOST</key>',
    `    <string>${escapeXml(host)}</string>`,
    '    <key>PORT</key>',
    `    <string>${opts.port}</string>`,
    '    <key>CAIRN_HOME</key>',
    `    <string>${escapeXml(opts.cairnHome)}</string>`,
    `    <key>${RESIDENT_MANAGED_BY_ENV}</key>`,
    `    <string>${RESIDENT_MANAGED_BY_VALUE}</string>`,
    ...(cloudUrl !== null
      ? ['    <key>CAIRN_CLOUD_URL</key>', `    <string>${escapeXml(cloudUrl)}</string>`]
      : []),
    '  </dict>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <dict>',
    '    <key>SuccessfulExit</key>',
    '    <false/>',
    '  </dict>',
    '  <key>ThrottleInterval</key>',
    '  <integer>15</integer>',
    '  <key>StandardOutPath</key>',
    `  <string>${escapeXml(outLog)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${escapeXml(errLog)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export function isResidentInstalled(homeDir: string): boolean {
  return existsSync(residentPlistPath(homeDir));
}

export function residentPlistNeedsUpdate(opts: {
  homeDir: string;
  executablePath: string;
  serverEntry: string;
  cairnHome: string;
  logDir: string;
  port?: number;
  host?: string;
  cloudUrl?: string | null;
}): boolean {
  const path = residentPlistPath(opts.homeDir);
  if (!existsSync(path)) return false;
  try {
    const current = readFileSync(path, 'utf8');
    const expected = buildResidentPlist({
      executablePath: opts.executablePath,
      serverEntry: opts.serverEntry,
      cairnHome: opts.cairnHome,
      port: opts.port ?? DEFAULT_RESIDENT_PORT,
      logDir: opts.logDir,
      host: opts.host,
      cloudUrl: opts.cloudUrl,
    });
    return current !== expected;
  } catch {
    return true;
  }
}

export type InstallResidentResult =
  | { ok: true; plistPath: string; port: number }
  | { ok: false; reason: string };

export async function installResidentHost(opts: {
  homeDir: string;
  executablePath: string;
  serverEntry: string;
  cairnHome: string;
  logDir: string;
  port?: number;
  host?: string;
  cloudUrl?: string | null;
  uid?: number;
  runLaunchctl?: (args: string[]) => Promise<void>;
}): Promise<InstallResidentResult> {
  if (process.platform !== 'darwin' && opts.runLaunchctl === undefined) {
    return { ok: false, reason: 'resident host launchd is only supported on macOS' };
  }
  const port = opts.port ?? DEFAULT_RESIDENT_PORT;
  const plistPath = residentPlistPath(opts.homeDir);
  mkdirSync(dirname(plistPath), { recursive: true });
  mkdirSync(opts.logDir, { recursive: true });
  writeFileSync(
    plistPath,
    buildResidentPlist({
      executablePath: opts.executablePath,
      serverEntry: opts.serverEntry,
      cairnHome: opts.cairnHome,
      port,
      logDir: opts.logDir,
      host: opts.host,
      cloudUrl: opts.cloudUrl,
    }),
    'utf8',
  );
  const domain = `gui/${opts.uid ?? process.getuid?.() ?? 501}`;
  const run =
    opts.runLaunchctl ??
    (async (args: string[]) => {
      await execFileAsync('launchctl', args);
    });
  try {
    await run(['bootout', `${domain}/${RESIDENT_LABEL}`]);
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  await run(['bootstrap', domain, plistPath]);
  return { ok: true, plistPath, port };
}

export async function uninstallResidentHost(opts: {
  homeDir: string;
  uid?: number;
  runLaunchctl?: (args: string[]) => Promise<void>;
}): Promise<{ ok: true }> {
  const plistPath = residentPlistPath(opts.homeDir);
  const domain = `gui/${opts.uid ?? process.getuid?.() ?? 501}`;
  const run =
    opts.runLaunchctl ??
    (async (args: string[]) => {
      await execFileAsync('launchctl', args);
    });
  try {
    await run(['bootout', `${domain}/${RESIDENT_LABEL}`]);
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  try {
    if (existsSync(plistPath)) unlinkSync(plistPath);
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  return { ok: true };
}

interface ThreadActivity {
  turnQueue?: unknown;
  activeRun?: unknown;
}

export async function residentWritingReply(
  cairnHome: string,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  const record = await probeResidentServer(cairnHome, fetchImpl);
  if (record === null) return false;
  const authGet = (path: string): Promise<Response> =>
    fetchImpl(`${record.origin}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
  const versionRes = await authGet('/api/server/version');
  if (versionRes.ok) {
    const version = (await versionRes.json()) as { busy?: unknown };
    if (typeof version.busy === 'boolean') return version.busy;
  } else if (versionRes.status !== 404) {
    throw new Error(
      `the resident server answered HTTP ${versionRes.status} for /api/server/version`,
    );
  }
  const get = async (path: string): Promise<unknown> => {
    const res = await authGet(path);
    if (!res.ok) throw new Error(`the resident server answered HTTP ${res.status} for ${path}`);
    return res.json();
  };
  const teams = (await get('/api/teams')) as { id: string }[];
  for (const team of teams) {
    const threads = (await get(
      `/api/teams/${encodeURIComponent(team.id)}/chief/threads`,
    )) as ThreadActivity[];
    if (threads.some((thread) => thread.turnQueue != null || thread.activeRun != null)) {
      return true;
    }
  }
  return false;
}

export interface ResidentHealthProbe {
  ok: boolean;
  version: string | null;
  pid: number | null;
  busy: boolean;
}

export async function acquireDeployLease(
  cairnHome: string,
  token: string | null,
  owner: string,
  ttlMs: number,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  const ownerRec = readServerOwner(cairnHome);
  if (ownerRec === null || ownerRec.managedBy !== 'launchd' || !pidAlive(ownerRec.pid)) {
    return true;
  }
  if (token === null || token === '') return false;
  try {
    const res = await fetchImpl(`${ownerRec.origin}/api/server/deploy/lease`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ owner, ttlMs }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function releaseDeployLease(
  cairnHome: string,
  token: string | null,
  owner: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (token === null || token === '') return;
  const ownerRec = readServerOwner(cairnHome);
  if (ownerRec === null || ownerRec.managedBy !== 'launchd' || !pidAlive(ownerRec.pid)) return;
  try {
    await fetchImpl(`${ownerRec.origin}/api/server/deploy/lease`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ owner }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
}

export async function probeResidentHealth(
  cairnHome: string,
  token: string | null,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ResidentHealthProbe> {
  const record = readServerOwner(cairnHome);
  if (record === null || record.managedBy !== 'launchd' || !pidAlive(record.pid)) {
    return { ok: false, version: null, pid: null, busy: false };
  }
  if (token === null || token === '') {
    try {
      const desc = await fetchImpl(`${record.origin}/api/remote/descriptor`, {
        signal: AbortSignal.timeout(2_500),
      });
      return { ok: desc.ok, version: null, pid: record.pid, busy: false };
    } catch {
      return { ok: false, version: null, pid: record.pid, busy: false };
    }
  }
  try {
    const res = await fetchImpl(`${record.origin}/api/server/version`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_500),
    });
    if (!res.ok) return { ok: false, version: null, pid: record.pid, busy: false };
    const body = (await res.json()) as { version?: unknown; busy?: unknown };
    const version = typeof body.version === 'string' && body.version !== '' ? body.version : null;
    return {
      ok: version !== null,
      version,
      pid: record.pid,
      busy: body.busy === true,
    };
  } catch {
    return { ok: false, version: null, pid: record.pid, busy: false };
  }
}

const IGNORED_DOMAIN_TABLES = new Set([
  'deploy_lease',
  '__drizzle_migrations',
  '_drizzle_migrations',
]);

async function sqliteQueryJson<T>(dbPath: string, sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    '/usr/bin/sqlite3',
    ['-readonly', '-json', dbPath, '.timeout 5000', sql],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  return JSON.parse(trimmed) as T[];
}

function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

async function sqliteAttachQueryJson<T>(
  dbPath: string,
  snapshotPath: string,
  sql: string,
): Promise<T[]> {
  const { stdout } = await execFileAsync(
    '/usr/bin/sqlite3',
    [
      '-readonly',
      '-json',
      dbPath,
      '.timeout 5000',
      `ATTACH DATABASE '${escapeSqlString(snapshotPath)}' AS snap;`,
      sql,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const trimmed = stdout.trim();
  if (trimmed === '') return [];
  return JSON.parse(trimmed) as T[];
}

export async function snapshotResidentDb(
  cairnHome: string,
  fromVersion: string,
  now: number = Date.now(),
): Promise<string | null> {
  const serverDir = join(cairnHome, 'server');
  const dbPath = join(serverDir, 'server.db');
  if (!existsSync(dbPath)) return null;
  const safeVersion = fromVersion.replace(/[^0-9A-Za-z.+-]/g, '_');
  const snapPath = join(serverDir, `preupdate-${safeVersion}-${now}.db`);
  await execFileAsync('/usr/bin/sqlite3', [
    dbPath,
    '.timeout 5000',
    `.backup "${snapPath.replaceAll('"', '""')}"`,
  ]);
  return snapPath;
}

export async function hasDomainWritesSinceSnapshot(
  cairnHome: string,
  snapshotPath: string | null,
): Promise<boolean> {
  if (snapshotPath === null) return false;
  if (!existsSync(snapshotPath)) return true;
  const dbPath = join(cairnHome, 'server', 'server.db');
  if (!existsSync(dbPath)) return true;
  try {
    const mainTables = await sqliteQueryJson<{ name: string }>(
      dbPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    );
    const snapTables = await sqliteQueryJson<{ name: string }>(
      snapshotPath,
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    );
    const mainSet = new Set(
      mainTables.map((t) => t.name).filter((name) => !IGNORED_DOMAIN_TABLES.has(name)),
    );
    const snapSet = new Set(
      snapTables.map((t) => t.name).filter((name) => !IGNORED_DOMAIN_TABLES.has(name)),
    );

    for (const name of mainSet) {
      if (!snapSet.has(name)) {
        const [row] = await sqliteQueryJson<{ cnt: number }>(
          dbPath,
          `SELECT COUNT(*) AS cnt FROM ${quoteIdent(name)};`,
        );
        if ((row?.cnt ?? 1) > 0) return true;
      }
    }
    for (const name of snapSet) {
      if (!mainSet.has(name)) {
        const [row] = await sqliteQueryJson<{ cnt: number }>(
          snapshotPath,
          `SELECT COUNT(*) AS cnt FROM ${quoteIdent(name)};`,
        );
        if ((row?.cnt ?? 1) > 0) return true;
      }
    }

    for (const name of mainSet) {
      if (!snapSet.has(name)) continue;
      const q = quoteIdent(name);
      const [counts] = await sqliteAttachQueryJson<{ main_cnt: number; snap_cnt: number }>(
        dbPath,
        snapshotPath,
        `SELECT (SELECT COUNT(*) FROM main.${q}) AS main_cnt, (SELECT COUNT(*) FROM snap.${q}) AS snap_cnt;`,
      );
      if (counts === undefined || counts.main_cnt !== counts.snap_cnt) return true;
      if (counts.main_cnt === 0) continue;

      const mainCols = await sqliteQueryJson<{ name: string }>(dbPath, `PRAGMA table_info(${q});`);
      const snapCols = await sqliteQueryJson<{ name: string }>(
        snapshotPath,
        `PRAGMA table_info(${q});`,
      );
      const snapColSet = new Set(snapCols.map((c) => c.name));
      const commonCols = mainCols.map((c) => c.name).filter((col) => snapColSet.has(col));
      if (commonCols.length === 0) return true;

      const colList = commonCols.map(quoteIdent).join(', ');
      const diffForward = await sqliteAttachQueryJson<Record<string, unknown>>(
        dbPath,
        snapshotPath,
        `SELECT 1 AS diff FROM (SELECT ${colList}, COUNT(*) AS _c FROM main.${q} GROUP BY ${colList} EXCEPT SELECT ${colList}, COUNT(*) AS _c FROM snap.${q} GROUP BY ${colList}) LIMIT 1;`,
      );
      if (diffForward.length > 0) return true;
      const diffReverse = await sqliteAttachQueryJson<Record<string, unknown>>(
        dbPath,
        snapshotPath,
        `SELECT 1 AS diff FROM (SELECT ${colList}, COUNT(*) AS _c FROM snap.${q} GROUP BY ${colList} EXCEPT SELECT ${colList}, COUNT(*) AS _c FROM main.${q} GROUP BY ${colList}) LIMIT 1;`,
      );
      if (diffReverse.length > 0) return true;
    }
    return false;
  } catch {
    return true;
  }
}

export async function restoreResidentDb(
  cairnHome: string,
  snapshotPath: string | null,
  failedVersion: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (snapshotPath === null || !existsSync(snapshotPath)) return null;
  const serverDir = join(cairnHome, 'server');
  const dbPath = join(serverDir, 'server.db');
  const safeVersion = failedVersion.replace(/[^0-9A-Za-z.+-]/g, '_');
  const failedDbPath = join(serverDir, `failed-${safeVersion}-${now}.db`);
  if (existsSync(dbPath)) {
    renameSync(dbPath, failedDbPath);
  }
  for (const suffix of ['-wal', '-shm']) {
    const walPath = `${dbPath}${suffix}`;
    if (existsSync(walPath)) renameSync(walPath, `${failedDbPath}${suffix}`);
  }
  copyFileSync(snapshotPath, dbPath);
  rmSync(snapshotPath, { force: true });
  return existsSync(failedDbPath) ? failedDbPath : null;
}

export async function stopResidentHost(opts: {
  homeDir: string;
  cairnHome: string;
  uid?: number;
  runLaunchctl?: (args: string[]) => Promise<void>;
  waitForExit?: () => Promise<boolean>;
}): Promise<boolean> {
  if (process.platform !== 'darwin' && opts.runLaunchctl === undefined) {
    return opts.waitForExit !== undefined
      ? opts.waitForExit()
      : waitForResidentExit(opts.cairnHome, { timeoutMs: 10_000 });
  }
  if (!isResidentInstalled(opts.homeDir)) return true;
  const domain = `gui/${opts.uid ?? process.getuid?.() ?? 501}`;
  const run =
    opts.runLaunchctl ??
    (async (args: string[]) => {
      await execFileAsync('launchctl', args);
    });
  try {
    await run(['bootout', `${domain}/${RESIDENT_LABEL}`]);
  } catch (error) {
    console.debug('cairn: recoverable operation failed', error);
  }
  return opts.waitForExit !== undefined
    ? opts.waitForExit()
    : waitForResidentExit(opts.cairnHome, { timeoutMs: 10_000 });
}

export async function kickstartResidentHost(opts: {
  homeDir: string;
  uid?: number;
  runLaunchctl?: (args: string[]) => Promise<void>;
}): Promise<boolean> {
  if (process.platform !== 'darwin' && opts.runLaunchctl === undefined) return false;
  const plistPath = residentPlistPath(opts.homeDir);
  if (!existsSync(plistPath)) return false;
  const uid = opts.uid ?? process.getuid?.() ?? 501;
  const domain = `gui/${uid}`;
  const run =
    opts.runLaunchctl ??
    (async (args: string[]) => {
      await execFileAsync('launchctl', args);
    });
  try {
    await run(['kickstart', '-k', `${domain}/${RESIDENT_LABEL}`]);
  } catch {
    await run(['bootstrap', domain, plistPath]);
  }
  return true;
}

export const restartResidentHost = kickstartResidentHost;

export interface WaitForResidentOptions {
  timeoutMs?: number;
  pollMs?: number;
  excludePid?: number;
  probe?: (cairnHome: string) => Promise<ServerOwnerRecord | null>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForResidentServer(
  cairnHome: string,
  opts: WaitForResidentOptions = {},
): Promise<ServerOwnerRecord | null> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const pollMs = opts.pollMs ?? 250;
  const probe = opts.probe ?? probeResidentServer;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;
  while (true) {
    const record = await probe(cairnHome);
    if (record !== null && record.pid !== opts.excludePid) return record;
    if (now() >= deadline) return null;
    await sleep(pollMs);
  }
}

export async function waitForResidentExit(
  cairnHome: string,
  opts: {
    timeoutMs?: number;
    pollMs?: number;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
  } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const pollMs = opts.pollMs ?? 150;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const deadline = now() + timeoutMs;
  while (true) {
    const record = readServerOwner(cairnHome);
    if (record === null || record.managedBy !== 'launchd' || !pidAlive(record.pid)) return true;
    if (now() >= deadline) return false;
    await sleep(pollMs);
  }
}

export async function handoffToResidentHost(opts: {
  hasEmbeddedServer: boolean;
  stopEmbeddedServer: () => Promise<void>;
  restoreEmbeddedServer: () => Promise<void>;
  install: () => Promise<InstallResidentResult>;
  uninstall: () => Promise<{ ok: true }>;
  waitForHealthy: () => Promise<ServerOwnerRecord | null>;
  relaunch: () => void;
}): Promise<ServerOwnerRecord> {
  let stoppedEmbedded = false;
  if (opts.hasEmbeddedServer) {
    await opts.stopEmbeddedServer();
    stoppedEmbedded = true;
  }
  let installed: InstallResidentResult;
  try {
    installed = await opts.install();
  } catch (error) {
    await opts.uninstall().catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
    if (stoppedEmbedded) await opts.restoreEmbeddedServer();
    throw error;
  }
  if (!installed.ok) {
    if (stoppedEmbedded) await opts.restoreEmbeddedServer();
    throw new Error(installed.reason);
  }
  const resident = await opts.waitForHealthy();
  if (resident === null) {
    await opts.uninstall().catch((error) => {
      console.debug('cairn: recoverable operation failed', error);
    });
    if (stoppedEmbedded) await opts.restoreEmbeddedServer();
    throw new Error('The resident host did not become healthy in time.');
  }
  opts.relaunch();
  return resident;
}

export async function handoffFromResidentHost(opts: {
  attachedToResident: boolean;
  uninstall: () => Promise<{ ok: true }>;
  waitForExit: () => Promise<boolean>;
  relaunch: () => void;
}): Promise<void> {
  await opts.uninstall();
  await opts.waitForExit();
  if (opts.attachedToResident) opts.relaunch();
}

export async function resolveResidentAtBoot(opts: {
  homeDir: string;
  executablePath: string;
  serverEntry: string;
  cairnHome: string;
  logDir: string;
  port?: number;
  host?: string;
  cloudUrl?: string | null;
  versionChanged: boolean;
  updatedAt: number | null;
  probe: (cairnHome: string) => Promise<ServerOwnerRecord | null>;
  waitForHealthy: (waitOpts?: WaitForResidentOptions) => Promise<ServerOwnerRecord | null>;
  install: () => Promise<InstallResidentResult>;
  kickstart: () => Promise<boolean>;
}): Promise<ServerOwnerRecord | null> {
  if (!isResidentInstalled(opts.homeDir)) return opts.probe(opts.cairnHome);
  if (
    residentPlistNeedsUpdate({
      homeDir: opts.homeDir,
      executablePath: opts.executablePath,
      serverEntry: opts.serverEntry,
      cairnHome: opts.cairnHome,
      logDir: opts.logDir,
      port: opts.port,
      host: opts.host,
      cloudUrl: opts.cloudUrl,
    })
  ) {
    const installed = await opts.install();
    if (!installed.ok) return opts.probe(opts.cairnHome);
    return opts.waitForHealthy({ timeoutMs: 15_000 });
  }
  const existing = await opts.probe(opts.cairnHome);
  const needsRefresh =
    opts.versionChanged ||
    (opts.updatedAt !== null && (existing === null || existing.startedAt < opts.updatedAt));
  if (existing !== null && !needsRefresh) return existing;
  if (existing !== null && needsRefresh) {
    await opts.kickstart();
    return (
      (await opts.waitForHealthy({ excludePid: existing.pid, timeoutMs: 15_000 })) ??
      (await opts.probe(opts.cairnHome))
    );
  }
  if (!needsRefresh) {
    const booting = await opts.waitForHealthy({ timeoutMs: 3_000 });
    if (booting !== null) return booting;
  }
  await opts.kickstart();
  return opts.waitForHealthy({ timeoutMs: 15_000 });
}
