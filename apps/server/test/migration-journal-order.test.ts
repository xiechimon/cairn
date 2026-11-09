import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const HISTORICAL_TIMESTAMP_CUTOFF = '0041_lovely_stepford_cuckoos';

test('migration journal identities and timestamps preserve upgrade order', () => {
  const { entries } = JSON.parse(
    readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'),
  ) as { entries: { idx: number; tag: string; when: number }[] };
  const cutoff = entries.findIndex((entry) => entry.tag === HISTORICAL_TIMESTAMP_CUTOFF);
  expect(cutoff, HISTORICAL_TIMESTAMP_CUTOFF).toBeGreaterThanOrEqual(0);
  expect(new Set(entries.map((entry) => entry.idx)).size, 'unique idx').toBe(entries.length);
  expect(new Set(entries.map((entry) => entry.tag)).size, 'unique tag').toBe(entries.length);

  let previousIdx = -1;
  let maximumWhen = Number.NEGATIVE_INFINITY;
  for (const [position, entry] of entries.entries()) {
    expect(entry.idx, entry.tag).toBeGreaterThan(previousIdx);
    expect(entry.tag, String(entry.idx)).toMatch(
      new RegExp(`^${String(entry.idx).padStart(4, '0')}_`),
    );
    if (position > cutoff) {
      expect(entry.when, `${entry.tag} must exceed all earlier timestamps`).toBeGreaterThan(
        maximumWhen,
      );
    }
    previousIdx = entry.idx;
    maximumWhen = Math.max(maximumWhen, entry.when);
  }
});
