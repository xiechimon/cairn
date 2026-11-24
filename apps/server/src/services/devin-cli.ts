import { readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { DevinSubscriptionVerifyResult } from '@cairn/shared';
import {
  unsafeManagedVersion,
  verifiedManagedBin,
  verifiedManagedBins,
} from '@cairn/shared/managed-bin';
import { acpProbeEnv, collectLines } from './acp-probe.js';

export { collectLines };

export const DEFAULT_DEVIN_TIMEOUT_MS = 30_000;

const MANAGED_INSTALL_ROOT = join(homedir(), '.cairn', 'tools', 'devin');
const AUTH_FAILURE = /authentication|401|invalid|expired|login|unauthorized|forbidden|auth method/i;

export function childEnv(home: string, token: string): NodeJS.ProcessEnv {
  return acpProbeEnv({ HOME: home, WINDSURF_API_KEY: token });
}

function managedVersions(): string[] {
  const versions: string[] = [];
  try {
    for (const entry of readdirSync(join(MANAGED_INSTALL_ROOT, 'versions'), {
      withFileTypes: true,
    })) {
      if (entry.isDirectory()) versions.push(entry.name);
    }
  } catch {}
  return versions;
}

function managedBin(): { command: string; args: string[] } | null {
  let currentVersion: string | null = null;
  try {
    const current = JSON.parse(
      readFileSync(join(MANAGED_INSTALL_ROOT, 'current.json'), 'utf8'),
    ) as { version?: unknown };
    if (typeof current.version === 'string' && !unsafeManagedVersion(current.version)) {
      currentVersion = current.version;
    }
  } catch {}
  const candidates = [
    ...(currentVersion === null
      ? []
      : [verifiedManagedBin(join(MANAGED_INSTALL_ROOT, 'versions', currentVersion))]),
    ...verifiedManagedBins(join(MANAGED_INSTALL_ROOT, 'versions'), managedVersions()),
  ];
  const found = candidates.find((bin) => bin !== null);
  if (found === undefined || found === null) return null;
  return { command: found.command, args: found.args.length > 0 ? found.args : ['acp'] };
}

export function devinBin(args: string[]): { command: string; args: string[] } {
  if (process.env.DEVIN_BIN !== undefined && process.env.DEVIN_BIN !== '') {
    return { command: process.env.DEVIN_BIN, args };
  }
  const managed = managedBin();
  if (managed === null) return { command: 'devin', args };
  const acpAt = managed.args.lastIndexOf('acp');
  const prefix = acpAt > 0 ? managed.args.slice(0, acpAt) : [];
  return {
    command: managed.command,
    args:
      args[0] === 'acp' && acpAt >= 0 ? [...managed.args, ...args.slice(1)] : [...prefix, ...args],
  };
}

export function errorReason(text: string): DevinSubscriptionVerifyResult {
  return AUTH_FAILURE.test(text) ? { ok: false, reason: 'auth' } : { ok: false, reason: 'failed' };
}
