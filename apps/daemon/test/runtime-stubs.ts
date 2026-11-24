import type { AntigravityManaged } from '../src/backend/antigravity-managed.js';
import type { ManagedRuntime } from '../src/backend/managed-runtime.js';
import type { MachineLoopOpts } from '../src/machine-loop.js';

export function stubManagedRuntime(overrides: Partial<ManagedRuntime> = {}): ManagedRuntime {
  const current = overrides.current ?? (() => null);
  return {
    current,
    acquire:
      overrides.acquire ??
      (() => {
        const install = current();
        return install === null ? null : { ...install, release: () => {} };
      }),
    status:
      overrides.status ??
      (() => ({
        installedVersion: current()?.version ?? null,
        availableVersion: null,
        phase: 'idle' as const,
      })),
    ensure: overrides.ensure ?? (async () => null),
    checkForUpdate:
      overrides.checkForUpdate ??
      (async () => ({
        installedVersion: current()?.version ?? null,
        availableVersion: null,
        phase: 'idle' as const,
      })),
    update: overrides.update ?? (async () => current()),
  };
}

export function stubAntigravityManaged(
  overrides: Partial<AntigravityManaged> = {},
): AntigravityManaged {
  return {
    current: overrides.current ?? (() => null),
    ensure: overrides.ensure ?? (async () => null),
    probe: overrides.probe ?? (async () => null),
    ...(overrides.probeDetailed !== undefined ? { probeDetailed: overrides.probeDetailed } : {}),
  };
}

export function offlineDaemonRuntimeOpts(): Pick<
  MachineLoopOpts,
  'devinManaged' | 'geminiManaged' | 'antigravityManaged' | 'updateChecksEnabled'
> {
  return {
    devinManaged: stubManagedRuntime(),
    geminiManaged: stubManagedRuntime(),
    antigravityManaged: stubAntigravityManaged(),
    updateChecksEnabled: () => false,
  };
}
