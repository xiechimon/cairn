import { execFile } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MAX_DEPTH = 64;
const BROWSER_NAME =
  /chrom|firefox|brave|vivaldi|edge|opera|zen|librewolf|epiphany|safari|browser/i;

export type ParentOf = (pid: number) => Promise<number | undefined>;

export async function parentOfProcess(pid: number): Promise<number | undefined> {
  const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => undefined);
  if (stat !== undefined) {
    const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    return Number.isInteger(parent) ? parent : undefined;
  }
  const { stdout } = await execFileAsync('ps', ['-o', 'ppid=', '-p', String(pid)]).catch(() => ({
    stdout: '',
  }));
  const parent = Number.parseInt(stdout.trim(), 10);
  return Number.isInteger(parent) ? parent : undefined;
}

export async function isDaemonProcess(
  pid: number,
  daemonPid: number = process.pid,
  parentOf: ParentOf = parentOfProcess,
): Promise<boolean> {
  let current: number | undefined = pid;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current > 1; depth += 1) {
    if (current === daemonPid) return true;
    current = await parentOf(current);
  }
  return false;
}

export async function isOwnFamily(
  pid: number,
  daemonPid: number = process.pid,
  parentOf: ParentOf = parentOfProcess,
): Promise<boolean> {
  if (await isDaemonProcess(pid, daemonPid, parentOf)) return true;
  let ancestor = await parentOf(daemonPid);
  for (let depth = 0; depth < MAX_DEPTH && ancestor !== undefined && ancestor > 1; depth += 1) {
    if (ancestor === pid) return true;
    ancestor = await parentOf(ancestor);
  }
  return false;
}

export function isBrowserApp(appName: string): boolean {
  return BROWSER_NAME.test(appName);
}

export function originHosts(origins: readonly string[]): string[] {
  const hosts: string[] = [];
  for (const origin of origins) {
    const text = origin.trim();
    if (text === '') continue;
    try {
      hosts.push(new URL(text.includes('://') ? text : `https://${text}`).host.toLowerCase());
    } catch {
      hosts.push(text.toLowerCase());
    }
  }
  return hosts;
}

export function showsCairn(texts: readonly string[], hosts: readonly string[]): boolean {
  return texts.some((text) => {
    const lower = text.toLowerCase();
    return hosts.some((host) => lower.includes(host));
  });
}

export type LookupAll = (host: string) => Promise<string[]>;

async function lookupAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
}

function machineAddresses(): string[] {
  return Object.values(networkInterfaces()).flatMap((list) =>
    (list ?? []).map((entry) => entry.address.toLowerCase()),
  );
}

function isMachineAddress(address: string, own: readonly string[]): boolean {
  const lower = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (lower === 'localhost' || lower.endsWith('.localhost')) return true;
  if (/^127\./.test(lower) || lower === '0.0.0.0' || lower === '::' || lower === '::1') return true;
  if (/^::ffff:(127\.|7f[0-9a-f]{2}:)/.test(lower) || lower === '::ffff:0.0.0.0') return true;
  return own.includes(lower);
}

function originOf(text: string): { host: string; port: string } | null {
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    return {
      host: url.hostname.toLowerCase(),
      port: url.port || (url.protocol === 'http:' ? '80' : '443'),
    };
  } catch {
    return null;
  }
}

export async function isCairnPage(
  raw: string,
  cairnOrigins: readonly string[],
  resolve: LookupAll = lookupAll,
  own: readonly string[] = machineAddresses(),
): Promise<boolean> {
  const text = raw.trim().replace(/^(blob|filesystem):/i, '');
  if (!/^https?:\/\//i.test(text)) return false;
  const page = originOf(text);
  if (page === null) return true;
  const origins = cairnOrigins.flatMap((origin) => {
    const parsed = origin.trim() === '' ? null : originOf(origin.trim());
    return parsed === null ? [] : [parsed];
  });
  if (origins.some((origin) => origin.host === page.host && origin.port === page.port)) return true;
  if (!origins.some((origin) => origin.port === page.port)) return false;
  const bare = page.host.replace(/^\[|\]$/g, '');
  if (isIP(bare) !== 0 || bare === 'localhost' || bare.endsWith('.localhost')) {
    return isMachineAddress(bare, own);
  }
  const addresses = await resolve(bare).catch(() => null);
  return addresses === null || addresses.some((address) => isMachineAddress(address, own));
}

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost', '[::1]'];

export function cairnBlockPatterns(cairnOrigins: readonly string[]): string[] {
  const patterns = new Set<string>();
  for (const origin of cairnOrigins) {
    let url: URL;
    try {
      url = new URL(origin.trim().includes('://') ? origin.trim() : `https://${origin.trim()}`);
    } catch {
      continue;
    }
    const port = url.port === '' ? '' : `:${url.port}`;
    patterns.add(`${url.protocol}//${url.host}/*`);
    for (const scheme of ['http:', 'https:']) {
      for (const name of LOOPBACK_NAMES) patterns.add(`${scheme}//${name}${port}/*`);
    }
  }
  return [...patterns];
}
