/**
 * Hard budget reservations for one bounded run.
 *
 * The cap lives here, in code, not in a prompt: once the start or wall
 * ceiling is reached every further reservation is refused, and a stop reason
 * is recorded that a scorecard can print. A reservation is a Cairn
 * model-backed start, not a provider token; it is charged when it is opened,
 * so work abandoned mid-flight still counts.
 */

export interface BudgetCap {
  /** Model-backed starts this run may ever open. */
  maxStarts: number;
  /** Wall-clock minutes across the whole run. */
  maxWallMinutes: number;
}

export type Reservation =
  | { ok: true; id: string; starts: number }
  | { ok: false; reason: string };

export interface LedgerSnapshot {
  starts: number;
  open: number;
  wallMs: number;
  closed: boolean;
  stopReason: string | null;
}

export class ReservationLedger {
  readonly cap: BudgetCap;
  private starts = 0;
  private readonly opened = new Set<string>();
  private wallMs = 0;
  private closed = false;
  private stopReason: string | null = null;
  private seq = 0;

  constructor(cap: BudgetCap) {
    if (cap.maxStarts < 0 || cap.maxWallMinutes < 0)
      throw new Error('reservation cap must not be negative');
    this.cap = cap;
  }

  stop(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stopReason = reason;
  }

  open(label: string, now = Date.now()): Reservation {
    if (this.closed) return { ok: false, reason: this.stopReason ?? 'stopped' };
    if (this.starts >= this.cap.maxStarts) {
      this.stop(`start cap ${this.cap.maxStarts} reached`);
      return { ok: false, reason: this.stopReason ?? 'start cap reached' };
    }
    if (this.wallMs >= this.cap.maxWallMinutes * 60_000) {
      this.stop(`wall cap ${this.cap.maxWallMinutes} minutes reached`);
      return { ok: false, reason: this.stopReason ?? 'wall cap reached' };
    }
    this.seq += 1;
    const id = `${label}#${this.seq}@${now}`;
    this.starts += 1;
    this.opened.add(id);
    return { ok: true, id, starts: this.starts };
  }

  /** Wall time is charged by the caller between reservation and settlement. */
  charge(id: string, elapsedMs: number): void {
    if (!this.opened.has(id)) return;
    this.opened.delete(id);
    this.wallMs += Math.max(0, elapsedMs);
    if (this.wallMs >= this.cap.maxWallMinutes * 60_000)
      this.stop(`wall cap ${this.cap.maxWallMinutes} minutes reached`);
  }

  snapshot(): LedgerSnapshot {
    return {
      starts: this.starts,
      open: this.opened.size,
      wallMs: this.wallMs,
      closed: this.closed,
      stopReason: this.stopReason,
    };
  }
}
