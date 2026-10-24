import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
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
    expect(r).toEqual({ n: 0, meanDiff: 0, sdDiff: 0, z: 0, degenerate: 'too_few_pairs' });
  });

  test('zero variance with nonzero mean yields signed infinity', () => {
    expect(pairedZ(Array.from({ length: MIN_PAIRS }, () => 0.5)).z).toBe(Number.POSITIVE_INFINITY);
    expect(pairedZ(Array.from({ length: MIN_PAIRS }, () => -0.5)).z).toBe(Number.NEGATIVE_INFINITY);
    expect(pairedZ(Array.from({ length: MIN_PAIRS }, () => 0.5)).degenerate).toBe('zero_variance');
  });

  test('zero variance with zero mean yields z = 0', () => {
    const r = pairedZ(Array.from({ length: MIN_PAIRS }, () => 0));
    expect(r.z).toBe(0);
    expect(r.degenerate).toBe('zero_variance');
  });
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
    const noise = [0.02, -0.03, 0.01, 0.04, -0.02, -0.01, 0.03, -0.04, 0.02, -0.01];
    const v = judgeAdoption(noise.map((d, i) => pair(`c${i}`, [scored(0.5)], [scored(0.5 + d)])));
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
  const dirs: string[] = [];
  const ledger = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cairn-adoption-sealed-'));
    dirs.push(dir);
    return join(dir, 'nested', 'sealed-reads.json');
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

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

  test('a candidate that did not pass the three gates cannot read the sealed set', () => {
    const path = ledger();
    const rejected = judgeAdoption(
      Array.from({ length: 10 }, (_, i) => pair(`c${i}`, [scored(0.2)], [scored(0.9, false)])),
    );
    expect(() =>
      readSealedOnce({
        ledgerPath: path,
        runId: 'run-1',
        candidateId: 'c',
        verdict: rejected,
        load: () => sealedCases,
      }),
    ).toThrow(/accepted/);
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
