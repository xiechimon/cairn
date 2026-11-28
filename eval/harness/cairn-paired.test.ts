import { describe, expect, test } from 'vitest';
import { decide, discordance, mcnemarOneSided, passRate, powerAt } from './paired.js';

const pair = (caseId: string, baseline: boolean, candidate: boolean) => ({
  caseId,
  baseline,
  candidate,
});

function pairs(wins: number, losses: number, ties: number) {
  const out = [];
  for (let i = 0; i < wins; i += 1) out.push(pair(`w${i}`, false, true));
  for (let i = 0; i < losses; i += 1) out.push(pair(`l${i}`, true, false));
  for (let i = 0; i < ties; i += 1) out.push(pair(`t${i}`, true, true));
  return out;
}

describe('paired decision', () => {
  test('ten unopposed wins out of twenty keeps the candidate', () => {
    const decision = decide(pairs(10, 0, 10));
    expect(decision.kind).toBe('keep');
    expect(decision.effect).toBeCloseTo(0.5);
    expect(decision.p).toBeLessThan(0.05);
  });

  test('four unopposed gains out of forty pairs is refused', () => {
    const decision = decide(pairs(4, 0, 36));
    expect(decision.effect).toBeCloseTo(0.1);
    expect(decision.p).toBeCloseTo(0.0625);
    expect(decision.kind).toBe('discard');
  });

  test('a higher raw pass rate with a five-point paired effect is refused', () => {
    const decision = decide(pairs(1, 0, 19));
    expect(decision.effect).toBeCloseTo(0.05);
    expect(decision.kind).toBe('discard');
  });

  test('ties count toward n but not toward the sign test', () => {
    const decision = decide(pairs(3, 3, 4));
    expect(decision.n).toBe(10);
    expect(decision.ties).toBe(4);
    expect(decision.p).toBeCloseTo(0.65625);
    expect(decision.kind).toBe('discard');
  });

  test('no pairs is invalid, never a keep', () => {
    expect(decide([]).kind).toBe('invalid');
  });

  test('one-sided exact McNemar matches the binomial tail', () => {
    expect(mcnemarOneSided(10, 0)).toBeCloseTo(1 / 1024);
    expect(mcnemarOneSided(4, 0)).toBeCloseTo(1 / 16);
    expect(mcnemarOneSided(0, 0)).toBe(1);
  });
});

describe('power and A/A noise', () => {
  test('more pairs and a cleaner signal give more power', () => {
    const small = powerAt(8, 0.5, 0.75);
    const large = powerAt(24, 0.5, 0.75);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeLessThanOrEqual(1);
  });

  test('a 24-pair confirmation cannot reach 80% power at the 30-point target', () => {
    expect(powerAt(24, 1, 0.65)).toBeCloseTo(0.36, 2);
    expect(powerAt(32, 1, 0.65)).toBeGreaterThan(powerAt(24, 1, 0.65));
  });

  test('a pure A/A sample keeps almost nothing', () => {
    expect(powerAt(24, 0.4, 0.5)).toBeLessThan(0.05);
  });

  test('discordance and pass rate read straight off the pairs', () => {
    const sample = pairs(2, 1, 1);
    expect(discordance(sample)).toBeCloseTo(0.75);
    expect(passRate(sample.map((p) => p.candidate))).toBeCloseTo(0.75);
    expect(passRate([])).toBe(0);
  });
});
