export type ProviderHealthState = 'healthy' | 'degraded' | 'open' | 'half_open';

export const DEGRADED_AFTER_FAILURES = 3;
export const OPEN_AFTER_FAILURES = 5;
export const HALF_OPEN_AFTER_MS = 30_000;
export const PROBE_LEASE_MS = 10 * 60_000;

interface Entry {
  failures: number;
  openedAt: number | null;
  probeAt: number | null;
}

export class ProviderHealthTracker {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly now: () => number = Date.now) {}

  state(providerId: string): ProviderHealthState {
    const e = this.entries.get(providerId);
    if (e === undefined) return 'healthy';
    if (e.openedAt !== null) {
      return this.now() - e.openedAt >= HALF_OPEN_AFTER_MS ? 'half_open' : 'open';
    }
    return e.failures >= DEGRADED_AFTER_FAILURES ? 'degraded' : 'healthy';
  }

  tryAcquire(providerId: string): boolean {
    const s = this.state(providerId);
    if (s === 'healthy' || s === 'degraded') return true;
    if (s === 'open') return false;
    const e = this.entries.get(providerId);
    if (e === undefined) return true;
    const now = this.now();
    if (e.probeAt !== null && now - e.probeAt < PROBE_LEASE_MS) return false;
    e.probeAt = now;
    return true;
  }

  recordFailure(providerId: string): void {
    const e = this.entries.get(providerId) ?? { failures: 0, openedAt: null, probeAt: null };
    e.failures += 1;
    if (e.openedAt !== null || e.failures >= OPEN_AFTER_FAILURES) {
      e.openedAt = this.now();
      e.probeAt = null;
    }
    this.entries.set(providerId, e);
  }

  releaseProbe(providerId: string): void {
    const e = this.entries.get(providerId);
    if (e !== undefined) e.probeAt = null;
  }

  recordSuccess(providerId: string): void {
    this.entries.delete(providerId);
  }

  reset(): void {
    this.entries.clear();
  }
}

export const providerHealth = new ProviderHealthTracker();
