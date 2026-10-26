import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../scripts/test-tmpdir.mjs';
import {
  type AdoptionVerdict,
  type CasePair,
  collectTrial,
  generalizationReport,
  judgeAdoption,
  MAX_INFRA_RETRIES,
  MIN_PAIRS,
  pairedZ,
  type TrialOutcome,
  wasTriggered,
  Z_THRESHOLD,
} from '../eval/adoption/judge.mts';
import {
  readSealedOnce,
  SealedSetAlreadyRead,
  sealedReads,
} from '../eval/adoption/sealed-ledger.mts';

const scored = (score: number, triggered = true): TrialOutcome => ({
  kind: 'scored',
  score,
  triggered,
});
const infra = (reason: 'timeout' | 'network' | 'provider_5xx' | 'sandbox_start'): TrialOutcome => ({
  kind: 'infra_failure',
  reason,
});

const pair = (caseId: string, before: TrialOutcome[], after: TrialOutcome[]): CasePair => ({
  caseId,
  before,
  after,
});

const improvingPairs = (n: number): CasePair[] =>
  Array.from({ length: n }, (_, i) =>
    pair(`c${i}`, [scored(0.2 + (i % 3) * 0.05)], [scored(0.8 + (i % 2) * 0.05)]),
  );

describe('pairedZ', () => {
  test('z = mean(d) / (sd(d) / sqrt(n)) with sample sd (n-1)', () => {
    const diffs = Array.from({ length: MIN_PAIRS }, (_, i) => i + 1);
    const n = diffs.length;
    const mean = diffs.reduce((a, b) => a + b, 0) / n;
    const sd = Math.sqrt(diffs.reduce((acc, d) => acc + (d - mean) ** 2, 0) / (n - 1));
    const r = pairedZ(diffs);
    expect(r.degenerate).toBeNull();
    expect(r.n).toBe(n);
    expect(r.meanDiff).toBeCloseTo(mean, 12);
    expect(r.sdDiff).toBeCloseTo(sd, 12);
    expect(r.z).toBeCloseTo(mean / (sd / Math.sqrt(n)), 12);
  });

  test('worked example: diffs 1..5 give z = 3 / (sqrt(2.5) / sqrt(5))', () => {
    expect(MIN_PAIRS).toBe(5);
    expect(pairedZ([1, 2, 3, 4, 5]).z).toBeCloseTo(3 / (Math.sqrt(2.5) / Math.sqrt(5)), 12);
  });

  test('fewer than MIN_PAIRS diffs yields z = 0 marked too_few_pairs', () => {
    const r = pairedZ(Array.from({ length: MIN_PAIRS - 1 }, () => 1));
    expect(r.z).toBe(0);
    expect(r.degenerate).toBe('too_few_pairs');
  });

  test('empty diffs yields z = 0 and NaN-free stats', () => {
    const r = pairedZ([]);
    expect(r).toEqual({
      n: 0,
      meanDiff: 0,
      sdDiff: 0,
      z: 0,
      meanSign: 0,
      degenerate: 'too_few_pairs',
    });
  });

  test('zero variance keeps z finite and records the sign of the mean', () => {
    const up = pairedZ(Array.from({ length: MIN_PAIRS }, () => 0.5));
    const down = pairedZ(Array.from({ length: MIN_PAIRS }, () => -0.5));
    expect(Number.isFinite(up.z)).toBe(true);
    expect(Number.isFinite(down.z)).toBe(true);
    expect(up).toMatchObject({ degenerate: 'zero_variance', meanSign: 1, meanDiff: 0.5 });
    expect(down).toMatchObject({ degenerate: 'zero_variance', meanSign: -1, meanDiff: -0.5 });
  });

  test('zero variance with zero mean has sign 0', () => {
    const r = pairedZ(Array.from({ length: MIN_PAIRS }, () => 0));
    expect(r.z).toBe(0);
    expect(r.meanSign).toBe(0);
    expect(r.degenerate).toBe('zero_variance');
  });
});

const smallNoise = [0.02, -0.03, 0.01, 0.04, -0.02, -0.01, 0.03, -0.04, 0.02, -0.01];
const noisyPairs = smallNoise.map((d, i) => pair(`c${i}`, [scored(0.5)], [scored(0.5 + d)]));

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('judgeAdoption', () => {
  test('clear improvement is accepted', () => {
    const v = judgeAdoption(improvingPairs(10));
    expect(v.decision).toBe('accepted');
    expect(v.significance.z).toBeGreaterThanOrEqual(Z_THRESHOLD);
  });

  test('infra failures are excluded and do not pull the score down', () => {
    const base = improvingPairs(10);
    const clean = judgeAdoption(base);
    const withInfra = judgeAdoption([
      ...base,
      pair(
        'down-after',
        [scored(0.9)],
        [infra('timeout'), infra('network'), infra('provider_5xx')],
      ),
      pair(
        'down-before',
        [infra('sandbox_start'), infra('sandbox_start'), infra('timeout')],
        [scored(0)],
      ),
    ]);
    expect(withInfra.validity.excludedInfra).toBe(2);
    expect(withInfra.validity.excludedCaseIds).toEqual(['down-after', 'down-before']);
    expect(withInfra.validity.validPairs).toBe(10);
    expect(withInfra.significance).toEqual(clean.significance);
    expect(withInfra.decision).toBe('accepted');
  });

  test('a scored retry within the allowed reruns keeps the case', () => {
    const v = judgeAdoption([
      ...improvingPairs(10),
      pair(
        'flaky',
        [infra('network'), scored(0.2)],
        [infra('timeout'), infra('timeout'), scored(0.9)],
      ),
    ]);
    expect(v.validity.excludedInfra).toBe(0);
    expect(v.validity.retriedTrials).toBe(3);
    expect(v.validity.validPairs).toBe(11);
  });

  test('a score after the retry budget is ignored', () => {
    const tooLate: TrialOutcome[] = [
      ...Array.from({ length: MAX_INFRA_RETRIES + 1 }, () => infra('timeout')),
      scored(1),
    ];
    const v = judgeAdoption([...improvingPairs(10), pair('late', [scored(0)], tooLate)]);
    expect(v.validity.excludedCaseIds).toEqual(['late']);
  });

  test('candidate never triggered is rejected_inert', () => {
    const v = judgeAdoption(
      Array.from({ length: 10 }, (_, i) => pair(`c${i}`, [scored(0.2)], [scored(0.9, false)])),
    );
    expect(v.decision).toBe('rejected_inert');
    expect(v.effect.triggeredPairs).toBe(0);
    expect(v.effect.triggerRate).toBe(0);
  });

  test('untriggered cases earn the change no credit', () => {
    const triggeredFlat = Array.from({ length: 10 }, (_, i) =>
      pair(`t${i}`, [scored(0.5 + (i % 2) * 0.1)], [scored(0.5 + ((i + 1) % 2) * 0.1)]),
    );
    const untriggeredGains = Array.from({ length: 10 }, (_, i) =>
      pair(`u${i}`, [scored(0)], [scored(1, false)]),
    );
    const v = judgeAdoption([...triggeredFlat, ...untriggeredGains]);
    expect(v.effect.triggeredPairs).toBe(10);
    expect(v.effect.triggerRate).toBe(0.5);
    expect(v.significance.n).toBe(10);
    expect(v.decision).toBe('not_significant');
  });

  test('small noise is not_significant', () => {
    const v = judgeAdoption(noisyPairs);
    expect(Math.abs(v.significance.z)).toBeLessThan(Z_THRESHOLD);
    expect(v.decision).toBe('not_significant');
  });

  test('clear regression is rejected_regression', () => {
    const v = judgeAdoption(
      Array.from({ length: 10 }, (_, i) =>
        pair(`c${i}`, [scored(0.8 + (i % 2) * 0.05)], [scored(0.2 + (i % 3) * 0.05)]),
      ),
    );
    expect(v.decision).toBe('rejected_regression');
    expect(v.significance.z).toBeLessThanOrEqual(-Z_THRESHOLD);
  });

  test('zero variance with a uniform gain is accepted and flagged as zero variance', () => {
    const v = judgeAdoption(
      Array.from({ length: MIN_PAIRS }, (_, i) => pair(`c${i}`, [scored(0.25)], [scored(0.75)])),
    );
    expect(v.decision).toBe('accepted');
    expect(v.significance).toMatchObject({
      degenerate: 'zero_variance',
      meanSign: 1,
      n: MIN_PAIRS,
    });
  });

  test('zero variance with a uniform drop is rejected_regression', () => {
    const v = judgeAdoption(
      Array.from({ length: MIN_PAIRS }, (_, i) => pair(`c${i}`, [scored(0.75)], [scored(0.25)])),
    );
    expect(v.decision).toBe('rejected_regression');
    expect(v.significance).toMatchObject({ degenerate: 'zero_variance', meanSign: -1 });
  });

  test('zero variance with no change is not_significant', () => {
    const v = judgeAdoption(
      Array.from({ length: MIN_PAIRS }, (_, i) => pair(`c${i}`, [scored(0.5)], [scored(0.5)])),
    );
    expect(v.decision).toBe('not_significant');
    expect(v.significance.degenerate).toBe('zero_variance');
  });

  test('a uniform gain below MIN_PAIRS stays not_significant', () => {
    const v = judgeAdoption(
      Array.from({ length: MIN_PAIRS - 1 }, (_, i) =>
        pair(`c${i}`, [scored(0.25)], [scored(0.75)]),
      ),
    );
    expect(v.decision).toBe('not_significant');
  });

  test.each([
    [
      'uniform gain',
      improvingPairs(10).map((p) => ({ ...p, before: [scored(0.25)], after: [scored(0.75)] })),
    ],
    [
      'uniform drop',
      improvingPairs(10).map((p) => ({ ...p, before: [scored(0.75)], after: [scored(0.25)] })),
    ],
    ['noisy gain', improvingPairs(10)],
    ['too few pairs', improvingPairs(MIN_PAIRS - 1)],
    [
      'no valid pairs',
      [pair('x', [scored(0.5)], [infra('timeout'), infra('timeout'), infra('timeout')])],
    ],
  ])('verdict for %s survives a write to disk and read back unchanged', (_name, pairs) => {
    const verdict = judgeAdoption(pairs);
    const dir = makeTestTempDir('cairn-adoption-verdict-');
    dirs.push(dir);
    const path = join(dir, 'verdict.json');
    writeFileSync(path, JSON.stringify(verdict));
    const readBack = JSON.parse(readFileSync(path, 'utf8')) as AdoptionVerdict;
    expect(readBack).toEqual(verdict);
    expect(readBack.decision).toBe(verdict.decision);
    expect(readBack.significance.z).toBe(verdict.significance.z);
    expect(readBack.significance.meanDiff).toBe(verdict.significance.meanDiff);
  });

  test('a non-finite score throws instead of entering z', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() =>
        judgeAdoption([...improvingPairs(10), pair('bad', [scored(0.5)], [scored(bad)])]),
      ).toThrow(/non-finite score/);
      expect(() =>
        judgeAdoption([...improvingPairs(10), pair('bad', [scored(bad)], [scored(0.5)])]),
      ).toThrow(/bad/);
    }
  });

  test('too few valid pairs is not_significant even with uniform gains', () => {
    const v = judgeAdoption(
      Array.from({ length: MIN_PAIRS - 1 }, (_, i) => pair(`c${i}`, [scored(0)], [scored(1)])),
    );
    expect(v.decision).toBe('not_significant');
    expect(v.significance.degenerate).toBe('too_few_pairs');
  });

  test('all cases lost to infra is not_significant, not inert', () => {
    const v = judgeAdoption(
      Array.from({ length: 6 }, (_, i) =>
        pair(`c${i}`, [scored(0.5)], [infra('timeout'), infra('timeout'), infra('timeout')]),
      ),
    );
    expect(v.validity.validPairs).toBe(0);
    expect(v.decision).toBe('not_significant');
  });
});

describe('collectTrial', () => {
  test('reruns infra failures at most MAX_INFRA_RETRIES times', async () => {
    let calls = 0;
    const attempts = await collectTrial(async () => {
      calls++;
      return infra('provider_5xx');
    });
    expect(calls).toBe(MAX_INFRA_RETRIES + 1);
    expect(attempts).toHaveLength(MAX_INFRA_RETRIES + 1);
  });

  test('a thrown run counts as an infra failure with the reason recorded and is retried', async () => {
    let calls = 0;
    const attempts = await collectTrial(async () => {
      calls++;
      if (calls === 1) throw new Error('socket hang up');
      return scored(0.6);
    });
    expect(attempts).toEqual([
      { kind: 'infra_failure', reason: 'exception', detail: 'socket hang up' },
      scored(0.6),
    ]);
  });

  test('a run that keeps throwing is dropped from the pairs after the retry budget', async () => {
    let calls = 0;
    const attempts = await collectTrial(async () => {
      calls++;
      throw new Error(`boom ${calls}`);
    });
    expect(calls).toBe(MAX_INFRA_RETRIES + 1);
    expect(attempts.map((a) => a.kind)).toEqual([
      'infra_failure',
      'infra_failure',
      'infra_failure',
    ]);
    expect(attempts[2]).toEqual({ kind: 'infra_failure', reason: 'exception', detail: 'boom 3' });
    const v = judgeAdoption([...improvingPairs(10), pair('throws', [scored(0.5)], attempts)]);
    expect(v.validity.excludedCaseIds).toEqual(['throws']);
    expect(v.validity.validPairs).toBe(10);
  });

  test('a non-error throw is recorded as text', async () => {
    const attempts = await collectTrial(async () => {
      throw 'plain string';
    });
    expect(attempts[0]).toEqual({
      kind: 'infra_failure',
      reason: 'exception',
      detail: 'plain string',
    });
  });

  test('a non-finite score throws and is neither retried nor swallowed', async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      let calls = 0;
      await expect(
        collectTrial(async () => {
          calls++;
          return scored(bad);
        }),
      ).rejects.toThrow(/non-finite score/);
      expect(calls).toBe(1);
    }
  });

  test('stops at the first scored attempt', async () => {
    const queue = [infra('network'), scored(0.7)];
    const attempts = await collectTrial(async () => queue.shift() ?? scored(0));
    expect(attempts).toEqual([infra('network'), scored(0.7)]);
  });
});

describe('wasTriggered', () => {
  const change = { skills: ['web-dev'], promptSections: ['dispatch-rules'], routeBranches: [] };

  test('a changed skill appearing in skillInjection counts', () => {
    expect(
      wasTriggered(change, { injectedSkills: ['web-dev'], contextSections: [], routeBranches: [] }),
    ).toBe(true);
  });

  test('a changed prompt section reaching context counts', () => {
    expect(
      wasTriggered(change, {
        injectedSkills: [],
        contextSections: ['dispatch-rules'],
        routeBranches: [],
      }),
    ).toBe(true);
  });

  test('a changed route branch being taken counts', () => {
    expect(
      wasTriggered(
        { skills: [], promptSections: [], routeBranches: ['hold'] },
        { injectedSkills: [], contextSections: [], routeBranches: ['hold'] },
      ),
    ).toBe(true);
  });

  test('evidence that touches none of the changed parts does not count', () => {
    expect(
      wasTriggered(change, {
        injectedSkills: ['other'],
        contextSections: ['base'],
        routeBranches: ['dispatch'],
      }),
    ).toBe(false);
  });
});

describe('generalizationReport', () => {
  test('reports mean sealed score and size', () => {
    expect(
      generalizationReport([
        { caseId: 'a', score: 1 },
        { caseId: 'b', score: 0.5 },
      ]),
    ).toEqual({ n: 2, meanScore: 0.75 });
  });

  test('empty sealed results report n = 0 and meanScore = 0', () => {
    expect(generalizationReport([])).toEqual({ n: 0, meanScore: 0 });
  });
});

describe('readSealedOnce', () => {
  const ledger = (): string => {
    const dir = makeTestTempDir('cairn-adoption-sealed-');
    dirs.push(dir);
    return join(dir, 'nested', 'sealed-reads.json');
  };
  const accepted: AdoptionVerdict = judgeAdoption(improvingPairs(10));
  const sealedCases = ['s1', 's2'];

  test('first read returns the set and is persisted to disk', () => {
    const path = ledger();
    const got = readSealedOnce({
      ledgerPath: path,
      runId: 'run-1',
      candidateId: 'cand-a',
      verdict: accepted,
      load: () => sealedCases,
      now: () => new Date('2026-10-25T00:00:00Z'),
    });
    expect(got).toEqual(sealedCases);
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({
      version: 1,
      reads: [{ runId: 'run-1', candidateId: 'cand-a', readAt: '2026-10-25T00:00:00.000Z' }],
    });
    expect(sealedReads(path, 'run-1')).toHaveLength(1);
  });

  test('second read in the same run throws and does not call load', () => {
    const path = ledger();
    readSealedOnce({
      ledgerPath: path,
      runId: 'run-1',
      candidateId: 'cand-a',
      verdict: accepted,
      load: () => sealedCases,
    });
    let loaded = false;
    expect(() =>
      readSealedOnce({
        ledgerPath: path,
        runId: 'run-1',
        candidateId: 'cand-b',
        verdict: accepted,
        load: () => {
          loaded = true;
          return sealedCases;
        },
      }),
    ).toThrow(SealedSetAlreadyRead);
    expect(loaded).toBe(false);
    expect(sealedReads(path, 'run-1')).toHaveLength(1);
  });

  test('a different run may read once', () => {
    const path = ledger();
    const args = { ledgerPath: path, candidateId: 'c', verdict: accepted, load: () => sealedCases };
    readSealedOnce({ ...args, runId: 'run-1' });
    readSealedOnce({ ...args, runId: 'run-2' });
    expect(sealedReads(path)).toHaveLength(2);
  });

  const notSignificant = judgeAdoption(noisyPairs);
  const regression = judgeAdoption(
    Array.from({ length: 10 }, (_, i) =>
      pair(`c${i}`, [scored(0.8 + (i % 2) * 0.05)], [scored(0.2 + (i % 3) * 0.05)]),
    ),
  );
  const inert = judgeAdoption(
    Array.from({ length: 10 }, (_, i) => pair(`c${i}`, [scored(0.2)], [scored(0.9, false)])),
  );

  test.each([
    ['rejected_inert', inert],
    ['not_significant', notSignificant],
    ['rejected_regression', regression],
  ])('a %s candidate cannot read the sealed set', (decision, verdict) => {
    const path = ledger();
    expect(verdict.decision).toBe(decision);
    let loaded = false;
    expect(() =>
      readSealedOnce({
        ledgerPath: path,
        runId: 'run-1',
        candidateId: 'c',
        verdict,
        load: () => {
          loaded = true;
          return sealedCases;
        },
      }),
    ).toThrow(new RegExp(`accepted.*${decision}`));
    expect(loaded).toBe(false);
    expect(existsSync(path)).toBe(false);
  });

  test('a load failure still counts as the one read', () => {
    const path = ledger();
    const args = { ledgerPath: path, runId: 'run-1', candidateId: 'c', verdict: accepted };
    expect(() =>
      readSealedOnce({
        ...args,
        load: () => {
          throw new Error('disk gone');
        },
      }),
    ).toThrow('disk gone');
    expect(() => readSealedOnce({ ...args, load: () => sealedCases })).toThrow(
      SealedSetAlreadyRead,
    );
  });
});
