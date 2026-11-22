import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface HostIdentitySources {
  platform: NodeJS.Platform;
  readFile: (path: string) => string | null;
  run: (command: string, args: string[]) => string | null;
}

const MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
const PLATFORM_UUID = /"IOPlatformUUID"\s*=\s*"([^"]+)"/;

export function usableHardwareId(raw: string | null | undefined): string | null {
  const value = raw?.trim() ?? '';
  if (value === '' || value.length > 256 || /\p{C}/u.test(value)) return null;
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

export function hostKeyOf(parts: { hardwareId: string; home: string }): string {
  return createHash('sha256')
    .update(['cairn-host-v1', parts.hardwareId, resolve(parts.home)].join('\n'))
    .digest('hex');
}

function nodeSources(): HostIdentitySources {
  return {
    platform: process.platform,
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

export function probeHostKey(
  home: string,
  sources: HostIdentitySources = nodeSources(),
): string | null {
  const hardwareId = readHardwareId(sources);
  return hardwareId === null ? null : hostKeyOf({ hardwareId, home });
}
