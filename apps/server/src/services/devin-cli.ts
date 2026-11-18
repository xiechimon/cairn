import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DevinSubscriptionVerifyResult } from '@cairn/shared';

export const DEFAULT_DEVIN_TIMEOUT_MS = 30_000;

const MANAGED_INSTALL_ROOT = join(homedir(), '.local', 'share', 'cairn', 'devin');
const FORWARDED_ENV = [
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'https_proxy',
  'http_proxy',
  'all_proxy',
  'no_proxy',
  'LANG',
  'TZ',
];
const AUTH_FAILURE = /authentication|401|invalid|expired|login|unauthorized|forbidden|auth method/i;

export function childEnv(home: string, token: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { HOME: home, WINDSURF_API_KEY: token };
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH;
  for (const name of FORWARDED_ENV) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

function managedBin(): { command: string; args: string[] } | null {
  const versionDirs: string[] = [];
  try {
    const current = JSON.parse(
      readFileSync(join(MANAGED_INSTALL_ROOT, 'current.json'), 'utf8'),
    ) as { version?: unknown };
    if (typeof current.version === 'string') {
      versionDirs.push(join(MANAGED_INSTALL_ROOT, 'versions', current.version));
    }
  } catch {}
  try {
    for (const entry of readdirSync(join(MANAGED_INSTALL_ROOT, 'versions')).sort().reverse()) {
      versionDirs.push(join(MANAGED_INSTALL_ROOT, 'versions', entry));
    }
  } catch {}
  for (const dir of versionDirs) {
    try {
      const marker = JSON.parse(readFileSync(join(dir, '.install-complete'), 'utf8')) as {
        binRelPath?: unknown;
        args?: unknown;
      };
      if (typeof marker.binRelPath !== 'string') continue;
      const binPath = join(dir, marker.binRelPath);
      if (!existsSync(binPath)) continue;
      const args =
        Array.isArray(marker.args) && marker.args.every((arg) => typeof arg === 'string')
          ? marker.args
          : ['acp'];
      return { command: binPath, args };
    } catch {}
  }
  return null;
}

export function devinBin(args: string[]): { command: string; args: string[] } {
  if (process.env.DEVIN_BIN !== undefined && process.env.DEVIN_BIN !== '') {
    return { command: process.env.DEVIN_BIN, args };
  }
  const managed = managedBin();
  if (managed === null) return { command: 'devin', args };
  const acpAt = managed.args.lastIndexOf('acp');
  const prefix = acpAt > 0 ? managed.args.slice(0, acpAt) : [];
  return args[0] === 'acp' && acpAt >= 0
    ? managed
    : { command: managed.command, args: [...prefix, ...args] };
}

export function collectLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let index = rest.indexOf('\n');
  while (index >= 0) {
    lines.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
    index = rest.indexOf('\n');
  }
  return { lines, rest };
}

export function errorReason(text: string): DevinSubscriptionVerifyResult {
  return AUTH_FAILURE.test(text) ? { ok: false, reason: 'auth' } : { ok: false, reason: 'failed' };
}
