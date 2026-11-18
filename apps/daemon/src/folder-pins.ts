import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';
import type { MachineFolderPinReport, MachinePresencePin } from '@cairn/shared';

function expandHome(pin: string, home: string): string | null {
  if (pin === '~') return home;
  if (pin.startsWith('~/') || pin.startsWith('~\\')) return join(home, pin.slice(2));
  if (pin.startsWith('~')) return null;
  return pin;
}

export function resolveFolderPin(pin: string, home: string = homedir()): string | null {
  const expanded = expandHome(pin, home);
  if (expanded === null || !isAbsolute(expanded)) return null;
  if (expanded.split(/[\\/]+/).some((segment) => segment === '..')) return null;
  let canonical: string;
  try {
    canonical = realpathSync(expanded);
  } catch {
    return null;
  }
  try {
    if (!statSync(canonical).isDirectory()) return null;
  } catch {
    return null;
  }
  if (canonical === resolve(sep) || canonical === '/') return null;
  return canonical;
}

export class FolderPins {
  private pins: MachinePresencePin[] = [];

  constructor(private readonly workspacesDir: string) {}

  workspacesRoot(): string {
    try {
      return realpathSync(this.workspacesDir);
    } catch {
      return normalize(this.workspacesDir);
    }
  }

  setPins(pins: readonly MachinePresencePin[]): void {
    this.pins = [...pins];
  }

  report(): MachineFolderPinReport[] {
    return this.pins.map((pin) => {
      const canonical = resolveFolderPin(pin.path);
      if (canonical === null) {
        return { pin: pin.path, status: pin.status === 'confirmed' ? 'absent' : 'rejected' };
      }
      if (pin.status === 'confirmed' && canonical !== pin.path) {
        return { pin: pin.path, status: 'absent' };
      }
      return { pin: pin.path, status: 'confirmed', canonicalPath: canonical };
    });
  }

  roots(): readonly string[] {
    const enabled = this.pins
      .filter((pin) => pin.enabled && pin.status === 'confirmed')
      .map((pin) => pin.path);
    return [this.workspacesRoot(), ...enabled];
  }
}
