import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const RESIDENT_LABEL = 'app.cairn.host';
export const SERVER_OWNER_FILE = 'server-owner.json';
export const DEFAULT_RESIDENT_PORT = 8787;

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
}): string {
  const outLog = join(opts.logDir, 'resident-host.out.log');
  const errLog = join(opts.logDir, 'resident-host.err.log');
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
    '    <string>0.0.0.0</string>',
    '    <key>PORT</key>',
    `    <string>${opts.port}</string>`,
    '    <key>CAIRN_HOME</key>',
    `    <string>${escapeXml(opts.cairnHome)}</string>`,
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

export async function installResidentHost(opts: {
  homeDir: string;
  executablePath: string;
  serverEntry: string;
  cairnHome: string;
  logDir: string;
  port?: number;
  uid?: number;
  runLaunchctl?: (args: string[]) => Promise<void>;
}): Promise<{ ok: true; plistPath: string; port: number } | { ok: false; reason: string }> {
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
