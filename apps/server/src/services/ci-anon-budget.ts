const HOUR_MS = 3_600_000;

export class AnonReadBudget {
  private readonly own: number[] = [];
  private readonly all: number[] = [];

  constructor(
    private readonly ownPerHour: number,
    private readonly ipPerHour: number,
  ) {}

  free(now: number): number {
    for (const list of [this.own, this.all]) {
      while (list.length > 0 && (list[0] ?? now) <= now - HOUR_MS) list.shift();
    }
    return Math.min(this.ownPerHour - this.own.length, this.ipPerHour - this.all.length);
  }

  recordShared(now: number, count = 1): void {
    this.free(now);
    for (let i = 0; i < count; i += 1) this.all.push(now);
  }

  take(now: number, need = 1): boolean {
    if (this.free(now) < need) return false;
    this.own.push(now);
    this.all.push(now);
    return true;
  }
}
