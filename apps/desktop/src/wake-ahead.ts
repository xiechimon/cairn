export const WAKE_AHEAD_LEAD_MS = 15 * 60_000;
export const WAKE_AHEAD_TRAIL_MS = 5 * 60_000;
export const WAKE_AHEAD_POLL_MS = 60_000;

export interface WakeAheadScheduleRow {
  enabled: boolean;
  nextRunAt: number | null;
}

export function earliestNextRunAt(rows: readonly WakeAheadScheduleRow[]): number | null {
  let earliest: number | null = null;
  for (const row of rows) {
    if (!row.enabled || row.nextRunAt === null) continue;
    if (earliest === null || row.nextRunAt < earliest) earliest = row.nextRunAt;
  }
  return earliest;
}

export function wakeAheadActive(nextRunAt: number | null, now: number): boolean {
  if (nextRunAt === null) return false;
  return now >= nextRunAt - WAKE_AHEAD_LEAD_MS && now <= nextRunAt + WAKE_AHEAD_TRAIL_MS;
}

export async function earliestScheduleNextRunAt(
  origin: string,
  token: string,
): Promise<number | null> {
  const res = await fetch(`${origin}/api/schedules`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`schedule fetch answered ${res.status}`);
  return earliestNextRunAt((await res.json()) as WakeAheadScheduleRow[]);
}

export interface WakeAhead {
  start(): void;
  stop(): void;
  pollNow(): Promise<void>;
}

export function createWakeAhead(opts: {
  nextRunAt: () => Promise<number | null>;
  onWindow: (active: boolean) => void;
  intervalMs?: number;
  now?: () => number;
}): WakeAhead {
  const now = opts.now ?? Date.now;
  const intervalMs = opts.intervalMs ?? WAKE_AHEAD_POLL_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let polling = false;
  const poll = async (): Promise<void> => {
    if (polling) return;
    polling = true;
    try {
      opts.onWindow(wakeAheadActive(await opts.nextRunAt(), now()));
    } catch {
      void 0;
    } finally {
      polling = false;
    }
  };
  return {
    start() {
      if (timer !== null) return;
      timer = setInterval(() => void poll(), intervalMs);
      timer.unref?.();
      void poll();
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    pollNow: poll,
  };
}
