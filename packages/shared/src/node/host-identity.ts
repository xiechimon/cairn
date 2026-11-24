import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface HostIdentitySources {
  platform: NodeJS.Platform;
  readFile: (path: string) => string | null;
  run: (command: string, args: string[]) => string | null;
  userHome?: string;
  xdgConfigHome?: string;
  appData?: string;
}

const MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
const PLATFORM_UUID = /"IOPlatformUUID"\s*=\s*"([^"]+)"/;
const PLACEHOLDER_HARDWARE_ID =
  /^(?:uninitialized|empty|none|unknown|default|null|n\/a|([0-9a-f])(?:-|\1)*|03000200-0400-0500-0006-000700080009|00020003-0004-0005-0006-000700080009)$/i;
export const MAX_LEGACY_HOST_KEYS = 8;

export function usableHardwareId(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (
    value === '' ||
    value.length > 256 ||
    /\p{C}/u.test(value) ||
    PLACEHOLDER_HARDWARE_ID.test(value)
  ) {
    return null;
  }
  return value;
}

export function readHardwareId(sources: HostIdentitySources): string | null {
  if (sources.platform === 'darwin') {
    return usableHardwareId(
      sources.run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'])?.match(PLATFORM_UUID)?.[1],
    );
  }
  if (sources.platform !== 'linux') return null;
  for (const path of MACHINE_ID_PATHS) {
    const id = usableHardwareId(sources.readFile(path));
    if (id !== null) return id;
  }
  return null;
}

export function hostKeyOf(hardwareId: string): string {
  return createHash('sha256').update(['cairn-host-v2', hardwareId].join('\n')).digest('hex');
}

export function legacyHostKeyOf(parts: { hardwareId: string; home: string }): string {
  return createHash('sha256')
    .update(['cairn-host-v1', parts.hardwareId, resolve(parts.home)].join('\n'))
    .digest('hex');
}

function nodeSources(): HostIdentitySources {
  return {
    platform: process.platform,
    userHome: homedir(),
    ...(process.env.XDG_CONFIG_HOME !== undefined
      ? { xdgConfigHome: process.env.XDG_CONFIG_HOME }
      : {}),
    ...(process.env.APPDATA !== undefined ? { appData: process.env.APPDATA } : {}),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    run: (command, args) => {
      try {
        return execFileSync(command, args, { encoding: 'utf8', timeout: 2_000 });
      } catch {
        return null;
      }
    },
  };
}

export function standardLegacyRunnerHomes(opts: {
  home: string;
  platform: NodeJS.Platform;
  userHome?: string;
  xdgConfigHome?: string;
  appData?: string;
  extraHomes?: readonly string[];
}): string[] {
  const candidates: string[] = [opts.home];
  if (opts.userHome !== undefined && opts.userHome !== '') {
    candidates.push(join(opts.userHome, '.cairn'));
    if (opts.platform === 'darwin') {
      const userData = join(opts.userHome, 'Library', 'Application Support', 'Cairn');
      candidates.push(join(userData, 'runner'), join(userData, 'runner-home'));
    } else if (opts.platform === 'linux') {
      const configRoot =
        opts.xdgConfigHome !== undefined && opts.xdgConfigHome !== ''
          ? opts.xdgConfigHome
          : join(opts.userHome, '.config');
      const userData = join(configRoot, 'Cairn');
      candidates.push(join(userData, 'runner'), join(userData, 'runner-home'));
    } else if (opts.platform === 'win32') {
      const appDataRoot =
        opts.appData !== undefined && opts.appData !== ''
          ? opts.appData
          : join(opts.userHome, 'AppData', 'Roaming');
      const userData = join(appDataRoot, 'Cairn');
      candidates.push(join(userData, 'runner'), join(userData, 'runner-home'));
    }
  }
  for (const extra of opts.extraHomes ?? []) {
    if (extra !== '') candidates.push(extra);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of candidates) {
    const normalized = resolve(dir);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function probeHostKey(sources: HostIdentitySources = nodeSources()): string | null {
  const hardwareId = readHardwareId(sources);
  return hardwareId === null ? null : hostKeyOf(hardwareId);
}

export function probeHostIdentity(
  home: string,
  sources: HostIdentitySources = nodeSources(),
  extraLegacyHomes: readonly string[] = [],
): { hostKey: string; legacyHostKey: string; legacyHostKeys: string[] } | null {
  const hardwareId = readHardwareId(sources);
  if (hardwareId === null) return null;
  const hostKey = hostKeyOf(hardwareId);
  const legacyHostKey = legacyHostKeyOf({ hardwareId, home });
  const homes = standardLegacyRunnerHomes({
    home,
    platform: sources.platform,
    ...(sources.userHome !== undefined ? { userHome: sources.userHome } : {}),
    ...(sources.xdgConfigHome !== undefined ? { xdgConfigHome: sources.xdgConfigHome } : {}),
    ...(sources.appData !== undefined ? { appData: sources.appData } : {}),
    extraHomes: extraLegacyHomes,
  });
  const legacyHostKeys = collectLegacyHostKeys(
    hostKey,
    homes.map((candidateHome) => legacyHostKeyOf({ hardwareId, home: candidateHome })),
  );
  return {
    hostKey,
    legacyHostKey,
    legacyHostKeys,
  };
}

export function collectLegacyHostKeys(
  hostKey: string | null | undefined,
  candidates: readonly (string | null | undefined)[],
  limit = MAX_LEGACY_HOST_KEYS,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const candidate of candidates) {
    if (out.length >= limit) break;
    if (candidate == null || candidate === '' || candidate === hostKey || seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
