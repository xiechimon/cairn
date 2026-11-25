import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

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
  } catch {}
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
  } catch {}
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
}): string {
  const outLog = join(opts.logDir, 'resident-host.out.log');
  const errLog = join(opts.logDir, 'resident-host.err.log');
  const host = opts.host ?? DEFAULT_RESIDENT_HOST;
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
  } catch {}
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
  } catch {}
  try {
    if (existsSync(plistPath)) unlinkSync(plistPath);
  } catch {}
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
  const get = async (path: string): Promise<unknown> => {
    const res = await fetchImpl(`${record.origin}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
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

export async function kickstartResidentHost(opts: {
  homeDir: string;
  uid?: number;
  runLaunchctl?: (args: string[]) => Promise<void>;
}): Promise<boolean> {
  if (process.platform !== 'darwin' && opts.runLaunchctl === undefined) return false;
  if (!isResidentInstalled(opts.homeDir)) return false;
  const run =
    opts.runLaunchctl ??
    (async (args: string[]) => {
      await execFileAsync('launchctl', args);
    });
  await run(['kickstart', '-k', `gui/${opts.uid ?? process.getuid?.() ?? 501}/${RESIDENT_LABEL}`]);
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
    await opts.uninstall().catch(() => {});
    if (stoppedEmbedded) await opts.restoreEmbeddedServer();
    throw error;
  }
  if (!installed.ok) {
    if (stoppedEmbedded) await opts.restoreEmbeddedServer();
    throw new Error(installed.reason);
  }
  const resident = await opts.waitForHealthy();
  if (resident === null) {
    await opts.uninstall().catch(() => {});
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
