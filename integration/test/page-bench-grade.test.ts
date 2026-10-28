import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  aggregateGrades,
  gradeRun,
  type PageBenchBank,
  type PageBenchRunRecord,
  qualityPerCost,
} from '../eval/harness-page-bench/grade.mts';

type LegacyPageRun = {
  question: string;
  harness: string;
  model: string;
  buildOk: boolean;
  consoleErrors: string[];
  requirements: Record<string, boolean>;
  screenshotPaths: string[];
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
};

function legacyMachineScore(run: LegacyPageRun): number {
  const reqs = Object.values(run.requirements);
  if (reqs.length === 0) return run.buildOk ? 1 : 0;
  const passed = reqs.filter(Boolean).length;
  if (!run.buildOk) return 0;
  return passed / reqs.length;
}

function legacyCostQuality(run: LegacyPageRun): number {
  const q = legacyMachineScore(run);
  const tokens = run.inputTokens + run.outputTokens;
  if (tokens <= 0) return q;
  return q / (tokens / 1000);
}

const BANK: PageBenchBank = {
  version: '1',
  questions: [
    {
      id: 'q-sample',
      requirements: [{ id: 'hero' }, { id: 'grid' }, { id: 'pricing' }, { id: 'footer' }],
    },
  ],
};

const scratch: string[] = [];

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sha256Hex(body: string | Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

function artifactHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'cairn-page-bench-grade-'));
  scratch.push(home);
  mkdirSync(join(home, 'shots'));
  return home;
}

function writeShot(home: string, name: string, body: string): { path: string; sha256: string } {
  const path = join(home, 'shots', name);
  writeFileSync(path, body);
  return { path, sha256: sha256Hex(body) };
}

function completeRecord(home: string, over: Partial<PageBenchRunRecord> = {}): PageBenchRunRecord {
  const desktop = writeShot(home, 'desktop.png', 'desktop-bytes');
  const mobile = writeShot(home, 'mobile.png', 'mobile-bytes');
  return {
    questionBankVersion: '1',
    questionId: 'q-sample',
    requirements: { hero: true, grid: true, pricing: true, footer: true },
    buildOk: true,
    consoleErrors: [],
    screenshots: [
      { viewport: 'desktop', path: desktop.path, sha256: desktop.sha256 },
      { viewport: 'mobile', path: mobile.path, sha256: mobile.sha256 },
    ],
    model: 'glm-5.3-flash',
    harnessVersion: 'bare-pi@0',
    budgets: { wallMs: 60_000, inputTokens: 1000, outputTokens: 200 },
    elapsedMs: 12_000,
    tokenUsage: { input: 1000, output: 200, cacheRead: 0, cacheWrite: 0 },
    retries: 0,
    ...over,
  };
}

describe('page-bench fail-closed grading (#1961)', () => {
  test('the reported case scores 1 under legacy and is invalid under gradeRun', () => {
    const reported: LegacyPageRun = {
      question: 'q',
      harness: 'bare-pi',
      model: 'm',
      buildOk: true,
      requirements: {},
      consoleErrors: ['Uncaught TypeError'],
      screenshotPaths: [],
      wallMs: 1,
      inputTokens: 10,
      outputTokens: 10,
      retries: 0,
    };
    expect(legacyMachineScore(reported)).toBe(1);

    const home = artifactHome();
    const graded = gradeRun(
      {
        questionBankVersion: '1',
        questionId: 'q-sample',
        requirements: {},
        buildOk: true,
        consoleErrors: ['Uncaught TypeError'],
        screenshots: [],
        model: 'm',
        harnessVersion: 'bare-pi@0',
        budgets: { wallMs: 1, inputTokens: 10, outputTokens: 10 },
        elapsedMs: 1,
        tokenUsage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
        retries: 0,
      },
      BANK,
      { artifactRoot: home },
    );
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.length).toBeGreaterThan(0);
    }
  });

  test('an empty requirement map is invalid', () => {
    const home = artifactHome();
    const graded = gradeRun(completeRecord(home, { requirements: {} }), BANK, {
      artifactRoot: home,
    });
    expect(graded).toMatchObject({ status: 'invalid' });
  });

  test('a map missing one bank requirement is invalid', () => {
    const home = artifactHome();
    const graded = gradeRun(
      completeRecord(home, {
        requirements: { hero: true, grid: true, pricing: true },
      }),
      BANK,
      { artifactRoot: home },
    );
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.join(' ')).toMatch(/footer|incomplete|missing/i);
    }
  });

  test('an unknown question id is invalid', () => {
    const home = artifactHome();
    const graded = gradeRun(completeRecord(home, { questionId: 'q-unknown' }), BANK, {
      artifactRoot: home,
    });
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.join(' ')).toMatch(/question/i);
    }
  });

  test('an unknown requirement id is invalid', () => {
    const home = artifactHome();
    const graded = gradeRun(
      completeRecord(home, {
        requirements: {
          hero: true,
          grid: true,
          pricing: true,
          footer: true,
          mystery: true,
        },
      }),
      BANK,
      { artifactRoot: home },
    );
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.join(' ')).toMatch(/mystery|unknown/i);
    }
  });

  test('console errors follow the rubric: any console error makes the run invalid', () => {
    const home = artifactHome();
    const graded = gradeRun(
      completeRecord(home, { consoleErrors: ['Uncaught TypeError: x is not a function'] }),
      BANK,
      { artifactRoot: home },
    );
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.join(' ')).toMatch(/console/i);
    }
  });

  test('missing desktop or mobile screenshot is invalid', () => {
    const home = artifactHome();
    const desktop = writeShot(home, 'desktop.png', 'desktop-only');
    const graded = gradeRun(
      completeRecord(home, {
        screenshots: [{ viewport: 'desktop', path: desktop.path, sha256: desktop.sha256 }],
      }),
      BANK,
      { artifactRoot: home },
    );
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.join(' ')).toMatch(/mobile|viewport|screenshot/i);
    }
  });

  test('a nonexistent or unreadable screenshot is invalid', () => {
    const home = artifactHome();
    const desktop = writeShot(home, 'desktop.png', 'desktop-bytes');
    const mobilePath = join(home, 'shots', 'missing-mobile.png');
    const gradedMissing = gradeRun(
      completeRecord(home, {
        screenshots: [
          { viewport: 'desktop', path: desktop.path, sha256: desktop.sha256 },
          {
            viewport: 'mobile',
            path: mobilePath,
            sha256: sha256Hex('ghost'),
          },
        ],
      }),
      BANK,
      { artifactRoot: home },
    );
    expect(gradedMissing.status).toBe('invalid');

    const locked = writeShot(home, 'locked-mobile.png', 'locked-bytes');
    chmodSync(locked.path, 0);
    try {
      const gradedUnreadable = gradeRun(
        completeRecord(home, {
          screenshots: [
            { viewport: 'desktop', path: desktop.path, sha256: desktop.sha256 },
            {
              viewport: 'mobile',
              path: locked.path,
              sha256: locked.sha256,
            },
          ],
        }),
        BANK,
        { artifactRoot: home },
      );
      expect(gradedUnreadable.status).toBe('invalid');
    } finally {
      chmodSync(locked.path, 0o644);
    }
  });

  test('a sha256 mismatch is invalid', () => {
    const home = artifactHome();
    const desktop = writeShot(home, 'desktop.png', 'desktop-bytes');
    const mobile = writeShot(home, 'mobile.png', 'mobile-bytes');
    const graded = gradeRun(
      completeRecord(home, {
        screenshots: [
          { viewport: 'desktop', path: desktop.path, sha256: desktop.sha256 },
          {
            viewport: 'mobile',
            path: mobile.path,
            sha256: 'a'.repeat(64),
          },
        ],
      }),
      BANK,
      { artifactRoot: home },
    );
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.join(' ')).toMatch(/sha256|digest|hash/i);
    }
  });

  test('complete evidence with 3 of 4 requirements passed scores per the rubric', () => {
    const home = artifactHome();
    const graded = gradeRun(
      completeRecord(home, {
        requirements: { hero: true, grid: true, pricing: true, footer: false },
      }),
      BANK,
      { artifactRoot: home },
    );
    expect(graded).toEqual({
      status: 'valid',
      score: 0.75,
      perRequirement: { hero: true, grid: true, pricing: true, footer: false },
    });
  });

  test('build failure scores per the rubric', () => {
    const home = artifactHome();
    const graded = gradeRun(completeRecord(home, { buildOk: false }), BANK, { artifactRoot: home });
    expect(graded).toEqual({
      status: 'valid',
      score: 0,
      perRequirement: { hero: true, grid: true, pricing: true, footer: true },
    });
  });

  test('zero, missing or negative token usage makes quality-per-cost unavailable, never raw quality', () => {
    const home = artifactHome();
    const valid = gradeRun(completeRecord(home), BANK, { artifactRoot: home });
    expect(valid.status).toBe('valid');
    if (valid.status !== 'valid') throw new Error('expected valid');

    expect(
      legacyCostQuality({
        question: 'q',
        harness: 'h',
        model: 'm',
        buildOk: true,
        consoleErrors: [],
        requirements: { a: true },
        screenshotPaths: ['x'],
        wallMs: 1,
        inputTokens: 0,
        outputTokens: 0,
        retries: 0,
      }),
    ).toBe(1);

    expect(
      qualityPerCost({
        score: valid.score,
        tokenUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      }),
    ).toBeNull();
    expect(
      qualityPerCost({
        score: valid.score,
        tokenUsage: { input: -1, output: 10, cacheRead: 0, cacheWrite: 0 },
      }),
    ).toBeNull();
    expect(
      qualityPerCost({
        score: valid.score,
        tokenUsage: null,
      }),
    ).toBeNull();
    expect(
      qualityPerCost({
        score: 1,
        tokenUsage: { input: 500, output: 500, cacheRead: 0, cacheWrite: 0 },
      }),
    ).toBeCloseTo(1);
  });

  test('aggregates exclude invalid runs and report their count and reasons', () => {
    const home = artifactHome();
    const ok = gradeRun(completeRecord(home), BANK, { artifactRoot: home });
    const bad = gradeRun(completeRecord(home, { requirements: {} }), BANK, { artifactRoot: home });
    const summary = aggregateGrades([ok, bad, bad]);
    expect(summary.validCount).toBe(1);
    expect(summary.invalidCount).toBe(2);
    expect(summary.meanScore).toBe(1);
    expect(summary.invalidReasons.length).toBe(2);
    expect(summary.invalidReasons.every((row) => row.length > 0)).toBe(true);
  });

  test('a record missing required fields with buildOk as a string is invalid and stays out of aggregates', () => {
    const home = artifactHome();
    const desktop = writeShot(home, 'desktop.png', 'desktop-bytes');
    const mobile = writeShot(home, 'mobile.png', 'mobile-bytes');
    const malformed = {
      questionBankVersion: '1',
      questionId: 'q-sample',
      requirements: { hero: true, grid: true, pricing: true, footer: true },
      buildOk: 'false',
      consoleErrors: [],
      screenshots: [
        { viewport: 'desktop', path: desktop.path, sha256: desktop.sha256 },
        { viewport: 'mobile', path: mobile.path, sha256: mobile.sha256 },
      ],
    };
    const graded = gradeRun(malformed, BANK, { artifactRoot: home });
    expect(graded.status).toBe('invalid');
    if (graded.status === 'invalid') {
      expect(graded.reasons.length).toBeGreaterThan(0);
      expect(graded.reasons.join(' ')).toMatch(
        /model|harnessVersion|budgets|elapsedMs|tokenUsage|retries|buildOk|schema|malformed/i,
      );
    }
    const ok = gradeRun(completeRecord(home), BANK, { artifactRoot: home });
    const summary = aggregateGrades([ok, graded]);
    expect(summary.validCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
    expect(summary.meanScore).toBe(1);
  });

  test('null requirements yield invalid reasons and do not throw', () => {
    const home = artifactHome();
    const record = {
      ...completeRecord(home),
      requirements: null,
    };
    let thrown: unknown;
    let graded: ReturnType<typeof gradeRun> | undefined;
    try {
      graded = gradeRun(record, BANK, { artifactRoot: home });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(graded?.status).toBe('invalid');
    if (graded?.status === 'invalid') {
      expect(graded.reasons.length).toBeGreaterThan(0);
    }
  });
});
