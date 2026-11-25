import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STEP_RECORD = /^step-[^.]+\.json$/;
const IN_FLIGHT: ReadonlySet<unknown> = new Set(['claimed', 'running', 'awaiting-upload']);

export function runnerStepsInFlight(runnerHome: string): number {
  const outbox = join(runnerHome, 'outbox');
  let names: string[];
  try {
    names = readdirSync(outbox);
  } catch {
    return 0;
  }
  let count = 0;
  for (const name of names) {
    if (!STEP_RECORD.test(name)) continue;
    try {
      const record = JSON.parse(readFileSync(join(outbox, name), 'utf8')) as { state?: unknown };
      if (IN_FLIGHT.has(record.state)) count += 1;
    } catch {}
  }
  return count;
}
